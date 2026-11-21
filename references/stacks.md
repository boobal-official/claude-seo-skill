# Stack recipes

Detect the stack with `node <skill>/scripts/repo-audit.mjs .` and add pages the way the repo
already does (same routing, metadata helpers, content collections).

## Next.js App Router
**Root metadata** (`app/layout.tsx`):
```ts
export const metadata: Metadata = {
  metadataBase: new URL('https://www.example.com'),          // makes canonical/OG URLs absolute
  title: { default: 'Example College of Engineering', template: '%s | Example College' },
  description: '...',
  robots: { index: process.env.VERCEL_ENV === 'production', follow: true }, // never leak staging noindex
  openGraph: { siteName: 'Example College', type: 'website' },
};
```
If the host is not Vercel, use the variable that distinguishes production there.

**Per page**: `export const metadata` or `generateMetadata` with `title`, `description`,
`alternates: { canonical: '/path' }`, `openGraph.images`. Every route gets its own title.

**Dynamic routes**:
```ts
export async function generateStaticParams() { return (await getCourses()).map((c) => ({ slug: c.slug })); }
export const dynamicParams = false;            // fixed set: unknown slugs 404 (Next <= 15, or 16 without cacheComponents)
export default async function Page({ params }) {
  const { slug } = await params;               // params is a Promise in Next 15+
  const course = await getCourse(slug);
  if (!course) notFound();                     // open set: real 404 for missing records
  ...
}
```

**Sitemap** (`app/sitemap.ts`): build from the same data as routes; real `lastModified`;
exclude noindex/redirected URLs; split with `generateSitemaps` past the per-file limit (`thresholds.md`).
```ts
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const courses = await getCourses();
  return [
    { url: 'https://www.example.com/', lastModified: new Date('2026-10-01') },
    ...courses.map((c) => ({ url: `https://www.example.com/courses/${c.slug}`, lastModified: c.updatedAt })),
  ];
}
```
**Robots**: `app/robots.ts` (template in `crawler-policy.md`).
**Redirects**: `next.config` `redirects()` (`permanent: true` = 308) for static maps; `middleware.ts` (renamed `proxy.ts` in Next 16) for large or data-driven maps.
**Next 16 + `cacheComponents`**: route segment configs such as `revalidate`/`dynamic` give way to `'use cache'` + `cacheLife`; check the docs for the installed version before adding segment configs. `notFound()` for missing records works in every version and is the portable soft-404 fix.
**Rendering**: fetch main content in Server Components. Client Components still SSR, but data
fetched in `useEffect`/SWR does not reach the HTML. Streaming: content inside `<Suspense>`
streams into the same response; check it appears in `seo-check.mjs` output.
**Streaming metadata** (Next 15.2+): `generateMetadata` output can stream into `<body>` for any user agent
not on Next's `htmlLimitedBots` list. Google renders JS and copes, but non-JS crawlers
(OAI-SearchBot, PerplexityBot, ClaudeBot, GPTBot) may miss a title or canonical that only appears in
the body, and Google ignores a canonical outside `<head>` in the raw HTML. Fix: add those crawlers to
`htmlLimitedBots` in `next.config`. Setting it **replaces** Next's default list, so copy the default
regex from the installed version (`grep -r HTML_LIMITED_BOT_UA_RE node_modules/next/dist`) and append
the AI crawlers; `/.*/` disables streaming metadata for everyone at a TTFB cost. Or use static
`metadata` / static or ISR rendering where possible (prerendered pages always have metadata in `<head>`). Check: `seo-check.mjs <url> --ua oai-searchbot` (code `metadata-streamed`).
**Images/fonts/scripts**: `next/image`, `next/font`, `next/script` (see `core-web-vitals.md`).
**Supabase/DB-backed pages**: public SEO pages read with a public, cached query (ISR
`revalidate`, or `'use cache'` + `cacheLife` with Next 16 `cacheComponents`), never through a user session; RLS policies must allow anonymous read of exactly the public rows.

**Framework security**: before shipping SEO changes on an old Next.js minor, check the Next.js security
advisories for that line (https://nextjs.org/blog and GitHub security advisories) and upgrade to the
patched release; say so in the report if the installed version is affected.

## Next.js Pages Router
`next/head` for title/meta/canonical per page; `getStaticPaths` with `fallback: false`, or
`fallback: 'blocking'` + `return { notFound: true }` for missing records; `next-sitemap`
package or a `pages/sitemap.xml.ts` route; `public/robots.txt`.

## WordPress
- One SEO plugin (Yoast, Rank Math, AIOSEO, SEOPress, The SEO Framework). Two = duplicate tags.
- Settings > Reading: "Discourage search engines" OFF on production.
- Settings > Permalinks: `/%postname%/` (changing later needs redirects).
- Noindex thin archives you do not want ranking (tag pages, date archives, author archives on single-author sites, attachment pages). Rank Math/Yoast redirect attachment pages to the file or parent.
- Plugin sitemap at `/sitemap_index.xml` (Yoast/Rank Math) or core `/wp-sitemap.xml`; submit the one in use.
- Edit theme templates in a child theme; page-builder bloat is the main CWV cost.
- Redirects: Redirection plugin or the SEO plugin's redirect manager.

## Shopify
- Duplicate product paths: `/collections/x/products/y` and `/products/y` (canonical points to
  `/products/y` by default; keep theme links pointing there).
- `/collections/x?filter...` and `/collections/all` sorting URLs: let canonicals work; do not index filter combos.
- robots.txt is editable via `robots.txt.liquid`; Shopify's defaults are sensible, change cautiously.
- Titles/descriptions in each product/collection's "Search engine listing"; JSON-LD comes from
  the theme (check it is not duplicated by an app).
- Apps inject scripts; audit for CWV.

## Static sites, Astro, Hugo, Jekyll, Eleventy
Usually excellent for SEO (pre-rendered HTML). Ensure: sitemap plugin (`@astrojs/sitemap`,
Hugo built-in, `jekyll-sitemap`), canonical in the base layout, real 404 page served with
404 status by the host (Netlify `404.html`, Vercel, Cloudflare Pages), trailing-slash consistency.

## SPAs (Vite/CRA React, Vue, Angular without SSR)
Every route returns the same empty shell. For public pages: prerender (build-time HTML for
each route), migrate marketing pages to an SSR/SSG framework, or serve them from a separate
static site. Also: real 404 statuses (SPAs return 200 for everything by default), unique
titles per route in the prerendered HTML, `<a href>` links.

## Verify after any stack change
```bash
node <skill>/scripts/repo-audit.mjs .
next build && next start   # or the stack's production preview
node <skill>/scripts/crawl-site.mjs http://localhost:3000 --max 200
```
