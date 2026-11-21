// Local test sites for the seo scripts (each export builds a request handler for a given port).
//   BROKEN: every page plants at least one known defect (see DEFECTS in run-tests.mjs)
//   CLEAN:  a healthy site that must produce no FATAL/HIGH findings
import http from 'node:http';

const page = (o, { title, desc, canonical, body, head = '', viewport = true, lang = 'en', h1 = true, blog = '/blog/post-a' }) => `<!doctype html>
<html${lang ? ` lang="${lang}"` : ''}><head><meta charset="utf-8">
${viewport ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}
${title !== undefined ? `<title>${title}</title>` : ''}
${desc ? `<meta name="description" content="${desc}">` : ''}
${canonical ? `<link rel="canonical" href="${o}${canonical}">` : ''}
<meta property="og:title" content="${title || ''}"><meta property="og:image" content="${o}/og.png">
${head}</head><body>
<header><nav><a href="/">Home</a> <a href="/pricing">Pricing</a> <a href="${blog}">Blog</a></nav></header>
<main>${h1 ? `<h1>${title || 'Page'}</h1>` : ''}${body}</main>
<footer><a href="/about">About</a></footer></body></html>`;

const lorem = (n, seed = '') =>
  Array.from({ length: n }, (_, i) => `${seed}word${(i * 7) % 97} detail${(i * 13) % 89} topic${i % 31}`).join(' ');

export function brokenSite(port) {
  const o = `http://127.0.0.1:${port}`;
  const routes = {
    '/robots.txt': () => [200, 'text/plain', `User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\nDisallow: /_next/\nNoindex: /tmp/\n\nSitemap: ${o}/sitemap.xml\n`],
    '/sitemap.xml': () => [200, 'application/xml', `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/pricing', '/blog/post-a', '/blog/post-b', '/blog/post-c', '/landing', '/old-page', '/product', '/hreflang-en', '/city/alpha', '/city/beta', '/body-canonical', '/orphan', '/deep/1', '/deep/5'].map((p) => `<url><loc>${o}${p}</loc><lastmod>2026-01-01</lastmod></url>`).join('')}</urlset>`],
    '/': () => [200, 'text/html', page(o, { title: 'Home', canonical: '/', viewport: false, body: `<p>${lorem(60)}</p><p><a href="/blog/post-a">Read the guide</a> <a href="/missing">Broken</a> <a href="/old-page">Old</a> <a href="/product">Product</a> <a href="/hreflang-en">EN</a> <a href="/city/alpha">Alpha</a> <a href="/city/beta">Beta</a> <a href="/body-canonical">BC</a> <a href="/deep/1">Deep</a> <a href="/landing">Landing</a> <a href="/blog/post-b">B</a> <a href="/no-title">NT</a></p>` })],
    '/pricing': () => [200, 'text/html', page(o, { title: 'Pricing plans for teams', desc: 'Plans', canonical: '/pricing', h1: false, body: `<div id="root"></div><script>${'var x=1;'.repeat(4000)}document.getElementById('root').innerHTML='$29 per month'</script>` })],
    '/blog/post-a': () => [200, 'text/html', page(o, { title: 'Duplicate blog title here', desc: 'A', canonical: '/blog/post-b', body: `<p>${lorem(80)}</p>` })],
    '/blog/post-b': () => [200, 'text/html', page(o, { title: 'Duplicate blog title here', canonical: '/blog/post-b', h1: false, body: `<p>${lorem(80, 'b')}</p><img src="/x.png"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article", headline: broken}</script>` })],
    '/blog/post-c': () => [200, 'text/html', page(o, { title: 'Post C about noindex', canonical: '/blog/post-c', head: '<meta name="robots" content="noindex">', body: `<p>${lorem(80, 'c')}</p>` })],
    '/landing': () => [200, 'text/html', page(o, { title: 'Landing page with header noindex', canonical: '/landing', body: `<p>${lorem(80, 'l')}</p>` }), { 'x-robots-tag': 'noindex' }],
    '/old-page': () => [301, null, null, { location: '/older-page' }],
    '/older-page': () => [301, null, null, { location: '/new-page' }],
    '/moved': () => [301, null, null, { location: '/new-page' }],
    '/new-page': () => [200, 'text/html', page(o, { title: 'New page destination', canonical: '/new-page', body: `<p>${lorem(80, 'n')}</p>` })],
    '/product': () => [200, 'text/html', page(o, { title: 'Widget product page', canonical: '/product', body: `<p>${lorem(80, 'p')}</p><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Widget', image: 'x', offers: { '@type': 'Offer', price: '29' } })}</script><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Gadget' })}</script>` })],
    '/hreflang-en': () => [200, 'text/html', page(o, { title: 'English version page', canonical: '/hreflang-en', head: `<link rel="alternate" hreflang="en-UK" href="${o}/hreflang-en"><link rel="alternate" hreflang="fr" href="${o}/hreflang-fr">`, body: `<p>${lorem(80, 'e')}</p>` })],
    '/hreflang-fr': () => [200, 'text/html', page(o, { title: 'Version francaise page', canonical: '/hreflang-fr', body: `<p>${lorem(80, 'f')}</p>` })],
    '/city/alpha': () => [200, 'text/html', page(o, { title: 'Plumbers in Alpha', canonical: '/city/alpha', body: `<p>Alpha ${lorem(120, 't')}</p>` })],
    '/city/beta': () => [200, 'text/html', page(o, { title: 'Plumbers in Beta', canonical: '/city/beta', body: `<p>Beta ${lorem(120, 't')}</p>` })],
    '/body-canonical': () => [200, 'text/html', page(o, { title: 'Canonical in body page', body: `<link rel="canonical" href="${o}/body-canonical"><p>${lorem(80, 'k')}</p>` })],
    '/orphan': () => [200, 'text/html', page(o, { title: 'About the company', canonical: '/orphan', body: `<p>${lorem(80, 'o')}</p>` })],
    '/about': () => [200, 'text/html', page(o, { title: 'About the company', canonical: '/about', body: `<p>${lorem(80, 'ab')}</p>` })],
    '/missing': () => [404, 'text/html', 'not here'],
    '/no-title': () => [200, 'text/html', page(o, { title: undefined, canonical: '/no-title', body: `<p>${lorem(80, 'nt')}</p>` })],
  };
  for (let i = 1; i <= 5; i++) {
    routes[`/deep/${i}`] = () => [200, 'text/html', page(o, { title: `Deep page level ${i}`, canonical: `/deep/${i}`, body: `<p>${lorem(80, 'd' + i)}</p>${i < 5 ? `<p><a href="/deep/${i + 1}">next level</a></p>` : ''}` })];
  }
  return (req, res) => {
    const path = new URL(req.url, o).pathname;
    const ua = req.headers['user-agent'] || '';
    if (/GPTBot|OAI-SearchBot/i.test(ua)) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end('blocked'); }
    const r = routes[path];
    // Soft 404: unknown paths render the homepage with 200.
    const [status, type, body, extra = {}] = r ? r() : routes['/']();
    res.writeHead(status, { ...(type ? { 'content-type': `${type}; charset=utf-8` } : {}), ...extra });
    res.end(body ?? '');
  };
}

export function cleanSite(port) {
  const o = `http://127.0.0.1:${port}`;
  const text = (s, seed) => `<p>${s} ${lorem(70, seed)}</p>`;
  const routes = {
    '/robots.txt': () => [200, 'text/plain', `User-agent: *\nAllow: /\nDisallow: /api/\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: ${o}/sitemap.xml\n`],
    '/sitemap.xml': () => [200, 'application/xml', `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${o}/</loc><lastmod>2026-10-01</lastmod></url><url><loc>${o}/pricing</loc><lastmod>2026-09-12</lastmod></url><url><loc>${o}/blog/guide</loc><lastmod>2026-08-03</lastmod></url><url><loc>${o}/about</loc><lastmod>2026-05-20</lastmod></url></urlset>`],
    '/': () => [200, 'text/html', page(o, { blog: '/blog/guide', title: 'Family Dentist in Salem | Bright Smile Clinic', desc: 'Same-day dental appointments in Salem with digital X-rays and upfront prices.', canonical: '/', head: `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Dentist', name: 'Bright Smile Clinic', address: { '@type': 'PostalAddress', streetAddress: '1 Main Rd', addressLocality: 'Salem', postalCode: '636001', addressCountry: 'IN' }, telephone: '+91-0000000000', url: `${o}/` })}</script>`, body: text('Welcome.', 'h') + '<p><a href="/pricing">see our treatment prices</a> and <a href="/blog/guide">read the root canal guide</a> or <a href="/about">meet the dentists</a>.</p>' })],
    '/pricing': () => [200, 'text/html', page(o, { blog: '/blog/guide', title: 'Dental Treatment Prices in Salem', desc: 'Cleaning from ₹800, fillings from ₹1,500, root canal from ₹6,000.', canonical: '/pricing', body: text('Cleaning costs ₹800. Fillings ₹1,500.', 'pr') + '<p><a href="/blog/guide">root canal recovery guide</a> <a href="/about">our dentists</a> <a href="/">clinic home</a></p>' })],
    '/blog/guide': () => [200, 'text/html', page(o, { blog: '/blog/guide', title: 'Root Canal Recovery: What to Expect', desc: 'A dentist explains root canal recovery day by day.', canonical: '/blog/guide', head: `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Root Canal Recovery', image: `${o}/rc.png`, datePublished: '2026-08-03', dateModified: '2026-08-03', author: { '@type': 'Person', name: 'Dr. A', url: `${o}/about` } })}</script>`, body: text('Recovery takes 2-3 days.', 'g') + '<p><a href="/pricing">root canal price in Salem</a> <a href="/about">about Dr. A</a> <a href="/">clinic home page</a></p>' })],
    '/about': () => [200, 'text/html', page(o, { blog: '/blog/guide', title: 'About Our Dentists | Bright Smile Clinic', desc: 'Meet the dentists at Bright Smile Clinic, Salem.', canonical: '/about', body: text('We are dentists.', 'ab') + '<p><a href="/pricing">treatment prices</a> <a href="/blog/guide">recovery guide</a> <a href="/">home</a></p>' })],
  };
  return (req, res) => {
    const path = new URL(req.url, o).pathname;
    const r = routes[path];
    const [status, type, body, extra = {}] = r ? r() : [404, 'text/html', '<!doctype html><title>Not found</title><h1>Not found</h1>'];
    res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, ...extra });
    res.end(body);
  };
}

// Starts a handler factory on an ephemeral port; resolves to { server, origin }.
export function serve(factory) {
  return new Promise((resolve) => {
    let handler = null;
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      handler = factory(port);
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

// Edge cases from the v1 code review: each route reproduces a bug that once crashed a tool
// or produced a false FATAL/HIGH. Healthy pages must stay clean; broken ones must not crash.
export function edgeSite(port) {
  const o = `http://127.0.0.1:${port}`;
  const ok = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="A healthy page used for regression tests of the seo scripts."><link rel="canonical" href="${o}PATH"><meta property="og:title" content="${title}"><meta property="og:image" content="${o}/og.png">${head}</head><body><main><h1>${title}</h1><p>${'Regression fixture text with enough words to look like a real page. '.repeat(12)}</p>${body}<p><a href="/">home page link</a></p></main></body></html>`;
  const pages = {
    '/imgnone': () => ok('Image preview none page', '', '<meta name="robots" content="index, follow, max-image-preview:none, max-snippet:-1">'),
    '/scoped-xrobots': () => ok('Scoped X-Robots-Tag page', ''),
    '/entity': () => ok('Bad entity &#99999999; page title', '<p>broken &#99999999; entity</p>'),
    '/base-href': () => ok('Base href page example', '<a href="about-us">about</a> <a href="./">root</a>', '<base href="/">'),
    '/cdata': () => ok('CDATA JSON-LD page', '', `<script type="application/ld+json">//<![CDATA[
${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'X', url: o })}
//]]></script><script type="application/ld+json">/* <![CDATA[ */${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'X', url: o })}/* ]]> */</script>`),
    '/title-in-script': () => ok('Real title is long enough here', '', "<script>var t='<title>Injected</title>'; document.write('<body>')</script>"),
    '/custom-element': () => ok('Custom element page example', '<link-preview rel="canonical" href="https://other.example/"></link-preview>'),
    '/commented-jsonld': () => ok('Commented JSON-LD page', '<!-- <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Old"}</script> -->'),
    '/hreflang-nohref': () => ok('Hreflang without href page', '', '<link rel="alternate" hreflang="fr">'),
    '/next-streamed': () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/_next/static/css/a.css"></head><body><main><h1>Streamed metadata page</h1><p>${'Next.js streamed metadata fixture text for regression tests. '.repeat(12)}</p><a href="/">home page link</a></main><title>Streamed metadata page title</title><meta name="description" content="Streamed description for the regression test page."><link rel="canonical" href="${o}/next-streamed"><script>self.__next_f.push([1,""])</script></body></html>`,
    '/plain-body-canonical': () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Plain body canonical page</title></head><body><link rel="canonical" href="${o}/plain-body-canonical"><main><h1>Plain</h1><p>${'Plain text. '.repeat(40)}</p><a href="/">home</a></main></body></html>`,
    '/huge': () => ok('Huge HTML page example', `<p>${'x'.repeat(2_300_000)}</p>`),
    '/preview-canonical': () => ok('Preview canonical page', '').replace(`${o}PATH`, 'https://my-app-git-main-acme.vercel.app/preview-canonical'),
    '/': () => ok('Edge fixture home page', '<a href="/imgnone">a</a> <a href="/entity">b</a> <a href="/base-href">c</a>'),
  };
  return (req, res) => {
    const path = new URL(req.url, o).pathname;
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: Bingbot
Crawl-delay: 5
User-agent: Googlebot
Disallow: /secret

User-agent: *
Allow: /
`); }
    if (path === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc><![CDATA[${o}/]]></loc></url><url><loc>${o}/imgnone</loc></url></urlset>`); }
    if (path === '/stall') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<html>'); return; } // never ends
    if (path === '/reset') { res.writeHead(200, { 'content-type': 'text/html', 'content-length': '100000' }); res.write('<html>'); return setTimeout(() => res.socket.destroy(), 50); }
    if (path === '/bad-location') { res.writeHead(301, { location: 'http://exa mple.com/x' }); return res.end(); }
    if (path === '/204') { res.writeHead(204); return res.end(); }
    if (path === '/cp1252') { res.writeHead(200, { 'content-type': 'text/html; charset=windows-1252' }); return res.end(Buffer.from(ok('Café menu page title here', '').replace('PATH', '/cp1252'), 'latin1')); }
    if (path === '/og.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47])); }
    if (path === '/about-us') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(ok('About us page example', '').replace('PATH', '/about-us')); }
    const f = pages[path];
    if (!f) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Not found</title>'); }
    const headers = { 'content-type': 'text/html; charset=utf-8' };
    if (path === '/scoped-xrobots') headers['x-robots-tag'] = 'otherbot: noindex, nofollow';
    res.writeHead(200, headers);
    res.end(f().replace(`${o}PATH`, `${o}${path === '/' ? '/' : path}`));
  };
}
