# Content quality, E-E-A-T, and AI search (GEO)

Google and AI assistants reward the same thing: pages that answer clearly, with facts only
this source can give, from a source that is identifiable and trustworthy. Optimising for
AI search is mostly doing classic SEO well and making each section quotable on its own.

## Contents
1. What "helpful" means in practice
2. E-E-A-T and YMYL
3. The fact file (`seo/kb/`)
4. Answer-first structure (featured snippets + AI citations)
5. Removing AI-writing tells
6. AI visibility: crawlers, llms.txt, tracking
7. Scaled and programmatic content

## 1. Helpful content, concretely
Ask of every page (Google's own self-assessment questions, condensed):
- Does it give original information, research, analysis, or first-hand experience?
- Would someone who arrives from search leave satisfied, or need to search again?
- Is it clear who wrote it and why they are qualified?
- Is it written for people first, with no padding to hit a length?
- Could the same paragraph appear unchanged on a competitor's site? If yes, rewrite it around a fact only this site has.

Never invent statistics, quotes, customers, reviews, prices, credentials, or benchmarks.
When a fact is missing, write `[NEEDS FACT: ...]` in a source comment (`{/* */}` in MDX,
`<!-- -->` in HTML/Markdown), remove the unverified claim from the visible copy, and list
it in the report for the owner.

## 2. E-E-A-T and YMYL
E-E-A-T (Experience, Expertise, Authoritativeness, Trust) is the framework Google's quality
raters use; it is not one ranking score, but the signals behind it are real:
- **Who**: author byline linked to a profile page with credentials; organization "About",
  contact details, physical address where relevant.
- **Experience**: first-hand photos, test results, case details, "we did X and saw Y".
- **Sources**: cite primary sources for claims; date statistics.
- **Trust**: accurate facts, clear policies (privacy, refunds, admissions criteria), HTTPS, no deceptive design.

**YMYL** (health, finance, safety, legal, major life decisions such as admissions):
- Health: content written or reviewed by a qualified professional; show "Medically reviewed by <name, credential>, <date>"; cite guidelines (WHO, national health bodies).
- Education: show accreditation (e.g. NAAC/NBA/AICTE/UGC in India), official fee and cut-off sources, placement figures with year and source.
- Finance/legal: disclose qualifications and the date the information was last verified.

## 3. The fact file (`seo/kb/`)
One place for every verifiable fact, so pages stop contradicting each other and drafts stop inventing:

```
seo/kb/
  facts.md        # name, offer, prices, limits, locations, accreditation, contacts; each with source + date
  proof/          # one file per proof point: benchmark, case study, review, award (source, date, numbers)
  pages-index.md  # which pages quote which fact IDs (so a changed fact can be updated everywhere)
```
Fact entry format: `F-012 | Root canal from ₹6,000 | source: /pricing (2026-10-01) | used on: /pricing, /blog/root-canal-cost`.
When a fact changes (price, fee, intake, placement %), grep `pages-index.md` and update every page in the same change.

## 4. Answer-first structure
Search engines and AI assistants quote passages; sections that answer on their own (heading +
direct answer + detail) are the ones that get lifted (a well-supported heuristic, not a documented algorithm).
- **First 40-60 words (heuristic) answer the query** directly (with the key number or the top pick). No throat-clearing intro.
- **Question H2s** matching how people ask, each followed by a 1-2 sentence answer, then detail.
- **Self-contained sections**: each comparison item carries its own name, verdict, best-for, price; a chunk lifted alone must still be correct.
- **Tables** for specs, prices, and comparisons (well-structured, with header rows).
- **Facts in text**: prices, specs, and attributes as text, not icons or images.
- **Entity clarity**: use the full name of the organization/product consistently; Organization schema with `sameAs` to official profiles; an About page that states what it is.
- **Freshness**: date-stamp time-sensitive facts ("as of Nov 2026").

## 5. Removing AI-writing tells
Generic AI prose loses readers and gets skipped by answer engines because it carries no facts.
Run `node <skill>/scripts/slop-check.mjs <files>` and rewrite each hit around a fact. Then read
once for what regex cannot see: passive voice that hides the actor, padded triplets, synonym
cycling (calling one tool by four names), labels that repeat the sentence, uniform sentence length.
A word used literally ("landscape orientation", "robust statistics") can stay; note it.

## 6. AI visibility
- **Crawlability**: AI search fetchers must be allowed and must get real HTML (`robots-check.mjs`, `seo-check.mjs --bots`). See `crawler-policy.md`.
- **Bing matters**: Bing search and Copilot use Bing's index; ChatGPT search is controlled by OAI-SearchBot access (`thresholds.md`). Verify the site in Bing Webmaster Tools and submit the sitemap. Bing Webmaster Tools also reports how often the site is cited in Bing/Copilot AI answers: free first-party AI-visibility data (check its current reports).
- **Get cited**: AI answers cite pages that are already well-ranked or widely referenced. Third-party mentions (reviews, comparison articles, forums, directories, news) influence which brands assistants name. Earn them through `off-page.md`, never by planting fake reviews or spam.
- **llms.txt**: a community proposal (2024). Google has said Search does not use it, and no major AI assistant has confirmed using it for ranking or citation. It is cheap and harmless; add it only if the user wants it, keep it consistent with the site, and never present it as a ranking lever.
- **First-party AI data (free)**: Search Console AI performance reports (AI Overviews / AI Mode) and Bing Webmaster Tools' Copilot citation reporting. Use them before and after changes.
- **Opting out**: if the owner wants out of Google's AI features, use the Search Console setting (`thresholds.md`), not robots.txt.
- **Tracking without paid tools**: keep `seo/ai-prompts.md` with 15-25 real buyer questions (a workable sample size, not a rule). Monthly, ask ChatGPT, Perplexity, Gemini, Copilot, and Google (AI Overview) each question; record whether the brand is named, what is said, which URLs are cited, and errors. Wrong facts mean the site states them unclearly: fix the page that owns the fact. Missing presence: the cited sources become the outreach list. Answers vary run to run, so track trends, not single answers. Paid trackers exist; mention them only if the user asks.

## 7. Scaled and programmatic content
Templates are fine when each page carries unique, useful data (real listings, prices,
reviews, local facts). They become scaled content abuse when pages differ only by a swapped
name. Gate by data: no data, no page (or `noindex`). Check with `crawl-site.mjs` (`near-duplicates`).
AI-assisted writing is acceptable when a human adds expertise, verifies facts, and the page serves readers; mass-published unedited AI text is not.
