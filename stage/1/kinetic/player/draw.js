// Draw one slide onto a 2D context in slide coordinates: the background, then every element in tree order
// with the state the build steps give it. Hidden elements wait for their build step.
import { elementState } from './effects.js';

/** Clip to each path of `clip` in turn (the page's clip paths, D-019 F-03). The caller saves and restores. */
function clipTo(ctx, clip) {
  for (const c of clip) ctx.clip(c);
}

function drawPaths(ctx, list, alpha) {
  for (const p of list) {
    if (p.clip) { ctx.save(); clipTo(ctx, p.clip); }
    const a = alpha * (p.opacity ?? 1);
    if (p.fill) {
      ctx.globalAlpha = a;
      ctx.fillStyle = p.fill;
      ctx.fill(p.path);
    }
    if (p.stroke) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth ?? 1;
      if (p.dash) ctx.setLineDash(p.dash);
      ctx.stroke(p.path);
      if (p.dash) ctx.setLineDash([]);
    }
    if (p.clip) ctx.restore();
  }
}

/**
 * Line-draw: stroke each path by length. `p.line` (preload.js) is the stroke geometry: the centerline of a
 * thin filled rectangle with its thickness as the line width, else the path itself. `setLineDash` with a
 * dash of `length * fraction` and a gap of `length` draws the first `fraction` of the path.
 */
function drawLines(ctx, list, alpha, fraction) {
  for (const p of list) {
    const line = p.line;
    if (!line) continue;
    if (p.clip) { ctx.save(); clipTo(ctx, p.clip); }
    ctx.globalAlpha = alpha * (p.opacity ?? 1);
    ctx.strokeStyle = p.stroke || p.fill || '#000000';
    ctx.lineWidth = line.width;
    ctx.lineCap = 'butt';
    ctx.setLineDash([line.length * fraction, line.length]);
    ctx.lineDashOffset = 0;
    ctx.stroke(line.path);
    ctx.setLineDash([]);
    if (p.clip) ctx.restore();
  }
}

function drawImage(ctx, handle, el) {
  const b = el.box;
  if (el.flip === 'vertical') {
    // mirror the box: the page draws this image upside down
    ctx.save();
    ctx.translate(0, 2 * b.y + b.h);
    ctx.scale(1, -1);
  }
  if (el.crop) ctx.drawImage(handle, el.crop.x, el.crop.y, el.crop.w, el.crop.h, b.x, b.y, b.w, b.h);
  else ctx.drawImage(handle, b.x, b.y, b.w, b.h);
  if (el.flip === 'vertical') ctx.restore();
}

/** Clip to the part of `box` a wipe has revealed: a rectangle that grows along `direction`. */
function clipWipe(ctx, box, clip) {
  const { direction, p } = clip;
  let { x, y, w, h } = box;
  if (direction === 'right') w *= p;
  else if (direction === 'left') { x += w * (1 - p); w *= p; }
  else if (direction === 'down') h *= p;
  else if (direction === 'up') { y += h * (1 - p); h *= p; }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
}

/**
 * Draw `slide` with steps up to `done` complete and step `done + 1` at `t` seconds (null when idle).
 * `videoControl(el, play)` lets the player start or keep a video; it returns the HTMLVideoElement to draw
 * when playing, else null (the poster is drawn). `range` { from, to } draws the elements [from, to) only,
 * with the background when `from` is 0, so a still frame can be rendered a few elements per animation frame.
 */
export function drawSlide(ctx, deck, slide, preloader, done, t, videoControl, range = null) {
  const first = range ? range.from : 0;
  const last = range ? Math.min(range.to, slide.elements.length) : slide.elements.length;
  ctx.save();
  // a slide never paints outside its own bounds: full-bleed layers (the slide 2 GIF starts at x -99) would
  // otherwise spill over the neighbouring slide during a push
  ctx.beginPath();
  ctx.rect(0, 0, deck.width, deck.height);
  ctx.clip();
  if (first === 0) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = slide.background?.value || '#000000';
    ctx.fillRect(0, 0, deck.width, deck.height);
  }
  for (let i = first; i < last; i++) {
    const el = slide.elements[i];
    const st = elementState(el, slide.builds, done, t);
    if (!st.visible) continue;
    ctx.save();
    ctx.translate(st.dx, st.dy);
    if (st.clip) clipWipe(ctx, el.box, st.clip);
    ctx.globalAlpha = st.alpha;
    if (el.kind === 'image') {
      const h = preloader.get(`img:${el.src}`);
      if (h) drawImage(ctx, h, el);
    } else if (el.kind === 'video') {
      const video = videoControl ? videoControl(el, st.play) : null;
      const poster = preloader.get(`img:${el.poster}`);
      const src = video && video.readyState >= 2 ? video : poster;
      if (src) ctx.drawImage(src, el.box.x, el.box.y, el.box.w, el.box.h);
    } else if (el.kind === 'shape') {
      const h = preloader.get(`paths:${slide.id}:${el.id}`);
      if (h && st.draw !== null && st.draw < 1) drawLines(ctx, h.paths, st.alpha, st.draw);
      else if (h) drawPaths(ctx, h.paths, st.alpha);
    } else if (el.kind === 'text') {
      const h = preloader.get(`paths:${slide.id}:${el.id}`);
      if (!h) { ctx.restore(); continue; }
      drawPaths(ctx, h.paths, st.alpha);
      if (!st.items) {
        for (const w of h.words) {
          if (w.clip) { ctx.save(); clipTo(ctx, w.clip); }
          ctx.globalAlpha = st.alpha;
          ctx.fillStyle = w.fill;
          ctx.fill(w.path);
          for (const c of w.chars) if (c.fill !== w.fill) { ctx.fillStyle = c.fill; ctx.fill(c.path); }
          if (w.clip) ctx.restore();
        }
      } else if (st.unit === 'word') {
        h.words.forEach((w, i) => {
          const s = st.items[i];
          if (!s || !s.visible) return;
          ctx.save();
          ctx.translate(s.dx, s.dy);
          if (w.clip) clipTo(ctx, w.clip);
          ctx.globalAlpha = s.alpha;
          ctx.fillStyle = w.fill;
          ctx.fill(w.path);
          for (const c of w.chars) if (c.fill !== w.fill) { ctx.fillStyle = c.fill; ctx.fill(c.path); }
          ctx.restore();
        });
      } else {
        let i = 0;
        for (const w of h.words) {
          const chars = w.chars.length ? w.chars : [{ path: w.path, fill: w.fill }];
          for (const c of chars) {
            const s = st.items[i++];
            if (!s || !s.visible) continue;
            ctx.save();
            ctx.translate(s.dx, s.dy);
            if (w.clip) clipTo(ctx, w.clip);
            ctx.globalAlpha = s.alpha;
            ctx.fillStyle = c.fill;
            ctx.fill(c.path);
            ctx.restore();
          }
        }
      }
    }
    ctx.restore();
  }
  ctx.restore();
}
