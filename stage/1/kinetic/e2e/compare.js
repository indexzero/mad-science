// Capture comparison helpers: decode PNGs, mask video boxes, run pixelmatch, write the capture set.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { cubicBezier } from '../player/effects.js';

export const here = dirname(fileURLToPath(import.meta.url));
export const CAPTURES = join(here, 'captures');
export const DECK = JSON.parse(readFileSync(join(here, '..', 'decks', '_all_docs', 'deck.json'), 'utf8'));
export const TOLERANCE = JSON.parse(readFileSync(join(here, 'tolerance.json'), 'utf8'));
export const THRESHOLD = 0.1;

export function slideByIndex(n) {
  return DECK.slides.find((s) => s.index === n);
}

/** Video boxes of a slide scaled to the capture size, clamped to the frame. */
export function videoMasks(n, width, height) {
  const slide = slideByIndex(n);
  const sx = width / DECK.width;
  const sy = height / DECK.height;
  return slide.elements
    .filter((e) => e.kind === 'video')
    .map((e) => {
      const x0 = Math.max(0, Math.floor(e.box.x * sx));
      const y0 = Math.max(0, Math.floor(e.box.y * sy));
      const x1 = Math.min(width, Math.ceil((e.box.x + e.box.w) * sx));
      const y1 = Math.min(height, Math.ceil((e.box.y + e.box.h) * sy));
      return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), id: e.id, poster: e.poster };
    });
}

export function decode(buf) {
  return PNG.sync.read(buf);
}

function paint(png, masks) {
  for (const m of masks) {
    for (let y = m.y; y < m.y + m.h; y++) {
      for (let x = m.x; x < m.x + m.w; x++) {
        const i = (y * png.width + x) * 4;
        png.data[i] = 0;
        png.data[i + 1] = 0;
        png.data[i + 2] = 0;
        png.data[i + 3] = 255;
      }
    }
  }
}

function cropPng(png, m) {
  const out = new PNG({ width: m.w, height: m.h });
  for (let y = 0; y < m.h; y++) {
    const src = ((m.y + y) * png.width + m.x) * 4;
    png.data.copy(out.data, y * m.w * 4, src, src + m.w * 4);
  }
  return out;
}

/**
 * Compare a live and a new capture. Writes <name>.{live,new,diff}.png under e2e/captures. Returns
 * { ratio, mismatched, unmasked, masked, regions: [{ id, ratio }] } where `ratio` is mismatched pixels over
 * unmasked pixels (0 when nothing is unmasked, flagged `vacuous`) and `regions` compares each masked box
 * between the two sides (recorded against tolerance.videoRegion, never asserted).
 */
export function compareCaptures(name, liveBuf, newBuf, masks = []) {
  mkdirSync(CAPTURES, { recursive: true });
  const live = decode(liveBuf);
  const fresh = decode(newBuf);
  if (live.width !== fresh.width || live.height !== fresh.height) throw new Error(`size mismatch ${live.width}x${live.height} vs ${fresh.width}x${fresh.height}`);
  const { width, height } = live;
  const regions = masks.map((m) => {
    if (!m.w || !m.h) return { id: m.id, ratio: 0 };
    const a = cropPng(live, m);
    const b = cropPng(fresh, m);
    const d = new PNG({ width: m.w, height: m.h });
    const mism = pixelmatch(a.data, b.data, d.data, m.w, m.h, { threshold: THRESHOLD });
    return { id: m.id, ratio: mism / (m.w * m.h), pixels: m.w * m.h };
  });
  writeFileSync(join(CAPTURES, `${name}.live.png`), liveBuf);
  writeFileSync(join(CAPTURES, `${name}.new.png`), newBuf);
  paint(live, masks);
  paint(fresh, masks);
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(live.data, fresh.data, diff.data, width, height, { threshold: THRESHOLD });
  const masked = masks.reduce((n, m) => n + m.w * m.h, 0);
  const unmasked = width * height - masked;
  writeFileSync(join(CAPTURES, `${name}.diff.png`), PNG.sync.write(diff));
  const ratio = unmasked > 0 ? mismatched / unmasked : 0;
  const result = { name, ratio, mismatched, unmasked, masked, vacuous: unmasked === 0, regions };
  writeFileSync(join(CAPTURES, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
  return result;
}

export function toleranceFor(name) {
  const o = TOLERANCE.captures?.[name];
  if (o && typeof o.tolerance === 'number') return o.tolerance;
  return TOLERANCE.default;
}

/**
 * Where the outgoing slide ends in a push-left frame: the first lit column scanning rows `rows` from the
 * left (the outgoing slide's top band is black on slide 1). Returns the median column, or null.
 */
export function pushBoundary(png, rows = [8, 16, 24, 32, 40, 48], lit = 60) {
  const cols = [];
  for (const y of rows) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i] + png.data[i + 1] + png.data[i + 2] > lit) { cols.push(x); break; }
    }
  }
  if (!cols.length) return null;
  cols.sort((a, b) => a - b);
  return cols[Math.floor(cols.length / 2)];
}

export const EASE_PUSH = cubicBezier(0.4970587193965912, 0, 0.4981173276901245, 0.9959721565246582);

/** The raw (pre-easing) progress whose eased value is `eased`. */
export function rawProgress(eased) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (EASE_PUSH(mid) < eased) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Merge extra recorded numbers into <name>.json. */
export function recordExtra(name, extra) {
  const file = join(CAPTURES, `${name}.json`);
  const cur = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...cur, ...extra }, null, 2) + '\n');
}
