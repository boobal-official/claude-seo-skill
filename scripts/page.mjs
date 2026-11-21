// Single-page analysis shared by seo-check.mjs and crawl-site.mjs.
import {
  findTags, findPaired, headEndIndex, scan, visibleText, wordCount, textOf, baseUrlOf, decodeEntities,
  extractLinks, mainContent, checkHreflangCode, PRICE_RE, normalizeUrl, NON_PROD_HOST,
} from './lib.mjs';
import { validateJsonLd } from './schema.mjs';
import { T } from './thresholds.mjs';

// Parses robots meta/X-Robots-Tag into directive sets per crawler.
// X-Robots-Tag values may be scoped: "googlebot: noindex", "otherbot: noindex, nofollow".
// "max-image-preview:none" and similar key:value directives are snippet controls, not noindex.
// `values`: the separate X-Robots-Tag header values when known (from rawHeaderValues); otherwise the
// fetch()-joined string is used, where a bare noindex after a bot-scoped directive is ambiguous
// ("googlebot-news: nosnippet" + "noindex" looks like "googlebot-news: nosnippet, noindex").
export function robotsDirectives(headers, metaTags, values = null) {
  const scopes = { generic: new Set(), googlebot: new Set(), bingbot: new Set() };
  const addTokens = (scope, str) => {
    for (const tok of String(str).toLowerCase().split(',')) {
      const t = tok.trim();
      if (!t || t.includes(':')) continue; // key:value snippet controls
      scopes[scope]?.add(t);
    }
  };
  let ambiguous = false;
  const parseValue = (raw, joined) => {
    let scope = 'generic'; // each header value starts unscoped; a UA prefix applies to the rest of it
    for (const part of raw.split(',')) {
      const m = /^\s*([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i.exec(part);
      let directive = part;
      if (m && !/^(max-snippet|max-image-preview|max-video-preview|unavailable_after)$/i.test(m[1])) {
        const ua = m[1].toLowerCase();
        scope = ua === 'googlebot' || ua === 'bingbot' ? ua : ua === 'robots' ? 'generic' : 'other';
        directive = m[2];
      }
      if (joined && !m && scope !== 'generic' && /^\s*(noindex|none)\s*$/i.test(directive)) ambiguous = true;
      if (scope !== 'other') addTokens(scope, directive);
    }
  };
  if (Array.isArray(values)) for (const v of values) parseValue(v, false);
  else {
    const raw = typeof headers?.get === 'function' ? headers.get('x-robots-tag') : null;
    if (raw) parseValue(raw, true);
  }
  for (const m of metaTags) {
    const name = (m.attrs.name || '').toLowerCase();
    if (name === 'robots') addTokens('generic', m.attrs.content || '');
    else if (name === 'googlebot' || name === 'bingbot') addTokens(name, m.attrs.content || '');
  }
  const has = (scope, d) => scopes.generic.has(d) || scopes[scope].has(d) || (d === 'noindex' || d === 'nofollow' ? scopes.generic.has('none') || scopes[scope].has('none') : false);
  const summary = ['generic', 'googlebot', 'bingbot'].filter((s) => scopes[s].size).map((s) => `${s === 'generic' ? 'robots' : s}: ${[...scopes[s]].join(', ')}`).join(' | ');
  return {
    noindexGoogle: has('googlebot', 'noindex'),
    noindexBing: has('bingbot', 'noindex'),
    nofollow: has('googlebot', 'nofollow'),
    nosnippet: has('googlebot', 'nosnippet'),
    ambiguous,
    summary,
  };
}

// A canonical that equals the URL minus tracking parameters (utm_*, gclid, fbclid ...) is correct.
const TRACKING = /^(utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|ref|igshid)$/i;
export function stripTracking(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
    return x.href.replace(/\?$/, '');
  } catch {
    return u;
  }
}

const isNext = (html) => /self\.__next_f|__NEXT_DATA__|\/_next\/static\//.test(html);

export function analyzeHtml(html, finalUrl, headers = new Headers(), opts = {}) {
  const issues = [];
  const { masked } = scan(html);
  const headEnd = headEndIndex(html);
  const inHead = (idx) => idx < headEnd;
  const base = baseUrlOf(html, finalUrl);
  const pageUrl = normalizeUrl(finalUrl);
  const pageHost = new URL(finalUrl).host;
  const metas = findTags(masked, 'meta');

  // ----- robots directives -----
  const rd = robotsDirectives(headers, metas, opts.xRobotsValues || null);
  const noindex = rd.noindexGoogle || rd.noindexBing;

  // ----- title / description -----
  const titles = findPaired(masked, 'title');
  // <title> is raw text: browsers show "<" literally, so decode entities without stripping tags.
  const titleRaw = titles.length ? html.slice(masked.indexOf('>', titles[0].index) + 1).slice(0, titles[0].inner.length) : '';
  const title = titles.length ? decodeEntities(titleRaw).replace(/\s+/g, ' ').trim() : '';
  const descTags = metas.filter((m) => (m.attrs.name || '').toLowerCase() === 'description');
  const description = descTags[0]?.attrs.content?.trim() || '';

  // ----- canonical / hreflang -----
  const linkTags = findTags(masked, 'link');
  const relHas = (l, v) => (l.attrs.rel || '').toLowerCase().split(/\s+/).includes(v);
  const canonicals = linkTags.filter((l) => relHas(l, 'canonical') && l.attrs.href !== undefined);
  const canonical = canonicals[0] ? normalizeUrl(canonicals[0].attrs.href.trim(), base) : null;
  const hreflangs = linkTags
    .filter((l) => relHas(l, 'alternate') && l.attrs.hreflang && l.attrs.href)
    .map((l) => ({ lang: l.attrs.hreflang.trim(), href: normalizeUrl(l.attrs.href.trim(), base) }));

  // ----- headings / text -----
  const h1s = findPaired(masked, 'h1').map((h) => textOf(h.inner));
  const text = visibleText(html);
  const words = wordCount(text);
  const mainText = textOf(mainContent(html));
  // Executable inline script only: JSON-LD and other data blocks do not render content.
  const scriptBytes = scan(html).scripts.filter((s) => !/json|template/i.test(s.attrs.type || '')).reduce((n, s) => n + s.inner.length, 0);
  const prices = [...new Set(text.match(PRICE_RE) || [])].slice(0, 10);

  // ----- misc -----
  const htmlTag = findTags(masked, 'html')[0]?.attrs || {};
  const viewport = metas.some((m) => (m.attrs.name || '').toLowerCase() === 'viewport');
  const og = Object.fromEntries(metas.filter((m) => (m.attrs.property || '').startsWith('og:')).map((m) => [m.attrs.property, m.attrs.content]));
  const imgs = findTags(masked, 'img');
  const imgsNoAlt = imgs.filter((i) => i.attrs.alt === undefined).length;
  const links = extractLinks(html, finalUrl);
  const internal = links.filter((l) => l.url && new URL(l.url).host === pageHost);
  const emptyAnchors = links.filter((l) => !l.text && !l.hasImgAlt && l.url).length;
  const jsLinks = links.filter((l) => /^\s*javascript:/i.test(l.href)).length;
  const schema = validateJsonLd(html);
  const icons = linkTags.filter((l) => /(^|\s)(shortcut\s+)?icon(\s|$)/i.test(l.attrs.rel || '') && l.attrs.href).map((l) => normalizeUrl(l.attrs.href, base));
  const next = isNext(html);

  // ----- issues -----
  if (noindex) {
    const who = rd.noindexGoogle && rd.noindexBing ? 'Google and Bing' : rd.noindexGoogle ? 'Google' : 'Bing';
    issues.push({ sev: 'FATAL', code: 'noindex', msg: `Page is noindex for ${who} (${rd.summary}). It will drop out of ${who}.`, fix: 'Remove noindex if this page should rank (check env-based guards that leak staging noindex to production). Intentional on login/thank-you/private pages.' });
  } else if (rd.nofollow) issues.push({ sev: 'MEDIUM', code: 'nofollow-page', msg: 'Page-level nofollow: crawlers will not follow any link on this page.' });
  if (rd.ambiguous) issues.push({ sev: 'HIGH', code: 'noindex-ambiguous', msg: `X-Robots-Tag "${headers.get('x-robots-tag')}" has a noindex after a bot-scoped directive and the separate header values could not be read. If they are separate headers, the page is noindexed for Google and Bing.`, fix: 'Check the raw headers with: curl -sI <url> | grep -i x-robots-tag' });
  if (rd.nosnippet) issues.push({ sev: 'INFO', code: 'nosnippet', msg: 'nosnippet: no text snippet in Google results and the page cannot be quoted in AI Overviews/AI Mode.' });

  if (!title) issues.push({ sev: 'HIGH', code: 'title-missing', msg: 'No <title>.', fix: 'Add a unique, descriptive title (primary topic first).' });
  else {
    if (title.length > T.titleMaxChars) issues.push({ sev: 'LOW', code: 'title-long', msg: `Title is ${title.length} chars; Google truncates by pixel width (~${T.titleMaxChars} chars). Make sure the key words come first.` });
    if (title.length < T.titleMinChars) issues.push({ sev: 'MEDIUM', code: 'title-short', msg: `Title "${title}" is very short/vague; it gives searchers and Google little to match.` });
    if (/^(home|untitled|index|welcome|page|new page)$/i.test(title.trim())) issues.push({ sev: 'MEDIUM', code: 'title-generic', msg: `Generic title "${title}".` });
  }
  if (titles.length > 1) issues.push({ sev: 'LOW', code: 'title-multiple', msg: `${titles.length} <title> elements; only the first is used.` });

  // Metadata emitted in <body>: Next.js 15.2+ streaming metadata does this for user agents not in
  // htmlLimitedBots. Google renders JS and copes; non-JS crawlers may miss it, and Google ignores a
  // canonical outside <head> in the raw HTML.
  const bodyMeta = [titles[0] && !inHead(titles[0].index) && 'title', descTags[0] && !inHead(descTags[0].index) && 'description', canonicals[0] && !inHead(canonicals[0].index) && 'canonical'].filter(Boolean);
  if (bodyMeta.length && next) {
    issues.push({ sev: 'MEDIUM', code: 'metadata-streamed', msg: `Next.js streamed metadata into <body> for this user agent (${bodyMeta.join(', ')}). Non-JS crawlers (OAI-SearchBot, PerplexityBot, ClaudeBot) may miss it.`, fix: 'Extend htmlLimitedBots in next.config with those crawlers while keeping Next\'s default list (setting it replaces the default), or use static metadata/rendering; re-test with --ua oai-searchbot and --ua bingbot. See references/stacks.md.' });
  } else if (bodyMeta.includes('canonical')) {
    issues.push({ sev: 'HIGH', code: 'canonical-in-body', msg: 'rel=canonical is outside <head>; Google ignores canonicals in the body.' });
  } else if (bodyMeta.includes('title')) {
    issues.push({ sev: 'LOW', code: 'title-in-body', msg: '<title> appears in <body>.' });
  }

  if (!description) issues.push({ sev: 'LOW', code: 'description-missing', msg: 'No meta description (Google will generate a snippet).' });
  else if (description.length > T.descriptionMaxChars) issues.push({ sev: 'LOW', code: 'description-long', msg: `Meta description is ${description.length} chars; snippets are cut around 150-${T.descriptionMaxChars}.` });

  if (canonicals.length > 1) {
    const distinct = new Set(canonicals.map((c) => normalizeUrl(c.attrs.href.trim(), base)));
    if (distinct.size > 1) issues.push({ sev: 'HIGH', code: 'canonical-conflict', msg: `${canonicals.length} canonical tags with different URLs; Google ignores all of them.`, fix: 'Emit exactly one canonical.' });
  }
  if (!canonicals.length) issues.push({ sev: 'MEDIUM', code: 'canonical-missing', msg: 'No rel=canonical. Query-string and tracking variants of this URL can be indexed as duplicates.', fix: 'Add a self-referencing absolute canonical.' });
  else if (canonical) {
    const cHost = new URL(canonical).hostname;
    if (NON_PROD_HOST.test(cHost) && !NON_PROD_HOST.test(new URL(finalUrl).hostname)) {
      issues.push({ sev: 'HIGH', code: 'canonical-foreign-host', msg: `Canonical points at a non-production host (${canonical}).`, fix: 'Build with the production origin (Next.js metadataBase / site URL env var).' });
    } else if (canonical !== pageUrl && canonical !== stripTracking(pageUrl)) {
      const cross = new URL(canonical).host !== pageHost;
      const protoOnly = canonical.replace(/^https?:/, '') === pageUrl.replace(/^https?:/, '');
      if (protoOnly && canonical.startsWith('http:')) issues.push({ sev: 'MEDIUM', code: 'canonical-http', msg: `Canonical uses http:// (${canonical}) on an https page.` });
      else issues.push({ sev: 'HIGH', code: 'canonical-elsewhere', msg: `Canonical points to ${cross ? 'another host' : 'another URL'}: ${canonical}. This page will not rank itself.`, fix: 'Intentional only for true duplicates or syndicated copies; otherwise make it self-referencing.' });
    }
    if (!/^https?:\/\//i.test(canonicals[0].attrs.href.trim())) issues.push({ sev: 'LOW', code: 'canonical-relative', msg: 'Canonical href is relative; use an absolute URL.' });
  }

  // ----- hreflang -----
  const langs = new Set();
  for (const h of hreflangs) {
    const err = checkHreflangCode(h.lang);
    if (err) issues.push(err);
    if (langs.has(h.lang.toLowerCase())) issues.push({ sev: 'MEDIUM', code: 'hreflang-duplicate', msg: `hreflang "${h.lang}" listed twice.` });
    langs.add(h.lang.toLowerCase());
  }
  if (hreflangs.length) {
    const self = normalizeUrl(canonical || finalUrl);
    const selfEntry = hreflangs.find((h) => h.href === self);
    if (!selfEntry) issues.push({ sev: 'MEDIUM', code: 'hreflang-no-self', msg: 'hreflang set does not include this page itself (self-reference required).' });
    if (!langs.has('x-default')) issues.push({ sev: 'LOW', code: 'hreflang-no-xdefault', msg: 'No x-default hreflang (recommended fallback for unmatched languages).' });
    if (selfEntry && htmlTag.lang && selfEntry.lang.toLowerCase() !== 'x-default' && selfEntry.lang.split('-')[0].toLowerCase() !== htmlTag.lang.split('-')[0].toLowerCase())
      issues.push({ sev: 'LOW', code: 'lang-mismatch', msg: `<html lang="${htmlTag.lang}"> does not match this page's own hreflang "${selfEntry.lang}".` });
  }
  for (const h of hreflangs) {
    if (h.href && NON_PROD_HOST.test(new URL(h.href).hostname) && !NON_PROD_HOST.test(new URL(finalUrl).hostname))
      issues.push({ sev: 'HIGH', code: 'hreflang-foreign-host', msg: `hreflang ${h.lang} points at a non-production host (${h.href}).` });
  }

  // ----- content / rendering -----
  if (h1s.length === 0) issues.push({ sev: 'MEDIUM', code: 'h1-missing', msg: 'No <h1> in the server HTML. A clear main heading helps users and parsers identify the topic.' });
  if (words < T.clientRenderedWords && scriptBytes > T.clientRenderedScriptBytes)
    issues.push({ sev: 'HIGH', code: 'client-rendered', msg: `Only ${words} words in the raw HTML but ${Math.round(scriptBytes / 1024)} KB of inline script: main content is rendered by JavaScript. Google renders it later; assume AI crawlers do not run JS at all.`, fix: 'Server-render (SSR/SSG) the main content.' });
  else if (words < T.littleTextWords) issues.push({ sev: 'MEDIUM', code: 'little-text', msg: `Only ${words} words of visible text in the raw HTML.` });
  const bytes = opts.bytes ?? Buffer.byteLength(html, 'utf8');
  if (bytes > T.googlebotHtmlBytes) issues.push({ sev: 'HIGH', code: 'html-over-2mb', msg: `HTML is ${(bytes / 1048576).toFixed(1)} MB uncompressed; Googlebot only processes the first ${T.googlebotHtmlBytes / 1048576} MB. Content and links after the cutoff are not indexed.`, fix: 'Move large inline JSON/scripts/styles to separate files; paginate very long pages.' });

  // ----- mobile / misc -----
  if (!viewport) issues.push({ sev: 'HIGH', code: 'no-viewport', msg: 'No <meta name="viewport">: page is not mobile-friendly; Google indexes the mobile version.', fix: '<meta name="viewport" content="width=device-width, initial-scale=1">' });
  if (!htmlTag.lang) issues.push({ sev: 'LOW', code: 'no-lang', msg: '<html> has no lang attribute.' });
  if (imgsNoAlt) issues.push({ sev: 'LOW', code: 'img-alt-missing', msg: `${imgsNoAlt} of ${imgs.length} <img> have no alt attribute (use alt="" for decorative images).` });
  if (emptyAnchors) issues.push({ sev: 'LOW', code: 'empty-anchor', msg: `${emptyAnchors} links have no text, aria-label or img alt; crawlers get no anchor context.` });
  if (jsLinks) issues.push({ sev: 'MEDIUM', code: 'js-links', msg: `${jsLinks} links use href="javascript:"; crawlers cannot follow them. Use real <a href> URLs.` });
  if (!internal.length) issues.push({ sev: 'MEDIUM', code: 'no-internal-links', msg: 'No crawlable internal <a href> links in the raw HTML (dead end for crawlers).' });
  if (!og['og:title'] || !og['og:image']) issues.push({ sev: 'LOW', code: 'og-missing', msg: `Open Graph incomplete (missing ${['og:title', 'og:image'].filter((k) => !og[k]).join(', ')}); shared links render poorly.` });
  if (og['og:image']) {
    try {
      const h = new URL(og['og:image'], base).hostname;
      if (NON_PROD_HOST.test(h) && !NON_PROD_HOST.test(new URL(finalUrl).hostname)) issues.push({ sev: 'MEDIUM', code: 'og-foreign-host', msg: `og:image points at a non-production host (${og['og:image']}).` });
    } catch {}
  }
  if (finalUrl.startsWith('https:') && /<(?:img|script|iframe|audio|video|source)\b[^>]*?\s(?:src)\s*=\s*["']?http:\/\/|<link\b(?=[^>]*rel=["']?stylesheet)[^>]*\shref\s*=\s*["']?http:\/\//i.test(scan(html).noComments))
    issues.push({ sev: 'MEDIUM', code: 'mixed-content', msg: 'Page loads http:// subresources on an https page (browsers block or warn).' });
  // Whole title/H1 must be a not-found message ("404", "Page not found | Brand"), so real titles such
  // as "404 Media" or "Not Found Fest 2026" do not trigger it.
  // The whole title/H1 must be a not-found message, optionally followed by a short brand suffix
  // ("404 page not found | Acme"), AND the page must be short. Real articles such as "404 Error: What It
  // Is and How to Fix It", "404 Media" or "Not Found Fest 2026" never match.
  const NF_PHRASE = String.raw`(?:oops!?\s*)?(?:error\s*)?(?:404(?:\s*(?:error|page))?(?:\s*[:\-–—|]?\s*(?:(?:this |that )?page (?:could not|cannot|can.t) be found|(?:page )?not found))?|page not found|not found|(?:this |that )?page (?:does not exist|doesn.t exist|could not be found|cannot be found|can.t be found)|(?:sorry, )?(?:we couldn.t|we can.t) find (?:that|this|the) page)`;
  // Brand suffix: at most 4 words ("| Acme Plumbing"), so "404 error - how to fix broken links" is not one.
  const NOT_FOUND = new RegExp(String.raw`^\s*${NF_PHRASE}\s*[.!]?\s*(?:$|[|–—-]\s*(?:[^\s|–—:]+\s*){1,4}$)`, 'i');
  if ((NOT_FOUND.test(title) || NOT_FOUND.test(h1s[0] || '')) && wordCount(mainText) < T.lowTextWords)
    issues.push({ sev: 'HIGH', code: 'soft-404-text', msg: 'Page says "not found" but returned 200 (soft 404).', fix: 'Return a real 404/410 status for missing content.' });
  if (new URL(finalUrl).pathname === '/' && !schema.types.some((t) => /Organization|LocalBusiness|WebSite|College|School|Store|Clinic|Dentist|Hospital|Physician|Restaurant/i.test(t) || t === 'Corporation'))
    issues.push({ sev: 'LOW', code: 'home-no-entity-schema', msg: 'Homepage has no Organization (or LocalBusiness subtype) / WebSite JSON-LD; search engines and AI assistants use it to identify the brand.' });

  issues.push(...schema.issues);

  return {
    title, titleLength: title.length, description, descriptionLength: description.length,
    canonical, canonicalCount: canonicals.length, noindex, noindexGoogle: rd.noindexGoogle, noindexBing: rd.noindexBing,
    nofollow: rd.nofollow, robots: rd.summary, hreflangs, h1s, words, mainText, prices, lang: htmlTag.lang || null,
    viewport, og, icons, isNext: next, images: imgs.length, imagesNoAlt: imgsNoAlt, links, internalLinks: internal.length,
    schemaTypes: schema.types, jsonLdBlocks: schema.blocks, bytes, issues,
  };
}

// Analyse a fetchChain() HTML response. When fetch() has merged X-Robots-Tag headers so that a
// noindex is ambiguous, re-read the raw header values and analyse again, so callers get a definite
// FATAL (or a clean result) instead of a guess.
export async function analyzeResponse(res, ua) {
  let a = analyzeHtml(res.body, res.finalUrl, res.headers, { bytes: res.bytes });
  if (a.issues.some((i) => i.code === 'noindex-ambiguous')) {
    const { rawHeaderValues } = await import('./lib.mjs');
    const values = await rawHeaderValues(res.finalUrl, 'x-robots-tag', ua);
    // Trust the second response only if it carries the same header as the first one.
    const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
    if (Array.isArray(values) && values.length && norm(values.join(', ')) === norm(res.headers.get('x-robots-tag'))) a = analyzeHtml(res.body, res.finalUrl, res.headers, { bytes: res.bytes, xRobotsValues: values });
  }
  return a;
}
