#!/usr/bin/env node
// Usage: node cwv.mjs <url> [--strategy mobile|desktop] [--json] [--local] [--from-json report.json]
// Core Web Vitals via the free PageSpeed Insights API: CrUX field data when the page/origin
// has enough traffic, plus a Lighthouse lab run. Thresholds: references/thresholds.md.
// Optional: PSI_API_KEY (free key from Google Cloud) avoids shared-quota 429s.
// --local runs Lighthouse on this machine instead (lab only; downloads lighthouse via npx and
//         needs Chrome; ask the user first). --from-json parses a saved PSI/Lighthouse JSON.
// Exit: 2 = a field metric is poor, 1 = needs improvement, 0 = good or no field data,
//       3 = not measured (quota/network/bad input), 64 = usage error. Never guess on exit 3.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, printIssues, runMain, urlArg } from './lib.mjs';
import { T } from './thresholds.mjs';

const USAGE = 'node cwv.mjs <url> [--strategy mobile|desktop] [--json] [--local] [--from-json file]';
const args = parseArgs(process.argv.slice(2));

class NotMeasured extends Error {}

runMain(async () => {
  const url = args['from-json'] && !args._[0] ? 'https://from-json.invalid/' : urlArg(args._[0]);
  const strategy = args.strategy === 'desktop' ? 'desktop' : 'mobile';
  let data;
  try {
    data = await load(url, strategy);
  } catch (e) {
    if (!(e instanceof NotMeasured)) throw e;
    if (args.json) console.log(JSON.stringify({ url, strategy, notMeasured: true, error: e.message, issues: [{ sev: 'INFO', code: 'not-measured', msg: e.message }] }));
    else console.error(e.message);
    return 3;
  }

  const C = T.cwv;
  const rate = (k, v) => (v == null ? 'n/a' : v <= C[k].good ? 'good' : v <= C[k].poor ? 'needs-improvement' : 'poor');
  const field = (exp) => {
    const m = exp?.metrics;
    if (!m) return null;
    const get = (key, div = 1) => (m[key]?.percentile != null ? m[key].percentile / div : null);
    const f = { LCP: get('LARGEST_CONTENTFUL_PAINT_MS'), INP: get('INTERACTION_TO_NEXT_PAINT'), CLS: get('CUMULATIVE_LAYOUT_SHIFT_SCORE', 100), FCP: get('FIRST_CONTENTFUL_PAINT_MS'), TTFB: get('EXPERIMENTAL_TIME_TO_FIRST_BYTE') };
    return Object.values(f).some((v) => v != null) ? f : null;
  };
  // PSI sets origin_fallback when the URL has too little traffic and the data is really origin-level.
  const pageField = data.loadingExperience?.origin_fallback ? null : field(data.loadingExperience);
  const originField = field(data.originLoadingExperience) || (data.loadingExperience?.origin_fallback ? field(data.loadingExperience) : null);
  const fieldData = pageField || originField;
  const fieldScope = pageField ? 'this URL' : originField ? 'whole origin (URL has too little traffic)' : null;

  const lh = data.lighthouseResult || {};
  const audits = lh.audits || {};
  const num = (id) => audits[id]?.numericValue ?? null;
  const lab = { LCP: num('largest-contentful-paint'), CLS: num('cumulative-layout-shift'), TBT: num('total-blocking-time'), FCP: num('first-contentful-paint'), TTFB: num('server-response-time'), score: lh.categories?.performance?.score != null ? Math.round(lh.categories.performance.score * 100) : null };
  const diag = Object.values(audits)
    .filter((a) => a && a.score !== null && a.score < 0.9 && (a.details?.type === 'opportunity' || /insight$/.test(a.id || '') || a.details?.overallSavingsMs > 0))
    .map((a) => ({ id: a.id, title: a.title, savingsMs: Math.round(a.details?.overallSavingsMs || a.metricSavings?.LCP || 0), display: a.displayValue || '' }))
    .sort((a, b) => b.savingsMs - a.savingsMs)
    .slice(0, 10);
  const lcpAudit = audits['largest-contentful-paint-element']?.details?.items?.[0];
  const lcpEl = lcpAudit?.items?.[0]?.node?.snippet || lcpAudit?.node?.snippet || null;

  const issues = [];
  if (fieldData) {
    for (const k of ['LCP', 'INP', 'CLS']) {
      const r = rate(k, fieldData[k]);
      if (r === 'poor') issues.push({ sev: 'HIGH', code: `cwv-${k.toLowerCase()}-poor`, msg: `${k} p75 = ${fmt(k, fieldData[k])} (poor) for ${fieldScope}.` });
      else if (r === 'needs-improvement') issues.push({ sev: 'MEDIUM', code: `cwv-${k.toLowerCase()}-ni`, msg: `${k} p75 = ${fmt(k, fieldData[k])} (needs improvement) for ${fieldScope}.` });
    }
  } else {
    issues.push({ sev: 'INFO', code: 'no-field-data', msg: 'No CrUX field data (not enough real-user traffic). Lab values are a proxy; TBT stands in for INP. Rankings use field data only.' });
    if (lab.LCP > C.LCP.poor) issues.push({ sev: 'MEDIUM', code: 'lab-lcp-poor', msg: `Lab LCP ${fmt('LCP', lab.LCP)} on a simulated ${strategy} device.` });
    if (lab.CLS > C.CLS.poor) issues.push({ sev: 'MEDIUM', code: 'lab-cls-poor', msg: `Lab CLS ${lab.CLS.toFixed(2)}.` });
    if (lab.TBT > C.labTbtInpRisk) issues.push({ sev: 'MEDIUM', code: 'lab-tbt-high', msg: `Lab Total Blocking Time ${Math.round(lab.TBT)} ms (INP risk: too much main-thread JS).` });
  }

  if (args.json) console.log(JSON.stringify({ url, strategy, fieldScope, field: fieldData, lab, lcpElement: lcpEl, diagnostics: diag, issues }, null, 2));
  else {
    console.log(`Core Web Vitals: ${url} (${strategy})\n`);
    if (fieldData) {
      console.log(`Field data (CrUX p75, ${fieldScope}):`);
      for (const k of ['LCP', 'INP', 'CLS', 'FCP', 'TTFB']) if (fieldData[k] != null) console.log(`  ${k.padEnd(5)} ${fmt(k, fieldData[k]).padEnd(10)} ${rate(k, fieldData[k])}`);
    }
    console.log(`\nLab (Lighthouse, performance score ${lab.score ?? 'n/a'}):`);
    console.log(`  LCP ${fmt('LCP', lab.LCP)}  CLS ${lab.CLS?.toFixed(3) ?? 'n/a'}  TBT ${lab.TBT != null ? Math.round(lab.TBT) + ' ms' : 'n/a'}  TTFB ${lab.TTFB != null ? Math.round(lab.TTFB) + ' ms' : 'n/a'}`);
    if (lcpEl) console.log(`  LCP element: ${lcpEl.slice(0, 160)}`);
    if (diag.length) {
      console.log('\nTop diagnostics:');
      for (const d of diag) console.log(`  - ${d.title}${d.savingsMs ? ` (~${d.savingsMs} ms)` : ''}${d.display ? ` [${d.display}]` : ''}`);
    }
    console.log('');
    printIssues(issues);
  }
  const worst = fieldData ? ['LCP', 'INP', 'CLS'].map((k) => rate(k, fieldData[k])) : [];
  return worst.includes('poor') ? 2 : worst.includes('needs-improvement') ? 1 : 0;
}, USAGE);

async function load(url, strategy) {
  if (args['from-json']) {
    let j;
    try { j = JSON.parse(readFileSync(String(args['from-json']), 'utf8')); } catch (e) { throw new NotMeasured(`--from-json: cannot read/parse ${args['from-json']}: ${e.message}`); }
    return j.lighthouseResult || j.loadingExperience ? j : { lighthouseResult: j };
  }
  if (args.local) {
    // No shell: the URL is passed as one literal argument (safe with &, |, quotes on Windows).
    const flags = ['-y', 'lighthouse@12', url, '--output=json', '--output-path=stdout', '--quiet', '--only-categories=performance', '--chrome-flags=--headless=new'];
    if (strategy === 'desktop') flags.push('--preset=desktop');
    let cmd = 'npx', cmdArgs = flags;
    if (process.platform === 'win32') {
      const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
      if (!existsSync(cli)) throw new NotMeasured("Local Lighthouse: npm's npx-cli.js was not found next to node.exe. Run Lighthouse manually: npx lighthouse <url> --only-categories=performance");
      cmd = process.execPath;
      cmdArgs = [cli, ...flags];
    }
    const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 200e6, shell: false });
    if (r.status !== 0) throw new NotMeasured(`Local Lighthouse failed: ${(r.stderr || r.error?.message || '').slice(0, 400)}`);
    try { return { lighthouseResult: JSON.parse(r.stdout) }; } catch { throw new NotMeasured('Local Lighthouse returned non-JSON output.'); }
  }
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', url);
  api.searchParams.set('strategy', strategy);
  api.searchParams.append('category', 'performance');
  if (process.env.PSI_API_KEY) api.searchParams.set('key', process.env.PSI_API_KEY);
  for (let attempt = 0; attempt < 3; attempt++) {
    let res, body = '';
    try {
      res = await fetch(api, { signal: AbortSignal.timeout(120000) });
      if (res.ok) return await res.json();
      body = await res.text();
    } catch (e) {
      throw new NotMeasured(`PageSpeed Insights request failed: ${e.message}`);
    }
    if (res.status === 429 && attempt < 2 && process.env.PSI_API_KEY) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
    if (res.status === 429)
      throw new NotMeasured(
        'QUOTA: the PageSpeed Insights shared keyless quota is exhausted. Options:\n' +
          '  1. Free key: Google Cloud console > enable "PageSpeed Insights API" > create API key, then set PSI_API_KEY.\n' +
          '  2. Lab-only run on this machine (needs Chrome, user approval): node cwv.mjs <url> --local\n' +
          '  3. Field data by hand: https://pagespeed.web.dev/ or Search Console > Core Web Vitals report.'
      );
    throw new NotMeasured(`PageSpeed Insights API error ${res.status}: ${body.slice(0, 200)}${/localhost|127\.0\.0\.1/.test(url) ? ' (PSI cannot reach local URLs; use --local)' : ''}`);
  }
  throw new NotMeasured('PageSpeed Insights: retries exhausted.');
}

function fmt(k, v) {
  if (v == null) return 'n/a';
  if (k === 'CLS') return v.toFixed(2);
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}
