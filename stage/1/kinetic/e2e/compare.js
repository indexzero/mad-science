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

/**
 * The number of pixels the boxes cover in a `width` x `height` frame, each pixel counted once. Boxes may
 * overlap (slide 64 places five videos whose boxes overlap), so this is the area of their union, never
 * the sum of their areas. Boxes are clamped to the frame.
 */
export function maskedPixels(masks, width, height) {
  const covered = new Uint8Array(width * height);
  let n = 0;
  for (const m of masks) {
    const x0 = Math.max(0, m.x);
    const y0 = Math.max(0, m.y);
    const x1 = Math.min(width, m.x + m.w);
    const y1 = Math.min(height, m.y + m.h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * width + x;
        if (!covered[p]) { covered[p] = 1; n += 1; }
      }
    }
  }
  return n;
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
  const masked = maskedPixels(masks, width, height);
  const unmasked = width * height - masked;
  writeFileSync(join(CAPTURES, `${name}.diff.png`), PNG.sync.write(diff));
  const ratio = unmasked > 0 ? mismatched / unmasked : 0;
  const result = { name, ratio, mismatched, unmasked, masked, vacuous: unmasked === 0, regions };
  writeFileSync(join(CAPTURES, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
  return result;
}

/**
 * The pixels that move on either side: a Uint8Array (1 per moving pixel) over `width` x `height`, from two
 * or more frames per side taken at the same build state. A pixel moves when pixelmatch flags it between
 * any two consecutive frames of one side. The mask is dilated by `dilate` pixels so the fringe of a moving
 * region is masked too. Used where a video box covers the frame: the GIF phase cannot be aligned between
 * the two players, so the moving pixels are excluded and the still content is compared.
 */
export function animatedMask(liveFrames, newFrames, width, height, dilate = 2) {
  const mask = new Uint8Array(width * height);
  for (const frames of [liveFrames, newFrames]) {
    for (let i = 1; i < frames.length; i++) {
      const a = decode(frames[i - 1]);
      const b = decode(frames[i]);
      const d = new PNG({ width, height });
      pixelmatch(a.data, b.data, d.data, width, height, { threshold: THRESHOLD, diffMask: true });
      for (let p = 0; p < width * height; p++) if (d.data[p * 4 + 3] > 0) mask[p] = 1;
    }
  }
  if (!dilate) return mask;
  const out = new Uint8Array(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -dilate; dy <= dilate; dy++) {
        for (let dx = -dilate; dx <= dilate; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < height && xx >= 0 && xx < width) out[yy * width + xx] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * Compare a live and a new capture with a per-pixel mask (1 masks the pixel out on both sides). Writes the
 * capture set like compareCaptures. Returns { ratio, mismatched, unmasked, masked, vacuous }.
 */
export function compareCapturesMasked(name, liveBuf, newBuf, pixelMask) {
  mkdirSync(CAPTURES, { recursive: true });
  const live = decode(liveBuf);
  const fresh = decode(newBuf);
  const { width, height } = live;
  let masked = 0;
  for (let p = 0; p < width * height; p++) {
    if (!pixelMask[p]) continue;
    masked += 1;
    const i = p * 4;
    live.data[i] = fresh.data[i] = 0;
    live.data[i + 1] = fresh.data[i + 1] = 0;
    live.data[i + 2] = fresh.data[i + 2] = 0;
    live.data[i + 3] = fresh.data[i + 3] = 255;
  }
  writeFileSync(join(CAPTURES, `${name}.live.png`), liveBuf);
  writeFileSync(join(CAPTURES, `${name}.new.png`), newBuf);
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(live.data, fresh.data, diff.data, width, height, { threshold: THRESHOLD });
  const unmasked = width * height - masked;
  writeFileSync(join(CAPTURES, `${name}.diff.png`), PNG.sync.write(diff));
  const ratio = unmasked > 0 ? mismatched / unmasked : 0;
  const result = { name, ratio, mismatched, unmasked, masked, vacuous: unmasked === 0, regions: [] };
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
