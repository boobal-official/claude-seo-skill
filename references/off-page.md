# Off-page: earning links and mentions within Google's spam policies

Links from relevant, real sites still matter, and mentions in reviews, comparisons, news, and
forums shape what AI assistants say about a brand. Earn them; do not manufacture them.

## Policy line (from Google's spam policies; see `thresholds.md`)
- Buying links that pass PageRank, link exchanges at scale, PBNs, keyword-anchor guest posts at
  scale, and automated link building are link spam. Paid placements must carry
  `rel="sponsored"` (or `nofollow`); such links can still bring traffic and mentions but pass no ranking credit.
- If the user asks to buy dofollow links, explain the policy and the risk (manual action or the
  links being ignored), offer the compliant alternatives below, and let them decide. Never place orders or share checkout links.
- Third-party authority scores (DR, DA, AS) are vendor estimates, not Google metrics. Judge a
  link by relevance, real traffic, and editorial context.

## What works (in order of usual return for small teams)
1. **Fix your own link equity first**: redirect old URLs that still have backlinks (GSC Links report, `migrations.md`), fix broken internal links.
2. **Unlinked mentions**: search `"Brand Name" -site:yourdomain.com`; ask authors who mention you to add the link (one polite, specific request).
3. **Assets people cite**: original data (surveys, benchmarks, placement/admission statistics with sources), free tools/calculators, templates, clear explainers with diagrams. Then tell the people who write about that topic.
4. **Digital PR / journalist requests**: answer reporter queries on journalist-request platforms (several have free tiers; never pay for placement) with genuine expertise.
5. **Partners and real relationships**: suppliers, customers, universities, associations, event sponsors, alumni, recruiters listing you on their sites (sponsorship links get `sponsored`).
6. **Relevant directories and listings**: the ones real customers use in the vertical/country (see `local-seo.md`), plus software/tool directories for SaaS. Skip mass directory blasts.
7. **Broken link building**: find dead pages on relevant sites that pointed to a resource you now have; suggest yours as the replacement.
8. **Community**: helpful answers on Reddit/Quora/forums/Stack Overflow where the question is real; disclose affiliation; links only when they are the best answer. Many communities ban self-promotion; follow each one's rules.
9. **Syndication**: republish on Medium/Dev.to/LinkedIn with a canonical link back (or a clear "originally published at"). Hosting third-party content on your domain mainly to rank it is site reputation abuse.

## Outreach rules (drafts only; the owner sends)
- One named person, about one specific page of theirs, with one specific reason the link helps their readers.
- Ask in the first two lines; length per `thresholds.md`; no fake familiarity; no link swaps; no "guest post" templates.
- Personalize line 1 from their actual content; vary structure across emails.
- Track in `seo/outreach/tracker.csv` (`site,page,contact,angle,status,date`).
- Never send email, submit forms, or create accounts on the user's behalf.

## Disavow
Rarely needed. Use the disavow tool only for a manual action for unnatural links, or a clear
paid/spam link scheme you were part of. Random spammy links are ignored by Google; disavowing them does nothing useful and can hurt if done broadly.

## Measure
GSC > Links (top linking sites and pages, free). Record referring domains to money pages in the
monthly report (`seo/reports/`). A paid backlink tool adds coverage only if the user already has one.
