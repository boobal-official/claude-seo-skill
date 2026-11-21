# Evaluation

How the skill was measured, and what the numbers do and do not mean.

## Method

1. **Fixed rubric** ([RUBRIC.md](RUBRIC.md)): nine dimensions, each with explicit bars. A dimension
   scores 10 only when every bar is met with evidence. The overall score is the lowest dimension,
   because one weak area makes a skill unreliable in that area.
2. **Independent reviewers** (separate agents that saw only the rubric and the files, never the
   author's reasoning):
   - a *content reviewer* that checked every time-sensitive claim against official sources
     (Google Search Central, Bing, OpenAI, Anthropic, Perplexity, Amazon, schema.org, RFC 9309,
     Next.js docs, Google Business Profile help);
   - a *code reviewer* that tried to break the scripts with crafted inputs and reported only bugs it
     could reproduce by running them.
3. **Fix and re-verify**: every finding was fixed, given a regression test where possible, and
   re-checked by the next review round, which also re-ran all earlier probes to catch regressions.
4. **With-skill vs without-skill tasks**, graded blind against objective assertions by a separate
   grader agent, with ground truth from purpose-built fixture sites.

## Rubric scores by version

| Dimension | v1 | v2 | v3 | v4 | v5 |
|---|---|---|---|---|---|
| 1 Accuracy | 5 | 8 | 8 | 10 | 10 |
| 2 Ships verified changes | 8 | 9 | 9 | 10 | 10 |
| 3 Works with zero paid tools | 9 | 10 | 10 | 10 | 10 |
| 4 Coverage | 7 | 8 | 10 | 10 | 10 |
| 5 Safety & neutrality | 8 | 9 | 9 | 10 | 10 |
| 6 Tooling quality | 5 | 7 | 8 | 9 | 10 |
| 7 Skill design | 6 | 8 | 9 | 9 | 9 -> fixed* |
| 8 Internal consistency | 7 | 8 | 8 | 9 | 10 |

\*The v5 reviewer found one remaining bar-breaking defect (a size limit defined in two places). It was
fixed and a test now fails if any threshold literal appears outside `scripts/thresholds.mjs`; this
last fix was verified by the test suite, not by a further review round.

Examples of what the reviews caught and fixed:
- **Accuracy**: FAQ rich results retired for all sites (7 May 2026); Googlebot fetches the first 2 MB
  of HTML, not 15 MB; ChatGPT-User / Perplexity-User may not follow robots.txt; Search Console's
  per-property "Search generative AI" control; Next.js `htmlLimitedBots` replaces (not extends) the
  default list; Amazon's crawlers; AIPREF draft status and vendor positions.
- **Tooling**: a command-injection risk in an optional Lighthouse mode on Windows; crashes on bad
  entities, invalid redirects and stalled responses; false FATALs from `max-image-preview:none`;
  regex backtracking on pathological robots.txt patterns; RFC 9309 group-parsing details; a crawler
  that stopped after one page when the domain redirected to `www`.

## With vs without the skill

| Round | Tasks | With skill | Without skill |
|---|---|---|---|
| 1 | site audit, Next.js pre-launch fix, local clinic advice | 36/36 | 35/36 |
| 2 | 110-page site audit, developer-advice review | 20/22 | 19/22 |
| 3 | same two tasks, tightened assertions | **24/24** | 19/24 |

Round 1 showed the tasks were too easy to separate a strong model with and without the skill, so
harder tasks were built: a 110-page fixture site where defects only show at scale (orphans, deep
pages, scattered broken links, sitemap pollution, near-duplicate location pages) with traps for
false positives (`<base href>` relative links, `max-image-preview:none`), and an advice review full
of facts that changed in 2025-2026. In round 2 the skill lost a point on one stale fact; that fact
was corrected and round 3 scored 100%.

## What this does not prove

- The scores come from AI reviewers and graders against a written rubric, not from traffic
  results on real sites. SEO outcomes depend on content, competition and time.
- Search engines change their documentation often. The skill dates its facts and tells the agent
  to re-verify them, but it needs maintenance.
- The test tasks are a small sample (five task types). Treat the comparison as evidence that the
  skill improves accuracy and process, not as a guarantee.
