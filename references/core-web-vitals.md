# Core Web Vitals

Thresholds: `thresholds.md`. Field data (CrUX p75) is what counts; lab data explains why.

## Measure
```bash
node <skill>/scripts/cwv.mjs https://site.com/ --strategy mobile
node <skill>/scripts/cwv.mjs https://site.com/pricing --strategy desktop
```
- Exit 3 = not measured (quota/network). Report "not measured" and offer the remediation the
  script prints (free PSI key, `--local` Lighthouse with the user's OK, or pagespeed.web.dev).
- No field data = low traffic; lab numbers are a proxy, and TBT stands in for INP.
- Search Console > Core Web Vitals groups URLs by template: fix the template, not the URL.
- Test the slowest real template (product/listing/blog), not just the homepage.

## Diagnose by metric

### LCP (load)
Find the LCP element (`cwv.mjs` prints it), then the slow phase:
1. **TTFB** slow: cache HTML at the edge (SSG/ISR), avoid `force-dynamic` on marketing pages, move DB calls off the critical path, use a region near users.
2. **Resource load delay** (image discovered late): LCP image in the HTML as `<img>`, not CSS background or JS-inserted; `fetchpriority="high"`; never `loading="lazy"` on the LCP image.
3. **Resource load time**: AVIF/WebP, correct `sizes`/`srcset`, CDN.
4. **Render delay**: render-blocking CSS/JS, web fonts hiding text (use `font-display: swap` or optional), client-side rendering of the hero.

### INP (responsiveness)
Long tasks block the main thread after a click/tap/keypress.
- Break up long tasks (`await scheduler.yield()` where supported, or `setTimeout` chunking).
- Cut hydration cost: fewer/lighter client components, lazy-load below-the-fold widgets, remove unused third-party scripts (chat widgets, tag managers, A/B tools are the usual culprits).
- Give instant visual feedback, then do the work; debounce input handlers.
- Avoid layout thrashing (reading layout then writing styles in loops).

### CLS (visual stability)
- Width/height (or `aspect-ratio`) on every image, video, iframe, and ad slot.
- Reserve space for banners, cookie bars, embeds; do not insert content above existing content.
- Fonts: `size-adjust`/fallback metrics (next/font does this) to stop text reflow.
- Animate `transform`/`opacity`, not `top`/`height`.

## Stack recipes

**Next.js (App Router)**
- `next/image` on the LCP image: `priority` through Next 15; on Next 16 use `loading="eager"` + `fetchPriority="high"` (check `node_modules/next/package.json` and the matching docs), plus explicit `sizes`.
- `next/font` for self-hosted fonts (removes the Google Fonts request and adds fallback metrics).
- `next/script` with `strategy="lazyOnload"` for third parties; `afterInteractive` only when needed.
- Static/ISR for marketing pages (`export const revalidate = 3600`, or `'use cache'` + `cacheLife` with Next 16 `cacheComponents`); keep fully dynamic rendering for truly per-user pages.
- `dynamic(() => import(...))` for heavy below-the-fold client components.

**WordPress**
- Page cache (host-level or plugin) + CDN; object cache for dynamic sites.
- Remove unused plugins; heavy page builders are the usual INP/LCP cost.
- Serve WebP/AVIF; exclude the hero image from lazy loading; preload it.
- Delay non-critical third-party JS.

**Shopify**
- Audit installed apps (each injects scripts); remove unused ones and their leftover theme snippets.
- Use theme image filters (`image_url` with width) and `loading="eager"` + `fetchpriority="high"` on the hero only.

**Static/other**: compress, cache-control long on hashed assets, HTTP/2+, inline critical CSS.

## Verify
Re-run `cwv.mjs` (lab) after deploy and quote before/after. Field data is a rolling window
(`thresholds.md`), so say "lab improved from X to Y; field data will reflect it over the coming weeks" instead of claiming a field win.
