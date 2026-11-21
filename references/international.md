# International and multilingual SEO

## Decide the structure
| Option | Example | Use when |
|---|---|---|
| Subfolders | `example.com/fr/` | default: shares domain authority, one property |
| Subdomains | `fr.example.com` | separate teams/infrastructure |
| ccTLDs | `example.fr` | strong local presence, legal needs, budget for separate authority |
URL parameters (`?lang=fr`) are not recommended. Do not auto-redirect by IP/Accept-Language:
crawlers mostly come from US IPs and would only ever see one version. Offer a language switcher instead.

## Only ship locales you can maintain
Half-translated locales (English strings left in templates, machine-translated boilerplate)
are thin near-duplicates. Keep a locale when it is fully translated and earns traffic or
serves real users. For dropped locales: 301 to the equivalent default-language page (or
noindex), remove from sitemap and hreflang. Ask the user before dropping a locale that has traffic.

## hreflang rules (values in `thresholds.md`)
- Every page lists all alternates **and itself**, reciprocally; add `x-default` (usually the language picker or default locale).
- Each alternate URL must be the canonical, 200, indexable version. Canonical stays self-referencing per language (never canonicalize `/fr/x` to `/en/x`).
- Implement in one place: `<link rel="alternate" hreflang>` in `<head>`, or the sitemap
  (`xhtml:link`), or HTTP headers for PDFs. Not mixed inconsistently.
- Language-region only when content differs by region (pricing, currency, spelling): `en-IN` vs `en-GB`.

Next.js App Router:
```ts
export async function generateMetadata({ params }) {
  const { locale, slug } = await params;
  return {
    alternates: {
      canonical: `/${locale}/${slug}`,
      languages: { en: `/en/${slug}`, ta: `/ta/${slug}`, 'x-default': `/en/${slug}` },
    },
  };
}
```
Next.js `redirects()` for a dropped locale needs two rules (bare and nested) or the bare path breaks:
```js
{ source: '/fr', destination: '/', permanent: true },
{ source: '/fr/:path+', destination: '/:path+', permanent: true },
```

## Content
Translate titles, descriptions, slugs (optional), alt text, and structured data too. Localize
currency, units, phone formats, examples, and keyword research per market: direct translation
of keywords often misses what people actually type. For India: consider Tamil/Hindi pages
only where content will be maintained; many users search in English or transliterated text.

## Verify
```bash
node <skill>/scripts/seo-check.mjs https://site.com/fr/page --deep   # codes valid, self-reference, reciprocity
node <skill>/scripts/crawl-site.mjs https://site.com                 # sitemap only lists kept locales
```
