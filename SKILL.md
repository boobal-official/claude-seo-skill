---
name: seo
description: "Website SEO done as shipped, verified fixes: technical audits, indexing problems, Core Web Vitals, titles/meta, content refreshes, JSON-LD schema, local SEO (Google Business Profile, clinics, colleges, multi-location), internal linking, hreflang, migrations and redirects, robots.txt and AI-crawler policy, AI search visibility (ChatGPT, Perplexity, Google AI Overviews / GEO), compliant link earning, traffic-drop diagnosis and Search Console reporting. Bundles zero-dependency, tested scripts (crawler, page checker, robots tester, schema validator, CWV, redirect verifier) that run on free data. Use whenever the user mentions SEO, rankings, Google or Bing traffic, pages not indexed, Search Console, sitemaps, robots.txt, canonicals, schema, page speed for search, getting cited by AI assistants, or launching, migrating or redesigning a public site, even without saying 'SEO'. Not for paid ads, app-store optimization, YouTube growth, or in-app search engines."
---

# SEO

Make a website earn more search traffic that converts, from Google, Bing, and AI assistants:
find what blocks it, fix it in the code or content, and prove each fix worked with before/after
evidence. A report with no shipped change is not the deliverable; neither is a change with no proof.

## Principles (and why)
- **Fix the blocker before the polish.** A perfect title on a page Bing cannot crawl earns
  nothing. Work in severity order on the pages that make money first.
- **Evidence over memory.** Search engines change often (several 2025-2026 changes are recorded in
  `references/thresholds.md`). Measure the live site, read the repo, and re-check time-sensitive
  facts at the official URLs listed there. If you cannot verify something, say "not verified".
- **Never invent facts.** No made-up statistics, prices, reviews, credentials, or quotes. Missing
  facts become `[NEEDS FACT: ...]` items for the owner.
- **Free data first.** Everything works with the live site, the repo, Search Console/Bing exports,
  PageSpeed Insights, and web search. Paid SEO tools are optional if the user already has them; never recommend buying one.
- **Stay inside search engine spam policies.** No link buying, cloaking, doorway pages, fake
  reviews, or scaled thin pages: they get sites penalised or ignored, and recovery is slow.
- **Ask before irreversible, policy, or external actions** (list in Step 4).

## Step 1: Intake (short; infer what you can)
1. **Site URL** (or a local production build) and **goal**: audit, a specific problem, a page to rank, launch/migration, local, AI visibility, traffic drop.
2. **Money pages and conversion**: pricing, admissions, booking, product, contact. These get priority.
3. **Repo and stack**: `node <skill-dir>/scripts/repo-audit.mjs <repo>`.
4. **Data available**: GSC/Bing exports or access, analytics, a PSI API key, any paid SEO tool.
If something is missing, proceed with what exists and note the gap once; do not block.

`<skill-dir>` is this skill's base directory (shown when the skill loads). Scripts need only
Node >= 18 and run from anywhere. Flags may come in any order; `--json` gives machine-readable
output (always valid JSON, even on errors).

## Step 2: Route the task

| Task | Read | Run |
|---|---|---|
| Full audit / "why don't we rank" | `references/technical-audit.md` | `repo-audit`, `robots-check`, `crawl-site`, `seo-check --deep`, `seo-check --bots` (separate run; ask first behind a WAF/CDN bot shield), `cwv` |
| Traffic dropped | `measurement.md` (drop diagnosis) then `technical-audit.md` | `crawl-site`, `robots-check` |
| Pages not indexed / GSC errors | `technical-audit.md`, `measurement.md` | `crawl-site`, `seo-check --deep` |
| Page speed, Core Web Vitals | `core-web-vitals.md` | `cwv` |
| Titles, meta, headings, intent, refresh a post | `on-page.md` | `seo-check`, `crawl-site` |
| Content quality, E-E-A-T, AI writing cleanup, AI search / GEO | `content-and-ai-search.md` | `slop-check`, `seo-check --bots` (ask first behind a WAF/CDN bot shield) |
| Schema / rich results | `structured-data.md` | `seo-check` |
| Local, Google Business Profile, multi-location, clinics, colleges | `local-seo.md` + `structured-data.md` | `seo-check`, `crawl-site --money "^/locations/"` |
| Internal links, orphans, site structure | `internal-linking.md` | `crawl-site --money ...` |
| Multilingual / hreflang | `international.md` | `seo-check --deep` |
| Domain move, rebrand, URL changes, replatform | `migrations.md` | `verify-redirects`, `crawl-site`, `robots-check` |
| robots.txt, AI bots, blocking scrapers | `crawler-policy.md` | `robots-check`, `seo-check --bots` (ask first behind a WAF/CDN bot shield) |
| Backlinks, PR, outreach, directories | `off-page.md` | - |
| Keyword research, competitors, content plan | `research.md` | - |
| Search Console, logs, reporting, IndexNow, Discover | `measurement.md` | `indexnow` (dry run first) |
| Next.js / WordPress / Shopify / static / SPA specifics | `stacks.md` | `repo-audit` |

Every threshold, limit, and time-sensitive policy fact lives in `references/thresholds.md` (the
scripts read the same values from `scripts/thresholds.mjs`; the test suite fails if they drift).
Workflow rules of thumb stay in the guide that uses them and are labelled as heuristics.

## Step 3: Prioritise
Severity scale (defined in `thresholds.md`): FATAL, HIGH, MEDIUM, LOW, INFO. Order work by severity x page value:
```
FATAL on any page that matters      -> fix now
HIGH on money / high-traffic pages  -> fix now
HIGH elsewhere, MEDIUM on money     -> this change if under ~1 hour, else top of the roadmap
MEDIUM elsewhere                    -> roadmap with owner
LOW                                 -> one batched line at the bottom; skip while FATAL/HIGH remain
```
Script output is evidence, not a verdict. Confirm intent before "fixing": a `noindex` on a login
page, a canonical on a true duplicate, or an owner-approved AI-bot block is correct.

## Step 4: Change and verify
**Before** changing anything, run the check that found the issue and save its `--json` output
under `seo/evidence/YYYY-MM-DD/` (the "before"). Make the change the way the repo already works (its routing, metadata helpers, CMS).
Then re-run the same check (the "after"). Pass conditions:

| Change | Proof (after) |
|---|---|
| robots.txt | `robots-check.mjs <origin>`: no FATAL; any remaining HIGH is a block the owner approved |
| noindex / canonical / title / meta / schema | `seo-check.mjs <url> --deep` shows the new values and no issue code for it |
| soft 404 | `crawl-site.mjs` no `soft-404`; `curl -s -o /dev/null -w "%{http_code}" <origin>/zzz-test` prints 404 |
| redirects / http->https / host | `verify-redirects.mjs map.csv` "0 failed"; `crawl-site.mjs` no `http-not-redirected` / `host-duplicate` / `url-variant-duplicate` |
| sitemap | `crawl-site.mjs` no `sitemap-*` codes |
| hreflang | `seo-check.mjs <url> --deep` no `hreflang-*` codes on every language version |
| bot access (WAF/UA rules) | `seo-check.mjs <url> --bots` status 200 for search + AI-search bots |
| internal links | `crawl-site.mjs --money ...`: no `money-underlinked`/`orphan-pages`, or each remaining one explained |
| rendering / content | `seo-check.mjs`: no `client-rendered`; the page's key facts (price, H1, main text) appear in the raw-HTML output |
| structured data | `seo-check.mjs`: no `jsonld-parse-error`/`schema-missing-required`; the owner confirms in the Rich Results Test (no public API) |
| CWV | `cwv.mjs` lab before vs after (field data lags; say so) |
| copy cleanup | `slop-check.mjs` 0 hits, or each remaining hit justified |
| NAP / local | `seo/local/nap-audit.md` shows every source matching; `seo-check.mjs` shows the same name/address/phone in JSON-LD and page text |
| IndexNow | `indexnow.mjs ... --submit --json` returns `"ok": true` (after approval) |
| AI-features opt-out | owner confirms Settings > Search generative AI shows Exclude on the right property; the Generative AI performance report trends to zero over the following days |
Also run the repo's lint/typecheck/build. Not deployed yet: verify against the local production
build and say that production still needs checking after deploy.

**Ask the user first** before: noindexing, deleting, or redirecting pages that have traffic or
backlinks; any robots.txt/WAF change that blocks a search engine, an AI search bot, or AI training
bots (a policy decision); opting out of Google's AI features; dropping a locale; changing URLs at
scale; submitting anything externally (IndexNow, sitemaps via APIs, directories, disavow files,
Search Console Change of Address, Bing Site Move); running `seo-check --bots` against a production
site behind a WAF/CDN bot shield (spoofed crawler user agents from the user's IP can get that IP
rate-limited or banned). **Never**: send emails or messages, post to
social or forums, create accounts, buy anything, or write reviews. Draft them for the owner.

## Step 5: Report (always this shape)
```markdown
## SEO: <site> (<date>)
Verdict: <one plain sentence: the biggest thing holding the site back>

### Shipped (verified)
| Change | File/URL | Before | After (proof command -> result) |

### Roadmap
| # | Severity | Page(s) | Issue | Why it costs traffic/revenue | Fix | How the owner can verify (no skill needed) | Status |

Every finding gets an owner-runnable check: a `curl` line, a Search Console/Bing report, or a
browser view-source step, in addition to any script command.

### Needs from you
- <max 3: access, facts marked NEEDS FACT, approvals>

### Not verified
- <anything you could not measure, and what would verify it>
```
Save it as `seo/reports/YYYY-MM-DD-<type>.md` in the repo when there is one. For ongoing work keep
state in `seo/` (`measurement.md` lists the files) so the next run starts where this one stopped.

## Script reference
| Script | Purpose |
|---|---|
| `scripts/repo-audit.mjs [dir]` | stack detection + source-level issues (env noindex, soft-404-prone routes, client-fetched content, missing metadata/sitemap/robots, SEO plugin conflicts) |
| `scripts/robots-check.mjs <origin> [paths]` / `--file robots.txt [paths]` | RFC 9309 / Google-parser matching for search, AI-search, user-triggered and training bots (list in `scripts/robots.mjs`); render-asset blocks; sitemap lines; `--offline` skips sitemap fetches |
| `scripts/crawl-site.mjs <origin> [--max N] [--max-sitemap N] [--concurrency N] [--sitemap URL] [--money REGEX] [--out f]` | link crawl + sitemaps: soft 404, broken links, chains, sitemap hygiene, duplicates, near-duplicates, depth, orphans, contextual in-links, URL variants, OG/favicon, production-host leaks, page issues rolled up |
| `scripts/seo-check.mjs <url> [--deep] [--ua preset]` | one page as raw HTML: status, chain, robots directives, canonical, title/meta/H1, hreflang, JSON-LD validation, rendering, Googlebot HTML size limit (`thresholds.md`); `--deep` also fetches canonical/hreflang/og:image targets |
| `scripts/seo-check.mjs <url> --bots` | separate mode: what a browser, Googlebot, Bingbot and AI bots each receive |
| `scripts/cwv.mjs <url> [--strategy mobile\|desktop] [--local] [--from-json f]` | CWV field + lab via PageSpeed Insights; `--local` = Lighthouse on this machine (ask first) |
| `scripts/verify-redirects.mjs map.csv [--http-max-hops N]` | 1-hop 301/308 to the mapped URL, final 200, http variants |
| `scripts/slop-check.mjs <files>` | AI-writing tells in copy (skips code and frontmatter) |
| `scripts/indexnow.mjs --host h --key k <urls> [--file f] [--submit]` | IndexNow ping (Bing and others); dry run unless `--submit` |
| `scripts/tests/run-tests.mjs [--network]` | self-test against local fixture sites; run after editing any script |

Exit codes (all scripts): 2 = FATAL found, 1 = HIGH found, 0 = otherwise, 3 = could not complete
(network, quota, internal error: report "not measured", never guess), 64 = usage error.
`cwv`: 2 = a field metric poor, 1 = needs improvement, 0 = good or no field data, 3 = not measured.
Network safety: when the audited site is public, the scripts refuse requests to private, loopback
and link-local addresses (e.g. cloud metadata endpoints) that a hostile site could point them at via
sitemaps, og:image or redirects; `--allow-private` overrides. Output from pages is sanitised before printing.
`verify-redirects`: 1 = a row failed. `slop-check`: 1 = hits remain. `indexnow`: 1 = key file or submission failed.
With `--json` every script prints valid JSON, including on usage and internal errors; those carry
severity INFO (a typo or an unreachable network is not a site defect) and the exit code (64 / 3) says what happened.
