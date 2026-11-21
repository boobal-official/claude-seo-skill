# Thresholds, limits, and policy facts (single source of truth)

Every threshold, limit and time-sensitive policy fact the skill relies on lives here; other files
link here instead of repeating them. Workflow rules of thumb stay in the guide that uses them and
are labelled as heuristics there. Scripts read the same values from `scripts/thresholds.mjs`, and
`scripts/tests/run-tests.mjs` fails if the two disagree. Each section names the official page
to re-check: search engines change these, and a stale fact stated confidently is worse than none.
Last reviewed: 2026-11-21.

## Severity scale (used by every script and report)
| Tier | Meaning |
|---|---|
| FATAL | blocks crawling, indexing, or rendering of the site or a page that matters |
| HIGH | a page cannot rank or be cited properly, or a sitewide quality problem confirmed on the live site |
| MEDIUM | weakens ranking/CTR, or a HIGH-class problem detected only statically (repo-audit) and not yet confirmed live |
| LOW | hygiene |
| INFO | context or a policy choice |
Static source analysis is one tier below the live confirmation of the same problem, because it is a prediction.

## Core Web Vitals (Google; p75 of real-user field data, mobile and desktop separately)
| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| LCP | <= 2500 ms | 2500-4000 ms | > 4000 ms |
| INP (replaced FID, March 2024) | <= 200 ms | 200-500 ms | > 500 ms |
| CLS | <= 0.1 | 0.1-0.25 | > 0.25 |
| FCP (diagnostic) | <= 1800 ms | 1800-3000 ms | > 3000 ms |
| TTFB (diagnostic) | <= 800 ms | 800-1800 ms | > 1800 ms |
- Rankings use field data (CrUX), never Lighthouse lab scores. CWV is a real but small signal.
- CrUX field data is a rolling 28-day window: field results lag a deployed fix by up to 28 days.
- Lab proxy when no field data: Total Blocking Time > 600 ms flags INP risk (heuristic, not a Google threshold).
- Verify: https://web.dev/articles/vitals

## Titles and snippets (heuristics, not Google limits)
- Google truncates titles by pixel width (~600 px desktop), roughly 50-60 characters. The scripts flag > 60 characters as LOW and < 15 as MEDIUM. These are heuristics; Google publishes no character limit.
- Google rewrites many titles and most descriptions that do not match the page or query.
- Meta descriptions do not affect ranking; displayed snippets are roughly 150-160 characters (scripts flag > 160 as LOW).
- Verify: https://developers.google.com/search/docs/appearance/title-link and .../appearance/snippet

## Crawling and indexing
- **robots.txt**: RFC 9309. Longest matching rule wins; on a tie, Allow wins. Google ignores `crawl-delay` (Bing honours it) and dropped `noindex` lines in 2019. Google reads the first 500 KiB of robots.txt and caches it up to 24 h. Status handling: 2xx parse; 3xx follow up to 5 hops; 4xx (except 429) = no restrictions; 429/5xx/unreachable = Google stops crawling the site for up to 12 h, then uses the last cached copy for up to 30 days, after that treats it as allow-all if the site is otherwise reachable.
- **Applebot** falls back to Googlebot's rules when robots.txt has no Applebot group.
- **noindex** only works on a crawlable URL. Never Disallow a URL you want de-indexed until it has dropped out.
- **File size**: Googlebot fetches the first 2 MB of an HTML (or other supported text) file, uncompressed and including headers, and the first 64 MB of a PDF; content past the cutoff is not indexed. Each referenced resource (CSS/JS) has its own 2 MB limit. (Docs changed from 15 MB in 2026.)
- **Sitemaps**: max 50,000 URLs and 50 MB uncompressed per file; use a sitemap index beyond that. Google ignores `<priority>` and `<changefreq>`; it uses `<lastmod>` only when it is consistently accurate.
- **Canonical**: a hint, not a directive; must be in `<head>`; one per page; absolute URL.
- **rel=next/prev**: not used by Google (since 2019). Paginated pages canonicalize to themselves.
- **Redirects**: 301/308 permanent, 302/307 temporary. Aim for 1 hop. Googlebot follows up to 10 hops.
- **Mobile-first indexing**: Google indexes the mobile rendering.
- **Google Indexing API**: only for JobPosting and BroadcastEvent (livestream) pages.
- **IndexNow**: Bing, Yandex, Naver, Seznam, Yep and others (current list: https://www.indexnow.org/searchengines.json). Google does not use it.
- **AI Overviews / AI Mode controls**: (1) Search Console **Search generative AI control** (Settings > Search generative AI): Include (default) / Exclude / Inherit from parent, set **per property**; a child or URL-prefix property can override its parent, so one section can be excluded. Excluded content is not used as input for AI Overviews, AI Mode or Discover generative AI features and earns no traffic or impressions there; normal Search results stay; Google says it is not a ranking or inclusion signal for other parts of Search; takes 1-2 days (longer with caching). Available to all sites worldwide since 31 Aug 2026. It does not affect AI training (that is `Google-Extended`) and is not a way to deindex (use noindex). (2) Page/element level: `nosnippet`, `max-snippet`, `data-nosnippet`, which also limit normal snippets. The Generative AI performance report (AI Overviews / AI Mode impressions) shows what an opt-out would cost.
- Verify: https://support.google.com/webmasters/answer/16908024 and https://support.google.com/webmasters/answer/16984139
- Verify: https://developers.google.com/search/docs/crawling-indexing and https://developers.google.com/crawling/docs/crawlers-fetchers/overview-google-crawlers

## Architecture heuristics (skill heuristics, not Google numbers)
- Click depth: important pages within **3** clicks of the homepage (`crawl-site` flags depth > 3 as MEDIUM).
- Money pages: at least **3** contextual (in-body) internal links in; nav/footer links do not count.
- Anchor text: descriptive, 3-7 words; no exact anchor reused more than ~3 times sitewide.
- Near-duplicate main content: >= **85%** MinHash similarity between indexable pages flags MEDIUM.
- Low text: < **150** words of visible text on an indexable page flags LOW (word count is not a ranking factor).
- Client-rendered: < 80 words in raw HTML with > 20 KB inline script flags HIGH; otherwise < 50 words of visible text flags MEDIUM.
- Slow server response in a single fetch: > 1800 ms flags MEDIUM (use `cwv.mjs` to measure properly).
- Outreach email length: under **100** words; one ask.
- Google Discover image guidance (Google number): large images at least 1200 px wide, with `max-image-preview:large`.

## hreflang
- Values: ISO 639-1 language (2 letters), optional ISO 15924 script (`zh-Hant`), optional ISO 3166-1 alpha-2 region (`en-GB`, `pt-BR`), or `x-default`. `en-UK` is invalid (use `en-GB`). A region alone is invalid. Numeric UN M.49 regions (`es-419`) are valid BCP 47 but not documented by Google: may be ignored.
- Every page in a set lists every other page and itself; one-way pairs are ignored.
- Verify: https://developers.google.com/search/docs/specialty/international/localized-versions

## Structured data (rich result eligibility changes often)
- **FAQ rich results**: no longer shown for any site since 7 May 2026 (restricted to gov/health sites from Aug 2023). FAQPage markup is still valid and harmless; it earns no rich result.
- **HowTo rich results**: removed in 2023.
- **Course Info** rich result retired (2025); the Course list carousel may still appear. Several other types were retired in 2025. Never promise a rich result without checking the Search Gallery.
- Review stars are not shown for self-serving reviews on LocalBusiness/Organization.
- Structured data must match visible content; marking up invisible or false content is spam.
- Verify: https://developers.google.com/search/docs/appearance/structured-data/search-gallery

## Crawlers (vendor docs change; verify)
- Training tokens: GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, Meta-ExternalAgent, Bytespider.
- `Google-Extended` (a robots token, no separate crawler) controls use of content for Gemini model training **and grounding in Gemini Apps / Vertex AI**. It does not affect Google Search ranking or AI Overviews.
- AI search crawlers (robots.txt controls them): OAI-SearchBot, Claude-SearchBot, PerplexityBot, Amzn-SearchBot (Amazon/Alexa search experiences; not used for AI training; follows the rules given to other search bots when not named).
- Amazon: Amazonbot (general crawler; does not support crawl-delay), Amzn-User (user-triggered; may not follow robots.txt). Verify: https://developer.amazon.com/amazonbot
- Other OpenAI agents exist (e.g. OAI-AdsBot for ad landing pages); check the OpenAI bots page before writing rules for them.
- User-triggered fetchers: Claude-User follows robots.txt; OpenAI says robots.txt rules **may not apply** to ChatGPT-User; Perplexity says Perplexity-User generally ignores robots.txt; Amazon says Amzn-User may not follow it. Blocking these in robots.txt is unreliable; use WAF rules if they must be blocked.
- ChatGPT search visibility is controlled by allowing OAI-SearchBot (OpenAI's documented control). Bing powers Bing search and Copilot; do not claim more about which third-party indexes other assistants use.
- Vendor docs: https://developers.openai.com/api/docs/bots, https://support.claude.com/en/articles/8896518, https://docs.perplexity.ai/guides/bots, https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
- AI-use preference signals (IETF AIPREF): working-group drafts define the vocabulary and a `Content-Usage` rule; the `__usage_ai-training` robots.txt token comes from an individual draft (draft-kelley). None is an RFC yet. Vendor support (verify each vendor's own docs): Anthropic has honoured a "no AI training" signal based on this work since 30 Oct 2026, and a robots.txt rule that names ClaudeBot still wins over it. Google's crawler docs say it intends to support `user-agent: __usage_ai-training` in early 2027; Google plans to treat a shared-token opt-out as a Google-Extended disallow when Google-Extended is not named explicitly. Keep explicit user-agent rules as the reliable control. Verify: https://datatracker.ietf.org/wg/aipref/documents/, https://support.claude.com/en/articles/8896518 and https://developers.google.com/search/blog/2026/10/ai-training-control
- llms.txt: Google has said Search does not use it; no major assistant has confirmed using it for ranking or citation.

## Spam policies that change recommendations
- Link spam: buying/selling links that pass ranking credit, excessive link exchanges, large-scale keyword-anchor guest posting, PBNs. Paid or sponsored links need `rel="sponsored"` (or `nofollow`); user-generated links `rel="ugc"`.
- Scaled content abuse (Mar 2024): mass-produced pages made to rank, not to help.
- Site reputation policy (Google's heading; introduced 2024): third-party content hosted to exploit a host site's ranking signals. Check the spam-policies page for regional enforcement changes (an EEA change took effect in Aug 2026).
- Expired domain abuse; doorway pages (e.g. city pages without a real presence); cloaking.
- Verify: https://developers.google.com/search/docs/essentials/spam-policies

## Local
- Google Business Profile: business name exactly as in the real world (no added keywords); one profile per real, staffed location. Practitioners (doctors, lawyers) may each have one profile (one per practitioner, not per specialty). When a practitioner is the sole public-facing practitioner at a branded organization, use one shared profile named "[brand]: [practitioner]"; with several practitioners at one location, each practitioner's profile is titled with their name only. Departments (e.g. a hospital's emergency department) may have their own profile when they are public-facing and distinct, with their own name and their own category. Repeated guideline violations lead to suspension; reinstatement goes through the GBP appeals process after fixing the cause.
- Verify: https://support.google.com/business/answer/3038177

## Myths the skill never repeats
LSI keywords; keyword density targets; meta keywords; "minimum word count to rank"; repeated
"Request indexing"; priority/changefreq; rel=next/prev as a Google signal; domain age as a
factor; "Google penalises duplicate content" (it filters duplicates; only deceptive duplication
is spam); social shares as a direct ranking factor; third-party authority scores (DR/DA/AS) as
Google metrics; E-E-A-T as a single ranking score; llms.txt as a ranking or citation lever.
