#!/usr/bin/env node
// Usage:
//   node seo-check.mjs <url> [--ua checker|browser|googlebot|bingbot|oai-searchbot|<string>] [--json]
//   node seo-check.mjs <url> --deep      # also verify canonical target, hreflang reciprocity, og:image
//   node seo-check.mjs <url> --bots      # compare what browsers, search bots and AI bots receive (runs alone)
// Single-page technical/on-page/structured-data check of the RAW server HTML (no JS),
// which is what non-rendering crawlers (most AI crawlers) see.
// Exit: 2 = FATAL, 1 = HIGH, 0 = otherwise, 3 = could not complete, 64 = usage error.

import { parseArgs, fetchChain, resolveUA, UA_PRESETS, printIssues, exitCodeFor, normalizeUrl, findTags, scan, runMain, urlArg } from './lib.mjs';
import { analyzeHtml, analyzeResponse } from './page.mjs';
import { T } from './thresholds.mjs';

const USAGE = 'node seo-check.mjs <url> [--ua preset] [--deep] [--bots] [--json]';
const args = parseArgs(process.argv.slice(2));

runMain(async () => {
  const url = urlArg(args._[0]);
  if (args.bots) return bots(url);

  const ua = resolveUA(args.ua);
  const res = await fetchChain(url, { ua });
  const issues = [];
  let analysis = null;

  if (res.chain.length > 1) issues.push({ sev: 'MEDIUM', code: 'redirect-chain', msg: `${res.chain.length} redirect hops before the final URL (aim for 1). ${res.chain.map((h) => `${h.status} ${h.url}`).join(' -> ')} -> ${res.finalUrl}` });
  for (const h of res.chain) if ([302, 303, 307].includes(h.status)) issues.push({ sev: 'LOW', code: 'temporary-redirect', msg: `${h.status} (temporary) redirect at ${h.url}; use 301/308 for permanent moves.` });

  if (res.error && !res.status) issues.push({ sev: res.chain.length ? 'FATAL' : 'INFO', code: 'fetch-failed', msg: `Request failed: ${res.error}${res.chain.length ? '' : ' (no response at all: could not complete, exit 3)'}` });
  else if (res.error) issues.push({ sev: 'FATAL', code: /redirect|Location/i.test(res.error) ? 'redirect-error' : 'fetch-failed', msg: res.error });
  else if (res.status >= 400) issues.push({ sev: 'FATAL', code: 'http-error', msg: `Final status ${res.status}. The page cannot be indexed.` });
  else if (res.status !== 200) issues.push({ sev: 'HIGH', code: 'non-200', msg: `Final status ${res.status}; indexable pages must return 200.` });
  else {
    if (res.ttfbMs > T.slowResponseMs) issues.push({ sev: 'MEDIUM', code: 'slow-response', msg: `Server responded in ${res.ttfbMs} ms. Slow servers hurt LCP and crawl rate; measure properly with cwv.mjs.` });
    const ct = res.headers?.get('content-type') || '';
    if (/html/i.test(ct) || (!ct && /<html|<!doctype/i.test(res.body.slice(0, 500)))) {
      analysis = await analyzeResponse(res, ua);
      issues.push(...analysis.issues);
      const enc = res.headers.get('content-encoding');
      if (!enc && res.bytes > 50_000) issues.push({ sev: 'LOW', code: 'no-compression', msg: `${Math.round(res.bytes / 1024)} KB of HTML served without gzip/brotli; slower for users and crawlers.` });
    } else issues.push({ sev: 'INFO', code: 'not-html', msg: `Content-Type is "${ct}"; HTML checks skipped.` });
  }

  if (args.deep && analysis) await deepChecks(analysis, res, ua, issues);
  const code = report(url, res, analysis, issues);
  return res.status === 0 && !res.chain.length ? 3 : code; // no response at all: could not complete
}, USAGE);

async function deepChecks(a, res, ua, issues) {
  const self = normalizeUrl(a.canonical || res.finalUrl);
  if (a.canonical && a.canonical !== normalizeUrl(res.finalUrl)) {
    const c = await fetchChain(a.canonical, { ua, read: false });
    if (c.status !== 200 || c.chain.length) issues.push({ sev: 'HIGH', code: 'canonical-target-bad', msg: `Canonical target ${a.canonical} returns ${c.status || c.error}${c.chain.length ? ` after ${c.chain.length} redirect(s)` : ''}; canonicals must point to a 200, indexable URL.` });
  }
  for (const h of a.hreflangs) {
    if (!h.href || h.href === self) continue;
    const alt = await fetchChain(h.href, { ua });
    if (alt.status !== 200) {
      issues.push({ sev: 'MEDIUM', code: 'hreflang-target-bad', msg: `hreflang ${h.lang} -> ${h.href} returns ${alt.status || alt.error}.` });
      continue;
    }
    const back = findTags(scan(alt.body).masked, 'link').some(
      (l) => (l.attrs.rel || '').toLowerCase().split(/\s+/).includes('alternate') && l.attrs.hreflang && l.attrs.href && normalizeUrl(l.attrs.href.trim(), alt.finalUrl) === self
    );
    if (!back) issues.push({ sev: 'MEDIUM', code: 'hreflang-not-reciprocal', msg: `${h.href} (${h.lang}) does not link back to this page; Google ignores one-way hreflang pairs.` });
  }
  const assets = [];
  if (a.og['og:image']) assets.push(['og:image', a.og['og:image'], 'og-image-broken', 'MEDIUM']);
  if (a.icons[0]) assets.push(['favicon', a.icons[0], 'favicon-broken', 'LOW']);
  for (const [label, href, code, sev] of assets) {
    let abs;
    try { abs = new URL(href, res.finalUrl).href; } catch { issues.push({ sev, code, msg: `${label} URL is invalid: ${href}` }); continue; }
    const r = await fetchChain(abs, { ua, read: false });
    const ct = r.headers?.get('content-type') || '';
    if (r.status !== 200 || !/^image\//i.test(ct)) issues.push({ sev, code, msg: `${label} ${abs} returns ${r.status || r.error} ${ct || ''} (expected an image). Shared links${label === 'favicon' ? ' and search results' : ''} show no image.` });
  }
}

async function bots(url) {
  const presets = ['browser', 'googlebot', 'bingbot', 'oai-searchbot', 'perplexitybot', 'claudebot', 'gptbot'];
  if (!args.json) console.error('Note: sending spoofed crawler user agents from this IP. Sites behind a WAF/CDN bot shield may rate-limit or block it (get the owner\'s OK for production).\n');
  const rows = [];
  for (const p of presets) {
    const r = await fetchChain(url, { ua: UA_PRESETS[p] });
    const a = r.status === 200 && !r.error ? await analyzeResponse(r, UA_PRESETS[p]) : null;
    rows.push({ ua: p, status: r.status || r.error, hops: r.chain.length, words: a?.words ?? 0, title: a?.title ?? '', prices: a?.prices?.length ?? 0, noindex: a?.noindex ?? false });
  }
  const issues = [];
  const base = rows[0];
  const unreachable = typeof base.status !== 'number';
  if (base.status !== 200) issues.push({ sev: 'FATAL', code: 'browser-fetch-failed', msg: `A normal browser request returns ${base.status}; bot comparison is meaningless until the page loads.` });
  else {
    for (const r of rows.slice(1)) {
      if (r.status !== 200) {
        const sev = ['googlebot', 'bingbot'].includes(r.ua) ? 'FATAL' : ['oai-searchbot', 'perplexitybot'].includes(r.ua) ? 'HIGH' : 'INFO';
        issues.push({ sev, code: 'bot-blocked', msg: `${r.ua} gets ${r.status} while a browser gets 200 (WAF/bot rule or UA block).`, fix: 'Allow verified search and AI-search crawlers in the WAF; block training bots by name only if the owner wants that. Some WAFs block any spoofed UA from non-official IPs, so confirm in WAF logs / GSC URL Inspection before changing rules.' });
      } else if (base.words > 100 && r.words < base.words * 0.5) {
        issues.push({ sev: 'MEDIUM', code: 'bot-content-diff', msg: `${r.ua} receives ${r.words} words vs ${base.words} for a browser. Serving bots different content risks cloaking or empty pages.` });
      }
      if (base.prices > 0 && r.status === 200 && r.prices === 0) issues.push({ sev: 'MEDIUM', code: 'bot-no-prices', msg: `${r.ua} sees no prices in the HTML (browser sees ${base.prices}).` });
    }
  }
  if (args.json) console.log(JSON.stringify({ url, rows, issues }, null, 2));
  else {
    console.log(`Bot comparison for ${url}\n`);
    console.log('UA'.padEnd(16) + 'status'.padEnd(10) + 'hops'.padEnd(6) + 'words'.padEnd(8) + 'prices'.padEnd(8) + 'noindex'.padEnd(9) + 'title');
    for (const r of rows) console.log(r.ua.padEnd(16) + String(r.status).slice(0, 9).padEnd(10) + String(r.hops).padEnd(6) + String(r.words).padEnd(8) + String(r.prices).padEnd(8) + String(r.noindex).padEnd(9) + r.title.slice(0, 50));
    console.log('\nNote: these requests spoof the UA from your IP. Sites that verify crawler IPs may answer differently than they do for the real bots.\n');
    printIssues(issues);
  }
  return unreachable ? 3 : exitCodeFor(issues);
}

function report(url, res, a, issues) {
  if (args.json) {
    const { links, mainText, ...rest } = a || {};
    console.log(JSON.stringify({ url, finalUrl: res.finalUrl, status: res.status, error: res.error, chain: res.chain, ttfbMs: res.ttfbMs, bytes: res.bytes, ...rest, internalLinkUrls: links ? [...new Set(links.filter((l) => l.url).map((l) => l.url))].slice(0, 200) : [], issues }, null, 2));
  } else {
    console.log(`URL:        ${url}`);
    if (res.chain?.length) console.log(`Redirects:  ${res.chain.map((h) => `${h.status} ${h.url}`).join(' -> ')} -> ${res.finalUrl}`);
    console.log(`Status:     ${res.status || res.error}   TTFB ${res.ttfbMs ?? '-'} ms   ${Math.round((res.bytes || 0) / 1024)} KB   UA: ${args.ua || 'checker'}`);
    if (a) {
      console.log(`Title:      ${a.title || '(none)'} [${a.titleLength}]`);
      console.log(`Desc:       ${a.description ? a.description.slice(0, 100) : '(none)'} [${a.descriptionLength}]`);
      console.log(`Canonical:  ${a.canonical || '(none)'}`);
      console.log(`Robots:     ${a.robots || '(none: indexable)'}`);
      console.log(`H1:         ${a.h1s.length ? a.h1s.map((h) => `"${h.slice(0, 60)}"`).join(', ') : '(none)'}`);
      console.log(`Text:       ${a.words} words in raw HTML; ${a.internalLinks} internal links; prices seen: ${a.prices.join(' ') || 'none'}`);
      console.log(`Schema:     ${a.schemaTypes.join(', ') || 'none'} (${a.jsonLdBlocks} JSON-LD blocks)`);
      if (a.hreflangs.length) console.log(`hreflang:   ${a.hreflangs.map((h) => h.lang).join(', ')}`);
    }
    console.log('');
    printIssues(issues);
  }
  return exitCodeFor(issues);
}
