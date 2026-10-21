// Read a Keynote KPF HTML export: header.json, per-slide JSON, and assets.
// `base` is the export URL (https://all-docs.talks.charlie.dev/) or a local
// directory that mirrors it. URL fetches go through a cache under
// .cache/kpf/<sha256-12 of base>/ keyed by URL path, so a run is offline after
// the first fetch and two exports never share a cache entry (D-009).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Default cache root: stage/2/kinetic/.cache/kpf (gitignored). */
export const DEFAULT_CACHE_DIR = join(here, '..', '.cache', 'kpf');

/** A browser-like agent. The host answers 403 to Python's default agent; Node's default `node` gets 200. */
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 kinetic-convert/0.0.0';

export const LIVE_BASE = 'https://all-docs.talks.charlie.dev/';

export function isUrl(base) {
  return /^https?:\/\//.test(base);
}

/** URL path of header.json, relative to the export root. */
export function headerPath() {
  return 'assets/header.json';
}

/** URL path of a slide's JSON, relative to the export root. Verified: main.js downloadSlide builds "./assets/"+A+"/"+A+".json". */
export function slidePath(uuid) {
  return `assets/${uuid}/${uuid}.json`;
}

/** URL path of a slide asset. `name` is the asset's url.native (for example "assets/<file>.pdf"). */
export function assetPath(uuid, name) {
  const rel = name.startsWith('assets/') ? name : `assets/${name}`;
  return `assets/${uuid}/${rel}`;
}

/** The cache directory level for a base: the first 12 hex characters of sha256(base). */
export function baseHash(base) {
  return createHash('sha256').update(String(base)).digest('hex').slice(0, 12);
}

/** Where a fetched path is cached: <cacheDir>/<baseHash>/<relPath>. */
export function cachePathFor(base, relPath, cacheDir = DEFAULT_CACHE_DIR) {
  return join(cacheDir, baseHash(base), relPath);
}

function encodePath(relPath) {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

/**
 * Fetch one path under `base`. Returns { bytes: Buffer, file: string, fromCache: boolean }.
 * `file` is a path on disk that holds the bytes (the cache file, or the local file for a directory base).
 */
export async function fetchPath(base, relPath, opts = {}) {
  if (!isUrl(base)) {
    const file = join(base, relPath);
    return { bytes: readFileSync(file), file, fromCache: false };
  }
  const file = cachePathFor(base, relPath, opts.cacheDir || DEFAULT_CACHE_DIR);
  if (existsSync(file) && !opts.refresh) {
    return { bytes: readFileSync(file), file, fromCache: true };
  }
  const url = new URL(encodePath(relPath), base.endsWith('/') ? base : base + '/').href;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } });
  if (res.status !== 200) {
    throw new Error(`kpf fetch ${url} -> HTTP ${res.status}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return { bytes, file, fromCache: false };
}

export async function loadHeader(base, opts) {
  const { bytes } = await fetchPath(base, headerPath(), opts);
  return JSON.parse(bytes.toString('utf8'));
}

export async function loadSlide(base, uuid, opts) {
  const { bytes } = await fetchPath(base, slidePath(uuid), opts);
  return JSON.parse(bytes.toString('utf8'));
}

/** Fetch a slide asset. Returns { bytes, file, fromCache }. */
export async function fetchAsset(base, uuid, name, opts) {
  return fetchPath(base, assetPath(uuid, name), opts);
}

/** Async iterator over [index1, uuid, slideJson] for every slide in header order. */
export async function* eachSlide(base, opts) {
  const header = await loadHeader(base, opts);
  let i = 0;
  for (const uuid of header.slideList) {
    i += 1;
    yield [i, uuid, await loadSlide(base, uuid, opts)];
  }
}
