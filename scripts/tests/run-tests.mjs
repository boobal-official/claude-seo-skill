#!/usr/bin/env node
// Self-test for the seo skill scripts. Run: node scripts/tests/run-tests.mjs [--network]
// Starts three local fixture sites on ephemeral ports (broken, clean, edge) and asserts:
// every planted defect is detected, the clean site has no FATAL/HIGH, every edge case from
// past code reviews neither crashes a tool nor produces a false FATAL/HIGH, and the numbers in
// scripts/thresholds.mjs match references/thresholds.md.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, brokenSite, cleanSite, edgeSite } from './fixture-server.mjs';
import { parseRobots, isAllowed, matches } from '../robots.mjs';
import { decodeEntities, parseArgs, fixMsysPath } from '../lib.mjs';
import { robotsDirectives, analyzeHtml } from '../page.mjs';
import { DOC_ANCHORS } from '../thresholds.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const S = (n) => join(here, '..', n);
let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? `\n     ${String(detail).slice(0, 600)}` : ''}`); }
};
function run(script, ...a) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [S(script), ...a]);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      let json = null;
      try { json = JSON.parse(out); } catch {}
      resolve({ code, json, out, err });
    });
  });
}
const runJ = (script, ...a) => run(script, '--json', ...a); // --json FIRST: also tests flag-order independence
const codes = (r) => new Set((r.json?.issues || []).map((i) => i.code));
const sevOf = (r, code) => r.json?.issues?.find((i) => i.code === code)?.sev;
const expectCodes = (r, list, label) => { const c = codes(r); for (const x of list) ok(c.has(x), `${label}: detects ${x}`, `got: ${[...c].join(', ')} ${r.err}`); };
const expectNoCodes = (r, list, label) => { const c = codes(r); for (const x of list) ok(!c.has(x), `${label}: no false ${x}`, JSON.stringify(r.json?.issues?.filter((i) => i.code === x))); };
const expectClean = (r, label) => { const bad = (r.json?.issues || []).filter((i) => ['FATAL', 'HIGH'].includes(i.sev)); ok(r.json && bad.length === 0, `${label}: no FATAL/HIGH`, JSON.stringify(bad) + r.err); };
const validJson = (r, label) => ok(r.json && Array.isArray(r.json.issues), `${label}: valid JSON output`, r.out.slice(0, 200) + r.err.slice(0, 300));

const [B, C, E] = await Promise.all([serve(brokenSite), serve(cleanSite), serve(edgeSite)]);
const bo = B.origin, co = C.origin, eo = E.origin;

try {
  // ---- thresholds: doc and code agree ----
  const doc = readFileSync(join(here, '..', '..', 'references', 'thresholds.md'), 'utf8');
  for (const a of DOC_ANCHORS) ok(doc.includes(a), `thresholds.md contains "${a}" (matches thresholds.mjs)`);

  // ---- robots parser unit tests (RFC 9309 / Google parser) ----
  const t = (txt, ua, path, want, name) => ok(isAllowed(parseRobots(txt), ua, path).allowed === want, `robots: ${name}`);
  t('User-agent: *\nAllow: /p\nDisallow: /', 'x', '/page', true, 'longest match allow');
  t('User-agent: *\nAllow: /folder\nDisallow: /folder', 'x', '/folder/page', true, 'tie -> allow');
  t('User-agent: *\nAllow: /page\nDisallow: /*.htm', 'x', '/page.htm', false, 'wildcard longer wins');
  t('User-agent: *\nAllow: /$\nDisallow: /', 'x', '/', true, '$ anchor allow root');
  t('User-agent: *\nAllow: /$\nDisallow: /', 'x', '/page.htm', false, '$ anchor disallow other');
  t('User-agent: *\nDisallow: /*.php$', 'x', '/index.php', false, '$ end match');
  t('User-agent: *\nDisallow: /*.php$', 'x', '/index.php?x=1', true, '$ does not match with query');
  t('User-agent: GOOGLEBOT\nDisallow: /a', 'Googlebot', '/a', false, 'case-insensitive UA');
  t('User-agent: googlebot\nDisallow: /a\n\nUser-agent: googlebot\nDisallow: /b', 'Googlebot', '/b', false, 'groups merge');
  t('User-agent: Googlebot\nDisallow: /img', 'Googlebot-Image', '/img/x', false, 'Googlebot-Image falls back to Googlebot');
  t('User-agent: Googlebot\nDisallow: /g', 'Applebot', '/g', false, 'Applebot falls back to Googlebot');
  t('User-agent: bingbot\nDisallow: /\n\nUser-agent: *\nDisallow: /x', 'Googlebot', '/', true, 'falls back to * group');
  t('User-agent: *\nDisallow:', 'x', '/anything', true, 'empty disallow allows');
  t('User-agent: a\nUser-agent: b\nDisallow: /x', 'b', '/x', false, 'multi-agent group');
  t('User-agent: *\nDisallow: /', 'x', '/robots.txt', true, 'robots.txt always allowed');
  t('Sitemap: https://x/s.xml\nUser-agent: *\nDisallow: /a', 'x', '/a', false, 'sitemap line before group');
  t('User-agent: Bingbot\nCrawl-delay: 5\nUser-agent: Googlebot\nDisallow: /', 'Bingbot', '/', false, 'crawl-delay does not end agent list (RFC 9309 2.2.4)');
  t('User-agent: Bingbot\nHost: x.com\nUser-agent: Googlebot\nDisallow: /', 'Bingbot', '/', false, 'host line does not end agent list');
  t('User-agent: MJ12bot\nDisallow: /', 'MJ12bot', '/', false, 'tokens with digits');
  t('User-agent: Googlebot*\nDisallow: /z', 'Googlebot', '/z', false, '"Googlebot*" token');
  t('User agent: *\nDisallow /q', 'x', '/q', false, 'Google-accepted typos ("User agent", no colon)');
  t('User-agent: *\nDisallow: /a%2fb', 'x', '/a%2Fb', false, 'percent-escape case-insensitive');
  t('User-agent: *\nDisallow: /a%2Ab', 'x', '/aXYZb', true, '%2A stays literal, not a wildcard');
  t('\uFEFFUser-agent: *\r\nDisallow: /crlf\r\n', 'x', '/crlf', false, 'BOM + CRLF');
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) matches('/' + 'a-'.repeat(80) + 'b.html', '/*-*-*-*-*-*-*-*-*-*-*-*-*-*.pdf$');
  ok(performance.now() - t0 < 500, 'robots: pathological wildcard pattern runs in linear time', `${Math.round(performance.now() - t0)} ms`);
  ok(parseRobots('User-agent: *\nDisallow: /late\n'.padStart(600 * 1024, '#')).oversized, 'robots: >500 KiB flagged');

  // ---- unit: entities, flags, MSYS paths, robots directives, foreign hosts ----
  ok(decodeEntities('a&#99999999;b&ndash;c&rsquo;') === 'a\uFFFDb\u2013c\u2019', 'entities: invalid code point -> U+FFFD, named entities decoded');
  const pa = parseArgs(['--json', 'https://x.com/', '--deep', '/path']);
  ok(pa.json === true && pa.deep === true && pa._[0] === 'https://x.com/' && pa._[1] === '/path', 'args: boolean flags never swallow positionals');
  ok(fixMsysPath('C:/Program Files/Git/pricing') === '/pricing', 'args: Git Bash path rewrite undone');
  const rd = (h, m) => robotsDirectives(new Headers(h), m.map((c) => ({ attrs: { name: 'robots', content: c } })));
  ok(!rd({}, ['index, follow, max-image-preview:none']).noindexGoogle, 'robots meta: max-image-preview:none is not noindex');
  ok(!rd({ 'x-robots-tag': 'otherbot: noindex, nofollow' }, []).noindexGoogle, 'X-Robots-Tag scoped to another bot does not apply');
  ok(rd({ 'x-robots-tag': 'googlebot: noindex' }, []).noindexGoogle, 'X-Robots-Tag googlebot: noindex applies');
  ok(rd({}, ['none']).noindexGoogle, 'robots meta "none" = noindex');
  ok(robotsDirectives(new Headers(), [{ attrs: { name: 'bingbot', content: 'noindex' } }]).noindexBing, 'bingbot meta noindex detected');
  ok(analyzeHtml('<html><head><link rel="canonical" href="https://my-app-git-main.vercel.app/x"></head><body><p>x</p></body></html>', 'https://www.example.com/x').issues.some((i) => i.code === 'canonical-foreign-host'), 'page: canonical on a preview host flagged for a production page');

  // ---- robots-check ----
  const rb = await runJ('robots-check.mjs', bo);
  expectCodes(rb, ['search-engine-blocked', 'ai-search-blocked', 'render-assets-blocked', 'robots-noindex-unsupported'], 'robots-check broken');
  ok(rb.json?.issues.some((i) => i.sev === 'FATAL' && /Bingbot/.test(i.msg)), 'robots-check: Bingbot block is FATAL');
  ok(sevOf(rb, 'ai-user-blocked') === 'INFO', 'robots-check: user-triggered fetcher block is INFO');
  const rc = await runJ('robots-check.mjs', co);
  expectClean(rc, 'robots-check clean');
  ok(sevOf(rc, 'ai-training-blocked') === 'INFO', 'robots-check: training block is INFO only');
  const re = await runJ('robots-check.mjs', eo, '/secret');
  const bingSecret = re.json?.rows?.find((r) => r.token === 'Bingbot')?.results?.find((x) => x.path === '/secret');
  ok(bingSecret && bingSecret.allowed === false, 'robots-check: Bingbot in a group with crawl-delay gets the shared Disallow', JSON.stringify(bingSecret));

  // ---- seo-check (broken site) ----
  const page = async (p, list, extra = []) => expectCodes(await runJ('seo-check.mjs', bo + p, ...extra), list, `seo-check ${p}`);
  await page('/', ['no-viewport', 'title-generic', 'home-no-entity-schema']);
  await page('/pricing', ['client-rendered', 'h1-missing']);
  await page('/blog/post-a', ['canonical-elsewhere', 'og-image-broken'], ['--deep']);
  await page('/blog/post-b', ['jsonld-parse-error', 'img-alt-missing', 'description-missing', 'h1-missing']);
  await page('/landing', ['noindex']);
  await page('/old-page', ['redirect-chain']);
  await page('/product', ['schema-missing-required']);
  await page('/hreflang-en', ['hreflang-invalid', 'hreflang-not-reciprocal', 'hreflang-no-xdefault'], ['--deep']);
  await page('/body-canonical', ['canonical-in-body']);
  await page('/no-title', ['title-missing']);
  const prod = await runJ('seo-check.mjs', bo + '/product');
  ok(prod.json?.issues.filter((i) => i.code === 'schema-missing-required').length === 2, 'seo-check: Offer priceCurrency + Product offers both flagged');
  const bots = await runJ('seo-check.mjs', bo + '/', '--bots');
  ok(bots.json?.issues.some((i) => i.code === 'bot-blocked' && /oai-searchbot/.test(i.msg) && i.sev === 'HIGH'), 'seo-check --bots: OAI-SearchBot 403 is HIGH');
  for (const p of ['/', '/pricing', '/blog/guide', '/about']) expectClean(await runJ('seo-check.mjs', co + p, '--deep'), `seo-check clean ${p}`);
  expectClean(await runJ('seo-check.mjs', co + '/', '--bots'), 'seo-check clean --bots');

  // ---- seo-check edge cases (crash-proofing and false positives) ----
  const edge = (p, extra = []) => runJ('seo-check.mjs', eo + p, ...extra);
  for (const p of ['/imgnone', '/scoped-xrobots', '/entity', '/base-href', '/cdata', '/title-in-script', '/custom-element', '/commented-jsonld', '/hreflang-nohref', '/cp1252']) {
    const r = await edge(p, ['--deep']);
    validJson(r, `edge ${p}`);
    expectClean(r, `edge ${p}`);
  }
  ok((await edge('/title-in-script')).json?.title === 'Real title is long enough here', 'edge: <title> inside a script string is ignored');
  ok(!(await edge('/commented-jsonld')).json?.schemaTypes?.includes('Product'), 'edge: commented-out JSON-LD ignored');
  ok((await edge('/cdata')).json?.schemaTypes?.includes('WebSite'), 'edge: both CDATA JSON-LD wrapper forms parse');
  ok((await edge('/cp1252')).json?.title === 'Caf\u00e9 menu page title here', 'edge: windows-1252 page decoded by charset');
  ok((await edge('/entity')).json?.title?.includes('\uFFFD'), 'edge: invalid entity does not crash');
  for (const [p, codeWant, exitWant] of [['/stall', 'fetch-failed', 2], ['/reset', 'fetch-failed', 2], ['/bad-location', 'redirect-error', 2], ['/204', 'non-200', 1]]) {
    const r = await runJ('seo-check.mjs', eo + p);
    validJson(r, `edge ${p}`);
    ok(codes(r).has(codeWant) && r.code === exitWant, `edge ${p}: reports ${codeWant}, exit ${exitWant}`, `code=${r.code} ${[...codes(r)].join(',')}`);
  }
  const ns = await edge('/next-streamed');
  ok(codes(ns).has('metadata-streamed') && !codes(ns).has('canonical-in-body'), 'edge: Next.js streamed metadata -> MEDIUM metadata-streamed, not HIGH canonical-in-body', [...codes(ns)].join(','));
  expectCodes(await edge('/plain-body-canonical'), ['canonical-in-body'], 'edge non-Next body canonical');
  expectCodes(await edge('/huge'), ['html-over-2mb'], 'edge huge page');
  const down = await runJ('seo-check.mjs', 'http://127.0.0.1:9/', '--bots');
  ok(codes(down).has('browser-fetch-failed') && down.code === 3, 'seo-check --bots: unreachable site -> FATAL issue + exit 3 (could not complete), not "no issues"');
  const down2 = await runJ('seo-check.mjs', 'http://127.0.0.1:9/');
  ok(down2.code === 3 && codes(down2).has('fetch-failed'), 'seo-check: unreachable site exits 3');

  // ---- v2 review regressions (N1-N20) ----
  const { scan: scanFn, fixMsysPath: fixP, NON_PROD_HOST: NPH, decodeBody: dec, intArg: ia } = await import('../lib.mjs');
  ok(analyzeHtml('<html lang="en"><head><title>Self closing svg page</title></head><body><header><svg class="logo" viewBox="0 0 1 1"/></header><main><h1>Main heading</h1><p>' + 'word '.repeat(80) + '</p><a href="/about">About</a></main></body></html>', 'https://www.example.com/x').h1s[0] === 'Main heading', 'N4: self-closing <svg/> does not hide the page');
  ok(analyzeHtml('<html><head><title>Unclosed svg page here</title></head><body><svg><path d="M0"/><main><h1>Still here</h1></main></body></html>', 'https://www.example.com/x').h1s[0] === 'Still here', 'N4: unclosed <svg> masks only the tag');
  ok(/<h1>After<\/h1>/.test(scanFn('<!--><h1>After</h1>').masked) && /<h1>After<\/h1>/.test(scanFn('<!---><h1>After</h1>').masked), 'N13: HTML5 empty comments "<!-->" and "<!--->"');
  ok(fixP('C:\\Git\\shop-site') === 'C:\\Git\\shop-site' && fixP('D:/Git/blog/post.md') === 'D:/Git/blog/post.md', 'N5: real X:\\Git\\ paths are not rewritten');
  ok(!NPH.test('dev.to') && !NPH.test('test.com') && !NPH.test('uat.com') && NPH.test('staging.example.com') && NPH.test('my-app.vercel.app') && NPH.test('localhost'), 'N9: NON_PROD_HOST needs a subdomain label');
  ok(dec(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Caf\u00e9', 'utf8')]), 'text/html; charset=iso-8859-1') === 'Caf\u00e9', 'N16: UTF-8 BOM beats the HTTP charset');
  let threw = false; try { ia(true, 300, 'max'); } catch { threw = true; }
  ok(threw, 'N18: a value flag without a value is a usage error');
  const amb = robotsDirectives(new Headers({ 'x-robots-tag': 'googlebot-news: nosnippet, noindex' }), []);
  ok(amb.ambiguous, 'N3: merged scoped + generic X-Robots-Tag flagged as ambiguous');
  for (const t of ["Why the Perfect Diet Doesn't Exist", 'Free shipping is no longer available on sale items'])
    ok(!analyzeHtml(`<html><head><title>${t}</title></head><body><main><h1>${t}</h1></main></body></html>`, 'https://www.example.com/x').issues.some((i) => i.code === 'soft-404-text'), `N7: no false soft-404 on "${t}"`);
  ok(analyzeHtml('<html><head><title>Page not found</title></head><body><h1>Page not found</h1></body></html>', 'https://www.example.com/x').issues.some((i) => i.code === 'soft-404-text'), 'N7: real "Page not found" still flagged');
  const bad = await run('seo-check.mjs', '--json', 'http://exa mple.com/');
  ok(bad.code === 64 && bad.json?.issues?.[0]?.code === 'usage-error', 'seo-check: invalid URL -> usage error JSON, exit 64', bad.out + bad.err);

  // ---- v3 review regressions ----
  const html3 = (title, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="canonical" href="https://www.example.com/x"></head><body><main><h1>${title}</h1><p>${'word '.repeat(90)}</p><a href="/a">a link</a>${extra}</main></body></html>`;
  for (const t of ['404 Media', '404 Day deals: 40% off', 'Not Found Fest 2026'])
    ok(!analyzeHtml(html3(t), 'https://www.example.com/x').issues.some((i) => i.code === 'soft-404-text'), `v3: no false soft-404 on "${t}"`);
  for (const t of ['404 - Page not found', 'Page not found | Brand', '404'])
    ok(analyzeHtml(html3(t), 'https://www.example.com/x').issues.some((i) => i.code === 'soft-404-text'), `v3: real not-found title "${t}" flagged`);
  const tScript = analyzeHtml(html3('Placeholder').replace('<title>Placeholder</title>', '<title>Hello <script> world title</title>'), 'https://www.example.com/x');
  ok(tScript.h1s.length === 1 && tScript.title === 'Hello <script> world title', 'v3: unescaped <script> inside <title> does not swallow the page', JSON.stringify({ h1: tScript.h1s, t: tScript.title }));
  const svgs = '<svg>'.repeat(2000) + 'x'.repeat(5_000_000);
  const tsvg = performance.now(); analyzeHtml(html3('Many unclosed svgs page', svgs), 'https://www.example.com/x');
  ok(performance.now() - tsvg < 3000, 'v3: 2000 unclosed <svg> on a 5 MB page stay fast', `${Math.round(performance.now() - tsvg)} ms`);
  const XR = await serve(() => (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/robots.txt') { res.writeHead(404); return res.end(); }
    if (u.pathname === '/loop') { res.writeHead(301, { location: '/loop' }); return res.end(); }
    res.setHeader('X-Robots-Tag', u.pathname === '/bing' ? ['bingbot: nosnippet', 'noindex'] : ['googlebot-news: nosnippet', 'noindex']);
    res.writeHead(u.pathname === '/' || u.pathname === '/bing' ? 200 : 404, { 'content-type': 'text/html' });
    res.end(html3('Two header noindex test page'));
  });
  const xr1 = await runJ('seo-check.mjs', XR.origin + '/');
  ok(codes(xr1).has('noindex') && !codes(xr1).has('noindex-ambiguous'), 'v3: two X-Robots-Tag headers resolved via raw headers -> definite noindex', [...codes(xr1)].join(','));
  const xr2 = await runJ('seo-check.mjs', XR.origin + '/bing');
  ok(xr2.json?.noindexGoogle === true && xr2.json?.noindexBing === true, 'v3: "bingbot: nosnippet" + "noindex" headers -> noindex for Google and Bing', JSON.stringify({ g: xr2.json?.noindexGoogle, b: xr2.json?.noindexBing }));
  const xr3 = await runJ('crawl-site.mjs', XR.origin);
  ok(codes(xr3).has('home-noindex'), 'v3: crawl-site resolves the two-header noindex (home-noindex FATAL)', [...codes(xr3)].join(','));
  const xr4 = await runJ('crawl-site.mjs', XR.origin + '/loop');
  ok(xr4.code !== 3, 'v3: endless entry redirect is a site problem, not "could not reach" (exit != 3)', `code=${xr4.code}`);
  XR.server.close();
  const noOut = await run('crawl-site.mjs', co, '--json', '--out');
  ok(noOut.code === 64, 'v3: --out without a path -> usage error');
  const jsonEq = await run('seo-check.mjs', '--json=true');
  ok(jsonEq.json?.usageError === true && jsonEq.json.issues[0].sev === 'INFO', 'v3: --json=true honoured; usage errors are INFO, not FATAL', jsonEq.out);
  const rUn = await runJ('robots-check.mjs', 'http://127.0.0.1:9');
  ok(rUn.code === 3, 'v3: robots-check on an unreachable host exits 3', `code=${rUn.code}`);
  const amznT = parseRobots('User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /');
  ok(isAllowed(amznT, 'Amzn-SearchBot', '/').allowed === false, 'robots parser: Amzn-SearchBot falls to * at parser level (fallback modelled in robots-check)');
  const AZ = await serve(() => (req, res) => {
    if (new URL(req.url, 'http://x').pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nUser-agent: Bingbot\nDisallow: /secret\n'); }
    res.writeHead(404); res.end();
  });
  const az = await runJ('robots-check.mjs', AZ.origin, '/secret', '/ok');
  AZ.server.close();
  const azr = az.json?.rows?.find((r) => r.token === 'Amzn-SearchBot')?.results || [];
  ok(azr.find((x) => x.path === '/')?.allowed === true && azr.find((x) => x.path === '/secret')?.allowed === false && azr.find((x) => x.path === '/ok')?.allowed === true && codes(az).has('amzn-searchbot-fallback') && !az.json.issues.some((i) => i.code === 'ai-search-blocked' && /Amzn-SearchBot/.test(i.msg)), 'v4: Amzn-SearchBot fallback copies Googlebot per-path verdicts (/secret blocked, / allowed)', JSON.stringify(azr));

  // ---- v4 review regressions ----
  for (const t of ['404 Error: What It Is and How to Fix It', 'Error 404: what it means for your SEO', '404 error - how to fix broken links (2026 guide)', 'Not found: the lost films of the 1920s'])
    ok(!analyzeHtml(html3(t), 'https://www.example.com/x').issues.some((i) => i.code === 'soft-404-text'), `v4: no false soft-404 on article "${t}"`);
  const short404 = (t) => `<html><head><title>${t}</title></head><body><h1>${t}</h1><p>Go back home.</p></body></html>`;
  for (const t of ['404 Page Not Found', '404: This page could not be found.', 'Oops! That page can’t be found. – Acme', 'Error 404 – Acme'])
    ok(analyzeHtml(short404(t), 'https://www.example.com/x').issues.some((i) => i.code === 'soft-404-text'), `v4: real not-found page "${t}" flagged`);
  for (const [t, bad] of [['The HTML <body> tag explained', 'canonical-in-body'], ['<link rel="canonical" href="https://evil.example/">', 'canonical-conflict'], ['<meta name="robots" content="noindex">', 'noindex']]) {
    const a = analyzeHtml(html3('Placeholder').replace('<title>Placeholder</title>', `<title>${t}</title>`), 'https://www.example.com/x');
    ok(!a.issues.some((i) => i.code === bad) && a.title === t, `v4: tag-like text in <title> is text, not markup (${bad})`, JSON.stringify({ title: a.title, codes: a.issues.map((i) => i.code) }));
  }
  ok(analyzeHtml(html3('Attribute comment page', '<a href="/b" title="see <!-- here">b</a>' + '<p>' + 'after '.repeat(60) + '</p>'), 'https://www.example.com/x').words > 100, 'v4 (N13): "<!--" inside an attribute value does not start a comment');
  const jf = await run('seo-check.mjs', co + '/', '--json=false');
  ok(jf.json === null && /URL:/.test(jf.out), 'v4: --json=false prints text, not JSON');
  const rfMissing = await runJ('robots-check.mjs', '--file', join(tmpdir(), 'no-such-robots.txt'));
  ok(rfMissing.code === 64, 'v4: robots-check --file with a missing file -> usage error 64', `code=${rfMissing.code}`);
  const rUn2 = await runJ('robots-check.mjs', 'http://127.0.0.1:9');
  ok(rUn2.json?.notMeasured === true && rUn2.json.rows.length === 0, 'v4: unreachable robots.txt -> notMeasured, no fake "allow" verdicts');

  // ---- v5 review: single source of truth enforced in code, not only in docs ----
  const { ROBOTS_MAX_BYTES } = await import('../robots.mjs');
  const { T: TT } = await import('../thresholds.mjs');
  ok(ROBOTS_MAX_BYTES === TT.robotsMaxBytes, 'v5: robots.mjs reads its size limit from thresholds.mjs');
  const srcFiles = ['lib.mjs', 'robots.mjs', 'page.mjs', 'schema.mjs', 'seo-check.mjs', 'crawl-site.mjs', 'robots-check.mjs', 'cwv.mjs', 'repo-audit.mjs'];
  const literalLimits = srcFiles.filter((f) => /500\s*\*\s*1024|2\s*\*\s*1024\s*\*\s*1024|first 2 MB|\b2500\b|\b4000\b/.test(readFileSync(S(f), 'utf8')));
  ok(literalLimits.length === 0, 'v5: no threshold literals duplicated outside thresholds.mjs', literalLimits.join(', '));
  const utm = analyzeHtml(html3('UTM tagged page title').replace('href="https://www.example.com/x"', 'href="https://www.example.com/x"'), 'https://www.example.com/x?utm_source=google&utm_medium=organic');
  ok(!utm.issues.some((i) => i.code === 'canonical-elsewhere'), 'v5: canonical equal to the URL without tracking params is not "elsewhere"');
  const chrome404 = `<html><head><title>Page not found</title></head><body><nav>${'<a href="/x">menu item</a> '.repeat(80)}</nav><main><h1>Page not found</h1><p>Try the search.</p></main><footer>${'footer link text '.repeat(40)}</footer></body></html>`;
  ok(analyzeHtml(chrome404, 'https://www.example.com/x').issues.some((i) => i.code === 'soft-404-text'), 'v5: soft-404 counts main-content words, so a 404 page with heavy chrome is still caught');
  const ldOnly = `<html lang="en"><head><title>Server rendered page with big JSON-LD</title><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'X', description: 'y'.repeat(30000) })}</script></head><body><main><h1>Hi</h1><p>${'real text '.repeat(30)}</p></main></body></html>`;
  ok(!analyzeHtml(ldOnly, 'https://www.example.com/').issues.some((i) => i.code === 'client-rendered'), 'v5: JSON-LD bytes do not count as client-side rendering script');

  // ---- security review fixes ----
  const L = await import('../lib.mjs');
  const { gzipSync } = await import('node:zlib');
  for (const [h, want] of [['169.254.169.254', true], ['10.0.0.1', true], ['192.168.1.20', true], ['172.20.0.1', true], ['100.64.0.1', true], ['[::1]', true], ['::ffff:127.0.0.1', true], ['fd00::1', true], ['localhost', true], ['8.8.8.8', false], ['93.184.215.14', false]])
    ok((await L.isPrivateHost(h)) === want, `SSRF: isPrivateHost(${h}) === ${want}`);
  await L.enableSsrfGuard('https://93.184.215.14/');
  const blockedFetch = await L.fetchChain(`${bo}/`);
  ok(blockedFetch.blocked === true && blockedFetch.status === 0, 'SSRF: auditing a public site refuses requests to loopback/private targets', JSON.stringify(blockedFetch).slice(0, 200));
  await L.enableSsrfGuard('http://127.0.0.1/'); // auditing a local site: guard off again
  ok((await L.fetchChain(`${bo}/`)).status === 200, 'SSRF: auditing a local site allows local targets');
  let bomb = false; try { L.maybeGunzip(gzipSync(Buffer.alloc(60 * 1024 * 1024))); } catch { bomb = true; }
  ok(bomb, 'gzip bomb: decompression capped at 50 MB');
  ok(L.decodeEntities('a&#27;[31mb&#x9b;c') === 'a�[31mb�c' && L.safe('x\x1b]0;evil\x07y') === 'x�]0;evil�y', 'terminal escapes: control characters neutralised in entities and printed output');
  const t1 = performance.now();
  const many = '<a href="/x">'.repeat(20000) + 'text '.repeat(1000) + '<nav>'.repeat(5000) + '<main>'.repeat(5000) + '<div role="navigation">'.repeat(5000);
  L.findPaired(many, 'a'); L.stripChrome(many); L.mainContent(many);
  ok(performance.now() - t1 < 2000, 'DoS: thousands of unclosed <a>/<nav>/<main>/role=navigation parse in linear time', `${Math.round(performance.now() - t1)} ms`);
  ok(L.findPaired('<a href="/1">one</a> <a href="/2">two</a> <a>open', 'a').map((x) => x.inner).join('|') === 'one|two', 'findPaired: linear matcher keeps lazy-regex semantics');

  // ---- crawl-site ----
  const cr = await runJ('crawl-site.mjs', bo, '--money', '^/pricing');
  expectCodes(cr, ['soft-404', 'broken-internal-links', 'redirect-chains', 'links-to-redirects', 'sitemap-non-200', 'sitemap-noindex', 'sitemap-non-canonical', 'duplicate-titles', 'missing-title', 'missing-h1', 'deep-pages', 'orphan-pages', 'near-duplicates', 'lastmod-identical', 'money-underlinked', 'url-variant-duplicate', 'og-image-broken', 'pages-client-rendered', 'pages-jsonld-parse-error'], 'crawl broken');
  ok(sevOf(cr, 'soft-404') === 'HIGH', 'crawl: soft-404 severity HIGH (thresholds.md scale)');
  ok(cr.json?.issues.find((i) => i.code === 'orphan-pages')?.urls?.some((u) => u.endsWith('/orphan')), 'crawl: /orphan listed as orphan');
  const nd = cr.json?.issues.find((i) => i.code === 'near-duplicates');
  ok(nd?.urls?.some((u) => /alpha/.test(u) && /beta/.test(u)), 'crawl: city pages flagged as near-duplicates');
  ok(!(nd?.urls || []).some((u) => /deep\/1.*deep\/2/.test(u)), 'crawl: distinct pages not flagged as near-duplicates');
  const cc = await runJ('crawl-site.mjs', co, '--money', '^/pricing');
  expectClean(cc, 'crawl clean');
  expectNoCodes(cc, ['near-duplicates', 'orphan-pages', 'money-underlinked', 'url-variant-duplicate'], 'crawl clean');
  const ct = await runJ('crawl-site.mjs', bo, '--max', '5');
  ok(ct.json?.summary?.truncated === true && codes(ct).has('crawl-truncated') && codes(ct).has('possible-orphans') && !codes(ct).has('orphan-pages'), 'crawl: --max truncation reported, orphans downgraded', JSON.stringify(ct.json?.summary));
  ok(ct.json?.summary?.viaLinks === 5, 'crawl: --max caps link-crawled pages exactly', JSON.stringify(ct.json?.summary));
  const ce = await runJ('crawl-site.mjs', eo);
  validJson(ce, 'crawl edge');
  expectNoCodes(ce, ['broken-internal-links'], 'crawl edge (<base href> resolves links)');
  const cbad = await run('crawl-site.mjs', '--json', bo, '--concurrency', 'abc');
  ok(cbad.code === 64 && cbad.json?.issues?.[0]?.code === 'usage-error', 'crawl: bad --concurrency -> usage error', cbad.out + cbad.err);
  const cnoval = await run('crawl-site.mjs', co, '--json', '--max');
  ok(cnoval.code === 64, 'crawl: --max without a value -> usage error (N18)');
  ok(!codes(ce).has('no-sitemap') && ce.json?.summary?.sitemapUrls > 0, 'crawl edge: CDATA <loc> in sitemap is read (N14)', JSON.stringify(ce.json?.summary));
  // N1: the entry URL redirects to another host (apex -> www style).
  const R = await serve(() => (req, res) => { res.writeHead(301, { location: `${co.replace('127.0.0.1', 'localhost')}/` }); res.end(); });
  const cr1 = await runJ('crawl-site.mjs', R.origin);
  R.server.close();
  ok(cr1.json?.summary?.viaLinks > 1 && codes(cr1).has('entry-redirect') && !codes(cr1).has('orphan-pages'), 'N1: crawl follows the entry redirect to the real host', JSON.stringify(cr1.json?.summary) + [...codes(cr1)].join(','));
  ok(codes(cr1).has('sitemap-wrong-host'), 'crawl: sitemap URLs on another host than the site flagged (not reported as orphans)');
  const cunreach = await runJ('crawl-site.mjs', 'http://127.0.0.1:9/');
  ok(cunreach.code === 3 && cunreach.json?.issues, 'N20: crawl of an unreachable site exits 3 with JSON');

  // ---- verify-redirects ----
  const tmp = mkdtempSync(join(tmpdir(), 'seo-test-'));
  const csv = join(tmp, 'map.csv');
  writeFileSync(csv, `\uFEFF"old_url","new_url"\n${bo}/old-page,${bo}/new-page\n${bo}/moved,${bo}/new-page,301\n"${bo}/moved?a=1,2",${bo}/new-page\n${bo}/moved?b=1,2,${bo}/new-page\n`);
  const vr = await runJ('verify-redirects.mjs', csv);
  ok(vr.json?.failed === 1 && vr.json.results.filter((r) => r.pass).length === 3, 'verify-redirects: quoted header, extra column, quoted and unquoted commas parse; 2-hop chain fails (N15)', vr.out.slice(0, 600));
  writeFileSync(join(tmp, 'down.csv'), 'old_url,new_url\nhttp://127.0.0.1:9/a,http://127.0.0.1:9/b\n');
  const vdown = await runJ('verify-redirects.mjs', join(tmp, 'down.csv'));
  ok(vdown.code === 3, 'v3: verify-redirects with nothing reachable exits 3', `code=${vdown.code}`);
  const sd = join(tmp, 'dash.md');
  writeFileSync(sd, 'Founded in 1998 — the oldest school.\nOpen 3–5 pm and 2024 – 2026.\n');
  const sdr = await runJ('slop-check.mjs', sd);
  ok(sdr.json?.hits === 1 && sdr.json.items[0].line === 1, 'v3: dash after a number is flagged; numeric ranges are not', JSON.stringify(sdr.json?.items));
  const vmissing = await runJ('verify-redirects.mjs', join(tmp, 'nope.csv'));
  ok(vmissing.code === 64 && vmissing.json?.issues, 'verify-redirects: missing file -> usage error JSON');

  // ---- slop-check ----
  const md = join(tmp, 'post.md');
  writeFileSync(md, '\uFEFF---\ntitle: Test \u2014 with dash in frontmatter\n---\nWe delve into caching.\nThis is fast \u2014 really.\n```\nleverage this in code\n```\nUse `leverage` inline is fine.\nWe leverage Redis.\nPlain sentence with a fact: builds take 11 s.\n');
  const sc = await runJ('slop-check.mjs', md);
  ok(sc.json?.hits === 3, 'slop-check: exactly 3 hits (BOM+frontmatter, code fence and inline code skipped)', JSON.stringify(sc.json?.items?.map((i) => `${i.line}:${i.rule}`)));

  // ---- cwv parsing (offline, PSI-format fixtures) ----
  const cw = await runJ('cwv.mjs', 'https://x.test/', '--from-json', join(here, 'psi-sample.json'));
  ok(cw.code === 2 && codes(cw).has('cwv-lcp-poor') && codes(cw).has('cwv-inp-ni') && !codes(cw).has('cwv-cls-poor'), 'cwv: field LCP poor, INP needs-improvement, CLS good; exit 2', `code=${cw.code} ${[...codes(cw)].join(',')} ${cw.err}`);
  ok(Math.abs(cw.json?.field?.CLS - 0.05) < 1e-9, 'cwv: CLS percentile scaled /100');
  ok(cw.json?.lcpElement?.includes('hero'), 'cwv: LCP element extracted');
  ok(cw.json?.diagnostics?.[0]?.id === 'render-blocking-insight', 'cwv: insights listed by savings');
  const cn = await runJ('cwv.mjs', 'https://x.test/', '--from-json', join(here, 'psi-nofield.json'));
  ok(cn.code === 0 && codes(cn).has('no-field-data') && codes(cn).has('lab-lcp-poor') && codes(cn).has('lab-tbt-high'), 'cwv: no field data -> lab proxies + INFO, exit 0', `code=${cn.code} ${[...codes(cn)].join(',')}`);
  const fb = JSON.parse(readFileSync(join(here, 'psi-sample.json'), 'utf8'));
  fb.loadingExperience.origin_fallback = true;
  writeFileSync(join(tmp, 'fallback.json'), JSON.stringify(fb));
  const cf = await runJ('cwv.mjs', 'https://x.test/', '--from-json', join(tmp, 'fallback.json'));
  ok(/origin/.test(cf.json?.fieldScope || ''), 'cwv: origin_fallback labelled as origin data', cf.json?.fieldScope);
  writeFileSync(join(tmp, 'bad.json'), '{not json');
  const cb = await runJ('cwv.mjs', 'https://x.test/', '--from-json', join(tmp, 'bad.json'));
  ok(cb.code === 3 && cb.json?.notMeasured, 'cwv: unparsable report -> exit 3 "not measured" JSON');

  // ---- repo-audit ----
  const mk = (base, files) => { for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(base, p)), { recursive: true }); writeFileSync(join(base, p), c); } };
  const badRepo = join(tmp, 'bad');
  mk(badRepo, {
    'package.json': JSON.stringify({ dependencies: { next: '15.3.0', react: '19.0.0' } }),
    'app/layout.tsx': "export const metadata = { title: 'Site', robots: { index: false } }\nexport default function L({children}){return <html><body>{children}</body></html>}",
    'app/page.tsx': 'export default function P(){return <h1>Home</h1>}',
    'app/blog/[slug]/page.tsx': 'export default async function P({params}){ const p = await get(params.slug); return <h1>{p?.title}</h1>}',
    'app/docs/[[...slug]]/page.tsx': "export const metadata = { title: 'Docs' }\nexport default async function P(){ return <h1>Docs</h1>}",
    'app/about/page.tsx': 'export default function A(){return <h1>About</h1>}',
    'app/dashboard/page.tsx': "'use client'\nimport {useEffect,useState} from 'react'\nexport default function D(){const [d,setD]=useState(); useEffect(()=>{ fetch('/api/x').then(r=>r.json()).then(setD)},[]); return <div>{d}</div>}",
    'public/robots.txt': 'User-agent: *\nDisallow: /\n',
  });
  const ra = await runJ('repo-audit.mjs', badRepo);
  expectCodes(ra, ['metadata-noindex', 'no-metadataBase', 'dynamic-soft-404', 'page-no-metadata', 'client-fetched-content', 'robots-blocks-search', 'no-sitemap'], 'repo-audit bad');
  ok(sevOf(ra, 'metadata-noindex') === 'FATAL', 'repo-audit: unguarded root noindex is FATAL');
  ok(ra.json?.issues.find((i) => i.code === 'dynamic-soft-404')?.urls?.some((u) => u.includes('[[...slug]]')), 'repo-audit: optional catch-all checked for soft 404');
  const goodRepo = join(tmp, 'good');
  mk(goodRepo, {
    'package.json': '\uFEFF' + JSON.stringify({ dependencies: { next: '15.3.0', react: '19.0.0' } }),
    'app/(site)/layout.tsx': "// fonts: we used to load https://fonts.googleapis.com here\nexport const metadata = { metadataBase: new URL('https://x.com'), title: { default: 'X', template: '%s | X' }, robots: { index: true, follow: true, googleBot: { index: true, follow: true, noimageindex: false, 'max-image-preview': 'large' } } }\nexport default function L({children}){return <html lang='en'><body>{children}</body></html>}",
    'app/(site)/page.tsx': "export default function P(){return <><script type='application/ld+json'>{}</script><h1>Home</h1></>}",
    'app/robots.ts': "export default function robots(){return {rules:{userAgent:'*',allow:'/'}, sitemap:'https://x.com/sitemap.xml'}}",
    'app/sitemap.ts': 'export default function sitemap(){return []}',
    'app/(site)/blog/[slug]/page.tsx': "import { getPostOrNotFound } from '@/lib/posts'\nexport const generateMetadata = async () => ({ title: 'Post' })\nexport default async function P({params}){ const p = await getPostOrNotFound((await params).slug); return <h1>{p.title}</h1>}",
    'lib/posts.ts': "import { notFound } from 'next/navigation'\nexport async function getPostOrNotFound(s: string){ const p = null; if(!p) notFound(); return p }",
    'app/(site)/about/page.tsx': "export const metadata = { title: 'About' }\nexport default function A(){return <h1>About</h1>}",
    'app/(site)/@modal/(.)photo/[id]/page.tsx': 'export default function M(){return <div/>}',
  });
  mk(goodRepo, {
    'app/(site)/docs/page.tsx': "export { metadata } from './meta'\nconst clean = (p: string) => p.replace(/\\/*$/, '')\nexport default function D(){return <h1>{clean('/docs/')}</h1>}",
    'app/(site)/docs/meta.ts': "export const metadata = { title: 'Docs', robots: 'index, follow, max-image-preview:none' }",
  });
  const rg = await runJ('repo-audit.mjs', goodRepo);
  ok(rg.json && rg.json.issues.filter((i) => !['INFO', 'LOW'].includes(i.sev)).length === 0, 'repo-audit good: no MEDIUM+ (googleBot.noimageindex, helper notFound, const generateMetadata, route groups, parallel routes, BOM)', JSON.stringify(rg.json?.issues || rg.err));
  expectNoCodes(rg, ['external-fonts'], 'repo-audit good (URL in a comment)');
  expectNoCodes(rg, ['metadata-noindex', 'page-no-metadata'], 'repo-audit good (export { metadata } from, regex literal with /*, max-image-preview:none string) (N6/N8/N17)');
  const envRepo = join(tmp, 'env');
  mk(envRepo, {
    'package.json': JSON.stringify({ dependencies: { next: '15.3.0' } }),
    'app/layout.tsx': "export const metadata = {\n  metadataBase: new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`),\n  robots: { index: false, follow: false },\n}\nexport default function L({children}){return <html lang='en'><body>{children}</body></html>}",
    'app/page.tsx': 'export default function P(){return <h1>Home</h1>}',
    'app/about/page.tsx': "export const metadata = { robots: { googleBot: 'noindex, nofollow' } }\nexport default function A(){return <h1>About</h1>}",
  });
  const re2 = await runJ('repo-audit.mjs', envRepo);
  ok(re2.json?.issues?.some((i) => i.code === 'metadata-noindex' && i.sev === 'FATAL' && /layout/.test(i.msg)), 'N2: unconditional root noindex stays FATAL even if the file mentions process.env', JSON.stringify(re2.json?.issues));
  ok(re2.json?.issues?.some((i) => i.code === 'metadata-noindex' && /about/.test(i.msg)), 'N17: googleBot string noindex detected');
  const r3 = join(tmp, 'r3');
  mk(r3, {
    'package.json': JSON.stringify({ dependencies: { next: '16.0.0' } }),
    'app/layout.tsx': "const isRoot = (p: string) => /^\\/*$/.test(p)\nexport const metadata = { metadataBase: new URL('https://x.com'), robots: { index: false } }\nexport default function L({children}){return <html lang='en'><body>{children}</body></html>}",
    'app/page.tsx': 'export default function P(){return <h1>Home</h1>}',
    'app/a/page.tsx': "export const metadata = { 'robots': 'noindex' }\nexport default function A(){return <h1>A</h1>}",
    'app/b/page.tsx': "const ROBOTS = { index: false, follow: true }\nexport const metadata = { title: 'B', robots: ROBOTS }\nexport default function B(){return <h1>B</h1>}",
    'app/c/page.tsx': "export const metadata = { title: 'C', robots: process.env.VERCEL_ENV === 'production' ? { index: true } : { index: false } }\nexport default function C(){return <h1>C</h1>}",
    'app/d/page.tsx': "export const metadata = { title: 'D', openGraph: { title: 'D' }, robots: { index: true } }\nexport const other = { robots: { index: false } }\nexport default function D(){return <h1>D</h1>}",
  });
  const r3r = await runJ('repo-audit.mjs', r3);
  const ni = (re) => r3r.json?.issues?.find((i) => i.code === 'metadata-noindex' && re.test(i.msg));
  ok(ni(/layout/)?.sev === 'FATAL', 'v3: regex literal after "=>" does not hide the root noindex', JSON.stringify(r3r.json?.issues));
  ok(!r3r.json?.issues?.some((i) => i.code === 'no-metadataBase'), 'v3: metadataBase still seen after the regex literal');
  ok(ni(/app\/a\//), 'v3: quoted \'robots\' key noindex detected');
  ok(ni(/app\/b\//), 'v3: robots set from a same-file constant detected');
  ok(ni(/app\/c\//)?.sev === 'INFO', 'v3: env ternary noindex reported as guarded INFO');
  ok(ni(/app\/d\//), 'v3: a second robots object in the file is checked');
  const r4 = join(tmp, 'r4');
  mk(r4, {
    'package.json': JSON.stringify({ dependencies: { next: '16.0.0' } }),
    'app/layout.tsx': "const robots = { index: false, follow: false }\nexport const metadata = { metadataBase: new URL('https://x.com'), robots }\nexport default function L({children}){return <html lang='en'><body>{children}</body></html>}",
    'app/page.tsx': 'export default function P(){return <h1>Home</h1>}',
  });
  const r4r = await runJ('repo-audit.mjs', r4);
  ok(r4r.json?.issues?.some((i) => i.code === 'metadata-noindex' && i.sev === 'FATAL'), 'v4: shorthand `{ robots }` from a const is checked', JSON.stringify(r4r.json?.issues));
  rmSync(tmp, { recursive: true, force: true });

  // ---- optional live network checks ----
  if (process.argv.includes('--network')) {
    const cwv = await runJ('cwv.mjs', 'https://web.dev/', '--strategy', 'mobile');
    if (cwv.code === 3) { ok(cwv.json?.notMeasured, 'cwv live: not-measured JSON'); console.log('SKIP cwv live: PSI not reachable/quota (exit 3, as designed)'); }
    else ok(cwv.json?.lab, 'cwv live: PSI returns lab data', cwv.err);
    const live = await runJ('seo-check.mjs', 'https://example.com/');
    ok(live.json?.status === 200, 'seo-check: live fetch works', live.err);
  }
} finally {
  for (const s of [B, C, E]) { s.server.closeAllConnections?.(); s.server.close(); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
