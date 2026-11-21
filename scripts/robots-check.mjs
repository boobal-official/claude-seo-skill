#!/usr/bin/env node
// Usage:
//   node robots-check.mjs https://example.com [/path /other?x=1 ...] [--json]
//   node robots-check.mjs --file public/robots.txt [/path ...]      (offline, before deploy)
// Tests the live (or local) robots.txt against search, AI-search, user-triggered and
// AI-training crawlers, and flags policies that cost search visibility.
// Exit: 2 = FATAL, 1 = HIGH, 0 = otherwise, 3 = could not complete, 64 = usage error.
// Note: an AI-search block the owner approved stays HIGH by design; report it as accepted.

import { readFileSync } from 'node:fs';
import { enableSsrfGuard, safe, parseArgs, fetchChain, printIssues, exitCodeFor, runMain, urlArg, UsageError } from './lib.mjs';
import { parseRobots, isAllowed, BOTS } from './robots.mjs';
import { T } from './thresholds.mjs';

const USAGE = 'node robots-check.mjs <origin> [paths...] [--json] | --file robots.txt [paths...]';
const args = parseArgs(process.argv.slice(2));

runMain(async () => {
  const positional = [...args._];
  const issues = [];
  let text = '';
  let source = '';
  let origin = null;
  let unreachable = false;

  if (args.file) {
    if (args.file === true) throw new UsageError('--file needs a path');
    try { text = readFileSync(String(args.file), 'utf8'); } catch (e) { throw new UsageError(`cannot read ${args.file}: ${e.code || e.message}`); }
    source = String(args.file);
    if (positional[0] && !positional[0].startsWith('/')) origin = new URL(urlArg(positional.shift(), 'origin')).origin;
  } else {
    origin = new URL(urlArg(positional.shift(), 'origin')).origin;
    await enableSsrfGuard(origin, { allowPrivate: args['allow-private'] === true });
    source = `${origin}/robots.txt`;
    const res = await fetchChain(source, { maxHops: T.robotsMaxRedirectHops });
    if (res.error && /redirect/.test(res.error)) {
      issues.push({ sev: 'INFO', code: 'robots-redirect-limit', msg: `robots.txt ${res.error}; Google gives up after ${T.robotsMaxRedirectHops} hops and treats it as if there were no robots.txt (no restrictions).` });
    } else if (res.error || res.status === 0) {
      unreachable = !res.chain.length;
      issues.push({ sev: unreachable ? 'INFO' : 'FATAL', code: 'robots-unreachable', msg: `robots.txt could not be fetched (${res.error}). Google treats an unreachable robots.txt like a 5xx and stops crawling.`, fix: 'Make /robots.txt return 200 (or 404 if you have no rules).' });
    } else if (res.status === 429 || res.status >= 500) {
      issues.push({ sev: 'FATAL', code: 'robots-5xx', msg: `robots.txt returns ${res.status}. Google stops crawling the whole site while robots.txt errors (thresholds.md).`, fix: 'Serve robots.txt as a static file with status 200.' });
    } else if (res.status >= 400) {
      issues.push({ sev: 'INFO', code: 'robots-4xx', msg: `robots.txt returns ${res.status}: crawlers treat this as "no restrictions".` });
    } else {
      text = res.body;
      const ct = res.headers.get('content-type') || '';
      if (/<html|<!doctype html/i.test(text.slice(0, 500))) {
        issues.push({ sev: 'HIGH', code: 'robots-is-html', msg: 'robots.txt returns an HTML page (usually a catch-all route rendering for every path).', fix: 'Serve a real text file at /robots.txt (Next.js: app/robots.ts or public/robots.txt).' });
        text = '';
      } else if (!/text\/plain/i.test(ct)) {
        issues.push({ sev: 'LOW', code: 'robots-content-type', msg: `robots.txt content-type is "${ct}", expected text/plain.` });
      }
      if (res.chain.length) issues.push({ sev: 'INFO', code: 'robots-redirect', msg: `robots.txt redirects (${res.chain.length} hop(s)) to ${res.finalUrl}.` });
    }
  }

  const parsed = parseRobots(text);
  if (parsed.oversized) issues.push({ sev: 'MEDIUM', code: 'robots-too-big', msg: `robots.txt is larger than ${T.robotsMaxBytes / 1024} KiB; Google ignores rules after that point.` });
  const extraPaths = positional;
  const paths = [...new Set(['/', ...extraPaths])];
  const renderPaths = ['/_next/static/chunks/main.js', '/wp-content/themes/x/style.css', '/assets/app.css', '/static/js/main.js'];

  const rows = BOTS.map(([token, category, purpose]) => ({ token, category, purpose, results: paths.map((p) => ({ path: p, ...isAllowed(parsed, token, p) })) }));
  const blockedAt = (cat, path = '/') => rows.filter((r) => r.category === cat && !r.results.find((x) => x.path === path).allowed).map((r) => r.token);

  for (const bot of blockedAt('search')) {
    const sev = bot === 'Googlebot' || bot === 'Bingbot' ? 'FATAL' : 'HIGH';
    issues.push({
      sev,
      code: 'search-engine-blocked',
      msg: `${bot} is disallowed from "/".${bot === 'Bingbot' ? ' This removes the site from Bing and Copilot, and from other products that use Bing results.' : ''}`,
      fix: 'Default-allow ("User-agent: *" with only private paths disallowed). Block specific bots by name instead of a blanket "Disallow: /".',
    });
  }
  // Amzn-SearchBot follows the rules given to other search bots when robots.txt does not name it.
  const amzn = rows.find((r) => r.token === 'Amzn-SearchBot');
  const searchAllowed = rows.some((r) => ['Googlebot', 'Bingbot'].includes(r.token) && r.results[0].allowed);
  const amznFallback = amzn && amzn.results[0].group !== 'amzn-searchbot' && searchAllowed;
  if (amznFallback) {
    // Copy the per-path verdicts of the search bot it falls back to (Googlebot, else Bingbot).
    const donor = rows.find((r) => r.token === 'Googlebot' && r.results[0].allowed) || rows.find((r) => r.token === 'Bingbot' && r.results[0].allowed);
    const wasBlocked = !amzn.results[0].allowed;
    amzn.results = donor.results.map((x) => ({ ...x }));
    if (wasBlocked) issues.push({ sev: 'INFO', code: 'amzn-searchbot-fallback', msg: `Amzn-SearchBot is not named, so it follows the rules given to other search bots (here: ${donor.token}'s group).` });
  }
  const aiSearch = blockedAt('ai-search');
  if (aiSearch.length) issues.push({ sev: 'HIGH', code: 'ai-search-blocked', msg: `AI search crawlers blocked from "/": ${aiSearch.join(', ')}. The site cannot appear or be cited in those assistants' search answers.`, fix: 'Allow OAI-SearchBot, Claude-SearchBot, PerplexityBot and Amzn-SearchBot unless the owner decided otherwise. See references/crawler-policy.md.' });
  const aiUser = blockedAt('ai-user');
  if (aiUser.length) issues.push({ sev: 'INFO', code: 'ai-user-blocked', msg: `User-triggered AI fetchers disallowed: ${aiUser.join(', ')}. Only Claude-User reliably follows robots.txt; OpenAI and Perplexity say their user-triggered fetchers may not. Use a WAF rule if they must be blocked.` });
  const training = blockedAt('ai-training');
  if (training.length) issues.push({ sev: 'INFO', code: 'ai-training-blocked', msg: `AI training crawlers blocked: ${training.join(', ')}. A policy choice with no effect on search rankings (Google-Extended also stops Gemini Apps/Vertex AI grounding).` });

  for (const p of renderPaths) {
    const r = isAllowed(parsed, 'Googlebot', p);
    if (!r.allowed) issues.push({ sev: 'HIGH', code: 'render-assets-blocked', msg: `Googlebot cannot fetch ${p} (rule "Disallow: ${r.rule.path}", line ${r.rule.line}). Google renders pages with CSS/JS; blocking them can make pages look broken or empty.`, fix: `Remove the "Disallow: ${r.rule.path}" rule.` });
  }
  for (const p of extraPaths) {
    const g = rows.find((r) => r.token === 'Googlebot').results.find((x) => x.path === p);
    if (!g.allowed) issues.push({ sev: 'HIGH', code: 'path-blocked', msg: `Googlebot is disallowed from ${p} (rule "${g.rule.path}" line ${g.rule.line}). If this page should rank, it cannot be crawled.` });
  }
  if (parsed.groups.some((g) => g.agents.includes('googlebot')) && parsed.groups.some((g) => g.agents.includes('*')))
    issues.push({ sev: 'INFO', code: 'googlebot-own-group', msg: 'robots.txt has a Googlebot-specific group, so Googlebot ignores every "*" rule. Make sure the Googlebot group repeats the rules it needs.' });

  if (!parsed.sitemaps.length) issues.push({ sev: 'LOW', code: 'no-sitemap-line', msg: 'No "Sitemap:" line in robots.txt.', fix: 'Add "Sitemap: https://<host>/sitemap.xml" (absolute URL).' });
  for (const s of parsed.sitemaps) if (!/^https?:\/\//i.test(s)) issues.push({ sev: 'MEDIUM', code: 'sitemap-relative', msg: `Sitemap line "${s}" is not an absolute URL; it will be ignored.` });
  for (const u of parsed.unsupported) issues.push({ sev: 'MEDIUM', code: 'robots-noindex-unsupported', msg: `Line ${u.line}: "${u.field}: ${u.value}" is not supported by Google (dropped in 2019). These URLs are NOT de-indexed.`, fix: 'Use <meta name="robots" content="noindex"> or the X-Robots-Tag header, and keep the URL crawlable so the noindex can be seen.' });
  const delays = parsed.groups.filter((g) => g.crawlDelay);
  if (delays.length) issues.push({ sev: 'INFO', code: 'crawl-delay', msg: `crawl-delay set for ${delays.map((g) => g.agents.join('/')).join(', ')}. Google ignores it; Bing honours it (high values slow Bing indexing).` });

  const sitemapChecks = [];
  if (origin && !args.offline) {
    for (const s of parsed.sitemaps.filter((s) => /^https?:/i.test(s))) {
      const r = await fetchChain(s, { read: 'buffer', maxHops: 5, maxBytes: 4096 });
      const head = r.buffer ? r.buffer.subarray(0, 300).toString('utf8') : '';
      const okXml = r.status === 200 && (/<(urlset|sitemapindex)\b/i.test(head) || (r.buffer?.[0] === 0x1f && r.buffer?.[1] === 0x8b) || /<\?xml/i.test(head));
      sitemapChecks.push({ url: s, status: r.status, ok: okXml });
      if (!okXml) issues.push({ sev: 'HIGH', code: 'sitemap-broken', msg: `Sitemap ${s} returned ${r.status || r.error}${r.status === 200 ? ' but is not valid sitemap XML' : ''}.`, fix: 'Serve an XML sitemap (Next.js: app/sitemap.ts).' });
    }
  }

  if (args.json) console.log(JSON.stringify({ source, notMeasured: unreachable, sitemaps: parsed.sitemaps, sitemapChecks, rows: unreachable ? [] : rows, issues }, null, 2));
  else {
    console.log(`robots.txt: ${source}`);
    if (unreachable) { console.log('\nCould not fetch robots.txt (no response): bot verdicts not measured.\n'); printIssues(issues); return 3; }
    console.log(`groups: ${parsed.groups.length}, sitemaps: ${parsed.sitemaps.length}\n`);
    const w = 20;
    console.log('Bot'.padEnd(w) + 'Category'.padEnd(13) + paths.map((p) => p.slice(0, 18).padEnd(20)).join(''));
    for (const r of rows) console.log(r.token.padEnd(w) + r.category.padEnd(13) + r.results.map((x) => (x.allowed ? 'allow' : `BLOCK(${safe(x.rule.path)})`).slice(0, 18).padEnd(20)).join(''));
    console.log('');
    printIssues(issues);
  }
  return unreachable ? 3 : exitCodeFor(issues);
}, USAGE);
