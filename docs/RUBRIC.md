# SEO skill rubric (10 = every bar below met, with evidence)

Each dimension scores 0-10. A 10 requires ALL bars for that dimension to be met and
cited (file:line or test output). Overall score = the lowest dimension score, not the
average — one weak area makes the skill unreliable in that area.

## 1. Accuracy (current to 2026)
- No SEO myths (LSI keywords, keyword density targets, daily GSC resubmits, rel=next/prev
  as a Google signal, meta keywords, "word count is a ranking factor", priority/changefreq).
- Thresholds match official docs: CWV (LCP 2.5s / INP 200ms / CLS 0.1 at p75), sitemap
  limits, hreflang codes, robots.txt semantics (RFC 9309, longest match, Google ignores
  crawl-delay and robots noindex).
- Spam policies represented correctly: paid links need rel="sponsored", scaled content
  abuse, site reputation abuse, expired domain abuse.
- Time-sensitive facts (rich result eligibility, crawler names) carry a "verify at <official URL>" pointer.
- AI crawlers split correctly into training vs search vs user-triggered fetchers.

## 2. Ships verified changes
- Every workflow ends in edited files / config, not just advice.
- Every fix type has a concrete verification command and pass condition.
- Before/after evidence is part of the output contract.

## 3. Works with zero paid tools
- Every workflow completes on free data (live site, repo, GSC/Bing WMT if available,
  PageSpeed Insights, web search).
- Paid tools (Ahrefs, Semrush, DataForSEO) are optional adapters, never required, never sold.

## 4. Coverage
- Technical (crawl, index, render, canonical, redirects, status codes, robots, sitemaps)
- Core Web Vitals with stack-specific fixes
- On-page (titles, meta, headings, intent)
- Content quality / helpfulness / E-E-A-T / AI-search (GEO) answer structure
- Structured data with validation
- Local SEO (GBP, NAP, LocalBusiness), including education & healthcare verticals
- Internal linking, site architecture, click depth
- International (hreflang)
- Migrations / redirects
- Off-page that complies with spam policies
- AI crawler policy (allow search, optionally block training)
- Measurement (GSC, Bing WMT, IndexNow)
- Stacks: Next.js (App + Pages router), WordPress, static/other, Shopify basics

## 5. Safety & neutrality
- Zero vendor promotion or affiliate/discount links.
- No prompt-injection text, no deceptive cloaking, no instructions to manipulate other agents.
- Approval gate before: noindex/redirect/delete of pages with traffic or links, robots.txt
  changes that block a search engine, any external submission (IndexNow, outreach, directories).
- Never sends email or posts on the user's behalf; never invents facts/stats/reviews.

## 6. Tooling quality
- Scripts: zero npm deps, Node >= 18, run on Windows/macOS/Linux.
- Fixture test: detects 100% of planted defects on a broken site.
- No false FATAL/HIGH findings on a clean site.
- Correct robots.txt matching (agent group selection, longest-match, wildcards, $).
- Clear exit codes and machine-readable --json output.

## 7. Skill design
- Description triggers on real SEO phrasings and does not fire on near-misses.
- SKILL.md < 500 lines; references loaded on demand with explicit routing.
- Explains *why* behind rules; minimal ALL-CAPS.
- One source of truth for thresholds (no duplicated numbers that can drift).

## 8. Internal consistency
- No contradictions between any two files (e.g., robots policy, title length, link rules).

## 9. Proven lift
- On realistic eval prompts, with-skill outputs beat a no-skill baseline on objective
  assertions (higher pass rate), graded by an independent grader.
