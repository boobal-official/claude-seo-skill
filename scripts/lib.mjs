// Shared helpers for the seo skill scripts. Zero dependencies, Node >= 18.
// Regex/streaming based so it runs anywhere Claude Code runs (Windows, macOS, Linux)
// without npm install. Real-world HTML is messy: every parser here masks <script>,
// <style>, comments, etc. first so text inside them cannot be mistaken for markup.

import { gunzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';

export const UA_PRESETS = {
  checker: 'Mozilla/5.0 (compatible; seo-skill-checker/1.0; +site-owner-audit)',
  browser:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  googlebot:
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'oai-searchbot':
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot)',
  gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  perplexitybot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  claudebot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
};

export function resolveUA(v) {
  if (!v || v === true) return UA_PRESETS.checker;
  return UA_PRESETS[String(v).toLowerCase()] ?? String(v);
}

// ---------- CLI helpers ----------
// Boolean flags never consume the next argument, so flag order does not matter.
const BOOL_FLAGS = new Set(['json', 'bots', 'deep', 'local', 'submit', 'offline', 'help', 'allow-private']);
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) args[k] = BOOL_FLAGS.has(k) ? /^(1|true|yes)$/i.test(a.slice(eq + 1)) : a.slice(eq + 1);
      else if (BOOL_FLAGS.has(k)) args[k] = true;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
      else args[k] = true;
    } else args._.push(fixMsysPath(a));
  }
  return args;
}

// Git Bash (MSYS) rewrites arguments that start with "/" into Windows paths
// ("/pricing" -> "C:/Program Files/Git/pricing"). Undo that for path-like args.
// Only the Git install root is rewritten, and only when the argument is not a real path.
export function fixMsysPath(a) {
  const m = /^[A-Za-z]:[\\/]Program Files[\\/]Git([\\/].*)$/i.exec(a);
  if (!m || existsSync(a)) return a;
  return m[1].replace(/\\/g, '/');
}

export function intArg(v, def, name) {
  if (v === undefined) return def;
  if (v === true) throw new UsageError(`--${name} needs a value`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${name} must be a non-negative number, got "${v}"`);
  return Math.floor(n);
}

export function urlArg(v, name = 'url') {
  if (!v) throw new UsageError(`missing ${name}`);
  let s = String(v);
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`; // "example.com" -> https://example.com
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    return u.href;
  } catch {
    throw new UsageError(`invalid ${name}: "${v}"`);
  }
}

export class UsageError extends Error {}

// Runs a CLI main(). Any crash still yields valid JSON (with --json) and a documented exit code:
// 64 = usage error, 3 = could not complete (network/internal), else what main() returns.
// The JSON error object uses severity INFO on purpose: a typo or a crash is not a site defect, so
// consumers that count FATAL/HIGH issues are not misled. The exit code (64 / 3) carries the meaning.
export async function runMain(main, usage) {
  const json = process.argv.some((a) => a === '--json' || /^--json=(1|true|yes)$/i.test(a)) && !process.argv.some((a) => /^--json=(0|false|no)$/i.test(a));
  try {
    const code = await main();
    process.exitCode = code ?? 0;
  } catch (e) {
    const usageErr = e instanceof UsageError;
    const msg = usageErr ? e.message : `${e?.name || 'Error'}: ${e?.message || e}`;
    if (json) console.log(JSON.stringify({ error: msg, usageError: usageErr, notMeasured: !usageErr, issues: [{ sev: 'INFO', code: usageErr ? 'usage-error' : 'internal-error', msg }] }));
    else {
      console.error(msg);
      if (usageErr && usage) console.error(`usage: ${usage}`);
    }
    process.exitCode = usageErr ? 64 : 3;
  }
}

export const SEV_ORDER = ['FATAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
export const sevRank = (s) => SEV_ORDER.indexOf(s);
export function sortIssues(issues) {
  return [...issues].sort((a, b) => sevRank(a.sev) - sevRank(b.sev));
}
export function exitCodeFor(issues) {
  if (issues.some((i) => i.sev === 'FATAL')) return 2;
  if (issues.some((i) => i.sev === 'HIGH')) return 1;
  return 0;
}
export function printIssues(issues, { indent = '' } = {}) {
  const sorted = sortIssues(issues);
  if (!sorted.length) {
    console.log(`${indent}No issues found.`);
    return;
  }
  for (const i of sorted) {
    console.log(`${indent}[${i.sev}] ${i.code}: ${safe(i.msg)}`);
    if (i.fix) console.log(`${indent}        fix: ${safe(i.fix)}`);
    if (i.urls?.length) {
      for (const u of i.urls.slice(0, 10)) console.log(`${indent}        - ${safe(u)}`);
      if (i.urls.length > 10) console.log(`${indent}        ... +${i.urls.length - 10} more`);
    }
  }
}

// Neutralises control characters from untrusted page content before printing to a terminal
// (prevents ANSI/OSC escape-sequence injection via titles, URLs, headers).
export function safe(s) {
  return String(s ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '�');
}

// ---------- SSRF guard ----------
// Untrusted sites can point the tools at internal addresses (robots.txt Sitemap lines, sitemap
// indexes, og:image, redirects). Unless the audit itself targets a private/local host, requests to
// loopback, private, link-local (cloud metadata), CGNAT and unique-local addresses are refused.
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
function privateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
}
const hostCache = new Map();
export async function isPrivateHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (isIP(h)) return privateIp(h);
  if (!hostCache.has(h)) hostCache.set(h, lookup(h, { all: true }).then((rs) => rs.some((r) => privateIp(r.address))).catch(() => false));
  return hostCache.get(h);
}
let fetchGuard = null;
// Call once per run with the audited URL. Auditing a local/private site allows private targets.
export async function enableSsrfGuard(startUrl, { allowPrivate = false } = {}) {
  if (allowPrivate || (await isPrivateHost(new URL(startUrl).hostname))) { fetchGuard = null; return false; }
  fetchGuard = async (u) => {
    try {
      return (await isPrivateHost(new URL(u).hostname)) ? `blocked: ${new URL(u).hostname} resolves to a private/loopback/link-local address (SSRF protection; pass --allow-private to override)` : null;
    } catch {
      return null;
    }
  };
  return true;
}

// ---------- HTTP ----------
// Follows redirects manually so every hop is visible. Never throws: every failure is
// returned as { error } so one bad URL cannot crash a whole crawl.
export async function fetchChain(url, opts = {}) {
  const {
    ua = UA_PRESETS.checker,
    maxHops = 10,
    timeoutMs = 20000,
    method = 'GET',
    body: reqBody,
    headers = {},
    read = 'text', // 'text' | 'buffer' | false
    maxBytes = 8_000_000,
  } = opts;
  const chain = [];
  let current = url;
  const t0 = performance.now();
  for (let i = 0; i <= maxHops; i++) {
    const hopStart = performance.now();
    const guard = opts.guard === undefined ? fetchGuard : opts.guard;
    if (guard) {
      const why = await guard(current);
      if (why) return { chain, finalUrl: current, status: 0, blocked: true, error: why };
    }
    let res;
    try {
      res = await fetch(current, {
        method,
        body: reqBody,
        redirect: 'manual',
        headers: {
          'user-agent': ua,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en;q=0.9,*;q=0.5',
          'accept-encoding': 'gzip, deflate, br',
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return { chain, finalUrl: current, status: 0, error: netErr(e) };
    }
    const ttfbMs = Math.round(performance.now() - hopStart);
    const status = res.status;
    const location = res.headers.get('location');
    if (status >= 300 && status < 400 && location) {
      let next;
      try {
        next = new URL(location, current).href;
      } catch {
        try { await res.body?.cancel(); } catch {}
        return { chain, finalUrl: current, status, headers: res.headers, error: `invalid Location header: "${location}"` };
      }
      chain.push({ url: current, status, location: next });
      try { await res.body?.cancel(); } catch {}
      if (chain.some((h) => h.url === next)) return { chain, finalUrl: next, status, error: 'redirect loop' };
      current = next;
      continue;
    }
    const base = { chain, finalUrl: current, status, headers: res.headers, ttfbMs };
    if (!read || method === 'HEAD') {
      try { await res.body?.cancel(); } catch {}
      return { ...base, body: '', bytes: 0, totalMs: Math.round(performance.now() - t0) };
    }
    let buffer, bytes = 0, truncated = false;
    try {
      ({ buffer, bytes, truncated } = await readLimited(res, maxBytes));
    } catch (e) {
      return { ...base, body: '', bytes: 0, error: `body read failed: ${netErr(e)}` };
    }
    const body = read === 'text' ? decodeBody(buffer, res.headers.get('content-type')) : '';
    return { ...base, body, buffer, bytes, truncated, totalMs: Math.round(performance.now() - t0) };
  }
  return { chain, finalUrl: current, status: 0, error: `more than ${maxHops} redirects` };
}

function netErr(e) {
  const code = e?.cause?.code || e?.name || 'FetchError';
  return `${code}: ${e?.cause?.message || e?.message || e}`;
}

// Streams the body and stops at maxBytes (memory-safe on huge pages). `bytes` counts
// everything received up to the cap; `truncated` says the cap was hit.
async function readLimited(res, maxBytes) {
  if (!res.body) return { buffer: Buffer.alloc(0), bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const parts = [];
  let bytes = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    parts.push(value);
    if (bytes >= maxBytes) {
      truncated = true;
      try { await reader.cancel(); } catch {}
      break;
    }
  }
  const buf = Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
  return { buffer: buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf, bytes, truncated };
}

// Decodes using the HTTP charset, else <meta charset>, else UTF-8.
// WHATWG order: byte-order mark, then HTTP charset, then <meta charset>, then UTF-8.
export function decodeBody(buf, contentType = '') {
  if (!buf) return '';
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  let label = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  if (!label) {
    const head = buf.subarray(0, 2048).toString('latin1');
    label = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  label = (label || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(label).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return buf.toString('utf8').replace(/^\uFEFF/, '');
  }
}

// fetch() joins repeated headers with ", ", which loses the boundary between separate
// X-Robots-Tag headers. This re-requests the URL with node:http(s) to get each value separately.
export async function rawHeaderValues(url, name, ua = UA_PRESETS.checker, timeoutMs = 15000) {
  try {
    const mod = url.startsWith('https:') ? await import('node:https') : await import('node:http');
    return await new Promise((resolve) => {
      const req = mod.request(url, { method: 'GET', headers: { 'user-agent': ua }, timeout: timeoutMs }, (res) => {
        const v = res.headersDistinct?.[name.toLowerCase()] ?? (res.headers[name.toLowerCase()] !== undefined ? [String(res.headers[name.toLowerCase()])] : []);
        res.destroy();
        resolve(v);
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  } catch {
    return null;
  }
}

// Capped at the sitemap protocol's 50 MB uncompressed limit, so a gzip bomb cannot exhaust memory.
export function maybeGunzip(buf, maxOutputLength = 50 * 1024 * 1024) {
  if (buf && buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf, { maxOutputLength });
  return buf;
}

export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const n = Math.max(1, Math.floor(Number(limit)) || 1);
  const workers = Array.from({ length: Math.min(n, Math.max(1, items.length)) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- URL helpers ----------
export function normalizeUrl(u, base) {
  try {
    const url = new URL(u, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) url.port = '';
    return url.href;
  } catch {
    return null;
  }
}

// Hosts that should never appear in production canonicals/sitemaps/OG URLs.
// staging./dev./test. etc. count only as a subdomain label (so dev.to, test.com, uat.com are real sites).
export const NON_PROD_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|.*\.(vercel\.app|netlify\.app|pages\.dev|herokuapp\.com|ngrok(-free)?\.(app|io)|onrender\.com|fly\.dev|web\.app|firebaseapp\.com)|(?:staging|stage|preview|dev|test|uat)(?:-[a-z0-9-]+)?\.(?:[^.]+\.)+[^.]+)$/i;

export const NON_HTML_EXT =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|css|js|mjs|map|json|xml|txt|pdf|zip|gz|rar|7z|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|csv|xlsx?|docx?|pptx?)$/i;

// ---------- HTML parsing ----------
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', sbquo: '\u201a', bdquo: '\u201e', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', middot: '\u00b7', bull: '\u2022', laquo: '\u00ab', raquo: '\u00bb', euro: '\u20ac',
  pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', rupee: '\u20b9', deg: '\u00b0', times: '\u00d7', divide: '\u00f7',
  frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', shy: '', zwnj: '\u200c', zwj: '\u200d', thinsp: '\u2009',
  ensp: '\u2002', emsp: '\u2003', eacute: '\u00e9', egrave: '\u00e8', aacute: '\u00e1', agrave: '\u00e0', ouml: '\u00f6',
  uuml: '\u00fc', auml: '\u00e4', szlig: '\u00df', ntilde: '\u00f1', ccedil: '\u00e7', iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa',
};
export function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      const control = (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) || (cp >= 0x7f && cp <= 0x9f);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) && !control ? String.fromCodePoint(cp) : '\uFFFD';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function parseAttrs(s = '') {
  const out = {};
  const re = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*)`;
const RAW_BLOCKS = ['script', 'style', 'template', 'noscript', 'textarea', 'svg', 'iframe', 'xmp', 'title'];

// Scans the document left to right like a browser tokenizer: comments and raw-text
// elements are found in document order, so "<!--" inside a script string does not start
// a comment and a <script> inside a comment is not a script. Returns:
//   masked: same-length copy with comments and raw blocks blanked (indexes preserved)
//   scripts: [{attrs, inner, index}] for <script> elements that are not inside comments
//   noComments: same-length copy with only comments blanked
export function scan(html) {
  if (scan.lastHtml === html) return scan.last;
  // Comments (incl. HTML5 empty forms "<!-->" and "<!--->") or the start tag of a raw-text block.
  // Third alternative: any other start/end tag is stepped over whole, so "<!--" inside an attribute
  // value (title="<!--") is not mistaken for a comment.
  const re = new RegExp(`<!--(?:-?>|[\\s\\S]*?(?:--!?>|$))|<(${RAW_BLOCKS.join('|')})(?=[\\s/>])${ATTRS}>|<\\/?[a-zA-Z][\\w:-]*(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');
  let masked = '', noComments = '', last = 0, m;
  const scripts = [];
  const noCloseFrom = {}; // tag -> position after which no closing tag exists (keeps unclosed tags O(n))
  while ((m = re.exec(html))) {
    let end = m.index + m[0].length;
    const isComment = m[0].startsWith('<!--');
    if (!isComment && !m[1]) {
      // Ordinary tag: copy it unchanged and continue after it.
      const end = m.index + m[0].length;
      masked += html.slice(last, end);
      noComments += html.slice(last, end);
      last = end;
      continue;
    }
    const tag = isComment ? '' : m[1].toLowerCase();
    let inner = '';
    if (!isComment) {
      const selfClosing = tag === 'svg' && /\/\s*$/.test(m[2] || '');
      if (!selfClosing) {
        let c = null;
        if (!(noCloseFrom[tag] !== undefined && end >= noCloseFrom[tag])) {
          const close = new RegExp(`<\\/${tag}\\s*>`, 'gi');
          close.lastIndex = end;
          c = close.exec(html);
          if (!c) noCloseFrom[tag] = end;
        }
        inner = html.slice(end, c ? c.index : html.length);
        // An unclosed <svg> is foreign content browsers recover from: mask only the tag.
        end = c ? c.index + c[0].length : tag === 'svg' ? end : html.length;
      }
      if (tag === 'script') scripts.push({ attrs: parseAttrs(m[2]), inner, index: m.index });
    }
    // <title> is raw text too (so "<script>" inside a title cannot swallow the page) but stays visible.
    const keep = tag === 'title';
    const blank = ' '.repeat(end - m.index);
    // For <title>: keep the open/close tags (so it can be found) but blank its text, so tag-like
    // text in a title ("The HTML <body> tag") is never read as markup. page.mjs reads the text from html.
    let piece = blank;
    if (keep) {
      const openEnd = m.index + m[0].length;
      const closeLen = /<\/title\s*>$/i.exec(html.slice(openEnd, end))?.[0].length ?? 0;
      const closeAt = Math.max(openEnd, end - closeLen);
      piece = html.slice(m.index, openEnd) + ' '.repeat(closeAt - openEnd) + html.slice(closeAt, end);
    }
    masked += html.slice(last, m.index) + piece;
    noComments += html.slice(last, m.index) + (isComment ? blank : html.slice(m.index, end));
    last = re.lastIndex = end;
  }
  masked += html.slice(last);
  noComments += html.slice(last);
  const result = { masked, noComments, scripts };
  scan.lastHtml = html;
  scan.last = result;
  return result;
}

export function stripComments(html) {
  return scan(html).noComments;
}

// Returns [{attrs, index}] for every <tag ...> (exact tag name, not custom elements like <link-preview>).
export function findTags(html, tag) {
  const re = new RegExp(`<${tag}(?=[\\s/>])${ATTRS}>`, 'gi');
  return [...html.matchAll(re)].map((m) => ({ attrs: parseAttrs(m[1]), index: m.index }));
}

// Returns [{attrs, inner, index}] for paired tags (non-nested assumption).
// Linear: openers are found in one pass and each pairs with the first closing tag after it
// (non-nested assumption, same results as a lazy regex) via a pointer over the close positions,
// so thousands of unclosed tags cannot make parsing quadratic.
function pairRanges(html, tag) {
  const openRe = new RegExp(`<${tag}(?=[\\s/>])${ATTRS}>`, 'gi');
  const closes = [...html.matchAll(new RegExp(`<\\/${tag}\\s*>`, 'gi'))].map((m) => [m.index, m[0].length]);
  const out = [];
  let ci = 0, m;
  while ((m = openRe.exec(html))) {
    const start = m.index + m[0].length;
    while (ci < closes.length && closes[ci][0] < start) ci++;
    if (ci >= closes.length) break;
    out.push({ attrsRaw: m[1], index: m.index, innerStart: start, innerEnd: closes[ci][0], end: closes[ci][0] + closes[ci][1] });
    openRe.lastIndex = closes[ci][0] + closes[ci][1];
  }
  return out;
}
export function findPaired(html, tag) {
  return pairRanges(html, tag).map((r) => ({ attrs: parseAttrs(r.attrsRaw), inner: html.slice(r.innerStart, r.innerEnd), index: r.index }));
}
function blankRanges(h, ranges) {
  if (!ranges.length) return h;
  let out = '', last = 0;
  for (const r of ranges.sort((a, b) => a.index - b.index)) {
    if (r.index < last) continue;
    out += h.slice(last, r.index) + ' ';
    last = r.end;
  }
  return out + h.slice(last);
}

// Index where <head> ends, computed on masked HTML so "<body" inside a script does not count.
export function headEndIndex(html) {
  const m = scan(html).masked.search(/<\/head\s*>|<body(?=[\s>])/i);
  return m < 0 ? html.length : m;
}

export function textOf(fragment = '') {
  return decodeEntities(
    fragment
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(new RegExp(`<(${RAW_BLOCKS.join('|')})(?=[\\s/>])[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function visibleText(html) {
  const body = scan(html).masked.replace(/<head(?=[\s>])[\s\S]*?<\/head\s*>/i, ' ');
  return textOf(body);
}

export function wordCount(text) {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// Removes site chrome so only body-copy links/text remain.
export function stripChrome(html) {
  let h = scan(html).masked;
  for (const t of ['nav', 'header', 'footer', 'aside']) h = blankRanges(h, pairRanges(h, t));
  // Elements with role="navigation": find openers in one pass, close each with the first matching end tag.
  const ranges = [];
  const noClose = new Set();
  for (const m of h.matchAll(/<([a-z][a-z0-9]*)\b(?:[^>"']|"[^"]*"|'[^']*')*\brole=["']?navigation["']?(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tag = m[1].toLowerCase();
    if (noClose.has(tag)) continue;
    const close = new RegExp(`<\\/${tag}\\s*>`, 'gi');
    close.lastIndex = m.index + m[0].length;
    const c = close.exec(h);
    if (!c) { noClose.add(tag); continue; }
    ranges.push({ index: m.index, end: c.index + c[0].length });
  }
  return blankRanges(h, ranges);
}

export function mainContent(html) {
  const masked = scan(html).masked;
  const r = pairRanges(masked, 'main')[0];
  return r ? masked.slice(r.innerStart, r.innerEnd) : stripChrome(html);
}

// <base href> changes how every relative URL on the page resolves.
export function baseUrlOf(html, pageUrl) {
  const masked = scan(html).masked;
  const b = findTags(masked.slice(0, headEndIndex(html)), 'base')[0]?.attrs.href;
  if (!b) return pageUrl;
  try { return new URL(b, pageUrl).href; } catch { return pageUrl; }
}

export function extractLinks(html, pageUrl) {
  const masked = scan(html).masked;
  const base = baseUrlOf(html, pageUrl);
  const out = [];
  for (const a of findPaired(masked, 'a')) {
    const href = a.attrs.href;
    if (href === undefined) continue;
    const abs = normalizeUrl(href.trim(), base);
    out.push({
      href,
      url: abs,
      rel: (a.attrs.rel || '').toLowerCase(),
      text: textOf(a.inner) || a.attrs['aria-label'] || a.attrs.title || '',
      hasImgAlt: /<img\b[^>]*\balt=["'][^"']+["']/i.test(a.inner),
    });
  }
  return out;
}

// ---------- JSON-LD ----------
export function extractJsonLd(html) {
  const blocks = [];
  for (const s of scan(html).scripts) {
    if ((s.attrs.type || '').trim().toLowerCase() !== 'application/ld+json') continue;
    const raw = s.inner
      .replace(/^\s*(?:\/\/|\/\*)?\s*<!\[CDATA\[\s*(?:\*\/)?/, '')
      .replace(/(?:\/\/|\/\*)?\s*\]\]>\s*(?:\*\/)?\s*$/, '')
      .trim();
    if (!raw) continue;
    try {
      blocks.push({ ok: true, data: JSON.parse(raw) });
    } catch (e) {
      blocks.push({ ok: false, error: e.message, snippet: raw.slice(0, 120) });
    }
  }
  return blocks;
}

export const typeName = (t) => String(t).split(/[/:#]/).pop();
export function typesOf(node) {
  const t = node?.['@type'];
  if (!t) return [];
  return (Array.isArray(t) ? t : [t]).map(typeName);
}

export function walkNodes(value, parentTypes = [], out = []) {
  if (Array.isArray(value)) {
    for (const v of value) walkNodes(v, parentTypes, out);
  } else if (value && typeof value === 'object') {
    const types = typesOf(value);
    if (types.length) out.push({ node: value, types, parentTypes });
    for (const [k, v] of Object.entries(value)) {
      if (k === '@context') continue;
      walkNodes(v, types.length ? types : parentTypes, out);
    }
  }
  return out;
}

// ---------- hreflang ----------
const ISO_REGIONS = new Set(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ')
);
// Returns null when fine, { sev, code, msg } otherwise.
export function checkHreflangCode(code) {
  if (code.toLowerCase() === 'x-default') return null;
  const m = /^([a-z]{2,3})(?:-([A-Za-z]{4}))?(?:-([A-Za-z]{2}|\d{3}))?$/i.exec(code);
  if (!m) return { sev: 'MEDIUM', code: 'hreflang-invalid', msg: `"${code}" is not a valid hreflang value (ISO 639-1 language, optional script, optional ISO 3166-1 region, e.g. en, zh-Hant, en-GB)` };
  if (m[1].length === 3) return { sev: 'LOW', code: 'hreflang-language-3letter', msg: `"${code}": Google documents ISO 639-1 (2-letter) languages; use the 2-letter code if one exists` };
  if (m[3] && /^\d{3}$/.test(m[3])) return { sev: 'LOW', code: 'hreflang-region-unsupported', msg: `"${code}": numeric UN M.49 region "${m[3]}" is valid BCP 47 but Google documents only ISO 3166-1 alpha-2 regions; it may be ignored (list the countries instead, or use the language alone)` };
  if (m[3] && !ISO_REGIONS.has(m[3].toUpperCase()))
    return { sev: 'MEDIUM', code: 'hreflang-invalid', msg: `"${code}": region "${m[3]}" is not an ISO 3166-1 code${m[3].toUpperCase() === 'UK' ? ' (use GB for the United Kingdom)' : ''}` };
  return null;
}

// ---------- currency detection (prices visible to non-JS crawlers) ----------
export const PRICE_RE = /(?:[$€£₹¥]|\bRs\.?|\bINR|\bUSD|\bEUR|\bGBP)\s?\d[\d,]*(?:\.\d+)?/gi;
