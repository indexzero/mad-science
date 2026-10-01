// Bertin-style reorderable matrix: offerings × atomic facts, one heatmap per
// lens. Each lens only changes the row order and the group label, so solid
// blocks mean the lens finds structure and a checkerboard means it doesn't.
import * as Plot from '@observablehq/plot';
import {
  EXAMPLE_NOTE, INK, NON_FITS, SEQUENTIAL, document, isExample, load, write,
} from './lib.mjs';

const { offerings, lenses, assignments, facts } = load();

const names = new Map(offerings.map((o) => [o.id, o.name]));
const factIds = [...new Set(facts.map((f) => f.fact))];

// yes/no/unknown, or an ordinal 0-3 on the sequential ramp.
const fill = (v) => {
  if (v === 'yes') return SEQUENTIAL[2];
  if (v === 'no') return INK.neutral;
  if (/^[0-3]$/.test(v)) return SEQUENTIAL[Number(v)];
  return INK.surface;
};

for (const [n, lens] of lenses.entries()) {
  const group = new Map(
    assignments.filter((a) => a.lens === lens.id).map((a) => [a.offering, a.category]),
  );
  const rank = (id) => {
    const c = group.get(id) ?? 'misfit';
    const i = lens.categories.indexOf(c);
    return (NON_FITS.includes(c) ? 1000 : 0) + (i < 0 ? 999 : i);
  };
  const rows = offerings
    .map((o) => o.id)
    .sort((a, b) => rank(a) - rank(b) || names.get(a).localeCompare(names.get(b)));
  const label = (id) => `${group.get(id) ?? 'misfit'} · ${names.get(id)}`;
  const cells = facts.map((f) => ({ ...f, row: label(f.offering) }));

  const plot = Plot.plot({
    document: document(),
    title: `Facts ordered by lens: ${lens.label}`,
    subtitle: isExample() ? EXAMPLE_NOTE : undefined,
    style: { background: INK.surface, color: INK.primary, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    marginLeft: 220,
    marginBottom: 150,
    width: 220 + factIds.length * 44 + 20,
    height: 150 + rows.length * 30 + 40,
    padding: 0.06,
    x: { domain: factIds, tickRotate: -40, label: null },
    y: { domain: rows.map(label), label: null },
    color: { type: 'identity' },
    marks: [
      Plot.cell(cells, {
        x: 'fact',
        y: 'row',
        fill: (d) => fill(d.value),
        stroke: (d) => (d.value === 'unknown' ? INK.grid : 'none'),
        rx: 2,
        title: (d) => `${names.get(d.offering)}\n${d.fact} = ${d.value}${d.source_url ? `\n${d.source_url} (${d.source_date})` : ''}`,
      }),
      Plot.text(cells.filter((d) => d.value === 'unknown'), {
        x: 'fact', y: 'row', text: () => '?', fill: INK.muted,
      }),
    ],
  });

  write(`heatmap.${n}.${lens.id}.html`, plot.outerHTML);
}
