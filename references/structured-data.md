# Structured data (JSON-LD)

Rules: markup must describe content visible on the page; never mark up what is not there;
one entity described consistently across the site. Eligibility for rich results changes:
check the Search Gallery before promising one (`thresholds.md`).

## Workflow
1. Detect current markup: `node <skill>/scripts/seo-check.mjs <url>` (types + validation issues).
2. Choose types from the table below by page type.
3. Generate JSON-LD from the same data the page renders (never hand-type prices twice).
4. Render server-side in the HTML (`<script type="application/ld+json">`).
5. Validate: re-run `seo-check.mjs` (0 `jsonld-parse-error` / `schema-missing-required`), then the
   user can confirm in Google's Rich Results Test (https://search.google.com/test/rich-results)
   and Schema Markup Validator (https://validator.schema.org/). There is no public API for those, so ask the user to paste results if needed.
6. After deploy, Search Console > Enhancements shows errors at scale.

## Which types where
| Page | Types |
|---|---|
| Homepage | `Organization` (or a subtype) + `WebSite` |
| College / school | `CollegeOrUniversity` / `School` / `EducationalOrganization` with address, `sameAs` |
| Course / program page | `Course` (name, description, provider; the Course Info rich result is retired, the Course list carousel may remain); `EducationalOccupationalProgram` for degree programs |
| Clinic / hospital / doctor | `MedicalClinic` / `Hospital` / `PhysiciansOffice` / `Dentist` for the practice (LocalBusiness subtypes); `IndividualPhysician` for a doctor's own page |
| Local business location | most specific `LocalBusiness` subtype per location |
| Product | `Product` + `Offer` (+ `AggregateRating`/`Review` only from real customer reviews). Online stores: also see Merchant listing requirements (shipping, returns, price, availability) and Google Merchant Center for free product listings |
| SaaS / app | `SoftwareApplication` (+ `Offer`) |
| Article / blog | `Article`/`BlogPosting` with `author` as a `Person` linked to a profile page |
| Any deep page | `BreadcrumbList` matching the visible breadcrumb |
| Events, admissions open days | `Event` |
| Jobs / recruitment | `JobPosting` |
| Video page | `VideoObject` |

## Templates

Organization (homepage; use a subtype when one fits):
```json
{
  "@context": "https://schema.org",
  "@type": "CollegeOrUniversity",
  "@id": "https://www.example.edu/#org",
  "name": "Example College of Engineering",
  "alternateName": "ECE",
  "url": "https://www.example.edu/",
  "logo": "https://www.example.edu/logo.png",
  "address": { "@type": "PostalAddress", "streetAddress": "...", "addressLocality": "...", "addressRegion": "...", "postalCode": "...", "addressCountry": "IN" },
  "telephone": "+91-...",
  "sameAs": ["https://www.linkedin.com/school/...", "https://www.youtube.com/@...", "https://en.wikipedia.org/wiki/..."]
}
```

LocalBusiness (one per physical location, on that location's page):
```json
{
  "@context": "https://schema.org",
  "@type": "Dentist",
  "@id": "https://www.example.com/salem/#location",
  "name": "Bright Smile Clinic Salem",
  "url": "https://www.example.com/salem/",
  "telephone": "+91-...",
  "address": { "@type": "PostalAddress", "streetAddress": "...", "addressLocality": "Salem", "postalCode": "...", "addressCountry": "IN" },
  "geo": { "@type": "GeoCoordinates", "latitude": 11.66, "longitude": 78.15 },
  "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"], "opens": "09:00", "closes": "19:00" }],
  "parentOrganization": { "@id": "https://www.example.com/#org" }
}
```

Product + Offer:
```json
{ "@context": "https://schema.org", "@type": "Product", "name": "...", "image": ["..."], "description": "...", "brand": { "@type": "Brand", "name": "..." }, "sku": "...",
  "offers": { "@type": "Offer", "price": "1499.00", "priceCurrency": "INR", "availability": "https://schema.org/InStock", "url": "https://..." } }
```

Article:
```json
{ "@context": "https://schema.org", "@type": "BlogPosting", "headline": "...", "image": ["https://..."], "datePublished": "2026-08-03", "dateModified": "2026-10-01",
  "author": { "@type": "Person", "name": "Dr. A. Kumar", "url": "https://www.example.com/team/a-kumar" },
  "publisher": { "@id": "https://www.example.com/#org" } }
```

Merchant listings (online stores; eligibility for Shopping surfaces and product rich results):
- Required: `Product` `name`, `image` and `offers`; on the `Offer`, `price` (greater than zero) and
  `priceCurrency` (or a `priceSpecification` carrying both).
- Recommended: `availability` (`InStock`, `OutOfStock`, `PreOrder`, `Discontinued`). Keep out-of-stock
  products live with `OutOfStock` rather than 404ing them while they may return; 301 or 410 discontinued ones.
- Strongly recommended: `shippingDetails` (`OfferShippingDetails`), `hasMerchantReturnPolicy`
  (`MerchantReturnPolicy`, or set them once at Organization level), `gtin`/`mpn`, `image` (several sizes).
- Variants (size/colour): `ProductGroup` with `hasVariant` and `variesBy`; each variant URL selects the variant.
- Free product listings: submit the catalogue in Google Merchant Center (free) and keep feed and
  on-page price/availability identical. Verify: https://developers.google.com/search/docs/appearance/structured-data/merchant-listing

BreadcrumbList:
```json
{ "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
  { "@type": "ListItem", "position": 1, "name": "Courses", "item": "https://www.example.edu/courses/" },
  { "@type": "ListItem", "position": 2, "name": "B.E. Computer Science" } ] }
```

Next.js rendering (App Router):
```tsx
export default function Page() {
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Course', name: course.name, description: course.summary, provider: { '@id': 'https://www.example.edu/#org' } };
  return (<>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
    {/* page */}
  </>);
}
```
The `.replace(/</g, '\\u003c')` stops `</script>` inside data from breaking out of the tag.

## Do not
- Sell FAQPage or HowTo markup as a "rich result win": neither shows rich results any more (`thresholds.md`). Existing markup is harmless; keep the visible FAQ content if it helps readers.
- Add `AggregateRating` from testimonials you picked, or reviews about your own business on your own LocalBusiness/Organization markup (self-serving; not shown).
- Duplicate the same entity with conflicting names/addresses across pages. Use `@id` references.
- Copy JSON-LD from a competitor or template without matching your visible content.
