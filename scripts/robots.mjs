// robots.txt parser/matcher following RFC 9309 and Google's open-source parser:
// - user-agent product tokens ([A-Za-z0-9_-]) match case-insensitively; groups for the same token merge
// - consecutive user-agent lines form one group; only allow/disallow lines end the agent list
//   (crawl-delay, host, sitemap and unknown lines do not interfere)
// - the most specific matching group wins, else "*", else allow all
// - longest matching rule wins; on a tie, allow wins; "*" any sequence, "$" end anchor
// - linear-time matching (no regex backtracking), percent-escapes compared case-insensitively
// - Google reads only the first 500 KiB; accepts "user agent"/"useragent" and common "disallow" typos
// - /robots.txt itself is always allowed
// Google ignores crawl-delay and noindex lines; Bing honours crawl-delay.

import { T } from './thresholds.mjs';

export const ROBOTS_MAX_BYTES = T.robotsMaxBytes; // single source: scripts/thresholds.mjs

// When a crawler has no group of its own it falls back to another crawler's group.
const FALLBACK = {
  'googlebot-image': 'googlebot',
  'googlebot-news': 'googlebot',
  'googlebot-video': 'googlebot',
  'storebot-google': 'googlebot',
  'google-inspectiontool': 'googlebot',
  applebot: 'googlebot', // Apple: Applebot follows Googlebot rules when it has none of its own
};

const KEY_ALIASES = {
  'user-agent': 'user-agent', useragent: 'user-agent', 'user agent': 'user-agent',
  allow: 'allow',
  disallow: 'disallow', dissallow: 'disallow', dissalow: 'disallow', disalow: 'disallow', diasllow: 'disallow', disallaw: 'disallow',
  sitemap: 'sitemap', 'site-map': 'sitemap',
  'crawl-delay': 'crawl-delay', noindex: 'noindex', nofollow: 'nofollow', host: 'host',
};

export function parseRobots(input = '') {
  let text = input.replace(/^﻿/, '');
  const oversized = Buffer.byteLength(text, 'utf8') > ROBOTS_MAX_BYTES;
  if (oversized) text = Buffer.from(text, 'utf8').subarray(0, ROBOTS_MAX_BYTES).toString('utf8');
  const groups = [];
  const sitemaps = [];
  const unsupported = [];
  let current = null;
  let inAgentList = false;
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    let key, value;
    const m = /^([A-Za-z][A-Za-z -]*?)\s*:\s*(.*)$/.exec(line);
    if (m) {
      key = m[1].toLowerCase().replace(/\s+/g, ' ');
      value = m[2].trim();
    } else {
      const parts = line.split(/\s+/); // Google accepts "Disallow /" (exactly two tokens, no colon)
      if (parts.length !== 2) return;
      [key, value] = [parts[0].toLowerCase(), parts[1]];
    }
    const field = KEY_ALIASES[key];
    if (!field) return;
    if (field === 'user-agent') {
      const token = value === '*' ? '*' : (/^[A-Za-z0-9_-]+/.exec(value)?.[0] || '').toLowerCase();
      if (!inAgentList || !current) {
        current = { agents: [], rules: [], crawlDelay: null, line: i + 1 };
        groups.push(current);
      }
      if (token) current.agents.push(token);
      inAgentList = true;
      return;
    }
    if (field === 'sitemap') {
      sitemaps.push(value);
      return;
    }
    if (!current) return; // rules before any user-agent are ignored
    if (field === 'allow' || field === 'disallow') {
      current.rules.push({ allow: field === 'allow', path: value, line: i + 1 });
      inAgentList = false;
    } else if (field === 'crawl-delay') {
      current.crawlDelay = value;
    } else if (field === 'noindex' || field === 'nofollow') {
      unsupported.push({ field, value, line: i + 1 });
    }
  });
  return { groups, sitemaps, unsupported, oversized };
}

// Normalise a path or pattern for comparison: uppercase %xx escapes, percent-encode
// non-ASCII and spaces. "*" and "$" in patterns stay special; "%2A" stays a literal escape.
export function normPath(p) {
  let out = '';
  for (const ch of String(p)) {
    const code = ch.codePointAt(0);
    if (code > 0x7e || code <= 0x20) out += encodeURIComponent(ch);
    else out += ch;
  }
  return out.replace(/%[0-9a-f]{2}/gi, (e) => e.toUpperCase());
}

// Google's position-set matcher: O(path x pattern), no backtracking.
export function matches(path, pat) {
  let pos = [0];
  for (let j = 0; j < pat.length; j++) {
    const c = pat[j];
    if (c === '$' && j === pat.length - 1) return pos.includes(path.length);
    if (c === '*') {
      const s = pos[0];
      pos = [];
      for (let i = s; i <= path.length; i++) pos.push(i);
      continue;
    }
    const nx = [];
    for (const p of pos) if (p < path.length && path[p] === c) nx.push(p + 1);
    if (!nx.length) return false;
    pos = nx;
  }
  return true;
}

export function selectGroup(parsed, userAgentToken) {
  let token = userAgentToken.toLowerCase();
  const tried = new Set();
  while (token && !tried.has(token)) {
    tried.add(token);
    const hit = parsed.groups.filter((g) => g.agents.includes(token));
    if (hit.length) return { token, rules: hit.flatMap((g) => g.rules), crawlDelay: hit.find((g) => g.crawlDelay)?.crawlDelay ?? null };
    token = FALLBACK[token];
  }
  const star = parsed.groups.filter((g) => g.agents.includes('*'));
  if (star.length) return { token: '*', rules: star.flatMap((g) => g.rules), crawlDelay: star.find((g) => g.crawlDelay)?.crawlDelay ?? null };
  return { token: null, rules: [], crawlDelay: null };
}

// pathWithQuery like "/blog/x?page=2"
export function isAllowed(parsed, userAgentToken, pathWithQuery) {
  const path = normPath(pathWithQuery || '/');
  if (path === '/robots.txt') return { allowed: true, rule: null, group: null };
  const group = selectGroup(parsed, userAgentToken);
  let best = null;
  for (const r of group.rules) {
    if (r.path === '') continue;
    const rp = normPath(r.path);
    if (!matches(path, rp)) continue;
    const len = rp.length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.rule.allow)) best = { len, rule: r };
  }
  return { allowed: best ? best.rule.allow : true, rule: best?.rule ?? null, group: group.token };
}

export const BOTS = [
  // [token, category, what it does]  (see references/thresholds.md > Crawlers)
  ['Googlebot', 'search', 'Google Search (also AI Overviews / AI Mode)'],
  ['Bingbot', 'search', 'Bing search and Copilot'],
  ['DuckDuckBot', 'search', 'DuckDuckGo own crawler'],
  ['Applebot', 'search', 'Siri / Spotlight / Safari suggestions (falls back to Googlebot rules)'],
  ['YandexBot', 'search', 'Yandex'],
  ['OAI-SearchBot', 'ai-search', 'ChatGPT search results and citations'],
  ['Claude-SearchBot', 'ai-search', 'Claude search results'],
  ['PerplexityBot', 'ai-search', 'Perplexity answer index'],
  ['Amzn-SearchBot', 'ai-search', 'Amazon/Alexa search experiences (not AI training)'],
  ['ChatGPT-User', 'ai-user', 'user-triggered ChatGPT fetches (OpenAI: robots.txt may not apply)'],
  ['Claude-User', 'ai-user', 'user-triggered Claude fetches (respects robots.txt)'],
  ['Perplexity-User', 'ai-user', 'user-triggered Perplexity fetches (generally ignores robots.txt)'],
  ['Amzn-User', 'ai-user', 'user-triggered Amazon fetches (may not follow robots.txt)'],
  ['GPTBot', 'ai-training', 'OpenAI model training'],
  ['ClaudeBot', 'ai-training', 'Anthropic model training'],
  ['Google-Extended', 'ai-training', 'Gemini training and Gemini Apps/Vertex AI grounding; not Google Search'],
  ['Applebot-Extended', 'ai-training', 'Apple foundation model training'],
  ['CCBot', 'ai-training', 'Common Crawl (widely used for training)'],
  ['Meta-ExternalAgent', 'ai-training', 'Meta AI training'],
  ['Bytespider', 'ai-training', 'ByteDance'],
  ['Amazonbot', 'ai-mixed', 'Amazon general crawler (see developer.amazon.com/amazonbot)'],
];
