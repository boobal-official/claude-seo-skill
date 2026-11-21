# Internal linking and site architecture

Internal links do two jobs: they tell crawlers which pages matter and how topics relate, and
they move readers from pages that get traffic to pages that convert. Most sites get traffic
on informational pages while money pages (pricing, admissions, booking, product, location)
sit deep with only nav/footer links. Fixing that needs no new content and no new backlinks.

## 1. Measure (live site or local production build)
```bash
node <skill>/scripts/crawl-site.mjs https://site.com --money "^/(pricing|admissions|courses|book|locations)" --out seo/crawl-before.json
```
Per page you get: `depth` (clicks from home), `inlinks` (all), `contextualInlinks` (body only:
nav/header/footer/aside excluded), `inSitemap`. Issues: `orphan-pages`, `deep-pages`, `money-underlinked`.
Confirm the money-page list with the user; the regex is a starting guess.

## 2. Classify
```
money page
├── contextualInlinks below the minimum in thresholds.md -> UNDERLINKED (fix first)
├── depth above the maximum in thresholds.md             -> TOO DEEP (add hub/nav link)
└── otherwise OK
other pages
├── top 20 by GSC clicks (90 days) or by inlinks if no GSC -> SOURCE pages (heuristic cut-off)
└── rest: leave alone this run
orphans (in sitemap, 0 inlinks) -> link from the closest topical page, or retire if worthless
```

## 3. Add contextual links (edit files in place)
1. For each SOURCE page, pick 1-3 targets (heuristic) whose topic it already discusses. A post about root
   canal pain links the root canal price page; it does not link an unrelated orthodontics page.
2. Put at least one link in the first ~40% of the body, where more readers reach it (a usability heuristic).
3. Anchor text: descriptive words saying what the target is ("root canal price in Salem",
   "B.E. admission eligibility and fees"). Never "click here"/"read more". Vary anchors
   (limits in `thresholds.md`).
4. Edit minimally: wrap an existing phrase if it fits; otherwise add one useful sentence. Do not rewrite paragraphs.
5. Internal links stay followed (no `rel="nofollow"` on internal links).
6. Use real `<a href>` elements (Next.js `<Link>` renders one). Never `onClick` navigation.
7. Max one inline link per target per page.

Check current anchors before choosing new ones:
```bash
rg -o --no-filename '\[([^\]]+)\]\(/pricing[^)]*\)' content | sort | uniq -c | sort -rn
```

Optional conversion callout (once per long post, after the problem is explained, before the
fix steps): a small component linking the matching tool/booking/pricing page with a specific
CTA ("Check your root canal cost", not "Sign up"). Numbers in callouts come from `seo/kb/facts.md`.

## 4. Structure
- **Hubs**: `/courses`, `/locations`, `/treatments`, `/blog/<category>` index pages linking every child; create a hub once there are 2+ children.
- **Siblings**: each child links 2-3 related siblings (heuristic) and back to its hub.
- **Breadcrumbs**: visible breadcrumb matching the URL path + `BreadcrumbList` JSON-LD.
- **Depth**: every indexable page within the click-depth heuristic (`thresholds.md`); money pages ideally 1-2 clicks.
- **Pagination**: plain `<a href="?page=2">` links, each page self-canonical. No JS-only "load more" without paginated URLs.
- **Faceted navigation** (filters): index only facet combinations with real search demand;
  others `noindex, follow` or canonical to the base; prevent infinite crawl spaces (don't link every combination).

## 5. Verify and report
Re-run the crawl to `seo/crawl-after.json`. Done when `money-underlinked` and `orphan-pages`
are empty, or each remaining item is listed with the reason. Write `seo/reports/YYYY-MM-DD-internal-links.md`:

| Target | Contextual before | After | Distinct anchors | Source pages |
|---|---|---|---|---|

Also run the repo's build/link checker. Fix any broken link before handing off.
