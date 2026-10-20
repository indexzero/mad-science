// The preloader: decoded handles for every asset of a slide. Images and posters become ImageBitmap,
// videos become an HTMLVideoElement fed from a fetched Blob with readyState 4, text becomes Path2D lists.
// `isReady(n)` is one predicate: every asset key of slide n is in the cache.

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
    const out = { paths: (el.paths || []).map((p) => ({ path: new Path2D(p.d), fill: p.fill, opacity: p.opacity, stroke: p.stroke, strokeWidth: p.strokeWidth })) };
    if (el.kind === 'text') {
      out.words = el.words.map((w) => ({
        path: new Path2D(w.d),
        fill: w.fill || el.fill,
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
