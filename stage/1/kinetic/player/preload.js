// The preloader: decoded handles for every asset of a slide. Images and posters become ImageBitmap,
// videos become an HTMLVideoElement fed from a fetched Blob with readyState 4, text becomes Path2D lists.
// `isReady(n)` is one predicate: every asset key of slide n is in the cache.

const NUM_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/** Vertices of an absolute SVG path (M, L, C, Q, Z; the converter writes no other command) in order. */
export function pathPoints(d) {
  const pts = [];
  let start = null;
  for (const seg of d.matchAll(/([MLCQZ])([^MLCQZ]*)/g)) {
    const cmd = seg[1];
    const nums = (seg[2].match(NUM_RE) || []).map(Number);
    if (cmd === 'Z') { if (start) pts.push(start); continue; }
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const p = [nums[i], nums[i + 1]];
      pts.push(p);
      if (cmd === 'M' && i === 0) start = p;
    }
  }
  return pts;
}

/** Length of the polyline through `pts`. */
export function polylineLength(pts) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return n;
}

/**
 * The stroke geometry of a shape path for line-draw: { path, length, width }. A thin filled rectangle
 * (one side under a fifth of the other, the common Keynote rule) strokes its centerline with its
 * thickness as the width, from its start along the major axis (LineDraw direction 31, forward). Any other
 * path strokes itself with its own stroke width, measured along its control polygon.
 */
export function lineOf(p) {
  const pts = pathPoints(p.d);
  if (pts.length < 2) return null;
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const w = x1 - x0;
  const h = y1 - y0;
  const thin = p.fill && Math.min(w, h) <= Math.max(w, h) * 0.2;
  const path = new Path2D();
  if (thin) {
    if (w >= h) { path.moveTo(x0, (y0 + y1) / 2); path.lineTo(x1, (y0 + y1) / 2); }
    else { path.moveTo((x0 + x1) / 2, y0); path.lineTo((x0 + x1) / 2, y1); }
    return { path, length: Math.max(w, h), width: Math.max(1, Math.min(w, h)) };
  }
  return { path: new Path2D(p.d), length: polylineLength(pts), width: p.strokeWidth ?? 2 };
}

export class Preloader {
  constructor(deck, baseUrl) {
    this.deck = deck;
    this.base = baseUrl;
    this.cache = new Map();
    this.pending = new Map();
    this.videoType = Preloader.pickVideoType();
  }

  static pickVideoType() {
    const v = document.createElement('video');
    if (v.canPlayType('video/webm; codecs="vp9"')) return 'webm';
    if (v.canPlayType('video/mp4; codecs="avc1.42E01E"')) return 'mp4';
    return 'webm';
  }

  /** The slide with deck index n (1-based; a partial deck keeps the original numbering). */
  slide(n) {
    return this.deck.slides.find((s) => s.index === n) || null;
  }

  url(rel) {
    return new URL(rel, this.base).href;
  }

  /** Every asset of slide n: { key, kind, src?, el? }. */
  assetsOf(n) {
    const slide = this.slide(n);
    if (!slide) return [];
    const out = [];
    for (const el of slide.elements) {
      if (el.kind === 'image') out.push({ key: `img:${el.src}`, kind: 'image', src: el.src });
      else if (el.kind === 'video') {
        out.push({ key: `img:${el.poster}`, kind: 'image', src: el.poster });
        out.push({ key: `video:${el.src[this.videoType]}`, kind: 'video', src: el.src[this.videoType] });
      } else if (el.kind === 'text' || el.kind === 'shape') {
        out.push({ key: `paths:${slide.id}:${el.id}`, kind: 'paths', el });
      }
    }
    return out;
  }

  isReady(n) {
    const assets = this.assetsOf(n);
    return assets.length > 0 ? assets.every((a) => this.cache.has(a.key)) : this.slide(n) !== null;
  }

  preloaded() {
    return this.deck.slides.map((s) => s.index).filter((n) => this.isReady(n)).sort((a, b) => a - b);
  }

  get(key) {
    return this.cache.get(key);
  }

  /** Decode every asset of slide n. Resolves when the slide is ready. Idempotent and concurrent-safe. */
  async load(n) {
    const jobs = this.assetsOf(n).map((a) => this.loadAsset(a));
    await Promise.all(jobs);
    return this.isReady(n);
  }

  loadAsset(a) {
    if (this.cache.has(a.key)) return Promise.resolve();
    if (this.pending.has(a.key)) return this.pending.get(a.key);
    const job = this.decode(a).then((handle) => {
      this.cache.set(a.key, handle);
      this.pending.delete(a.key);
    }, (err) => {
      this.pending.delete(a.key);
      console.error('preload failed', a.key, err);
    });
    this.pending.set(a.key, job);
    return job;
  }

  async decode(a) {
    if (a.kind === 'paths') return Preloader.pathsOf(a.el);
    const res = await fetch(this.url(a.src));
    if (!res.ok) throw new Error(`${res.status} ${a.src}`);
    const blob = await res.blob();
    if (a.kind === 'image') return createImageBitmap(blob);
    return Preloader.videoOf(blob);
  }

  static pathsOf(el) {
    // `clip` (D-019 F-03): the clip paths of the page that may cut this outline, applied in turn
    const clipOf = (c) => (c ? c.map((d) => new Path2D(d)) : null);
    const out = { paths: (el.paths || []).map((p) => ({ path: new Path2D(p.d), fill: p.fill, opacity: p.opacity, stroke: p.stroke, strokeWidth: p.strokeWidth, clip: clipOf(p.clip), line: el.kind === 'shape' ? lineOf(p) : null })) };
    if (el.kind === 'text') {
      // a word's outline is its characters' outlines; deck.json carries `d` on the word only when it has no chars
      out.words = el.words.map((w) => ({
        path: new Path2D(w.d ?? (w.chars || []).map((c) => c.d).join('')),
        fill: w.fill || el.fill,
        clip: clipOf(w.clip),
        chars: (w.chars || []).map((c) => ({ path: new Path2D(c.d), fill: c.fill || w.fill || el.fill })),
      }));
    }
    return out;
  }

  static videoOf(blob) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      const url = URL.createObjectURL(blob);
      const done = () => {
        if (v.readyState >= 4) {
          v.removeEventListener('canplaythrough', done);
          resolve(v);
        }
      };
      v.addEventListener('canplaythrough', done);
      v.addEventListener('error', () => reject(new Error('video decode failed')));
      v.src = url;
      v.load();
      // a short blob is often ready before the listener is attached
      setTimeout(done, 0);
    });
  }

  /** Drop every asset not used by the slides in `keepIndexes`. Videos are paused first. */
  evict(keepIndexes) {
    const keep = new Set();
    for (const n of keepIndexes) for (const a of this.assetsOf(n)) keep.add(a.key);
    for (const [key, handle] of this.cache) {
      if (keep.has(key)) continue;
      if (handle instanceof HTMLVideoElement) {
        handle.pause();
        URL.revokeObjectURL(handle.src);
        handle.removeAttribute('src');
      } else if (handle && typeof handle.close === 'function') handle.close();
      this.cache.delete(key);
    }
  }
}
