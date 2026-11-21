# Crawler policy: search engines, AI search, AI training, scrapers

Default for most sites: **search engines and AI search crawlers allowed** (that is how pages
get ranked and cited). Blocking **AI training** crawlers is an optional business decision: it
does not affect search rankings, but it does change how the site's content is used, so it is
the owner's call. Facts and vendor links: `thresholds.md` > Crawlers.

Any change to who may crawl the site needs the user's approval first (SKILL.md, Step 4).

## The bots (tokens checked by `robots-check.mjs`)
| Category | Tokens | robots.txt reliable? | Effect of blocking |
|---|---|---|---|
| Search | Googlebot, Bingbot, DuckDuckBot, Applebot, YandexBot | yes | removed from that engine and products built on its index |
| AI search | OAI-SearchBot, Claude-SearchBot, PerplexityBot | yes | not shown/cited in that assistant's search answers |
| AI user-triggered | Claude-User (respects robots.txt), ChatGPT-User and Perplexity-User (vendors say robots.txt may not apply) | partly | the assistant may be unable to open the page when a user asks; only a WAF rule blocks ChatGPT-User/Perplexity-User reliably |
| AI training | GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, Meta-ExternalAgent, Bytespider | yes (for these vendors) | content not used for future training; Google-Extended also stops grounding in Gemini Apps/Vertex AI; no Search effect |
| Amazon | Amzn-SearchBot (search, no AI training; when not named it follows the rules given to other search bots), Amazonbot (general crawler; may be used to train Amazon AI models), Amzn-User (user-triggered, may ignore robots.txt) | mostly | Amzn-SearchBot block removes eligibility for Amazon/Alexa search experiences |

AI Overviews and AI Mode use normal Googlebot crawling, so `Google-Extended` does not keep a site out
of them. Controls (`thresholds.md` > Crawling): the per-property Search Console AI-features setting
(Search generative AI control; a child property can exclude one section), or
`nosnippet`/`max-snippet`/`data-nosnippet` per page or element (these also shrink normal snippets).
Opting out loses AI Overviews/AI Mode impressions and citations: look at Search Console's AI
performance reports first, and treat it as the owner's decision.

## robots.txt templates
**Default (everyone may crawl public pages):**
```
User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/

Sitemap: https://www.example.com/sitemap.xml
```
**Optional add-on, only if the owner chooses "no AI training":**
```
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: CCBot
User-agent: Meta-ExternalAgent
User-agent: Bytespider
Disallow: /
```
Only disallow private paths that exist in this repo. Never disallow CSS/JS. Keep the file
small (Google reads only the first part of the file; limit in `thresholds.md`). A separate `User-agent: Googlebot` group makes Googlebot ignore
the `*` group entirely, so repeat any rules it needs or avoid the extra group.

Next.js `app/robots.ts` (add the second rule only with the owner's OK):
```ts
import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', '/admin/'] },
      // { userAgent: ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent', 'Bytespider'], disallow: '/' },
    ],
    sitemap: 'https://www.example.com/sitemap.xml',
  };
}
```
On preview/staging deployments use `noindex` (meta or `X-Robots-Tag`), not `Disallow: /`:
a disallowed URL cannot be crawled, so its noindex is never seen and leaked preview URLs can
stay indexed; and a `Disallow` gated on a hosting env var blocks production too on any other host.

## robots.txt is a request, not a lock
Well-behaved crawlers obey it; scrapers do not. To stop abusive scraping or protect expensive endpoints:
- **Verify bots before trusting a UA**: reverse DNS of the IP must end in the vendor's domain
  (Googlebot: `googlebot.com`/`google.com`; Bingbot: `search.msn.com`), then a forward lookup
  must return the same IP; or match the vendor's published IP ranges with real CIDR checks
  (Google: https://developers.google.com/static/search/apis/ipranges/googlebot.json; Bing:
  https://www.bing.com/toolbox/bingbot.json; Anthropic: https://claude.com/crawling/bots.json; OpenAI,
  and Perplexity publish JSON ranges in their bot docs; Amazon publishes IP-list pages linked from
  https://developer.amazon.com/amazonbot).
  Never allow-list by User-Agent alone; never prefix-match IP strings.
- Use the host/CDN bot management (Cloudflare, Vercel Firewall, AWS WAF) with "verified bots"
  allowed; rate-limit expensive routes per IP; require auth for data APIs; cache public pages so bot hits are cheap.
- Do not block whole cloud networks (AWS, Azure, GCP) blindly: verified crawlers run there, and Bing's crawlers come from Microsoft networks.

## This skill does not
- Cloak (bots and users get the same content).
- Put hidden instructions aimed at AI agents into pages (prompt-injection text). It is deceptive, unreliable, and may be treated as spam or malicious content.
- Serve fake "verification" pages only to bots.

## Verify
```bash
node <skill-dir>/scripts/robots-check.mjs https://site.com /pricing /blog/
node <skill-dir>/scripts/seo-check.mjs https://site.com/pricing --bots    # WAF/UA blocks show as status differences (ask first if production sits behind a WAF/CDN bot shield)
```
Pass: no FATAL; every remaining HIGH is a block the owner approved. Spoofed-UA tests come from
your IP; real crawlers come from vendor IPs, so confirm with server/CDN logs, GSC URL
Inspection (live test), and Bing URL Inspection.
