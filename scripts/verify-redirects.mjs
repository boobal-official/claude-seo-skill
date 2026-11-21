#!/usr/bin/env node
// Usage: node verify-redirects.mjs seo/redirect-map.csv [--http-max-hops 2] [--json]
// CSV header: old_url,new_url   (absolute URLs; quote a field with "..." if it contains commas)
// A row passes when: the first hop is 301 or 308, new_url is reached in exactly 1 hop, and
// new_url returns 200. The http:// variant of every https:// old URL is also checked
// (managed hosts like Vercel/Netlify upgrade http->https first, so 2 hops are allowed there).
// Exit: 1 if any row fails, 0 if all pass, 3 = could not run, 64 = usage error.

import { readFileSync } from 'node:fs';
import { parseArgs, fetchChain, pool, normalizeUrl, runMain, intArg, UsageError } from './lib.mjs';

const USAGE = 'node verify-redirects.mjs map.csv [--http-max-hops 2] [--json]';
const args = parseArgs(process.argv.slice(2));

// Minimal RFC 4180 line parser (quoted fields, "" escapes). Unquoted rows with extra commas
// are split at the last ",http" so URLs containing commas still work.
function parseRow(line) {
  if (line.includes('"')) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }
  // Unquoted: old_url is everything up to the comma before the second absolute URL; new_url ends
  // at the next comma (extra columns such as a status code are ignored).
  const m = /^(.*?),\s*(https?:\/\/[^,]*)(?:,.*)?$/i.exec(line);
  if (!m) return line.split(',').map((s) => s.trim());
  return [m[1].trim(), m[2].trim()];
}

runMain(async () => {
  const file = args._[0] || 'seo/redirect-map.csv';
  const httpMax = intArg(args['http-max-hops'], 2, 'http-max-hops');
  let text;
  try { text = readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch (e) { throw new UsageError(`cannot read ${file}: ${e.code || e.message}`); }
  const rows = [];
  text.split(/\r?\n/).forEach((l, i) => {
    const line = l.trim();
    if (!line || /^"?old_url"?\s*,/i.test(line)) return;
    const [oldUrl, newUrl] = parseRow(line).slice(0, 2);
    if (!normalizeUrl(oldUrl) || !normalizeUrl(newUrl)) throw new UsageError(`line ${i + 1}: both columns must be absolute URLs: ${line}`);
    rows.push({ oldUrl, newUrl });
  });

  const checks = [];
  for (const r of rows) {
    checks.push({ ...r, maxHops: 1 });
    if (r.oldUrl.startsWith('https://')) checks.push({ oldUrl: r.oldUrl.replace(/^https:/, 'http:'), newUrl: r.newUrl, maxHops: httpMax });
  }
  const results = await pool(checks, 6, async (c) => {
    const res = await fetchChain(c.oldUrl, { read: false });
    const first = res.chain[0];
    const landed = normalizeUrl(res.finalUrl);
    const expected = normalizeUrl(c.newUrl);
    const problems = [];
    if (res.error) problems.push(res.error);
    if (!first) problems.push(`no redirect (status ${res.status || res.error})`);
    else if (![301, 308].includes(first.status)) problems.push(`first hop is ${first.status} (use 301/308)`);
    if (res.chain.length > c.maxHops) problems.push(`${res.chain.length} hops (max ${c.maxHops})`);
    if (landed !== expected) problems.push(`landed on ${res.finalUrl}`);
    if (res.status !== 200) problems.push(`final status ${res.status || res.error}`);
    return { ...c, hops: res.chain.length, finalUrl: res.finalUrl, finalStatus: res.status, pass: problems.length === 0, problems };
  });
  const failed = results.filter((r) => !r.pass);
  const unreachable = results.length > 0 && results.every((r) => r.finalStatus === 0 && r.hops === 0);
  if (args.json) console.log(JSON.stringify({ file, total: results.length, failed: failed.length, results }, null, 2));
  else {
    for (const f of failed) console.log(`FAIL ${f.oldUrl}\n     expected ${f.newUrl}\n     ${f.problems.join('; ')}`);
    console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
  }
  if (unreachable) { if (!args.json) console.log('No URL answered at all (network/DNS?): could not complete.'); return 3; }
  return failed.length ? 1 : 0;
}, USAGE);
