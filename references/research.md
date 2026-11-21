# Keyword and competitor research (free-first)

Start from what buyers/students/patients need, not from volume. Volume numbers from any tool
are estimates; Search Console impressions for your own site are real.

## 1. Build the seed list
- The offer in the customer's words: services, products, programs, treatments, problems solved.
- Modifiers: location ("in Salem", "near me"), price ("fees", "cost", "price"), comparison
  ("vs", "alternative", "best"), audience ("for beginners", "for small business"), time ("2027 admission").
- Competitor and brand names (navigational + "vs" queries).
- Questions: how/what/why/can/is.

## 2. Expand with free sources
| Source | How |
|---|---|
| Search Console | Performance > Queries: everything you already get impressions for (best source) |
| Google autocomplete | type the seed + a-z; record suggestions |
| People Also Ask / related searches | from a web search of each seed |
| Bing Webmaster Tools | Keyword Research tool (free volumes from Bing) |
| Google Keyword Planner | free with a Google Ads account; ranges without active spend (account setup may ask for billing details) |
| Google Trends | seasonality (admissions, festivals) and relative interest |
| Forums/Reddit/Quora/YouTube comments | the exact words people use and unmet questions |
| Competitor sitemaps | `curl -s https://competitor.com/sitemap.xml`; list their page types and topics |
| Site search logs, sales/admission FAQs, support tickets | what real users ask |

If the user already has Ahrefs/Semrush/DataForSEO (MCP tool or API key), use it for volume,
difficulty, and competitor top pages; otherwise do not ask them to buy one. Mark every
number with its source (`gsc`, `kwp`, `bing`, `ahrefs`, `estimate`).

## 3. Classify intent and cluster by SERP
For each candidate query, search it and record the top results' page types. Queries whose
top-10 results overlap heavily (heuristic: 3+ same URLs) belong on **one page**; different result types
mean different pages. This prevents cannibalization better than grouping by similar words.

## 4. Prioritize
Score = business value (does ranking produce a lead/sale/application?) x winnability (are the
current top results weaker, thinner, or off-intent?) x effort. Positions ~5-20 (heuristic band) on existing pages
first (fastest), then gaps where competitors rank and you have no page, then new topics.

## 5. Keyword map (`seo/keyword-map.csv`)
```
query,intent,volume,volume_source,target_url,status,position,last_checked
b.e. cse admission 2027,transactional,1900,kwp,/admissions/be-cse,live,7.4,2026-11-20
root canal cost salem,transactional,,gsc,/treatments/root-canal,gap,,2026-11-20
```
One primary query per URL; a query with no page is a `gap` and goes to `seo/backlog.md`.
Two URLs on one query: merge and 301, or re-target one.

## 6. Competitor gap (free)
List 3-8 competitors (who ranks for your money queries, who AI assistants name). For each:
sitemap page types, their pages for your money queries, what their pages have that yours do
not (prices, calculators, comparisons, reviews, location pages, program details). Add a backlog
item only where you can make a clearly better page.
