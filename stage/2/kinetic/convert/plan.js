// Which leaves of a slide's first event become elements. The design (revision 5) names seven page classes.
// `background` sets the slide color, `poster` belongs to a video, and `composite` is a snapshot only when the
// event has another content leaf (text, picture, mixed, shape). When the composite is the only content leaf
// (ten slides, among them spike slide 1), it IS the content and `compositeAsContent` is true (D-009 F1).

export const CONTENT_CLASSES = new Set(['text', 'picture', 'mixed', 'shape']);

/**
 * `leaves` are composed leaves (layout.js) each carrying `cls`, its page class. Returns
 * { content: leaf[], snapshots: leaf[], background: leaf | null, posters: leaf[], empty: leaf[], compositeAsContent }.
 * Order is preserved (tree order is draw order).
 */
export function planLeaves(leaves) {
  const hasOtherContent = leaves.some((l) => CONTENT_CLASSES.has(l.cls));
  const compositeAsContent = !hasOtherContent && leaves.some((l) => l.cls === 'composite');
  const out = { content: [], snapshots: [], background: null, posters: [], empty: [], compositeAsContent };
  for (const l of leaves) {
    if (l.cls === 'background') out.background = out.background || l;
    else if (l.cls === 'poster') out.posters.push(l);
    else if (l.cls === 'composite') (compositeAsContent ? out.content : out.snapshots).push(l);
    else if (CONTENT_CLASSES.has(l.cls)) out.content.push(l);
    else out.empty.push(l);
  }
  return out;
}
