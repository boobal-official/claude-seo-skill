// Numeric thresholds used by the scripts. Mirrors references/thresholds.md;
// tests/run-tests.mjs fails if a value here is missing from that file.
export const T = {
  cwv: {
    LCP: { good: 2500, poor: 4000 },
    INP: { good: 200, poor: 500 },
    CLS: { good: 0.1, poor: 0.25 },
    FCP: { good: 1800, poor: 3000 },
    TTFB: { good: 800, poor: 1800 },
    labTbtInpRisk: 600,
  },
  titleMaxChars: 60,
  titleMinChars: 15,
  descriptionMaxChars: 160,
  maxClickDepth: 3,
  minContextualInlinks: 3,
  nearDuplicateSimilarity: 0.85,
  lowTextWords: 150,
  littleTextWords: 50,
  clientRenderedWords: 80,
  clientRenderedScriptBytes: 20000,
  slowResponseMs: 1800,
  googlebotHtmlBytes: 2 * 1024 * 1024,
  robotsMaxBytes: 500 * 1024,
  sitemapMaxUrls: 50000,
  googlebotMaxRedirectHops: 10,
  robotsMaxRedirectHops: 5,
};
// Strings built FROM the values above that must appear in references/thresholds.md. Change a
// number here without updating the doc (or vice versa) and the test suite fails.
const c = T.cwv;
const n = (x) => x.toLocaleString('en-US');
export const DOC_ANCHORS = [
  `<= ${c.LCP.good} ms`, `> ${c.LCP.poor} ms`, `<= ${c.INP.good} ms`, `> ${c.INP.poor} ms`, `<= ${c.CLS.good}`, `> ${c.CLS.poor}`,
  `<= ${c.FCP.good} ms`, `<= ${c.TTFB.good} ms`, `> ${c.TTFB.poor} ms`, `> ${c.labTbtInpRisk} ms`,
  `> ${T.titleMaxChars} characters`, `< ${T.titleMinChars}`, `> ${T.descriptionMaxChars}`,
  `**${T.maxClickDepth}** clicks`, `at least **${T.minContextualInlinks}**`, `**${Math.round(T.nearDuplicateSimilarity * 100)}%**`,
  `**${T.lowTextWords}**`, `< ${T.littleTextWords} words`, `< ${T.clientRenderedWords} words`, `> ${T.clientRenderedScriptBytes / 1000} KB`,
  `> ${T.slowResponseMs} ms`, `first ${T.googlebotHtmlBytes / 1048576} MB`, `${T.robotsMaxBytes / 1024} KiB`, `${n(T.sitemapMaxUrls)} URLs`,
  `up to ${T.googlebotMaxRedirectHops} hops`, `up to ${T.robotsMaxRedirectHops} hops`,
];
