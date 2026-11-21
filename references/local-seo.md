# Local SEO (map pack, "near me", multi-location, colleges, clinics)

Local rankings come mainly from three things: **relevance** (does the profile/page match the
search), **distance** (from the searcher; you cannot change it), and **prominence** (reviews,
links, mentions, overall web presence). The Google Business Profile (GBP) drives the map pack;
the website drives organic results and supports the profile.

## 1. Google Business Profile (the owner does these; you draft and check)
- **Primary category** is the strongest relevance choice. Pick the most specific true one
  ("Dental clinic", "Engineering college", "Pharmacy"); add accurate secondary categories.
- **Business name** exactly as on signage. Adding keywords/locations to the name violates
  Google's guidelines and risks suspension.
- One profile per real staffed location (each campus/clinic with its own address and hours).
  No virtual offices or PO boxes. Service-area businesses hide the address and set areas.
- Practitioners (individual doctors/dentists) may have their own profile under Google's practitioner
  rules (one per practitioner); the sole public-facing practitioner at a branded practice shares one
  profile named "[brand]: [practitioner]". Departments (a hospital's emergency department, a college's
  admissions office) only when public-facing and distinct, with their own name and category.
  Rules: `thresholds.md` > Local.
- Complete: hours (incl. holidays), phone, website (link to the matching location page with UTM
  `?utm_source=google&utm_medium=organic&utm_campaign=gbp`), services/products, attributes, real photos.
- **Reviews**: ask every real customer/student/patient (a short link/QR); respond to all,
  promptly and specifically. Never buy reviews, gate them (asking only happy customers), or
  offer rewards for them: these violate Google's policies and consumer law in many countries.
- Posts: optional; useful for events (open days, admissions, camps). (Google has been retiring the public Q&A feature since 2025; check current GBP Help before planning around it.)
- Healthcare: never include patient-identifying details in review replies (privacy law).

## 2. NAP consistency
Name, Address, Phone identical everywhere: website footer/contact page, GBP, Bing Places,
Apple Business Connect, major directories, social profiles. Inconsistency splits signals.
Deliverable: `seo/local/nap-audit.md` table (`source | name | address | phone | match?`).
Fix order: website, GBP, Bing Places, Apple, then the top citations for the country/vertical
(e.g. India: Justdial, Sulekha, IndiaMART for B2B, Practo for doctors, Shiksha/Collegedunia for colleges).
Only list on directories real customers use; mass low-quality directory submission has no value.

## 3. Location pages (one per location, not per city you merely serve)
Each page: unique content about that location (address, map embed, hours, phone, parking/
transport, staff/doctors/faculty there, services offered there, photos, local reviews,
FAQs specific to that place), JSON-LD of the most specific matching type (a `LocalBusiness` subtype such as
`Dentist`/`MedicalClinic`, or an `EducationalOrganization` subtype such as `CollegeOrUniversity` for a
campus; see `structured-data.md`), and a
link from the locations hub and the nav/footer. City pages with swapped names and no real
presence are doorway pages (spam policy).

## 4. Vertical notes
**Colleges / schools**: entities to cover: institution, each department/program, admissions
(dates, eligibility, fees, cut-offs, counselling codes), accreditations, placements (year,
source), hostel/transport, campus location. Queries are seasonal (admissions season; the lead time below is a heuristic):
publish and refresh pages 6-8 weeks before peaks. Program pages should target
"<program> in <city/state>", "<college> fees", "<college> cut off", "<college> placements".
Separate GBPs for genuinely separate campuses/institutions.

**Clinics / hospitals / doctors**: one page per doctor (credentials, registration number where
customary, specialties, timings, location) with `IndividualPhysician` markup (`PhysiciansOffice` is the
practice/clinic type); one page per treatment
with honest pricing ranges, recovery facts, and medical review byline (YMYL, see
`content-and-ai-search.md`). Appointment booking must work without login.

**Service-area businesses**: one strong service page per service; area pages only where you
have real jobs/reviews/projects to show there.

## 5. Measure
GBP Performance (calls, direction requests, website clicks, searches); GSC filtered to
location pages; rank checks by searching from the area (results are distance-dependent, so
one desktop check from another city means little). Record monthly in `seo/local/log.md`.

## Verify (site side)
```bash
node <skill>/scripts/seo-check.mjs https://site.com/locations/salem   # LocalBusiness schema valid, NAP in text
node <skill>/scripts/crawl-site.mjs https://site.com --money "^/locations/"  # every location page linked, shallow
```
