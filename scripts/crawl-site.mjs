#!/usr/bin/env node
// Usage:
//   node crawl-site.mjs https://example.com [--max 300] [--max-sitemap 500] [--concurrency 4]
//                       [--sitemap URL] [--money "^/(pricing|admissions|courses)"] [--out seo/crawl.json] [--json]
// Crawls like a search engine (follows <a href> from the homepage, obeys robots.txt for
// Googlebot), reads every sitemap, and reports: soft 404s, broken links, redirect chains,
// sitemap hygiene, noindex/canonical conflicts, duplicate titles, near-duplicate templates,
// click depth, orphans, contextual in-links, URL-variant duplicates, broken OG images/favicons,
// non-production hosts in canonicals, and page-level problems rolled up sitewide.
// --max caps pages reached via links; sitemap-only URLs are fetched on top (up to --max-sitemap).
// Exit: 2 = FATAL, 1 = HIGH, 0 = otherwise, 3 = could not complete, 64 = usage error.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { enableSsrfGuard, parseArgs, fetchChain, pool, normalizeUrl, NON_HTML_EXT, NON_PROD_HOST, maybeGunzip, printIssues, exitCodeFor, stripChrome, extractLinks, textOf, mainContent, baseUrlOf, runMain, urlArg, intArg, UsageError } from './lib.mjs';
import { parseRobots, isAllowed } from './robots.mjs';
import { analyzeHtml, analyzeResponse } from './page.mjs';
import { T } from './thresholds.mjs';

const USAGE = 'node crawl-site.mjs <origin> [--max N] [--max-sitemap N] [--concurrency N] [--sitemap URL] [--money REGEX] [--out file] [--json]';
const args = parseArgs(process.argv.slice(2));

// Page-level codes worth rolling up sitewide (others are covered by crawl-level checks).
const ROLLUP = new Set(['noindex-ambiguous', 'client-rendered', 'canonical-in-body', 'canonical-conflict', 'canonical-foreign-host', 'metadata-streamed', 'jsonld-parse-error', 'no-viewport', 'html-over-2mb', 'soft-404-text', 'hreflang-invalid', 'hreflang-foreign-host', 'js-links', 'schema-missing-required', 'nofollow-page']);

runMain(async () => {
  const requested = normalizeUrl(urlArg(args._[0], 'origin'));
  await enableSsrfGuard(requested, { allowPrivate: args['allow-private'] === true });
  // Follow the entry redirect (apex -> www, http -> https) so the crawl runs on the real host.
  const entry = await fetchChain(requested, { read: false });
  if (entry.status === 0 && !entry.chain.length) {
    const msg = `Could not reach ${requested}: ${entry.error}`;
    if (args.json) console.log(JSON.stringify({ error: msg, notMeasured: true, issues: [{ sev: 'INFO', code: 'unreachable', msg }] }));
    else console.error(msg);
    return 3;
  }
  const start = entry.chain.length && entry.status === 200 ? normalizeUrl(entry.finalUrl) : requested;
  const origin = new URL(start).origin;
  const host = new URL(start).host;
  const MAX = intArg(args.max, 300, 'max');
  const MAX_SM = intArg(args['max-sitemap'], 500, 'max-sitemap');
  const CONC = Math.max(1, intArg(args.concurrency, 4, 'concurrency'));
  if (args.out === true) throw new UsageError('--out needs a file path');
  if (args.sitemap === true) throw new UsageError('--sitemap needs a URL');
  let MONEY = null;
  if (args.money) {
    try { MONEY = new RegExp(args.money); } catch (e) { throw new UsageError(`--money is not a valid regex: ${e.message}`); }
  }
  const issues = [];
  const add = (sev, code, msg, urls, fix) => issues.push({ sev, code, msg, urls, fix });
  if (start !== requested) add('INFO', 'entry-redirect', `${requested} redirects to ${start} (${entry.chain.length} hop(s)); crawling ${new URL(start).host}.`, entry.chain.map((h) => `${h.status} ${h.url}`));

  // ---------- robots ----------
  const robotsRes = await fetchChain(`${origin}/robots.txt`, { maxHops: T.robotsMaxRedirectHops });
  let robotsText = '';
  if (robotsRes.status === 429 || robotsRes.status >= 500 || (robotsRes.status === 0 && !/redirect/.test(robotsRes.error || ''))) {
    add('FATAL', 'robots-5xx', `robots.txt returns ${robotsRes.status || robotsRes.error}. Google stops crawling the site while robots.txt errors (see thresholds.md).`, [`${origin}/robots.txt`]);
  } else if (robotsRes.status === 200 && !/<html|<!doctype/i.test(robotsRes.body.slice(0, 300))) robotsText = robotsRes.body;
  const robots = parseRobots(robotsText);
  const allowed = (u) => {
    const x = new URL(u);
    return isAllowed(robots, 'Googlebot', x.pathname + x.search).allowed;
  };
  if (!allowed(start)) add('FATAL', 'home-blocked', 'robots.txt blocks Googlebot from the homepage.', [start]);

  // ---------- sitemaps ----------
  const sitemapUrls = new Map();
  const sitemapErrors = [];
  const seenSitemaps = new Set();
  const skippedSitemaps = [];
  const SITEMAP_CAP = 1000;
  async function readSitemap(u, depth = 0) {
    if (seenSitemaps.has(u) || depth > 3) return;
    if (seenSitemaps.size >= SITEMAP_CAP) { skippedSitemaps.push(u); return; }
    seenSitemaps.add(u);
    const r = await fetchChain(u, { read: 'buffer', maxHops: 5, maxBytes: 60_000_000 });
    if (r.status !== 200 || r.error) { sitemapErrors.push(`${u} -> ${r.status || ''} ${r.error || ''}`.trim()); return; }
    let xml;
    try { xml = maybeGunzip(r.buffer).toString('utf8'); } catch (e) { sitemapErrors.push(`${u} -> ${/maxOutputLength|buffer/i.test(e.message) ? 'decompresses to more than 50 MB (sitemap limit)' : 'gzip error'}`); return; }
    if (!/<(urlset|sitemapindex)\b/i.test(xml)) { sitemapErrors.push(`${u} -> not sitemap XML`); return; }
    if (/<sitemapindex\b/i.test(xml)) {
      for (const m of xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<]+?)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)) await readSitemap(m[1].replace(/&amp;/g, '&'), depth + 1);
      return;
    }
    xml = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)];
    if (entries.length > T.sitemapMaxUrls) add('HIGH', 'sitemap-too-big', `${u} lists ${entries.length} URLs; the per-file limit is ${T.sitemapMaxUrls} (thresholds.md).`);
    for (const e of entries) {
      const loc = e[1].match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1]?.replace(/&amp;|&#38;|&#x26;/gi, '&');
      const lastmod = e[1].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1] ?? null;
      const n = loc && normalizeUrl(loc);
      if (n) sitemapUrls.set(n, { lastmod, sitemap: u });
    }
  }
  const sitemapList = args.sitemap ? [String(args.sitemap)] : robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`];
  for (const s of sitemapList) await readSitemap(s);
  if (skippedSitemaps.length) add('INFO', 'sitemap-cap', `Read the first ${SITEMAP_CAP} child sitemaps; ${skippedSitemaps.length} more were skipped.`, skippedSitemaps);
  if (!sitemapUrls.size) add('MEDIUM', 'no-sitemap', `No sitemap URLs found (${sitemapErrors.join('; ') || 'none declared'}).`, [], 'Publish an XML sitemap of canonical, indexable URLs and reference it in robots.txt.');
  else if (sitemapErrors.length) add('HIGH', 'sitemap-errors', 'Some sitemaps failed to load.', sitemapErrors);
  const lastmods = [...sitemapUrls.values()].map((v) => v.lastmod).filter(Boolean);
  if (lastmods.length > 5 && new Set(lastmods).size === 1) add('INFO', 'lastmod-identical', 'Every sitemap <lastmod> is identical (usually "build time"). Google ignores lastmod it cannot trust; emit the real content-modified date.');
  // Sitemap URLs on a different host/protocol than the crawled site (e.g. apex URLs while the site
  // lives on www) are redirects at best: report them once and keep them out of the orphan check.
  const wrongHost = [...sitemapUrls.keys()].filter((u) => new URL(u).host !== host || new URL(u).protocol !== new URL(start).protocol);
  if (wrongHost.length) add('HIGH', 'sitemap-wrong-host', `${wrongHost.length} sitemap URLs are not on ${new URL(start).protocol}//${host} (the site's final host); they redirect or belong to another site.`, wrongHost, `List only ${new URL(start).protocol}//${host} URLs in the sitemap.`);
  for (const u of wrongHost) sitemapUrls.delete(u);
  const foreignLocs = [...sitemapUrls.keys()].filter((u) => { const h = new URL(u).hostname; return h !== new URL(start).hostname && NON_PROD_HOST.test(h); });
  if (foreignLocs.length && !NON_PROD_HOST.test(new URL(start).hostname)) add('HIGH', 'sitemap-foreign-host', `${foreignLocs.length} sitemap URLs point at a non-production host.`, foreignLocs, 'Generate sitemap URLs from the production origin.');

  // ---------- crawl ----------
  const pages = new Map();
  const inbound = new Map();
  const inboundCtx = new Map();
  const depth = new Map([[start, 0]]);
  const linkTargets = new Map();
  const blocked = new Set();
  const queued = new Set([start]);
  let frontier = [start];

  async function fetchPage(u) {
    if (!allowed(u)) { blocked.add(u); return { url: u, blocked: true }; }
    const r = await fetchChain(u);
    const rec = { url: u, status: r.status, error: r.error, chain: r.chain, finalUrl: r.finalUrl };
    const ct = r.headers?.get('content-type') || '';
    if (r.status === 200 && !r.error && /html/i.test(ct)) {
      try {
        const a = await analyzeResponse(r);
        const ctxLinks = new Set(extractLinks(stripChrome(r.body), r.finalUrl).map((l) => l.url).filter(Boolean));
        Object.assign(rec, {
          html: true, title: a.title, description: a.description, canonical: a.canonical, noindex: a.noindex,
          h1: a.h1s.length, words: a.words, schema: a.schemaTypes, icons: a.icons,
          ogImage: a.og['og:image'] ? (() => { try { return new URL(a.og['og:image'], baseUrlOf(r.body, r.finalUrl)).href; } catch { return a.og['og:image']; } })() : null,
          links: [...new Set(a.links.filter((l) => l.url && new URL(l.url).host === host && !/\bnofollow\b/.test(l.rel)).map((l) => l.url))],
          ctxLinks: [...ctxLinks].filter((l) => new URL(l).host === host),
          shingles: shingleSig(textOf(mainContent(r.body))),
          pageIssues: a.issues.filter((i) => ROLLUP.has(i.code)).map((i) => i.code),
        });
      } catch (e) {
        rec.analysisError = String(e?.message || e);
      }
    }
    return rec;
  }

  while (frontier.length && pages.size < MAX) {
    const batch = frontier.splice(0, MAX - pages.size); // keep the remainder queued
    const next = [];
    const recs = await pool(batch, CONC, fetchPage);
    for (const rec of recs) {
      pages.set(rec.url, rec);
      if (!rec.links) continue;
      const d = depth.get(rec.url) ?? 0;
      for (const l of rec.links) {
        if (NON_HTML_EXT.test(new URL(l).pathname)) continue;
        (linkTargets.get(l) ?? linkTargets.set(l, new Set()).get(l)).add(rec.url);
        if (l === rec.url) continue;
        (inbound.get(l) ?? inbound.set(l, new Set()).get(l)).add(rec.url);
        if (!depth.has(l)) depth.set(l, d + 1);
        if (!queued.has(l)) { queued.add(l); next.push(l); }
      }
      for (const l of rec.ctxLinks) if (l !== rec.url) (inboundCtx.get(l) ?? inboundCtx.set(l, new Set()).get(l)).add(rec.url);
    }
    frontier = [...frontier, ...next];
  }
  const truncated = frontier.length > 0;
  const linkCrawled = pages.size;

  const sitemapOnly = [...sitemapUrls.keys()].filter((u) => !pages.has(u)).slice(0, MAX_SM);
  for (const rec of await pool(sitemapOnly, CONC, fetchPage)) pages.set(rec.url, rec);

  // ---------- soft 404, protocol/host and URL variants ----------
  const probe = `${origin}/seo-skill-probe-${Math.random().toString(36).slice(2, 10)}`;
  const pr = await fetchChain(probe, { read: false });
  if (pr.status === 200) add('HIGH', 'soft-404', `A non-existent URL returns 200 (${probe}). Every typo/garbage URL becomes an indexable duplicate ("Soft 404" in Search Console).`, [probe], 'Return 404 for unknown paths (Next.js: notFound(); Pages Router: notFound:true; SPA hosts: no rewrite-all fallback for unknown paths).');
  if (start.startsWith('https:')) {
    const h = await fetchChain(start.replace(/^https:/, 'http:'), { read: false });
    if (h.status === 200 && !h.chain.length) add('HIGH', 'http-not-redirected', 'http:// serves the page with 200 instead of redirecting to https://.', [start.replace(/^https:/, 'http:')]);
    else if (h.chain.length > 1) add('LOW', 'http-redirect-chain', `http:// takes ${h.chain.length} hops to reach https://.`, h.chain.map((c) => c.url));
  }
  if (!NON_PROD_HOST.test(new URL(start).hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(new URL(start).hostname)) {
    const altHost = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
    const alt = await fetchChain(`${new URL(start).protocol}//${altHost}/`, { read: false, timeoutMs: 8000 });
    if (alt.status === 200 && !alt.chain.length) add('MEDIUM', 'host-duplicate', `${altHost} serves content without redirecting to ${host} (duplicate host).`, [`${new URL(start).protocol}//${altHost}/`]);
  }
  const ok = [...pages.values()].filter((r) => r.html && r.status === 200 && !r.chain?.length);
  const variantDupes = [];
  for (const r of ok.filter((r) => new URL(r.url).pathname.length > 1).slice(0, 3)) {
    const u = new URL(r.url);
    const variants = [u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : `${u.pathname}/`];
    if (/[a-z]/.test(u.pathname)) variants.push(u.pathname.toUpperCase());
    for (const v of variants) {
      const vu = `${u.origin}${v}${u.search}`;
      const vr = await fetchChain(vu);
      if (vr.status !== 200 || vr.chain.length) continue;
      const va = (() => { try { return analyzeHtml(vr.body, vr.finalUrl, vr.headers); } catch { return null; } })();
      if (va && va.canonical !== (r.canonical || normalizeUrl(r.url))) variantDupes.push(`${vu} (200, canonical ${va.canonical || 'none'}) duplicates ${r.url}`);
    }
  }
  if (variantDupes.length) add('MEDIUM', 'url-variant-duplicate', 'Trailing-slash or uppercase variants of pages return 200 without redirecting or canonicalizing to the main URL.', variantDupes, 'Redirect variants (301) to one form, or at least canonicalize them to it.');

  // ---------- analysis ----------
  const recs = [...pages.values()];
  const indexable = ok.filter((r) => !r.noindex && (!r.canonical || r.canonical === normalizeUrl(r.finalUrl)));

  const home = pages.get(start);
  if (home && !home.blocked && home.status !== 200) add('FATAL', 'home-status', `Homepage returns ${home.status || home.error}.`, [start]);
  if (home?.noindex) add('FATAL', 'home-noindex', 'Homepage is noindex.', [start]);

  const broken = [];
  for (const [target, sources] of linkTargets) {
    const rec = pages.get(target);
    if (rec && !rec.blocked && (rec.status >= 400 || rec.status === 0)) broken.push(`${target} (${rec.status || rec.error}) linked from ${[...sources].slice(0, 3).join(', ')}`);
  }
  if (broken.length) add('HIGH', 'broken-internal-links', `${broken.length} internal link targets return errors.`, broken, 'Fix the href or restore/redirect the target.');

  const toRedirect = recs.filter((r) => r.chain?.length && linkTargets.has(r.url)).map((r) => `${r.url} -> ${r.finalUrl}`);
  if (toRedirect.length) add('LOW', 'links-to-redirects', `${toRedirect.length} internal links point at redirecting URLs (update hrefs to the final URL).`, toRedirect);
  const chains = recs.filter((r) => r.chain?.length > 1).map((r) => `${r.url} (${r.chain.length} hops) -> ${r.finalUrl}`);
  if (chains.length) add('MEDIUM', 'redirect-chains', `${chains.length} URLs redirect through more than 1 hop.`, chains, 'Point every redirect straight at the final URL.');

  const sm = (pred) => [...sitemapUrls.keys()].filter((u) => pred(pages.get(u), u));
  const smBad = {
    'sitemap-non-200': sm((r) => r && !r.blocked && (r.status !== 200 || r.chain?.length || r.error)),
    'sitemap-noindex': sm((r) => r?.noindex),
    'sitemap-non-canonical': sm((r) => r?.canonical && r.canonical !== normalizeUrl(r.finalUrl)),
    'sitemap-blocked': sm((r, u) => blocked.has(u)),
  };
  const smMsg = {
    'sitemap-non-200': 'Sitemap lists URLs that redirect or error.',
    'sitemap-noindex': 'Sitemap lists noindex URLs (mixed signals: "index this" + "do not index").',
    'sitemap-non-canonical': 'Sitemap lists URLs whose canonical points elsewhere.',
    'sitemap-blocked': 'Sitemap lists URLs blocked by robots.txt.',
  };
  for (const [code, urls] of Object.entries(smBad)) if (urls.length) add('HIGH', code, smMsg[code], urls, 'List only canonical, indexable, 200 URLs in the sitemap.');

  const missingTitle = ok.filter((r) => !r.title).map((r) => r.url);
  if (missingTitle.length) add('HIGH', 'missing-title', `${missingTitle.length} pages have no <title>.`, missingTitle);
  const group = (key) => {
    const m = new Map();
    for (const r of indexable) if (r[key]) (m.get(r[key]) ?? m.set(r[key], []).get(r[key])).push(r.url);
    return [...m].filter(([, v]) => v.length > 1);
  };
  const dupT = group('title');
  if (dupT.length) add('MEDIUM', 'duplicate-titles', `${dupT.length} titles are shared by multiple indexable pages (cannibalization / unclear targeting).`, dupT.map(([t, u]) => `"${t}" x${u.length}: ${u.slice(0, 4).join(', ')}`));
  const dupD = group('description');
  if (dupD.length) add('LOW', 'duplicate-descriptions', `${dupD.length} meta descriptions are reused across pages.`, dupD.map(([t, u]) => `"${t.slice(0, 60)}" x${u.length}`));
  const noH1 = indexable.filter((r) => !r.h1).map((r) => r.url);
  if (noH1.length) add('MEDIUM', 'missing-h1', `${noH1.length} indexable pages have no <h1>.`, noH1);
  const thin = indexable.filter((r) => r.words < T.lowTextWords).map((r) => `${r.url} (${r.words} words)`);
  if (thin.length) add('LOW', 'low-text', `${thin.length} indexable pages have under ${T.lowTextWords} words of text. Word count is not a ranking factor, but near-empty pages are often "Crawled - currently not indexed".`, thin);

  const deep = indexable.filter((r) => depth.has(r.url) && depth.get(r.url) > T.maxClickDepth).map((r) => `${r.url} (depth ${depth.get(r.url)})`);
  if (deep.length) add('MEDIUM', 'deep-pages', `${deep.length} indexable pages are more than ${T.maxClickDepth} clicks from the homepage.`, deep, 'Link them from hubs/category pages or the homepage.');
  // Redirecting/erroring sitemap URLs are reported under sitemap-non-200, not as orphans.
  const orphans = [...sitemapUrls.keys()].filter((u) => !inbound.has(u) && u !== start && pages.get(u)?.status === 200 && !pages.get(u).chain?.length);
  if (orphans.length) {
    if (truncated) add('INFO', 'possible-orphans', `${orphans.length} sitemap URLs were not linked from the ${linkCrawled} pages crawled. The crawl hit --max, so re-run with a higher --max before treating them as orphans.`, orphans);
    else add('MEDIUM', 'orphan-pages', `${orphans.length} sitemap URLs have no internal links pointing to them.`, orphans, 'Add contextual links from related pages (see references/internal-linking.md).');
  }

  const dupPairs = [];
  outer: for (let i = 0; i < indexable.length; i++) {
    for (let j = i + 1; j < indexable.length; j++) {
      const a = indexable[i], b = indexable[j];
      if (!a.shingles || !b.shingles || a.words < 60 || b.words < 60) continue;
      const sim = similarity(a.shingles, b.shingles);
      if (sim >= T.nearDuplicateSimilarity) dupPairs.push(`${Math.round(sim * 100)}%: ${a.url} ~ ${b.url}`);
      if (dupPairs.length >= 200) break outer;
    }
  }
  if (dupPairs.length) add('MEDIUM', 'near-duplicates', `${dupPairs.length} page pairs have >= ${Math.round(T.nearDuplicateSimilarity * 100)}% similar main content (template pages with only a name swapped). Google may index one and drop the rest; at scale this matches "scaled content abuse".`, dupPairs, 'Add genuinely unique data per page, consolidate, or noindex the thin variants.');

  // Roll up page-level problems.
  const rolled = new Map();
  for (const r of recs) for (const c of r.pageIssues || []) (rolled.get(c) ?? rolled.set(c, []).get(c)).push(r.url);
  const rollSev = { 'noindex-ambiguous': 'HIGH', 'client-rendered': 'HIGH', 'canonical-in-body': 'HIGH', 'canonical-conflict': 'HIGH', 'canonical-foreign-host': 'HIGH', 'jsonld-parse-error': 'HIGH', 'no-viewport': 'HIGH', 'html-over-2mb': 'HIGH', 'soft-404-text': 'HIGH', 'hreflang-foreign-host': 'HIGH' };
  for (const [code, urls] of rolled) add(rollSev[code] || 'MEDIUM', `pages-${code}`, `${urls.length} pages have "${code}" (run seo-check.mjs on one for details).`, urls);
  const analysisErrors = recs.filter((r) => r.analysisError).map((r) => `${r.url}: ${r.analysisError}`);
  if (analysisErrors.length) add('INFO', 'analysis-errors', `${analysisErrors.length} pages could not be analysed.`, analysisErrors);

  // OG images and favicon (sample).
  const ogs = [...new Set(ok.map((r) => r.ogImage).filter(Boolean))].slice(0, 5);
  const badOg = [];
  for (const o of ogs) {
    let abs; try { abs = new URL(o).href; } catch { badOg.push(`${o} (invalid URL)`); continue; }
    const r = await fetchChain(abs, { read: false });
    const ct = r.headers?.get('content-type') || '';
    if (r.status !== 200 || !/^image\//i.test(ct)) badOg.push(`${abs} -> ${r.status || r.error} ${ct}`);
  }
  if (badOg.length) add('MEDIUM', 'og-image-broken', 'og:image URLs do not return images; shared links and link cards show no image.', badOg);
  const iconHref = home?.icons?.[0] || `${origin}/favicon.ico`;
  const ic = await fetchChain(iconHref, { read: false });
  if (ic.status !== 200 || !/^image\/|octet-stream/i.test(ic.headers?.get('content-type') || '')) add('LOW', 'favicon-broken', `Favicon ${iconHref} returns ${ic.status || ic.error} ${ic.headers?.get('content-type') || ''}; Google shows favicons next to results.`, [iconHref]);

  const moneyRows = [];
  if (MONEY) {
    for (const r of indexable) {
      if (!MONEY.test(new URL(r.url).pathname)) continue;
      moneyRows.push({ url: r.url, depth: depth.get(r.url) ?? null, inlinks: inbound.get(r.url)?.size ?? 0, contextualInlinks: inboundCtx.get(r.url)?.size ?? 0 });
    }
    const weak = moneyRows.filter((m) => m.contextualInlinks < T.minContextualInlinks).map((m) => `${m.url} (${m.contextualInlinks} contextual, ${m.inlinks} total)`);
    if (weak.length) add('MEDIUM', 'money-underlinked', `${weak.length} money pages have fewer than ${T.minContextualInlinks} contextual (body) links pointing in. Nav/footer links do not count.`, weak);
  }
  if (blocked.size) add('INFO', 'robots-blocked', `${blocked.size} linked URLs are disallowed for Googlebot (not fetched).`, [...blocked]);
  if (truncated) add('INFO', 'crawl-truncated', `Stopped at --max ${MAX} pages; ${frontier.length} discovered URLs not crawled.`, frontier.slice(0, 50));

  const summary = {
    origin, crawled: pages.size, viaLinks: linkCrawled, sitemapOnly: sitemapOnly.length, html200: ok.length, indexable: indexable.length,
    sitemapUrls: sitemapUrls.size, maxDepth: Math.max(0, ...indexable.map((r) => depth.get(r.url) ?? 0)), truncated,
  };
  const pageRows = recs.map(({ shingles, links, ctxLinks, ...r }) => ({
    ...r, depth: depth.get(r.url) ?? null, inlinks: inbound.get(r.url)?.size ?? 0, contextualInlinks: inboundCtx.get(r.url)?.size ?? 0, inSitemap: sitemapUrls.has(r.url),
  }));
  const out = { generatedAt: new Date().toISOString(), summary, issues, moneyPages: moneyRows, pages: pageRows };
  // Print first so a bad --out path never discards the crawl.
  let outError = null;
  if (args.out) {
    try {
      mkdirSync(dirname(String(args.out)), { recursive: true });
      writeFileSync(String(args.out), JSON.stringify(out, null, 2));
    } catch (e) {
      outError = `could not write --out ${args.out}: ${e.code || e.message}`;
      issues.push({ sev: 'INFO', code: 'out-write-failed', msg: outError });
    }
  }
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Crawled ${summary.crawled} URLs on ${origin} (${summary.viaLinks} via links, ${summary.sitemapOnly} sitemap-only; ${summary.html200} HTML 200, ${summary.indexable} indexable, ${summary.sitemapUrls} in sitemaps, max depth ${summary.maxDepth})${truncated ? ' [truncated]' : ''}\n`);
    printIssues(issues);
    if (moneyRows.length) {
      console.log('\nMoney pages:');
      for (const m of moneyRows) console.log(`  ${m.url}  depth=${m.depth} inlinks=${m.inlinks} contextual=${m.contextualInlinks}`);
    }
    if (args.out) console.log(outError ? `\n${outError}` : `\nFull per-page data: ${args.out}`);
  }
  return exitCodeFor(issues);
}, USAGE);

// ---------- MinHash helpers (64 seeded FNV-1a hashes over 5-word shingles) ----------
function hash32(str, seed) {
  let h = (2166136261 ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
function shingleSig(text) {
  const w = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (w.length < 10) return null;
  const sh = new Set();
  for (let i = 0; i + 5 <= w.length; i++) sh.add(w.slice(i, i + 5).join(' '));
  const sig = new Array(64).fill(0xffffffff);
  for (const s of sh) for (let k = 0; k < 64; k++) { const h = hash32(s, k); if (h < sig[k]) sig[k] = h; }
  return sig;
}
function similarity(a, b) {
  let same = 0;
  for (let k = 0; k < 64; k++) if (a[k] === b[k]) same++;
  return same / 64;
}
