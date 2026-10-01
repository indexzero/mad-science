// Download the primary spec documents listed in specs/sources.json into
// specs/<offering>/, and record each download in specs/MANIFEST.csv.
// Files already in the manifest are kept; pass --refresh to fetch again.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { csvFormat, csvParse } from 'd3';
import { ROOT } from './lib.mjs';

const SPECS = join(ROOT, 'specs');
const MANIFEST = join(SPECS, 'MANIFEST.csv');
const refresh = process.argv.includes('--refresh');

const sources = JSON.parse(readFileSync(join(SPECS, 'sources.json'), 'utf8'));
const manifest = existsSync(MANIFEST) ? csvParse(readFileSync(MANIFEST, 'utf8')) : [];
const done = new Map(manifest.filter((m) => m.status === '200').map((m) => [m.url, m]));

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
function extension(url, type) {
  const ext = extname(new URL(url).pathname);
  if (['.md', '.mdx', '.txt', '.json', '.html', '.pdf', '.yaml', '.proto'].includes(ext)) return ext;
  if (type.includes('pdf')) return '.pdf';
  if (type.includes('json')) return '.json';
  if (type.includes('markdown') || type.includes('text/plain')) return '.md';
  return '.html';
}

const rows = new Map(manifest.map((m) => [m.url, m]));
for (const s of sources) {
  if (!refresh && done.has(s.url) && existsSync(join(ROOT, done.get(s.url).path))) continue;
  let row;
  try {
    const get = (url) => fetch(url, { redirect: 'follow', headers: { 'user-agent': 'oobta-protocols spec archiver' } });
    let res = await get(s.url);
    let body = Buffer.from(await res.arrayBuffer());
    // Static sites redirect with a <meta http-equiv="refresh"> stub.
    const refreshTo = body.length < 4096 && /http-equiv="refresh"[^>]*URL=([^"]+)"/i.exec(body.toString());
    if (refreshTo) {
      res = await get(new URL(refreshTo[1].trim(), res.url).href);
      body = Buffer.from(await res.arrayBuffer());
    }
    const dir = join(SPECS, s.offering);
    const file = `${slug(s.title)}${extension(res.url, res.headers.get('content-type') ?? '')}`;
    if (res.ok) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, file), body);
    }
    row = {
      offering: s.offering,
      title: s.title,
      url: s.url,
      path: res.ok ? `specs/${s.offering}/${file}` : '',
      retrieved_at: new Date().toISOString(),
      status: String(res.status),
      sha256: res.ok ? createHash('sha256').update(body).digest('hex') : '',
      bytes: res.ok ? String(body.length) : '',
    };
  } catch (err) {
    row = { offering: s.offering, title: s.title, url: s.url, path: '', retrieved_at: new Date().toISOString(), status: `error: ${err.message}`, sha256: '', bytes: '' };
  }
  rows.set(s.url, row);
  console.log(`${row.status}  ${row.path || s.url}`);
}

const columns = ['offering', 'title', 'url', 'path', 'retrieved_at', 'status', 'sha256', 'bytes'];
writeFileSync(MANIFEST, `${csvFormat([...rows.values()].sort((a, b) => a.path.localeCompare(b.path)), columns)}\n`);
console.log(`wrote specs/MANIFEST.csv (${rows.size} entries)`);
