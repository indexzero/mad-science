// KPF layer tree to slide-space boxes. A layer's `initialState` holds `position` (the anchor point in the
// parent's bounds), `anchorPoint` (fraction of width and height), `width`, `height`, `affineTransform`
// (six numbers, CGAffineTransform order a b c d tx ty), `scale`, `rotation` (radians), and `contentsRect`
// (the fraction of the texture shown). Each layer maps its own bounds (0,0,w,h) into its parent's bounds.
// The root's parent is the slide, so the root at position (960,540) with size 1920x1080 lands at (0,0).
//
// Matrices are the six-number affine [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f.

export const IDENTITY = [1, 0, 0, 1, 0, 0];

/** m1 then m2 composed so that apply(multiply(m1, m2), p) === apply(m1, apply(m2, p)). */
export function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function translate(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx, sy = sx) {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotate(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

/** Axis-aligned box of a rectangle (0,0,w,h) under `m`. */
export function boxOf(m, w, h) {
  const pts = [apply(m, 0, 0), apply(m, w, 0), apply(m, w, h), apply(m, 0, h)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * The matrix that maps a layer's bounds into its parent's bounds. Order: translate to `position`, then
 * `affineTransform`, `scale`, `rotation`, then translate by minus the anchor in pixels. `contentsRect`
 * belongs to the texture mapping, not to the layer placement (see pageMatrix).
 */
export function layerMatrix(initialState = {}) {
  const st = initialState;
  const w = st.width ?? 0;
  const h = st.height ?? 0;
  const ax = st.anchorPoint?.pointX ?? 0.5;
  const ay = st.anchorPoint?.pointY ?? 0.5;
  const px = st.position?.pointX ?? 0;
  const py = st.position?.pointY ?? 0;
  let m = translate(px, py);
  const at = st.affineTransform;
  if (Array.isArray(at) && at.length === 6) m = multiply(m, at);
  if (typeof st.scale === 'number' && st.scale !== 1) m = multiply(m, scale(st.scale));
  if (typeof st.rotation === 'number' && st.rotation !== 0) m = multiply(m, rotate(st.rotation));
  m = multiply(m, translate(-ax * w, -ay * h));
  return m;
}

/**
 * Walk a layer tree root first. Returns every `texturedRectangle` leaf as
 * { layer, texture, matrix, box, hidden, opacity, path, objectID, parentObjectID }.
 * `matrix` maps the leaf's bounds to slide space; `box` is the axis-aligned result;
 * `hidden` and `opacity` are the leaf's own state combined with its ancestors (hidden if any ancestor is,
 * opacity multiplied); `path` is the index path from the root.
 */
export function composeLeaves(root) {
  const out = [];
  const walk = (layer, parent, path, parentId) => {
    if (!layer) return;
    const st = layer.initialState || {};
    const matrix = multiply(parent.matrix, layerMatrix(st));
    const hidden = parent.hidden || st.hidden === true;
    const opacity = parent.opacity * (typeof st.opacity === 'number' ? st.opacity : 1);
    if (layer.texturedRectangle) {
      out.push({
        layer,
        texture: layer.texture ?? null,
        matrix,
        box: boxOf(matrix, st.width ?? 0, st.height ?? 0),
        width: st.width ?? 0,
        height: st.height ?? 0,
        contentsRect: st.contentsRect ?? { x: 0, y: 0, width: 1, height: 1 },
        hidden,
        ownHidden: st.hidden === true,
        opacity,
        path,
        objectID: layer.objectID ?? null,
        parentObjectID: parentId,
        isVideoLayer: layer.isVideoLayer === true,
      });
    }
    (layer.layers || []).forEach((child, i) => walk(child, { matrix, hidden, opacity }, `${path}/${i}`, layer.objectID ?? parentId));
  };
  walk(root, { matrix: IDENTITY, hidden: false, opacity: 1 }, '', null);
  return out;
}

/**
 * The matrix that maps page coordinates (an SVG of `pageW` x `pageH`, origin top left) of a leaf's texture
 * into slide space: the leaf matrix, then the contentsRect crop, then `layer.width / page.width` scaling.
 */
export function pageMatrix(leaf, pageW, pageH) {
  const cr = leaf.contentsRect || { x: 0, y: 0, width: 1, height: 1 };
  const w = leaf.width;
  const h = leaf.height;
  let m = leaf.matrix;
  m = multiply(m, translate((-cr.x * w) / cr.width, (-cr.y * h) / cr.height));
  m = multiply(m, scale(w / (cr.width * pageW), h / (cr.height * pageH)));
  return m;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/** A box rounded to three decimals, for deck.json. */
export function roundBox(b) {
  return { x: r3(b.x), y: r3(b.y), w: r3(b.w), h: r3(b.h) };
}
