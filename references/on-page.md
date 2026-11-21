# On-page: intent, titles, descriptions, headings, URLs, images, refreshes

Lengths: `thresholds.md`. The SERP is the brief: what ranks today shows the format Google
believes answers the query. Look before you write (web search the query; note the top 5
result types, the featured snippet, People Also Ask, and whether AI Overviews appear).

## 1. Intent first
Classify the target query before touching copy:

| Intent | SERP looks like | Page must be |
|---|---|---|
| Informational ("what is", "how to") | guides, videos, PAA | a direct answer in the first 2 sentences, then depth |
| Commercial investigation ("best", "vs", "alternatives", "review") | listicles, comparisons | honest comparison with criteria, prices, trade-offs |
| Transactional ("buy", "pricing", "near me", "admission") | product/category/local pack | price, availability, CTA, trust signals above the fold |
| Navigational (brand) | the brand's pages | the right page ranking for the brand name |
| Local ("dentist in salem", "colleges near me") | map pack + local pages | GBP + a location page (see `local-seo.md`) |

If the page type does not match the SERP type, rewriting the title will not help; build the right page type.
One primary query per URL. Two URLs chasing one query (same titles/H1s, `duplicate-titles`)
split signals: merge and 301, or re-target one.

## 2. Titles
Formula: `Primary topic + differentiator + brand` (brand optional on long titles).
- Put the words the searcher types first; the differentiator is what makes them click (price, location, year, count, audience).
- Match the page type: pricing pages say "Pricing", comparisons say "vs".
- Unique per page; descriptive, not "Home"/"Services".
- Write 3 options, pick the most accurate and specific. No hype words the SERP does not use.
- Change slugs only when the page is new or the old slug is actively harmful; otherwise keep URLs stable.

| Weak | Better | Why |
|---|---|---|
| Home | Family Dentist in Salem, Same-Day Appointments | query + differentiator |
| Plans for Growing Teams | Invoice Software Pricing: Free, Pro $19/mo | page type + price |
| The Ultimate Complete Guide to Digital Signage Benefits | 8 Digital Signage Benefits for Retail Stores | concise, specific |
| B.E. Courses | B.E. Admissions 2027: Courses, Fees, Cut-offs | matches what applicants search |

Bulk work: return a table `Page | Current | Proposed | Reason` for approval, then edit.

## 3. Meta descriptions
No ranking effect; they earn clicks. Summarize the specific answer/offer with one concrete
fact and the action. Google rewrites them when they do not match the query, so do not
stuff variants.

## 4. Headings
- One clear H1 that states the page topic (multiple H1s are not an error, but one is clearer).
- H2s as the questions/sections a buyer or student actually has; at least one phrased like the query.
- Follow question headings with a 1-2 sentence direct answer; that pair is what featured snippets and AI answers lift.
- Do not skip levels for styling; style with CSS.

## 5. URLs
Short, lowercase, hyphenated, human-readable, stable. No dates in evergreen URLs. No IDs
when a name exists. Changing a URL needs a 301 and internal-link updates (`migrations.md`).

## 6. Images
Descriptive filenames; `alt` that describes the image for someone who cannot see it
(decorative images: `alt=""`); width/height set; modern formats; the LCP image not lazy-loaded.
Image search matters for products, recipes, places, and campuses.

## 7. Content refresh (pages slipping or stuck at positions ~5-20, a heuristic band)
1. Pull the page's queries (GSC Performance, filter by page, last 3 vs previous 3 months; a working heuristic).
2. Read the current top 5 for the main query. Note what they answer that the page does not,
   newer facts, better format (table, steps, calculator), and first-hand evidence.
3. Plan the refresh (Keep / Rewrite / Add / Remove per section) and show it to the user before rewriting large sections.
4. Edit in place, keep the URL, keep anchors other pages link to. Answer first, update facts
   with dates and sources, add what only this site knows (data, photos, examples, expert quotes).
5. Update `dateModified` only when the content changed meaningfully; a fake fresh date is a trust problem, not a trick.
6. Add 2-3 contextual internal links to it from strong related pages (`internal-linking.md`).
7. Record the change in `seo/log.md`; compare GSC 28 days later. Never promise a ranking.

Word count is not the goal: match the depth the query needs, and cut what the reader skips.

## Verify
```bash
node <skill>/scripts/seo-check.mjs https://site.com/page   # title/desc/H1/canonical as served
node <skill>/scripts/crawl-site.mjs https://site.com        # duplicate titles / missing H1 sitewide
```
