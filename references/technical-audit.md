# Technical audit

Goal: find what stops crawling, indexing, or rendering of pages that matter, fix it in the
repo, and prove the fix. Numbers referenced here live in `thresholds.md`.

## Contents
1. Run the tools
2. Triage order (what to check, in what order, and why)
3. Fix recipes by finding
4. Programmatic / template pages
5. JavaScript rendering
6. Output

## 1. Run the tools

```bash
node <skill>/scripts/repo-audit.mjs .                         # if you have the repo
node <skill>/scripts/robots-check.mjs https://site.com /pricing /admissions
node <skill>/scripts/crawl-site.mjs https://site.com --max 500 --money "^/(pricing|admissions|courses|book)" --out seo/crawl-before.json
node <skill>/scripts/seo-check.mjs https://site.com/pricing --deep    # page + canonical/hreflang/og:image targets
node <skill>/scripts/seo-check.mjs https://site.com/pricing --bots    # separate run: what each crawler receives (ask first behind a WAF/CDN bot shield)
node <skill>/scripts/cwv.mjs https://site.com/ --strategy mobile
```

No live site yet? Run the production build locally (`next build && next start`, `npm run build && npm run preview`)
and point the scripts at `http://localhost:3000`. The crawler skips host/https checks on localhost.

Search Console data beats any crawler for "is it indexed": if the user can export the
Pages (indexing) report or run URL Inspection, use it. If you cannot verify indexing, say "not verified".

## 2. Triage order

Work top-down. A lower tier never ships while a higher tier on a money page is open, because
polishing a page that cannot be crawled earns nothing.

1. **Reachability**: homepage and money pages return 200 to Googlebot and Bingbot (`--bots`), no WAF 403/challenge.
2. **robots.txt**: no blanket Disallow for search engines; CSS/JS crawlable; Sitemap line present.
3. **Index directives**: no stray `noindex` (meta or `X-Robots-Tag`), especially env-leaked staging noindex.
4. **Status codes**: unknown URLs return 404/410 (soft-404 probe); no 5xx; redirects 1 hop, 301/308.
5. **Canonicals**: one per page, in `<head>`, absolute, self-referencing unless a true duplicate; target returns 200.
6. **Rendering**: main content, links, prices, and headings exist in the raw HTML (most AI crawlers do not run JS).
7. **Sitemaps**: list only 200, indexable, self-canonical URLs; real lastmod.
8. **Duplication**: host/protocol variants redirect to one origin; parameters canonicalized; near-duplicate templates.
9. **Architecture**: money-page click depth and contextual in-links within the heuristics in `thresholds.md` (see `internal-linking.md`).
9b. **Production origin**: canonicals, sitemap `<loc>`, OG URLs, and hreflang use the production https host, never localhost or a preview domain; `og:image` and favicon URLs return images, not HTML.
10. **Mobile + CWV**: viewport set; mobile content parity; field CWV (see `core-web-vitals.md`).
11. **Structured data**: valid, matches visible content (see `structured-data.md`).
12. **Hygiene (LOW)**: alt text, description length, OG tags. Batch these at the end.

## 3. Fix recipes

| Finding (script code) | Fix | Verify |
|---|---|---|
| `search-engine-blocked` | Default-allow robots; disallow only private paths that exist (`/api/`, `/admin/`). Block specific bots by name. | `robots-check.mjs`: no FATAL; any HIGH left is an owner-approved block |
| `render-assets-blocked` | Remove Disallow on `/_next/`, `/static/`, `*.css`, `*.js` | `robots-check.mjs` |
| `soft-404` / `dynamic-soft-404` | Next App Router: `notFound()` when the record is missing (all versions); `dynamicParams = false` for fixed sets (Next <= 15, or 16 without `cacheComponents`). Pages Router: `fallback: false` or `return { notFound: true }`. Express/other: real 404 status. | `curl -s -o /dev/null -w "%{http_code}" https://site.com/garbage-xyz` prints 404 |
| `noindex` / `metadata-noindex` | Remove, or guard: `robots: { index: process.env.VERCEL_ENV === 'production' }` (use the real production signal of the host) | `seo-check.mjs` shows `Robots: (none: indexable)` on production |
| `metadata-streamed` | Extend Next `htmlLimitedBots` with non-JS crawlers while keeping the default list (setting it replaces the default; see `stacks.md`) | `seo-check.mjs <url> --ua oai-searchbot` and `--ua bingbot` both show canonical/title in head |
| `html-over-2mb` | Move large inline JSON/scripts/styles to files; paginate very long pages | `seo-check.mjs` no `html-over-2mb` |
| `canonical-foreign-host`, `sitemap-foreign-host`, `og-image-broken`, `url-variant-duplicate` | Build with the production origin (`metadataBase`, site URL env); serve real image assets; 301 trailing-slash/case variants | `seo-check.mjs --deep`, `crawl-site.mjs` |
| `canonical-elsewhere`, `canonical-conflict`, `canonical-in-body` | One absolute self-canonical in `<head>` (Next: `alternates: { canonical: '/path' }` + `metadataBase`) | `seo-check.mjs --deep` |
| `redirect-chain`, `links-to-redirects` | Point the redirect at the final URL; update internal hrefs to the final URL | `verify-redirects.mjs` / `seo-check.mjs` |
| `http-not-redirected`, `host-duplicate` | Single 301 from http and the other host to `https://<canonical-host>` at the edge/host config | `curl -sI http://site.com/` shows one 301 |
| `sitemap-*` | Generate the sitemap from the same data as routes; exclude noindex, redirected, and non-canonical URLs | `crawl-site.mjs` no `sitemap-*` codes |
| `client-rendered`, `client-fetched-content` | Fetch in a Server Component / SSG; render text, not icons or canvas | `seo-check.mjs` word count and prices present |
| `broken-internal-links` | Fix hrefs; restore or 301 the target | `crawl-site.mjs` |
| `robots-noindex-unsupported` | Move to meta robots/X-Robots-Tag; keep URLs crawlable | `robots-check.mjs` |
| Search/filter URL bloat (`?q=`, `?sort=`) | `noindex, follow` first; Disallow only after they leave the index; canonical to the clean URL | GSC Pages report |

Ask before shipping any change that removes pages from the index or redirects pages that
have traffic or backlinks: those changes are slow to reverse.

## 4. Programmatic and template pages

Template pages (locations, integrations, "X for Y", directories) are where sites trip
Google's scaled-content-abuse policy. Sample 20 URLs per template; for each check (the percentages below are working heuristics, not Google numbers):

| Check | Fail | Fix |
|---|---|---|
| Unique value | Only the name differs (`near-duplicates` code) | Add data only this page has (counts, prices, local facts, reviews), or consolidate |
| Empty results | > 10% of pages show 0-1 items | `noindex, follow` below a minimum (e.g. < 3 items) and drop from sitemap |
| Slugs | Numeric IDs (`/near/18234`) | Slug from the entity name; 301 the old IDs |
| Search intent words | "Property near X" | "Flats for rent near X (42 listings)" |
| Boilerplate FAQ | Same answer on > 30% of pages | Inject entity facts or delete the block |
| Contradictory numbers | H1, FAQ, and llms.txt disagree on a count | One constant derived from the data (`items.length`), read everywhere |

## 5. JavaScript rendering

Google renders JavaScript, but later and with limits; Bing renders less reliably; AI crawlers
(OAI-SearchBot, PerplexityBot, ClaudeBot) should be assumed to read only the raw HTML (observed
behaviour, not vendor-documented; a safe working assumption). So:
- Main content, internal links (`<a href>`, not `onClick`), prices, and headings must be in the server HTML.
- Next.js: Client Components are still server-rendered; the problem is data fetched in `useEffect`/SWR after load.
- Lazy-loaded content must not require scrolling or clicking to enter the DOM; use `loading="lazy"` on images, not JS-injected text.
- Infinite scroll needs paginated, linkable URLs behind it.
- Check: `seo-check.mjs <url>` reports words, prices, and links as seen without JS.

## 6. Output

1. The fix commits/PR: each change with its verification output pasted.
2. `seo/reports/YYYY-MM-DD-audit.md`: the report (SKILL.md output contract), ordered by
   severity x page value. Unverified items are labelled "not verified".
