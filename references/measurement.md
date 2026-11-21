# Measurement and reporting

Report only numbers you can source. "Not verified" is an honest answer; a guessed number is not.

## Free sources
| Source | Gives | How the agent gets it |
|---|---|---|
| Google Search Console | clicks, impressions, CTR, position per query/page; indexing status and reasons; CWV; links; manual actions | user exports CSV (Performance, Pages) or connects an MCP/API; URL Inspection per URL |
| Bing Webmaster Tools | Bing index status, keywords, backlinks, Site Scan, URL inspection, and the AI Performance report (citations in Copilot/Bing AI answers) | user export; IndexNow for push. Verify report names at https://www.bing.com/webmasters/help |
| Search Console Generative AI performance | AI Overviews / AI Mode impressions per page and country, impressions only, no click data (Discover has its own report); the per-property Search generative AI control | Search Console > Performance / Settings > Search generative AI |
| PageSpeed Insights / CrUX | field + lab CWV | `cwv.mjs` |
| Analytics (GA4 etc.) | sessions and conversions by landing page | user export; filter organic |
| Live site + repo | everything technical | the scripts |
| Web search | SERP features, competitors, intent | manual, record date and location |

## GSC essentials
- **Pages report** reasons: "Crawled - currently not indexed" (quality/value or duplication),
  "Discovered - currently not indexed" (crawl budget/priority/internal links), "Duplicate,
  Google chose different canonical" (canonical signals conflict), "Alternate page with proper
  canonical" (fine), "Excluded by noindex" (check it was intended), "Soft 404", "Blocked by robots.txt".
- **URL Inspection > Test live URL** shows rendered HTML and whether Google can index it. Use
  "Request indexing" once after a meaningful change; repeating it does nothing.
- **Performance filters**: page = X to see its queries; compare date ranges; queries at
  positions 5-20 with impressions are usually the fastest wins (heuristic) (titles, content, internal links).
- Data lags ~2-3 days; positions are averages; low-volume queries are anonymized.

## IndexNow (Bing and others, not Google)
After publishing or changing URLs: `node <skill>/scripts/indexnow.mjs --host <host> --key <key> <urls>`
(dry run), then `--submit` after the user approves. Needs a key file at `/<key>.txt`.
Many hosts/plugins already do this (Cloudflare Crawler Hints, WordPress plugins); check first.

## Rank tracking without paid tools
GSC average position per query is the primary source. For spot checks use a clean browser
profile and note location/device; personalized and local results vary, so never treat one
manual search as "the rank".

## State and reporting (`seo/` in the repo)
```
seo/
  context.md          # product/org facts summary, audiences, competitors, money pages (sources cited)
  kb/                 # fact file (content-and-ai-search.md)
  keyword-map.csv     # query,intent,volume,volume_source,target_url,status,position,last_checked (see research.md)
  backlog.md          # ordered by severity x page value
  log.md              # one dated line per shipped change with URL
  ai-prompts.md       # AI answer tracking (content-and-ai-search.md)
  reports/YYYY-MM-DD-<type>.md   # audit, weekly, internal-links, migration ... one file per run
  evidence/YYYY-MM-DD/           # before/after script output (--json) backing each shipped change
  crawl-*.json, old-crawl.json   # crawl-site --out snapshots (before/after; migrations.md)
  local/                         # nap-audit.md, log.md (local-seo.md)
  outreach/                      # tracker.csv and drafts (off-page.md)
  link-update-emails.md          # migration outreach drafts (migrations.md)
  url-inventory.csv, redirect-map.csv   # migrations.md
```
Weekly/monthly report (heuristic: <= 300 words): what shipped (links), what moved (clicks, impressions,
position, conversions vs previous period, each with its source), what is broken, what is next,
and at most 3 asks for the owner. Attribute carefully: algorithm updates, seasonality (e.g.
admissions cycles), and tracking changes move numbers too.

## Diagnosing a traffic drop
1. **Confirm it is real**: GSC clicks (not just analytics); compare the same weeks last year (seasonality: admissions, festivals, exams); check tracking changes and GA filters.
2. **Shape**: sitewide vs one section vs a few URLs; one engine (Google vs Bing) or all; one country/device.
3. **Timing**: match the start date against deploys (`git log`), migrations, robots/noindex changes, CMS/plugin updates, and Google's Search Status Dashboard (https://status.search.google.com/) for core/spam updates.
4. **Technical first**: `crawl-site.mjs` + `robots-check.mjs` now vs the last known-good state; GSC Pages report for new "Excluded" reasons; Manual actions and Security issues reports (hacked content, malware, spam injection).
5. **Query level**: GSC compare periods, sort by click loss; lost positions vs lost CTR (AI Overviews or new SERP features can cut CTR without a ranking change).
6. **Act on cause**: technical regressions get fixed now; core-update losses get content-quality work (`content-and-ai-search.md`), not quick fixes. Write the timeline and evidence into the report.

## Log files and crawl stats
GSC > Settings > Crawl stats shows Googlebot requests, response codes, file types and host status (free). Server/CDN logs show what each bot really fetched: filter by verified bot IPs (`crawler-policy.md`), then look for 5xx/429 spikes, time spent on parameter or faceted URLs, money pages rarely crawled, and redirect/404 hits. That is how crawl-budget problems on large sites are found.

## Google Discover and News (optional surfaces)
Discover: no special markup; needs high-quality large images (size guidance in `thresholds.md`), compelling but accurate titles (no clickbait), and E-E-A-T. News: original reporting, clear bylines and dates, a news sitemap for recent articles, and Google's news content policies. Track both in GSC's Discover/News reports.

## Expectations to set
Technical fixes show in crawling/indexing within days to weeks; content and link changes
usually take weeks to months; field CWV lags a fix (thresholds.md). Never promise rankings or dates.
