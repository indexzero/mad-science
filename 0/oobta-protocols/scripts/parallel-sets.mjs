// Parallel sets across lenses, one ribbon per offering.
// Column 0 lists the offerings; each later column is a lens. Ribbons keep the
// color of the first lens (the prediction), so a non-adjacent disagreement
// stays visible. See https://observablehq.com/@d3/parallel-sets.
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import {
  CATEGORICAL, EXAMPLE_NOTE, INK, NON_FITS, document, isExample, load, write,
} from './lib.mjs';

const { offerings, lenses, assignments } = load();

const category = new Map(
  assignments.map((a) => [`${a.offering}\u0000${a.lens}`, a.category]),
);
const columns = [
  { id: 'offering', label: 'Offering', categories: offerings.map((o) => o.id) },
  ...lenses,
];
const valueOf = (offering, column) =>
  column.id === 'offering' ? offering.id : category.get(`${offering.id}\u0000${column.id}`) ?? 'misfit';

// Color by the first lens. Fit categories take the categorical slots in order;
// non-fits and anything past the third slot fold to gray.
const first = lenses[0];
const fits = first.categories.filter((c) => !NON_FITS.includes(c));
const color = (offering) => {
  const i = fits.indexOf(valueOf(offering, first));
  return i >= 0 && i < CATEGORICAL.length ? CATEGORICAL[i] : INK.fold;
};

const names = new Map(offerings.map((o) => [o.id, o.name]));
const nodes = [];
const index = new Map();
columns.forEach((column, depth) => {
  for (const c of column.categories) {
    index.set(`${depth}\u0000${c}`, nodes.length);
    nodes.push({ depth, column: column.label, name: depth === 0 ? names.get(c) : c });
  }
});

const links = [];
for (const offering of offerings) {
  for (let d = 0; d < columns.length - 1; d++) {
    links.push({
      source: index.get(`${d}\u0000${valueOf(offering, columns[d])}`),
      target: index.get(`${d + 1}\u0000${valueOf(offering, columns[d + 1])}`),
      value: 1,
      offering,
      order: offerings.indexOf(offering),
    });
  }
}

const width = 240 * columns.length + 160;
const height = Math.max(420, offerings.length * 34);
const margin = { top: 48, right: 200, bottom: 36, left: 16 };

const layout = sankey()
  .nodeId((d) => d.index)
  .nodeAlign((d) => d.depth)
  .nodeWidth(4)
  .nodePadding(14)
  .nodeSort(null)
  .linkSort((a, b) => a.order - b.order)
  .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);

const graph = layout({
  nodes: nodes.map((d) => ({ ...d })),
  links: links.map((d) => ({ ...d })),
});
// Drop categories no offering landed in, so empty bars don't read as data.
graph.nodes = graph.nodes.filter((n) => n.value > 0);

const doc = document();
const svg = d3.select(doc.body).append('svg')
  .attr('xmlns', 'http://www.w3.org/2000/svg')
  .attr('viewBox', [0, 0, width, height])
  .attr('width', width)
  .attr('height', height)
  .attr('font-family', 'system-ui, -apple-system, "Segoe UI", sans-serif')
  .attr('font-size', 12);

svg.append('rect').attr('width', width).attr('height', height).attr('fill', INK.surface);

svg.append('g')
  .attr('fill', 'none')
  .selectAll('path')
  .data(graph.links)
  .join('path')
  .attr('d', sankeyLinkHorizontal())
  .attr('stroke', (d) => color(d.offering))
  .attr('stroke-opacity', 0.55)
  .attr('stroke-width', (d) => Math.max(1, d.width - 2))
  .append('title')
  .text((d) => `${d.offering.name}: ${d.source.name} → ${d.target.name}`);

svg.append('g')
  .selectAll('rect')
  .data(graph.nodes)
  .join('rect')
  .attr('x', (d) => d.x0)
  .attr('y', (d) => d.y0)
  .attr('width', (d) => d.x1 - d.x0)
  .attr('height', (d) => d.y1 - d.y0)
  .attr('fill', INK.primary)
  .append('title')
  .text((d) => `${d.column}: ${d.name} (${d.value})`);

svg.append('g')
  .selectAll('text')
  .data(graph.nodes)
  .join('text')
  .attr('x', (d) => d.x1 + 6)
  .attr('y', (d) => (d.y0 + d.y1) / 2)
  .attr('dy', '0.35em')
  .attr('fill', (d) => (NON_FITS.includes(d.name) ? INK.secondary : INK.primary))
  .attr('font-style', (d) => (NON_FITS.includes(d.name) ? 'italic' : null))
  .text((d) => (d.depth === 0 ? d.name : `${d.name} (${d.value})`));

svg.append('g')
  .selectAll('text')
  .data(columns)
  .join('text')
  .attr('x', (_, i) => graph.nodes.find((n) => n.depth === i)?.x0 ?? 0)
  .attr('y', margin.top - 18)
  .attr('fill', INK.secondary)
  .attr('font-weight', 600)
  .text((d) => d.label.toUpperCase());

if (isExample()) {
  svg.append('text')
    .attr('x', margin.left)
    .attr('y', height - 12)
    .attr('fill', INK.muted)
    .text(EXAMPLE_NOTE);
}

write('parallel-sets.svg', svg.node().outerHTML);
