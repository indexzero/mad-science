// Check that every citation link in public/index.html loads, and that its
// #fragment (if any) names an id on the page, or a line range on GitHub.
//   node scripts/check-citations.mjs
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const list = html.slice(html.indexOf('id="citation-list"'));
const urls = [...list.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
let bad = 0;
for (const url of urls) {
  const [base, fragment] = url.split('#');
  let status = 'ERR';
  let anchor = '';
  try {
    const res = await fetch(base, { redirect: 'follow', headers: { 'user-agent': 'jco-worker-csp citation check' } });
    status = String(res.status);
    if (fragment && !/^L\d+/.test(fragment)) {
      const body = await res.text();
      const ids = [`id="${fragment}"`, `id=${fragment}>`, `id=${fragment} `, `id="user-content-${fragment}"`, `name="${fragment}"`];
      anchor = ids.some((id) => body.includes(id))
        ? ' #ok'
        : ' #MISSING';
    }
  } catch (err) {
    status = `ERR ${err.cause?.code ?? err.message}`;
  }
  if (status !== '200' || anchor.includes('MISSING')) bad += 1;
  console.log(`${status}${anchor}  ${url}`);
}
console.log(`${urls.length} links, ${bad} not reachable or anchor missing`);
