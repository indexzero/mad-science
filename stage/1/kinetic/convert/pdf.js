// mutool wrapper and SVG glyph model. Discovery part (checkpoint 1), elements part (checkpoint 2).
// pageToSvg: `mutool draw -F svg -O text=path -o out.svg in.pdf <page+1>`, one page per file.
// parseSvg: reads the four element kinds the design names. `<path id="font_*" d>` in <defs>
// is a glyph outline in em units. `<use xlink:href="#font_*" data-text transform="matrix(s,0,0,-s,tx,ty)" fill>`
// is one glyph placement. `<path>` in the body without an id is a rectangle or rule. `<image>` is a raster.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { multiply, apply, translate, pageMatrix, roundBox, boxOf, IDENTITY } from './layout.js';

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
 * { width, height, defs: Map<id, d>, uses, imageUses, bodyPaths, images, imageDefs, clipPaths, groups }.
 * `uses` are glyph placements: a `<use>` whose href starts with `font_` (D-008 F-01; mutool also writes
 * `<use xlink:href="#image_N">` for a re-placed raster, which lands in `imageUses`). Group transforms
 * (`<g transform>`) are composed into every placement's `matrix`, so a matrix always maps into page space.
 * `<image>` inside `<defs>` (a mask source) is recorded in `imageDefs` and never in `images`; a `<use>`
 * inside `<defs>` (a mask's content) is not a placement. A `<g opacity>` multiplies into the `fillOpacity`
 * of the body paths and the `opacity` of the images under it (66 paths and one image deck-wide).
 * A `<g clip-path="url(#clip_N)">` scopes the placements under it (D-019 F-03): every body path, glyph
 * placement, and image carries `clips`, the list of its active clip paths in page space ({ d, box, rect }).
 */
export function parseSvg(svgText) {
  const defs = new Map();
  const imageDefs = new Map();
  const uses = [];
  const imageUses = [];
  const bodyPaths = [];
  const images = [];
  let clipPaths = 0;
  let groups = 0;
  let inDefs = false;
  let inClipPath = false;
  let clipId = null;
  const clipDefs = new Map(); // clipPath id -> { d, transform }
  const clipStack = [[]]; // the active clips, outermost first
  const clip = () => clipStack[clipStack.length - 1];
  let width = null;
  let height = null;
  let order = 0; // document order of placements, images, and body paths (the page's z-order)
  const stack = [IDENTITY];
  const alphas = [1]; // <g opacity> composed down the tree (slide 44 draws its boxes inside <g opacity=".1">)
  const ctm = () => stack[stack.length - 1];
  const alpha = () => alphas[alphas.length - 1];
  const withOwn = (transform) => {
    const own = parseMatrix(transform);
    return own ? multiply(ctm(), own) : ctm();
  };

  for (const m of svgText.matchAll(TAG_RE)) {
    const closing = m[1] === '/';
    const selfClosing = m[4] === '/';
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
      clipId = closing ? null : a.id ?? null;
    } else if (name === 'g' || name === 'mask') {
      if (closing) {
        stack.pop();
        alphas.pop();
        clipStack.pop();
      } else {
        if (name === 'g') groups += 1;
        const own = withOwn(a.transform);
        const ref = /url\(#([^)]+)\)/.exec(a['clip-path'] || '');
        let clips = clip();
        if (ref && clipDefs.has(ref[1])) {
          const def = clipDefs.get(ref[1]);
          const d = transformPath(def.d, multiply(own, parseMatrix(def.transform) || IDENTITY));
          clips = [...clips, { d, box: pathBox(d), rect: isAxisRect(d) }];
        }
        stack.push(own);
        alphas.push(alpha() * (a.opacity !== undefined ? Number(a.opacity) : 1));
        clipStack.push(clips);
        if (selfClosing) { stack.pop(); alphas.pop(); clipStack.pop(); }
      }
    } else if (name === 'path' && !closing && inClipPath && !a.id) {
      if (clipId) clipDefs.set(clipId, { d: a.d || '', transform: a.transform ?? null });
    } else if (name === 'path' && !closing) {
      if (a.id) {
        defs.set(a.id, a.d || '');
      } else if (!inDefs && !inClipPath) {
        bodyPaths.push({
          order: order++,
          d: a.d || '',
          fill: a.fill ?? null,
          fillOpacity: a['fill-opacity'] !== undefined || alpha() < 1 ? (a['fill-opacity'] !== undefined ? Number(a['fill-opacity']) : 1) * alpha() : null,
          stroke: a.stroke ?? null,
          strokeWidth: a['stroke-width'] !== undefined ? Number(a['stroke-width']) : null,
          dash: a['stroke-dasharray'] && a['stroke-dasharray'] !== 'none' ? a['stroke-dasharray'].split(/[\s,]+/).filter(Boolean).map(Number) : null,
          transform: a.transform ?? null,
          matrix: withOwn(a.transform),
          clips: clip(),
        });
      }
    } else if (name === 'use' && !closing) {
      // a <use> inside <defs> is the content of a <mask> (mutool masks a re-placed raster with a copy of
      // itself), never a placement on the page (slide 39: four mask uses over two body placements)
      if (inDefs) continue;
      const href = (a['xlink:href'] || a.href || '').replace(/^#/, '');
      const matrix = withOwn(a.transform);
      if (href.startsWith('font_')) {
        uses.push({
          order: order++,
          href,
          text: a['data-text'] !== undefined ? decodeEntities(a['data-text']) : null,
          s: Math.abs(matrix[0]),
          tx: matrix[4],
          ty: matrix[5],
          fill: a.fill ?? null,
          matrix,
          clips: clip(),
        });
      } else {
        const x = Number(a.x || 0);
        const y = Number(a.y || 0);
        const def = imageDefs.get(href) || images.find((i) => i.id === href) || null;
        imageUses.push({
          order: order++,
          opacity: alpha(),
          href,
          width: a.width !== undefined ? Number(a.width) : def?.width ?? null,
          height: a.height !== undefined ? Number(a.height) : def?.height ?? null,
          matrix: x || y ? multiply(matrix, translate(x, y)) : matrix,
          clips: clip(),
        });
      }
    } else if (name === 'image' && !closing) {
      const img = { id: a.id ?? null, width: Number(a.width), height: Number(a.height), transform: a.transform ?? null, matrix: withOwn(a.transform), inDefs, opacity: alpha(), clips: clip() };
      if (inDefs) imageDefs.set(img.id, img);
      else images.push({ ...img, order: order++ });
    }
  }
  return { width, height, defs, imageDefs, uses, imageUses, bodyPaths, images, clipPaths, groups };
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
    if (!u.href?.startsWith('font_') || !parsed.defs.has(u.href)) continue;
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
 * The page class of the design (revision 5, "Approaches evaluated" item 4). `info` carries the leaf's
 * `textureType`, `isBackgroundTexture`, `isPoster` (the texture of an `isVideoLayer` layer), `width` and
 * `height` (the asset size). Order: poster, background, composite, then the content classes by placements.
 */
export function classifyPage(parsed, info = {}) {
  if (info.isPoster) return 'poster';
  if (info.textureType === 1) return 'background';
  if (info.textureType === 0 && info.isBackgroundTexture === false && info.width === 1920 && info.height === 1080) return 'composite';
  return contentClass(parsed);
}

/** The content class by placements alone: text, picture, mixed, shape, or empty. */
export function contentClass(parsed) {
  const glyphs = parsed.uses.length > 0;
  const rasters = parsed.images.length + (parsed.imageUses?.length ?? 0) > 0;
  if (glyphs && rasters) return 'mixed';
  if (glyphs) return 'text';
  if (rasters) return 'picture';
  if (parsed.bodyPaths.length) return 'shape';
  return 'empty';
}

/** Every raster placement of a page (body images and image uses) with its page matrix and pixel size. */
export function imagePlacements(parsed) {
  const out = [];
  for (const i of parsed.images) out.push({ id: i.id, width: i.width, height: i.height, matrix: i.matrix, use: false, order: i.order ?? 0, opacity: i.opacity ?? 1 });
  for (const u of parsed.imageUses || []) out.push({ id: u.href, width: u.width, height: u.height, matrix: u.matrix, use: true, order: u.order ?? 0, opacity: u.opacity ?? 1 });
  return out.sort((a, b) => a.order - b.order);
}

/**
 * `leaf` is a composed leaf from layout.js (matrix, width, height, contentsRect). Returns one of:
 *   { kind: 'text',    box, words, fill, text, paths, images: [] }        glyph placements, no raster
 *   { kind: 'mixed',   box, words, fill, text, paths, images: [...] }     glyph placements and rasters
 *   { kind: 'picture', images: [{ box, width, height, matrix, id }] }      rasters, no glyph placement
 *   { kind: 'shape',   paths: [{ d, fill, opacity?, stroke?, strokeWidth? }] }  body paths only
 *   { kind: 'empty' }
 * `box` is the leaf box (from the layer tree, never from the page). Word and glyph boxes come from the ink.
 * Image boxes come from the SVG transform of each placement.
 */
export function pageToElements(page, leaf, { gapEm = 0.3, baselineEm = 0.1 } = {}) {
  const pm = pageMatrix(leaf, page.width, page.height);
  // clip paths (D-019 F-03): a placement wholly outside a clip of its group is dropped; one that a clip
  // may cut keeps that clip, mapped to slide space, as `clip` (a list of path `d`, applied in turn)
  const { parsed, clipStats } = applyClips(page);
  const toSlide = (clips) => (clips.length ? clips.map((c) => transformPath(c.d, pm)) : null);
  const cls = contentClass(parsed);
  const images = imagePlacements(parsed).map((p) => {
    const m = multiply(pm, p.matrix);
    // a negative y scale in the placement is a vertical flip: the PDF draws the image with a negative height
    // (slide 68's gradient overlay fades at the bottom right; drawn upright it faded at the top right)
    return { id: p.id, width: p.width, height: p.height, box: roundBox(boxOf(m, p.width, p.height)), matrix: m.map((v) => Math.round(v * 100000) / 100000), use: p.use, order: p.order, opacity: p.opacity, flipY: m[3] < 0 };
  });
  const paths = shapesOf(parsed, pm);
  if (cls === 'picture') return { kind: 'picture', images, paths, clipStats };
  if (cls === 'shape') return { kind: 'shape', paths, clipStats };
  if (cls === 'empty') return { kind: 'empty', clipStats };
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
      chars.push({ d, box, text: u.text ?? '', fill: u.fill || DEFAULT_FILL, clip: u.clipKeep?.length ? u.clipKeep : null });
    }
    if (!chars.length) continue;
    const fill = mostCommon(chars.map((c) => c.fill), DEFAULT_FILL);
    // a word takes the clips that may cut one of its glyphs; a glyph wholly inside them is not affected
    const cut = chars.filter((c) => c.clip);
    const key = (c) => c.clip.map((x) => x.d).join('|');
    if (cut.some((c) => key(c) !== key(cut[0]))) clipStats.conflicts += 1;
    const word = {
      d: chars.map((c) => c.d).join(''),
      box: roundBox(unionBox(chars.map((c) => c.box))),
      text: w.text,
      fill,
      chars: chars.map(({ clip, ...c }) => (c.fill === fill ? { d: c.d, box: c.box, text: c.text } : c)),
    };
    if (cut.length) word.clip = toSlide(cut[0].clip);
    words.push(word);
  }
  const fill = mostCommon(words.map((w) => w.fill), DEFAULT_FILL);
  if (!words.length) return images.length ? { kind: 'picture', images, paths, clipStats } : paths.length ? { kind: 'shape', paths, clipStats } : { kind: 'empty', clipStats };
  return {
    kind: cls,
    box: roundBox(leaf.box),
    words: words.map(({ fill: wf, ...w }) => (wf === fill ? w : { ...w, fill: wf })),
    fill,
    text: words.map((w) => w.text).join(' '),
    paths,
    images,
    clipStats,
    lastGlyph: Math.max(...parsed.uses.map((u) => u.order ?? 0)),
  };
}

/** True when an absolute path `d` of M and L commands is one axis-aligned rectangle. */
export function isAxisRect(d) {
  if (/[CQ]/.test(d)) return false;
  const nums = (d.match(NUM_RE) || []).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  if (pts.length > 1 && pts[pts.length - 1][0] === pts[0][0] && pts[pts.length - 1][1] === pts[0][1]) pts.pop();
  if (pts.length !== 4) return false;
  const xs = new Set(pts.map((p) => p[0]));
  const ys = new Set(pts.map((p) => p[1]));
  return xs.size === 2 && ys.size === 2 && new Set(pts.map((p) => p.join(','))).size === 4;
}

/**
 * Where a page-space box stands against a list of clips: 'out' when it lies wholly outside one of them
 * (it is never drawn), else the clips that may cut it (a rectangle that holds the box within 0.5 page units
 * is left out; any other clip is kept).
 */
export function clipVerdict(box, clips, eps = 0.5) {
  const keep = [];
  for (const c of clips || []) {
    const b = c.box;
    if (!b) continue;
    if (box.maxX <= b.minX || box.minX >= b.maxX || box.maxY <= b.minY || box.minY >= b.maxY) return 'out';
    const inside = c.rect && box.minX >= b.minX - eps && box.maxX <= b.maxX + eps && box.minY >= b.minY - eps && box.maxY <= b.maxY + eps;
    if (!inside) keep.push(c);
  }
  return keep;
}

/**
 * Apply the clips of a parsed page: placements wholly outside a clip are removed, a glyph or body path a
 * clip may cut carries `clipKeep`. Images are dropped when outside; a partly clipped image is counted (its
 * element is cropped to the leaf box only). Returns { parsed (a shallow copy), clipStats }.
 */
export function applyClips(page) {
  const stats = { kinds: { rect: 0, other: 0 }, dropped: { glyph: 0, path: 0, image: 0 }, clipped: { glyph: 0, path: 0 }, partialImages: 0, conflicts: 0 };
  const has = (x) => x.clips && x.clips.length;
  // the distinct clips that govern a placement on this page, by kind
  const seen = new Set();
  for (const x of [...page.uses, ...page.bodyPaths, ...page.images, ...(page.imageUses || [])]) {
    for (const c of x.clips || []) {
      if (seen.has(c)) continue;
      seen.add(c);
      stats.kinds[c.rect ? 'rect' : 'other'] += 1;
    }
  }
  const uses = [];
  for (const u of page.uses) {
    if (!has(u)) { uses.push(u); continue; }
    const def = page.defs.get(u.href);
    const box = def ? pathBox(transformPath(def, u.matrix)) : null;
    if (!box) { uses.push(u); continue; }
    const v = clipVerdict(box, u.clips);
    if (v === 'out') { stats.dropped.glyph += 1; continue; }
    if (v.length) stats.clipped.glyph += 1;
    uses.push(v.length ? { ...u, clipKeep: v } : u);
  }
  const bodyPaths = [];
  for (const p of page.bodyPaths) {
    if (!has(p)) { bodyPaths.push(p); continue; }
    const b = pathBox(transformPath(p.d, p.matrix || IDENTITY));
    if (!b) { bodyPaths.push(p); continue; }
    const half = p.stroke && p.stroke !== 'none' ? ((p.strokeWidth ?? 1) * Math.hypot((p.matrix || IDENTITY)[0], (p.matrix || IDENTITY)[1])) / 2 : 0;
    const v = clipVerdict({ minX: b.minX - half, maxX: b.maxX + half, minY: b.minY - half, maxY: b.maxY + half }, p.clips);
    if (v === 'out') { stats.dropped.path += 1; continue; }
    if (v.length) stats.clipped.path += 1;
    bodyPaths.push(v.length ? { ...p, clipKeep: v } : p);
  }
  const keepImage = (i, w, h) => {
    if (!has(i)) return true;
    const b = boxOf(i.matrix, w, h);
    const v = clipVerdict({ minX: b.x, maxX: b.x + b.w, minY: b.y, maxY: b.y + b.h }, i.clips);
    if (v === 'out') { stats.dropped.image += 1; return false; }
    if (v.length) stats.partialImages += 1;
    return true;
  };
  const images = page.images.filter((i) => keepImage(i, i.width, i.height));
  const imageUses = (page.imageUses || []).filter((u) => u.width === null || u.height === null || keepImage(u, u.width, u.height));
  return { parsed: { ...page, uses, bodyPaths, images, imageUses }, clipStats: stats };
}

/**
 * The paint order of a mixed page as element layers (D-019 F-01, D-020 CP3-F1). The body paths split around
 * the images by page order: the paths before an image stay under it, the paths after the last image stay
 * over every image. Glyphs still draw over all images (D-016). `paths` and `images` carry `order`. Returns
 * [{ kind: 'paths', paths } | { kind: 'image', index }] ending with { kind: 'text', paths } (the paths the
 * text element keeps; empty when no path follows the last image).
 */
export function mixedLayers(paths, images) {
  const sortedPaths = [...paths].sort((a, b) => a.order - b.order);
  const byOrder = images.map((im, index) => ({ index, order: im.order ?? 0 })).sort((a, b) => a.order - b.order);
  const out = [];
  let pi = 0;
  for (const im of byOrder) {
    const seg = [];
    while (pi < sortedPaths.length && sortedPaths[pi].order < im.order) seg.push(sortedPaths[pi++]);
    if (seg.length) out.push({ kind: 'paths', paths: seg });
    out.push({ kind: 'image', index: im.index });
  }
  out.push({ kind: 'text', paths: sortedPaths.slice(pi) });
  return out;
}

/** A shape path without its `order` (deck.json carries no z-order field; element order is the z-order). */
export function stripOrder({ order, ...p }) {
  return p;
}

/**
 * Body paths of a page as shape paths in slide space: { order, d, fill (null for none), opacity?, stroke?,
 * strokeWidth? }. `order` is the document order on the page, comparable with an image placement's.
 */
function shapesOf(parsed, pm) {
  return parsed.bodyPaths.map((p) => {
    const m = p.matrix ? multiply(pm, p.matrix) : pm;
    const s = { order: p.order ?? 0, d: transformPath(p.d, m) };
    if (p.fill === 'none') s.fill = null;
    else s.fill = p.fill || DEFAULT_FILL;
    if (p.fillOpacity !== null && p.fillOpacity !== undefined) s.opacity = p.fillOpacity;
    if (p.stroke) {
      s.stroke = p.stroke;
      s.strokeWidth = r2((p.strokeWidth ?? 1) * Math.hypot(m[0], m[1]));
      // a dash array scales with the stroke (D-019 F-04): `3,3` and `5,5` on slides 43, 44, 61, 62
      if (p.dash?.length && p.dash.every(Number.isFinite)) s.dash = p.dash.map((v) => r2(v * Math.hypot(m[0], m[1])));
    }
    if (p.clipKeep?.length) s.clip = p.clipKeep.map((c) => transformPath(c.d, pm));
    return s;
  });
}
