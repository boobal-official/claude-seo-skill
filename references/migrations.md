# Migrations: domain change, rebrand, subdomain->subfolder, URL restructure, platform move

A migration done well keeps rankings; done badly it loses traffic for months. Almost every
loss traces to the same few mistakes:

| Mistake | Consequence |
|---|---|
| Redirecting many old URLs to the homepage | Treated as soft 404s; the old pages' link equity is lost |
| Redirect chains (http -> https -> old slug -> new domain) | Slower processing; crawlers may stop following |
| Staging `noindex`/`Disallow: /` shipped to production | New site de-indexed |
| Blocking old URLs in robots.txt | Crawlers never see the 301s; old URLs stay indexed |
| Ignoring URLs missing from the sitemap | Old pages with backlinks start returning 404 |
| Removing redirects after a few months | Backlinks to old URLs keep pointing there for years |

Get user approval for the redirect map before cutover. It is the hardest thing to undo.

## Step 1: URL inventory (union of all sources)
1. Old sitemap(s).
2. Repo route tree + every slug generated from data/CMS.
3. GSC Pages/Performance: every URL with clicks or impressions in the last 16 months.
4. Backlinks: every old URL with referring domains (GSC Links report is free; a paid backlink tool adds coverage if the user has one).
5. Analytics landing pages (12 months).
6. `crawl-site.mjs` of the old site (`--out seo/old-crawl.json`).
Normalize (lowercase host, strip fragments/tracking params, one trailing-slash form) and write `seo/url-inventory.csv`.

## Step 2: Redirect map (1-to-1)
```
old URL
├── same content, same path    -> path-preserving catch-all rule
├── same content, new slug     -> explicit row
├── merged into another page   -> explicit row to the absorbing page
├── deleted, has links/traffic -> closest topical equivalent; if none, restore the page
└── deleted, no links/traffic  -> 410 (never the homepage)
```
Collapse existing redirects so every old URL reaches its destination in one hop.
Write `seo/redirect-map.csv` (`old_url,new_url`); every `new_url` must return 200.

## Step 3: Ship the config
**Next.js** (`next.config.*` on the deployment answering the old host; `permanent: true` = 308, equivalent to 301 for Google):
```js
import { readFileSync } from 'node:fs';
const explicit = readFileSync('./seo/redirect-map.csv', 'utf8').trim().split(/\r?\n/).slice(1)
  .map((l) => l.split(',')).map(([o, n]) => ({ from: new URL(o).pathname, to: n }));
export default {
  async redirects() {
    return [
      ...explicit.map(({ from, to }) => ({ source: from, destination: to, permanent: true, has: [{ type: 'host', value: '(www\\.)?old\\.com' }] })),
      { source: '/:path*', destination: 'https://new.com/:path*', permanent: true, has: [{ type: 'host', value: '(www\\.)?old\\.com' }] },
    ];
  },
};
```
Escape `( ) : * ?` in old paths used as `source`. Large maps (thousands of rows): use
middleware (`proxy.ts` in Next 16) with a lookup table, or the edge (Cloudflare Bulk Redirects, Vercel `vercel.json` / edge config), since `redirects()` has limits.

**Nginx**:
```nginx
map $uri $redirect_target { default ""; include /etc/nginx/old-redirects.map; }
server {
  listen 80; listen 443 ssl; server_name old.com www.old.com;   # keep valid TLS on the old domain
  if ($redirect_target) { return 301 $redirect_target; }
  return 301 https://new.com$request_uri;
}
```
**Apache** (`.htaccess`): `Redirect 301 /old-path https://new.com/new-path` per row, then `RewriteRule ^(.*)$ https://new.com/$1 [R=301,L]`.
**WordPress**: the Redirection plugin (import CSV) or server config; update Site Address only after redirects are ready.

## Step 4: Verify before and after DNS
```bash
node <skill>/scripts/verify-redirects.mjs seo/redirect-map.csv      # must end "N passed, 0 failed"
node <skill>/scripts/robots-check.mjs https://new.com                # no blanket Disallow
node <skill>/scripts/seo-check.mjs https://new.com/                   # no noindex, canonical on new host
```
Run against staging (hosts-file override) before cutover and on production right after.

## Step 5: Cutover edits
- Canonicals, OG URLs, sitemap, hreflang, internal links, JSON-LD `url`/`@id` use the new origin
  (`grep -rn "old.com" .` should only find the redirect config and history mentions).
- Organization schema: `alternateName` with the old brand; About page: "X (formerly Y)".
- New sitemap on the new domain; keep the old sitemap reachable for a few weeks so crawlers recrawl old URLs and see the 301s.
- GSC: verify both properties; full domain moves: run the Change of Address tool from the old property.
- Bing Webmaster Tools: Site Move tool.
- Keep the old domain registered with valid HTTPS and the redirects live permanently.

## Step 6: Monitor (days 1-60)
Day 1: verify script 0 failed; GSC no spike in "Blocked by robots" / "Excluded by noindex".
Weeks 1-8: new property indexed count rising as the old falls; compare clicks by page group.
Draft link-update emails (`seo/link-update-emails.md`) to the top referring sites (one ask,
exact old and new URL, length per `thresholds.md`). The owner sends them; you never send.
