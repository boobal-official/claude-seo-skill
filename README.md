# SEO skill for Claude Code

An agent skill that does website SEO the way a senior technical SEO would: find what blocks
traffic, fix it in the code or content, and **prove each fix worked** with before/after evidence.
It runs on free data (your live site, your repo, Search Console/Bing exports, PageSpeed Insights)
and ships with zero-dependency, tested Node.js scripts.

```
"Audit https://example.com and tell me why we get no traffic from Bing and ChatGPT"
"Fix the SEO problems in this Next.js repo before launch"
"Our admissions pages aren't indexed. Find out why."
"We're moving blog.example.com to example.com/blog. Plan the redirects and verify them."
```

## Why this skill

| | |
|---|---|
| **Ships changes, not PDFs** | Every workflow ends in edited files plus a proof command (and a check the site owner can run without the skill: `curl`, Search Console, view-source). |
| **Current to 2026** | Facts that changed recently are recorded with official links to re-check: FAQ rich results retired (May 2026), Googlebot's 2 MB HTML limit, the Search Console AI Overviews / AI Mode control, ChatGPT-User and robots.txt, Next.js streaming metadata, AIPREF status. |
| **One source of truth** | Every threshold and policy fact lives in `references/thresholds.md`; the scripts read the same values from `scripts/thresholds.mjs`, and the test suite fails if they drift. |
| **Free data first** | No paid SEO tool required, none recommended, no affiliate links. If you already have Ahrefs/Semrush/DataForSEO, it can use them. |
| **Safe by default** | Asks before noindexing, redirecting, blocking any crawler, or submitting anything externally. Never sends emails, buys links, or writes reviews. No cloaking, no prompt-injection tricks. Stays inside Google's spam policies. |
| **Tested tooling** | 274 automated tests against local fixture sites with planted defects, a clean site that must stay clean, and edge cases from four rounds of adversarial code review. CI runs them on Windows, macOS and Linux with Node 18, 20 and 22. |
| **Safe to point at untrusted sites** | SSRF protection (no requests to private/loopback/cloud-metadata addresses when auditing a public site), gzip-bomb and size caps, linear-time parsing, and terminal-escape sanitising of page content. |

## Install

Claude Code loads skills from `~/.claude/skills/` (all projects) or `.claude/skills/` (one project).

```bash
# macOS / Linux / Git Bash
git clone https://github.com/boobal-official/claude-seo-skill ~/.claude/skills/seo
```
```powershell
# Windows PowerShell
git clone https://github.com/boobal-official/claude-seo-skill "$env:USERPROFILE\.claude\skills\seo"
```

Restart Claude Code (or start a new session). The skill triggers automatically on SEO requests
(rankings, indexing, Search Console, robots.txt, schema, Core Web Vitals, migrations, AI-search
visibility...). Requires Node.js 18+ for the scripts. Update with `git pull` in that folder.

## What's inside

```
SKILL.md                    router: intake -> route -> prioritise -> change + verify -> report
references/
  thresholds.md             every number, limit and time-sensitive policy fact (+ official links)
  technical-audit.md        crawl, index, render, canonicals, soft 404s, programmatic pages
  core-web-vitals.md        LCP / INP / CLS diagnosis and stack fixes
  on-page.md                intent, titles, meta, headings, content refresh
  content-and-ai-search.md  helpful content, E-E-A-T/YMYL, answer-first structure, AI visibility
  structured-data.md        JSON-LD templates (Organization, LocalBusiness, Product/merchant, Article...)
  local-seo.md              Google Business Profile, NAP, location pages, clinics, colleges
  internal-linking.md       architecture, click depth, orphans, contextual links
  international.md          hreflang and locale strategy
  migrations.md             domain moves, redirect maps, cutover, monitoring
  off-page.md               link earning inside spam policies, outreach drafts
  crawler-policy.md         search vs AI-search vs training bots, robots.txt templates, bot verification
  measurement.md            Search Console, Bing, traffic-drop diagnosis, logs, reporting
  stacks.md                 Next.js (App/Pages Router, 15/16), WordPress, Shopify, static, SPA
  research.md               free keyword and competitor research
scripts/                    Node.js >= 18, no npm install
  crawl-site.mjs            link crawl + sitemaps: soft 404, broken links, chains, sitemap hygiene,
                            duplicates, near-duplicates, depth, orphans, contextual in-links
  seo-check.mjs             one page as raw HTML (what non-JS crawlers see); --deep, --bots
  robots-check.mjs          RFC 9309 / Google-parser matching for search, AI-search and training bots
  repo-audit.mjs            source-level issues before deploy (Next.js, WordPress, SPA)
  cwv.mjs                   Core Web Vitals via PageSpeed Insights (field + lab)
  verify-redirects.mjs      1-hop 301/308 verification for migrations
  slop-check.mjs            AI-writing tells in copy
  indexnow.mjs              IndexNow ping (dry run unless --submit)
  tests/run-tests.mjs       self-test suite
```

Use the scripts directly too:

```bash
node scripts/robots-check.mjs https://example.com /pricing
node scripts/crawl-site.mjs https://example.com --max 300 --money "^/(pricing|admissions)" --out seo/crawl.json
node scripts/seo-check.mjs https://example.com/pricing --deep
node scripts/repo-audit.mjs ./my-next-app
```
Exit codes: `2` FATAL found, `1` HIGH found, `0` otherwise, `3` could not complete (network/quota),
`64` usage error. Add `--json` for machine-readable output.

## How it was evaluated

The skill was built and improved over five review rounds against a fixed rubric
([docs/RUBRIC.md](docs/RUBRIC.md)), scored by independent reviewer agents that had not seen the
author's reasoning. One reviewer checked every factual claim against official documentation; a
second hunted for script bugs by running crafted inputs. Each round's findings were fixed and
re-verified. Details: [docs/EVALUATION.md](docs/EVALUATION.md).

| Dimension | v1 | final |
|---|---|---|
| Accuracy (current to Nov 2026) | 5 | 10 |
| Ships verified changes | 8 | 10 |
| Works with zero paid tools | 9 | 10 |
| Coverage | 7 | 10 |
| Safety & neutrality | 8 | 10 |
| Tooling quality | 5 | 10 |
| Skill design | 6 | 10* |
| Internal consistency | 7 | 10 |

\*The last review scored skill design 9 for one duplicated constant; it was fixed and is now
guarded by a test, but that final change was verified by the test suite rather than another review round.

**With vs without the skill** (same model, same tasks, blind grading against objective checks):
on a 110-page site audit and a "review my developer's SEO advice" task, runs with the skill
scored **24/24 (100%)** against **19/24 (79%)** without it. The baseline's misses were factual
(e.g. saying Applebot was blocked when it falls back to Googlebot's rules, quoting an outdated
"safe" Next.js version).

Honest limits: search engines change constantly, so `thresholds.md` records when each fact was
checked and tells the agent to re-verify; Core Web Vitals needs a free PageSpeed API key once the
shared quota runs out; spoofed-UA bot tests run from your IP and can differ from real crawlers.

## Run the tests

```bash
node scripts/tests/run-tests.mjs            # offline, local fixture sites on random ports
node scripts/tests/run-tests.mjs --network  # also a live fetch + PageSpeed check
```

## Contributing

Issues and pull requests are welcome, especially corrections with an official source link.
If you change a number, change it in both `references/thresholds.md` and `scripts/thresholds.mjs`
(the tests will tell you if you forget), and run the test suite.

## License

MIT, see [LICENSE](LICENSE).
