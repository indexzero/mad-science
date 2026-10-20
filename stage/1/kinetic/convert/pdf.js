// mutool wrapper and SVG glyph model. Discovery part (checkpoint 1), elements part (checkpoint 2).
// pageToSvg: `mutool draw -F svg -O text=path -o out.svg in.pdf <page+1>`, one page per file.
// parseSvg: reads the four element kinds the design names. `<path id="font_*" d>` in <defs>
// is a glyph outline in em units. `<use xlink:href="#font_*" data-text transform="matrix(s,0,0,-s,tx,ty)" fill>`
// is one glyph placement. `<path>` in the body without an id is a rectangle or rule. `<image>` is a raster.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { multiply, apply, pageMatrix, roundBox } from './layout.js';

export const MUTOOL = process.env.MUTOOL || 'mutool';

/** Render page `pageIndex` (0-based) of `pdfPath` to `outPath` as SVG with text as paths. Returns outPath. */
export function pageToSvg(pdfPath, pageIndex, outPath) {
  execFileSync(MUTOOL, ['draw', '-F', 'svg', '-O', 'text=path', '-o', outPath, pdfPath, String(pageIndex + 1)], { stdio: ['ignore', 'ignore', 'pipe'] });
  return outPath;
}

/** Page count of a PDF through `mutool info`. */
export function pageCount(pdfPath) {
  const out = execFileSync(MUTOOL, ['info', pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const m = /^Pages:\s+(\d+)/m.exec(out);
  if (!m) throw new Error(`mutool info: no page count for ${pdfPath}`);
  return Number(m[1]);
}

const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
const ATTR_RE = /([\w:-]+)="([^"]*)"/g;

function attrs(raw) {
  const o = {};
  for (const m of raw.matchAll(ATTR_RE)) o[m[1]] = m[2];
  return o;
}

/** Parse `matrix(a,b,c,d,e,f)`. Returns the six numbers or null. */
export function parseMatrix(transform) {
  const m = /matrix\(([^)]*)\)/.exec(transform || '');
  if (!m) return null;
  const v = m[1].split(/[\s,]+/).filter(Boolean).map(Number);
  return v.length === 6 && v.every(Number.isFinite) ? v : null;
}

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
}

/**
 * Parse a mutool SVG. Returns
 * { width, height, defs: Map<id, d>, uses: [{ href, text, s, tx, ty, fill, matrix }], bodyPaths: [{ d, fill, transform }], images: [{ width, height, transform }], clipPaths, groups }.
 */
export function parseSvg(svgText) {
  const defs = new Map();
  const uses = [];
  const bodyPaths = [];
  const images = [];
  let clipPaths = 0;
  let groups = 0;
  let inDefs = false;
  let inClipPath = false;
  let width = null;
  let height = null;

  for (const m of svgText.matchAll(TAG_RE)) {
    const closing = m[1] === '/';
    const name = m[2];
    const a = closing ? {} : attrs(m[3]);
    if (name === 'svg' && !closing) {
      width = Number(a.width);
      height = Number(a.height);
    } else if (name === 'defs') {
      inDefs = !closing;
    } else if (name === 'clipPath') {
      if (!closing) clipPaths += 1;
      inClipPath = !closing;
    } else if (name === 'g') {
      if (!closing) groups += 1;
    } else if (name === 'path' && !closing) {
      if (a.id) {
        defs.set(a.id, a.d || '');
      } else if (!inDefs && !inClipPath) {
        bodyPaths.push({
          d: a.d || '',
          fill: a.fill ?? null,
          fillOpacity: a['fill-opacity'] !== undefined ? Number(a['fill-opacity']) : null,
          stroke: a.stroke ?? null,
          strokeWidth: a['stroke-width'] !== undefined ? Number(a['stroke-width']) : null,
          transform: a.transform ?? null,
          matrix: parseMatrix(a.transform),
        });
      }
    } else if (name === 'use' && !closing) {
      const href = a['xlink:href'] || a.href || '';
      const matrix = parseMatrix(a.transform);
      uses.push({
        href: href.replace(/^#/, ''),
        text: a['data-text'] !== undefined ? decodeEntities(a['data-text']) : null,
        s: matrix ? Math.abs(matrix[0]) : null,
        tx: matrix ? matrix[4] : null,
        ty: matrix ? matrix[5] : null,
        fill: a.fill ?? null,
        matrix,
      });
    } else if (name === 'image' && !closing) {
      images.push({ width: Number(a.width), height: Number(a.height), transform: a.transform ?? null, matrix: parseMatrix(a.transform) });
    }
  }
  return { width, height, defs, uses, bodyPaths, images, clipPaths, groups };
}

/** Glyph defs only (ids that start with `font_`). */
export function glyphDefs(parsed) {
  return [...parsed.defs.keys()].filter((id) => id.startsWith('font_'));
}

/**
 * Split placements into words. A `data-text=" "` placement separates words. Where no space glyph
 * is emitted, an x gap wider than `gapEm` times the font size on one baseline splits. A baseline
 * change beyond `baselineEm` times the font size always splits. Returns [{ text, uses }].
 */
export function wordsFromUses(uses, { gapEm = 0.3, baselineEm = 0.1 } = {}) {
  const words = [];
  let current = null;
  let prev = null;
  const flush = () => {
    if (current && current.uses.length) words.push(current);
    current = null;
  };
  for (const u of uses) {
    if (u.text === ' ' || u.text === ' ') {
      flush();
      prev = u;
      continue;
    }
    if (current && prev && prev.text !== ' ' && prev.text !== ' ') {
      const size = u.s || prev.s || 1;
      const baselineMoved = Math.abs((u.ty ?? 0) - (prev.ty ?? 0)) > baselineEm * size;
      const prevAdvance = prev.s ? advanceOf(prev) : 0;
      const gap = (u.tx ?? 0) - ((prev.tx ?? 0) + prevAdvance);
      if (baselineMoved || gap > gapEm * size) flush();
    }
    if (!current) current = { text: '', uses: [] };
    current.text += u.text ?? '';
    current.uses.push(u);
    prev = u;
  }
  flush();
  return words;
}

/** Advance estimate of a placement: the right edge of the glyph's ink in em units (from its def), else 0.5 em. */
function advanceOf(u) {
  return (u.advance ?? 0.5) * (u.s || 1);
}

const NUM_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/** Bounding box of an SVG path `d` in its own units. mutool writes absolute commands only. Returns { minX, maxX, minY, maxY } or null. */
export function pathBox(d) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const seg of d.matchAll(/([MLCQHVZmlcqhvz])([^MLCQHVZmlcqhvz]*)/g)) {
    const cmd = seg[1].toUpperCase();
    const nums = (seg[2].match(NUM_RE) || []).map(Number);
    if (cmd === 'Z') continue;
    if (cmd === 'H') { for (const x of nums) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); } continue; }
    if (cmd === 'V') { for (const y of nums) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); } continue; }
    for (let i = 0; i + 1 < nums.length; i += 2) {
      minX = Math.min(minX, nums[i]); maxX = Math.max(maxX, nums[i]);
      minY = Math.min(minY, nums[i + 1]); maxY = Math.max(maxY, nums[i + 1]);
    }
  }
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}

/** Attach `advance` (em units, the ink right edge of the def) to every placement that has a def. Returns uses. */
export function withAdvances(parsed) {
  const cache = new Map();
  for (const u of parsed.uses) {
    if (!parsed.defs.has(u.href)) continue;
    if (!cache.has(u.href)) {
      const box = pathBox(parsed.defs.get(u.href));
      cache.set(u.href, box ? box.maxX : null);
    }
    const adv = cache.get(u.href);
    if (adv !== null) u.advance = adv;
  }
  return parsed.uses;
}

/** Convenience: pageToSvg then parseSvg. Returns the parsed model plus `svgPath`. */
export function parsePage(pdfPath, pageIndex, outPath) {
  pageToSvg(pdfPath, pageIndex, outPath);
  const parsed = parseSvg(readFileSync(outPath, 'utf8'));
  withAdvances(parsed);
  return { ...parsed, svgPath: outPath };
}

// ---------- checkpoint 2: path transforms and elements ----------

const CMD_RE = /([MLCQHVZmlcqhvz])([^MLCQHVZmlcqhvz]*)/g;
const ARITY = { M: 2, L: 2, C: 6, Q: 4, H: 1, V: 1, Z: 0 };
const r2 = (v) => {
  const n = Math.round(v * 100) / 100;
  return Object.is(n, -0) ? 0 : n;
};

/**
 * Apply an affine matrix to an absolute SVG path `d` (mutool writes absolute commands only; implicit
 * repetition is honoured, and M followed by extra pairs means L). H and V become L. Returns a compact `d`
 * with two decimals. Throws on a relative or arc command.
 */
export function transformPath(d, m) {
  const out = [];
  let cx = 0;
  let cy = 0;
  for (const seg of d.matchAll(CMD_RE)) {
    const cmd = seg[1];
    if (cmd !== cmd.toUpperCase()) throw new Error(`transformPath: relative command ${cmd} is not supported`);
    const nums = (seg[2].match(NUM_RE) || []).map(Number);
    if (cmd === 'Z') {
      out.push('Z');
      continue;
    }
    const n = ARITY[cmd];
    let first = true;
    for (let i = 0; i + n <= nums.length; i += n) {
      let op = cmd;
      let pts;
      if (cmd === 'H') {
        cx = nums[i];
        pts = [cx, cy];
        op = 'L';
      } else if (cmd === 'V') {
        cy = nums[i];
        pts = [cx, cy];
        op = 'L';
      } else {
        pts = nums.slice(i, i + n);
        cx = pts[n - 2];
        cy = pts[n - 1];
        if (cmd === 'M' && !first) op = 'L';
      }
      const mapped = [];
      for (let k = 0; k < pts.length; k += 2) {
        const [x, y] = apply(m, pts[k], pts[k + 1]);
        mapped.push(r2(x), r2(y));
      }
      out.push(op + mapped.join(' '));
      first = false;
    }
  }
  return out.join('');
}

function unionBox(boxes) {
  const bs = boxes.filter(Boolean);
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  const x2 = Math.max(...bs.map((b) => b.x + b.w));
  const y2 = Math.max(...bs.map((b) => b.y + b.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

function boxFromPath(d) {
  const b = pathBox(d);
  return b ? roundBox({ x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY }) : null;
}

function mostCommon(values, fallback) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = fallback;
  let n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}

/** SVG default fill is black; mutool omits the attribute for black. */
export const DEFAULT_FILL = '#000000';

/**
 * Turn a parsed page into element content in slide coordinates. `leaf` is a composed leaf from
 * layout.js (matrix, width, height, contentsRect). Returns one of:
 *   { kind: 'text', box, words, fill, text, shapes, images }   when the page has glyph placements
 *   { kind: 'picture', images, singleStream }                   when it has images and no placements
 *   { kind: 'shape', bodyPaths }                                when it has body paths only
 *   { kind: 'empty' }                                           otherwise
 * `box` is the leaf box (from the layer tree, never from the page). Word and glyph boxes come from the ink.
 */
export function pageToElements(parsed, leaf, { gapEm = 0.3, baselineEm = 0.1 } = {}) {
  const pm = pageMatrix(leaf, parsed.width, parsed.height);
  if (!parsed.uses.length) {
    if (parsed.images.length) return { kind: 'picture', images: parsed.images.length, singleStream: parsed.images.length === 1 };
    if (parsed.bodyPaths.length) return { kind: 'shape', bodyPaths: parsed.bodyPaths.length };
    return { kind: 'empty' };
  }
  withAdvances(parsed);
  const words = [];
  for (const w of wordsFromUses(parsed.uses, { gapEm, baselineEm })) {
    const chars = [];
    for (const u of w.uses) {
      const def = parsed.defs.get(u.href);
      if (!def || !u.matrix) continue;
      const d = transformPath(def, multiply(pm, u.matrix));
      if (!d) continue;
      const box = boxFromPath(d);
      if (!box) continue;
      chars.push({ d, box, text: u.text ?? '', fill: u.fill || DEFAULT_FILL });
    }
    if (!chars.length) continue;
    const fill = mostCommon(chars.map((c) => c.fill), DEFAULT_FILL);
    words.push({
      d: chars.map((c) => c.d).join(''),
      box: roundBox(unionBox(chars.map((c) => c.box))),
      text: w.text,
      fill,
      chars: chars.map((c) => (c.fill === fill ? { d: c.d, box: c.box, text: c.text } : c)),
    });
  }
  const shapes = parsed.bodyPaths.map((p) => {
    const m = p.matrix ? multiply(pm, p.matrix) : pm;
    const s = { d: transformPath(p.d, m) };
    if (p.fill === 'none') s.fill = null;
    else s.fill = p.fill || DEFAULT_FILL;
    if (p.fillOpacity !== null && p.fillOpacity !== undefined) s.opacity = p.fillOpacity;
    if (p.stroke) {
      s.stroke = p.stroke;
      s.strokeWidth = r2((p.strokeWidth ?? 1) * Math.hypot(m[0], m[1]));
    }
    return s;
  });
  const fill = mostCommon(words.map((w) => w.fill), DEFAULT_FILL);
  return {
    kind: 'text',
    box: roundBox(leaf.box),
    words: words.map((w) => (w.fill === fill ? { d: w.d, box: w.box, text: w.text, chars: w.chars } : w)),
    fill,
    text: words.map((w) => w.text).join(' '),
    shapes,
    images: parsed.images.length,
  };
}
