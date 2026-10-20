// Draw one slide onto a 2D context in slide coordinates: the background, then every element in tree order
// with the state the build steps give it. Hidden elements wait for their build step.
import { elementState } from './effects.js';

function drawPaths(ctx, list, alpha) {
  for (const p of list) {
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
      ctx.stroke(p.path);
    }
  }
}

function drawImage(ctx, handle, el) {
  const b = el.box;
  if (el.crop) ctx.drawImage(handle, el.crop.x, el.crop.y, el.crop.w, el.crop.h, b.x, b.y, b.w, b.h);
  else ctx.drawImage(handle, b.x, b.y, b.w, b.h);
}

/**
 * Draw `slide` with steps up to `done` complete and step `done + 1` at `t` seconds (null when idle).
 * `videoControl(el, play)` lets the player start or keep a video; it returns the HTMLVideoElement to draw
 * when playing, else null (the poster is drawn).
 */
export function drawSlide(ctx, deck, slide, preloader, done, t, videoControl) {
  ctx.save();
  // a slide never paints outside its own bounds: full-bleed layers (the slide 2 GIF starts at x -99) would
  // otherwise spill over the neighbouring slide during a push
  ctx.beginPath();
  ctx.rect(0, 0, deck.width, deck.height);
  ctx.clip();
  ctx.globalAlpha = 1;
  ctx.fillStyle = slide.background?.value || '#000000';
  ctx.fillRect(0, 0, deck.width, deck.height);
  for (const el of slide.elements) {
    const st = elementState(el, slide.builds, done, t);
    if (!st.visible) continue;
    ctx.save();
    ctx.translate(st.dx, st.dy);
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
      if (h) drawPaths(ctx, h.paths, st.alpha);
    } else if (el.kind === 'text') {
      const h = preloader.get(`paths:${slide.id}:${el.id}`);
      if (!h) { ctx.restore(); continue; }
      drawPaths(ctx, h.paths, st.alpha);
      if (!st.items) {
        for (const w of h.words) {
          ctx.globalAlpha = st.alpha;
          ctx.fillStyle = w.fill;
          ctx.fill(w.path);
          for (const c of w.chars) if (c.fill !== w.fill) { ctx.fillStyle = c.fill; ctx.fill(c.path); }
        }
      } else if (st.unit === 'word') {
        h.words.forEach((w, i) => {
          const s = st.items[i];
          if (!s || !s.visible) return;
          ctx.save();
          ctx.translate(s.dx, s.dy);
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
