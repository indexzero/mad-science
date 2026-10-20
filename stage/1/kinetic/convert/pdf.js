// mutool wrapper and SVG glyph model. Discovery part (checkpoint 1).
// pageToSvg: `mutool draw -F svg -O text=path -o out.svg in.pdf <page+1>`, one page per file.
// parseSvg: reads the four element kinds the design names. `<path id="font_*" d>` in <defs>
// is a glyph outline in em units. `<use xlink:href="#font_*" data-text transform="matrix(s,0,0,-s,tx,ty)" fill>`
// is one glyph placement. `<path>` in the body without an id is a rectangle or rule. `<image>` is a raster.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
        bodyPaths.push({ d: a.d || '', fill: a.fill ?? null, transform: a.transform ?? null, matrix: parseMatrix(a.transform) });
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
