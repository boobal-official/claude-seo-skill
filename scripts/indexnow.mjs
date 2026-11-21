#!/usr/bin/env node
// Usage:
//   node indexnow.mjs --host example.com --key <key> <url...>           (dry run: validates only)
//   node indexnow.mjs --host example.com --key <key> --file urls.txt --submit
// IndexNow notifies participating engines (Bing, Yandex, Naver, Seznam, Yep and others; current
// list: https://www.indexnow.org/searchengines.json) about changed URLs. Google does NOT use it.
// Requires the key file at https://<host>/<key>.txt containing the key.
// Submits only with --submit, which is an external action: get the user's approval first.
// Exit: 0 = ok (dry run or accepted), 1 = key file or submission failed, 64 = usage, 3 = internal.

import { readFileSync } from 'node:fs';
import { parseArgs, fetchChain, runMain, UsageError } from './lib.mjs';

const USAGE = 'node indexnow.mjs --host <host> --key <key> <url...> [--file urls.txt] [--submit] [--json]';
const args = parseArgs(process.argv.slice(2));
const out = (obj, text) => (args.json ? console.log(JSON.stringify(obj, null, 2)) : console.log(text));

runMain(async () => {
  const host = args.host === true ? '' : args.host;
  const key = (args.key === true ? '' : args.key) || process.env.INDEXNOW_KEY;
  const urls = [...args._];
  if (args.file) {
    try { urls.push(...readFileSync(String(args.file), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)); } catch (e) { throw new UsageError(`cannot read ${args.file}: ${e.code || e.message}`); }
  }
  if (!host || !key || !urls.length) throw new UsageError('need --host, --key and at least one URL');
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) throw new UsageError('key must be 8-128 chars of a-z, A-Z, 0-9 or "-"');
  const invalid = urls.filter((u) => { try { return !/^https?:$/.test(new URL(u).protocol); } catch { return true; } });
  if (invalid.length) throw new UsageError(`not absolute http(s) URLs: ${invalid.slice(0, 3).join(', ')}`);
  const foreign = urls.filter((u) => new URL(u).host.toLowerCase() !== String(host).toLowerCase());
  if (foreign.length) throw new UsageError(`URLs must all be on ${host}: ${foreign.slice(0, 3).join(', ')}`);

  const keyLocation = `https://${host}/${key}.txt`;
  const kf = await fetchChain(keyLocation);
  if (kf.status === 0 && !kf.chain.length) {
    const msg = `Could not reach ${keyLocation}: ${kf.error}`;
    out({ ok: false, notMeasured: true, issues: [{ sev: 'INFO', code: 'unreachable', msg }] }, msg);
    return 3;
  }
  if (kf.status !== 200 || kf.body.trim() !== key) {
    const msg = `Key file check failed: ${keyLocation} returned ${kf.status || kf.error}${kf.status === 200 ? ' with different content' : ''}. Create it (e.g. public/${key}.txt) and deploy first.`;
    out({ ok: false, issues: [{ sev: 'HIGH', code: 'indexnow-key-missing', msg }] }, msg);
    return 1;
  }
  if (!args.submit) {
    out({ ok: true, dryRun: true, urls: urls.length, issues: [] }, `Key file OK. ${urls.length} URL(s) ready.\nDry run. Re-run with --submit (after the user approves) to notify IndexNow engines.`);
    return 0;
  }
  const results = [];
  for (let i = 0; i < urls.length; i += 10000) {
    const batch = urls.slice(i, i + 10000);
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation, urlList: batch }),
    });
    results.push({ status: res.status, urls: batch.length, body: res.status >= 400 ? (await res.text()).slice(0, 300) : '' });
  }
  const failed = results.some((r) => r.status >= 400);
  out({ ok: !failed, results, issues: failed ? [{ sev: 'HIGH', code: 'indexnow-rejected', msg: JSON.stringify(results) }] : [] }, results.map((r) => `IndexNow: HTTP ${r.status} for ${r.urls} URLs ${r.body}`).join('\n'));
  return failed ? 1 : 0;
}, USAGE);
