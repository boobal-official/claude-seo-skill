#!/usr/bin/env node
// Usage: node repo-audit.mjs [repoDir] [--json]
// Detects the site stack and finds SEO problems in source BEFORE deploy: missing
// robots/sitemap/metadataBase, env-unsafe noindex, soft-404-prone dynamic routes,
// client-fetched main content, pages without their own metadata, SEO plugin conflicts.
// Static analysis is a prediction: severities are one tier below the live confirmation
// (references/thresholds.md), and every finding should be confirmed with seo-check/crawl-site.
// Exit: 2 = FATAL, 1 = HIGH, 0 = otherwise, 3 = could not complete, 64 = usage error.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname, resolve } from 'node:path';
import { parseArgs, printIssues, exitCodeFor, runMain, UsageError } from './lib.mjs';
import { parseRobots, isAllowed } from './robots.mjs';

const USAGE = 'node repo-audit.mjs [repoDir] [--json]';
const args = parseArgs(process.argv.slice(2));

runMain(async () => {
  const root = resolve(args._[0] || process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new UsageError(`not a directory: ${root}`);
  const issues = [];
  const add = (sev, code, msg, urls, fix) => issues.push({ sev, code, msg, urls, fix });
  const rel = (p) => relative(root, p).split(sep).join('/');
  const readRaw = (p) => { try { return readFileSync(p, 'utf8').replace(/^﻿/, ''); } catch { return ''; } };
  const codeCache = new Map();
  const read = (p) => { // source with JS/TS comments removed (strings preserved)
    if (!p) return '';
    if (!codeCache.has(p)) codeCache.set(p, stripJsComments(readRaw(p)));
    return codeCache.get(p);
  };
  const exists = (...p) => p.find((x) => existsSync(join(root, x)));

  const files = walk(root);
  let pkg = {};
  const pkgText = readRaw(join(root, 'package.json'));
  if (pkgText) {
    try { pkg = JSON.parse(pkgText); } catch (e) { add('INFO', 'package-json-invalid', `package.json could not be parsed (${e.message}); stack detection may be incomplete.`); }
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const stack = [];
  if (deps.next) stack.push(`next@${deps.next}`);
  if (deps.astro) stack.push('astro');
  if (deps.gatsby) stack.push('gatsby');
  if (deps.nuxt) stack.push('nuxt');
  if (deps['@sveltejs/kit']) stack.push('sveltekit');
  if (deps['@remix-run/react'] || deps['@react-router/dev']) stack.push('remix/react-router');
  if (!stack.length && deps.vite && (deps.react || deps.vue)) stack.push('vite-spa');
  if (!stack.length && deps['react-scripts']) stack.push('cra-spa');
  if (exists('wp-config.php', 'wp-content') || /Theme Name:/i.test(readRaw(join(root, 'style.css')))) stack.push('wordpress');
  if (exists('layout/theme.liquid')) stack.push('shopify-theme');
  if (exists('hugo.toml', 'hugo.yaml')) stack.push('hugo');
  if (exists('_config.yml') && exists('_layouts', '_posts')) stack.push('jekyll');
  if (exists('.eleventy.js', 'eleventy.config.js', 'eleventy.config.mjs')) stack.push('eleventy');
  const src = files.filter((f) => /\.(m?[jt]sx?|astro|vue|svelte|php|liquid)$/.test(f));

  const robotsFile = exists('public/robots.txt', 'static/robots.txt', 'robots.txt');
  if (robotsFile) {
    const parsed = parseRobots(readRaw(join(root, robotsFile)));
    for (const bot of ['Googlebot', 'Bingbot']) if (!isAllowed(parsed, bot, '/').allowed) add('FATAL', 'robots-blocks-search', `${robotsFile} blocks ${bot} from "/".`, [robotsFile]);
  }
  if (stack.some((s) => s.endsWith('-spa'))) add('HIGH', 'spa-client-rendered', 'Client-only SPA: every route ships an empty HTML shell. Google renders JS later; most AI crawlers never do.', [], 'Prerender public routes or move them to an SSR/SSG framework (Next.js, Astro).');

  if (deps.next) {
    const appDir = exists('app', 'src/app');
    const pagesDir = exists('pages', 'src/pages');
    const SKIP_ROUTE = /\/@[^/]+\/|\/\(\.{1,3}\)|\/\(\.\)\(\.\)/; // parallel (@slot) and intercepting ((.)x) routes
    if (appDir) {
      const appFiles = files.filter((f) => rel(f).startsWith(appDir + '/'));
      const routeDir = (f) => rel(f).replace(/\/[^/]+$/, '');
      const ungroup = (d) => d.replace(/\/\([^).][^)]*\)/g, '');
      const hasRobots = appFiles.some((f) => /\/robots\.(ts|js|txt)$/.test(rel(f))) || robotsFile;
      const hasSitemap = appFiles.some((f) => /\/sitemap\.(ts|js|xml)$/.test(rel(f))) || exists('public/sitemap.xml', 'next-sitemap.config.js', 'next-sitemap.config.mjs', 'next-sitemap.config.cjs');
      if (!hasRobots) add('MEDIUM', 'no-robots', 'No app/robots.ts or public/robots.txt.', [], 'Add app/robots.ts (references/crawler-policy.md).');
      if (!hasSitemap) add('MEDIUM', 'no-sitemap', 'No app/sitemap.ts, public/sitemap.xml or next-sitemap config.', [], 'Add app/sitemap.ts generated from your routes/data.');

      // Root layouts: app/layout.* and route-group roots app/(group)/layout.* (multiple root layouts).
      const layouts = appFiles.filter((f) => /\/layout\.(t|j)sx?$/.test(rel(f)));
      const rootLayouts = layouts.filter((f) => ungroup(routeDir(f)) === appDir);
      const layoutText = rootLayouts.map(read).join('\n');
      if (rootLayouts.length && !/metadataBase/.test(layoutText)) add('MEDIUM', 'no-metadataBase', 'Root layout has no metadataBase: relative canonical/OG URLs resolve against the deployment URL (often a preview domain).', rootLayouts.map(rel), "export const metadata = { metadataBase: new URL('https://www.example.com'), ... }");
      if (rootLayouts.length && !rootLayouts.some((f) => /<html[^>]*\slang=/.test(read(f)))) add('LOW', 'no-html-lang', 'Root layout <html> has no lang attribute.', rootLayouts.map(rel));

      for (const f of appFiles.filter((f) => /\/(layout|page)\.(t|j)sx?$/.test(rel(f)))) {
        const s = read(f);
        const nr = robotsNoindex(s);
        if (!nr) continue;
        // Guarded only when the robots value itself is conditional (an env var elsewhere in the file does not count).
        const guarded = nr === 'conditional' || /robots\s*:[^\n]*(\?|&&|\|\|)|(\?|&&|\|\|)[^\n]*robots\s*:|\bindex\s*:\s*[^,}\n]*(process\.env|isProd|===|!==)/.test(s);
        const isRoot = rootLayouts.includes(f);
        add(guarded ? 'INFO' : isRoot ? 'FATAL' : 'MEDIUM', 'metadata-noindex', `${rel(f)} sets noindex${guarded ? ' behind an environment check (verify production evaluates to index)' : ''}${isRoot ? ' in a ROOT layout (applies to every page under it)' : ''}.`, [rel(f)]);
      }

      // Dynamic routes (incl. [[...slug]] and pages nested under a dynamic segment).
      const pages = appFiles.filter((f) => /\/page\.(tsx?|jsx?|mdx?)$/.test(rel(f)) && !SKIP_ROUTE.test('/' + rel(f)));
      const dyn = pages.filter((f) => /\[[^\]]+\]/.test(rel(f)));
      const risky = [];
      for (const f of dyn) {
        const chain = [f, ...layouts.filter((l) => rel(f).startsWith(routeDir(l) + '/') && /\[/.test(routeDir(l)))];
        const sources = chain.flatMap((x) => [x, ...localImports(x)]);
        const all = sources.map(read).join('\n');
        if (!/\bnotFound\s*\(/.test(all) && !/dynamicParams\s*=\s*false/.test(all) && !/\bnotFound\b/.test(all.match(/import[^;]+/g)?.join(' ') || '')) risky.push(rel(f));
      }
      const nextConfig = ['next.config.ts', 'next.config.mjs', 'next.config.js'].map((f) => read(join(root, f))).join('\n');
      const cacheComponents = /cacheComponents\s*:\s*true/.test(nextConfig);
      if (risky.length) add('MEDIUM', 'dynamic-soft-404', `${risky.length} dynamic routes never call notFound() (directly or via a local helper) and do not set dynamicParams=false: unknown slugs may render 200 (soft 404s). Confirm live with crawl-site.mjs.`, risky, cacheComponents ? 'Call notFound() when the record is missing (cacheComponents is on, so route segment configs like dynamicParams are not available).' : 'Call notFound() when the record is missing; for fixed sets export generateStaticParams (+ dynamicParams = false).');

      const META_RE = /export\s+(?:const\s+(?:metadata|generateMetadata)\b|(?:async\s+)?function\s+generateMetadata\b)|export\s*\{[^}]*\b(?:metadata|generateMetadata)\b/;
      const noMeta = [];
      for (const f of pages) {
        const dir = routeDir(f);
        if (ungroup(dir) === appDir) continue; // home page uses root metadata
        const chain = layouts.filter((l) => dir === routeDir(l) || dir.startsWith(routeDir(l) + '/')).filter((l) => ungroup(routeDir(l)) !== appDir);
        if (!META_RE.test([f, ...chain].map(read).join('\n'))) noMeta.push(rel(f));
      }
      if (noMeta.length) add('MEDIUM', 'page-no-metadata', `${noMeta.length} routes export no metadata/generateMetadata (they inherit the root title, creating duplicate titles).`, noMeta);

      const clientFetch = pages.filter((f) => {
        const s = read(f);
        return /^\s*['"]use client['"]/.test(s) && /(useEffect\s*\([\s\S]{0,600}?fetch\s*\(|useSWR\s*\(|useQuery\s*\()/.test(s);
      }).map(rel);
      if (clientFetch.length) add('HIGH', 'client-fetched-content', `${clientFetch.length} pages fetch their main data client-side ("use client" + useEffect/SWR/React Query). Raw HTML ships without the content.`, clientFetch, 'Fetch in a Server Component (async page) and pass data down; keep only interactivity client-side.');
    }
    if (pagesDir) {
      const pFiles = files.filter((f) => rel(f).startsWith(pagesDir + '/') && /\[[^\]]+\]\.(t|j)sx?$/.test(rel(f)));
      const risky = pFiles.filter((f) => /fallback\s*:\s*(true|['"]blocking['"])/.test(read(f)) && !/notFound\s*:\s*true/.test(read(f))).map(rel);
      if (risky.length) add('MEDIUM', 'pages-fallback-soft-404', 'Pages Router dynamic routes use fallback true/blocking without returning { notFound: true } for missing records.', risky);
    }
    const imgTags = src.filter((f) => /\.(t|j)sx$/.test(f) && /<img\s/.test(read(f))).map(rel);
    if (imgTags.length) add('LOW', 'raw-img', `${imgTags.length} components use <img> instead of next/image (no automatic sizing/lazy-loading/formats; CLS and LCP risk).`, imgTags.slice(0, 20));
    const gfonts = src.filter((f) => /fonts\.googleapis\.com/.test(read(f))).map(rel);
    if (gfonts.length) add('LOW', 'external-fonts', 'Google Fonts loaded via <link>; next/font self-hosts and removes the render-blocking request.', gfonts);
    if (!src.some((f) => /application\/ld\+json/.test(read(f)))) add('INFO', 'no-jsonld', 'No JSON-LD found in source (Organization/WebSite on the homepage is a cheap baseline).');
  }

  if (stack.includes('wordpress')) {
    const pluginsDir = join(root, 'wp-content', 'plugins');
    const plugins = existsSync(pluginsDir) ? readdirSync(pluginsDir) : [];
    const seoPlugins = plugins.filter((p) => ['wordpress-seo', 'seo-by-rank-math', 'all-in-one-seo-pack', 'autodescription', 'wp-seopress'].includes(p));
    if (seoPlugins.length > 1) add('HIGH', 'wp-multiple-seo-plugins', `Multiple SEO plugins installed (${seoPlugins.join(', ')}): duplicate titles, canonicals and sitemaps.`, seoPlugins, 'Keep one.');
    if (!seoPlugins.length) add('MEDIUM', 'wp-no-seo-plugin', 'No SEO plugin found (titles/meta/sitemaps/schema rely on the theme).');
    add('INFO', 'wp-check-visibility', 'Check Settings > Reading > "Discourage search engines" is OFF on production (stored in the DB, not visible in files).');
  }

  if (args.json) console.log(JSON.stringify({ root, stack, files: files.length, issues }, null, 2));
  else {
    console.log(`Repo: ${root}\nStack: ${stack.join(', ') || 'unknown'}  (${files.length} files scanned)\n`);
    printIssues(issues);
  }
  return exitCodeFor(issues);

  // Resolves local imports (relative, "@/", "~/") one level deep so helpers that call notFound() count.
  function localImports(file) {
    const out = [];
    for (const m of read(file).matchAll(/from\s+['"]((?:\.{1,2}|@|~)\/[^'"]+)['"]/g)) {
      const spec = m[1];
      const bases = spec.startsWith('.') ? [join(dirname(file), spec)] : [join(root, spec.slice(2)), join(root, 'src', spec.slice(2))];
      for (const b of bases) {
        const hit = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'].map((e) => b + e).find((p) => existsSync(p) && statSync(p).isFile());
        if (hit) { out.push(hit); break; }
      }
    }
    return out;
  }
}, USAGE);

function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (['node_modules', '.git', '.next', 'dist', 'build', 'out', '.vercel', 'coverage', '.turbo'].includes(n)) continue;
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out, depth + 1);
    else out.push(p);
  }
  return out;
}

// Removes // and /* */ comments while leaving string/template literal contents intact.
// Regex literals are preserved too, so "/\/*$/" inside a regex is not read as a comment start.
export function stripJsComments(s) {
  const re = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`|(?<=(?:^|[(,=:[!&|?{};]|=>|\b(?:return|typeof|case|in|of|void|delete|yield|await))\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[dgimsuyv]*)|\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/[^\n]*/gm;
  return s.replace(re, (m, keep, pre) => (keep ? keep : pre !== undefined ? pre : ' '));
}

// True when a Next.js metadata `robots` setting disables indexing (for all bots or for googleBot).
// String values are split into directive tokens, so "max-image-preview:none" is not read as "none".
function tokensNoindex(str) {
  return str.toLowerCase().split(',').map((t) => t.trim()).some((t) => t === 'noindex' || t === 'none');
}
// Returns true (noindex), 'conditional' (noindex in one branch of a ternary/variable), or false.
function robotsNoindex(s) {
  let result = false;
  // Shorthand property `{ robots }` referring to a same-file constant.
  if (/[{,]\s*robots\s*[,}]/.test(s)) {
    const def = /(?:const|let|var)\s+robots\b[^=]*=\s*/.exec(s);
    if (def) {
      const r = robotsValueNoindex(s, def.index + def[0].length);
      if (r === true) return true;
      if (r) result = r;
    }
  }
  for (const m of s.matchAll(/(?<![\w$-])['"]?robots['"]?\s*:\s*/g)) {
    const r = robotsValueNoindex(s, m.index + m[0].length);
    if (r === true) return true;
    if (r === 'conditional') result = 'conditional';
  }
  return result;
}
function robotsValueNoindex(s, at) {
  const rest = s.slice(at);
  const str = /^(['"`])([^'"`]*)\1/.exec(rest);
  if (str) return tokensNoindex(str[2]);
  if (rest[0] !== '{') {
    // A constant defined in the same file: evaluate its value instead.
    const ident = /^([A-Za-z_$][\w$]*)\s*[,}\n]/.exec(rest)?.[1];
    if (ident && !/^(true|false|null|undefined)$/.test(ident)) {
      const def = new RegExp(`(?:const|let|var)\\s+${ident}\\b[^=]*=\\s*`).exec(s);
      if (def) return robotsValueNoindex(s, def.index + def[0].length) === true ? true : robotsValueNoindex(s, def.index + def[0].length);
    }
    // A ternary or other expression: look at it up to the end of the property.
    const expr = rest.slice(0, 400).split(/\n\s*[}\w'"]+\s*:/)[0];
    return /\bindex\s*:\s*false\b|['"`][^'"`]*\b(noindex|none)\b/.test(expr) ? 'conditional' : false;
  }
  const obj = balanced(s, at);
  const gbStr = /googleBot\s*:\s*(['"`])([^'"`]*)\1/.exec(obj);
  if (gbStr && tokensNoindex(gbStr[2])) return true;
  const gb = /googleBot\s*:\s*\{/.exec(obj);
  let top = obj, gbObj = '';
  if (gb) {
    gbObj = balanced(obj, obj.indexOf('{', gb.index));
    top = obj.replace(gbObj, '{}');
  }
  const off = /(?<![\w-])['"]?index['"]?\s*:\s*false\b/;
  return off.test(top) || off.test(gbObj);
}
function balanced(s, start) {
  let d = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') d++;
    else if (s[i] === '}' && --d === 0) return s.slice(start, i + 1);
  }
  return s.slice(start);
}
