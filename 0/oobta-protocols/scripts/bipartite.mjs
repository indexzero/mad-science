// Sovereignty bipartite graph as Mermaid: offerings on the left, operators on
// the right grouped by jurisdiction. Node shape encodes operator kind, edge
// weight encodes the strongest power the operator holds over that layer.
import { CATEGORICAL, EXAMPLE_NOTE, INK, isExample, load, write } from './lib.mjs';

const { offerings, operators, links } = load();

const SHAPES = {
  platform: 'rounded',
  registry: 'cyl',
  log: 'lin-cyl',
  ca: 'hex',
  dns: 'div-rect',
  'relay-set': 'processes',
  dht: 'cloud',
};
const JURISDICTIONS = [
  { id: 'US', label: 'United States', color: CATEGORICAL[0] },
  { id: 'CH', label: 'Switzerland', color: CATEGORICAL[1] },
  { id: 'other', label: 'Other or varies', color: CATEGORICAL[2] },
  { id: 'none', label: 'No single operator', color: INK.fold, dashed: true },
];

const id = (s) => s.replace(/[^A-Za-z0-9_]/g, '_');
const quote = (s) => `"${s.replace(/"/g, '#quot;')}"`;
const node = (key, label, shape) => `${id(key)}@{ shape: ${shape}, label: ${quote(label)} }`;

const used = new Set(links.map((l) => l.offering));
const lines = [];
if (isExample()) lines.push('---', `title: ${quote(`Sovereignty (${EXAMPLE_NOTE})`)}`, '---');
lines.push('flowchart LR');

lines.push('    subgraph OFFERINGS ["Offerings"]', '        direction TB');
for (const o of offerings.filter((o) => used.has(o.id))) {
  lines.push(`        ${node(`o_${o.id}`, o.name, 'doc')}`);
}
lines.push('    end');

for (const j of JURISDICTIONS) {
  const members = operators.filter((op) => op.jurisdiction === j.id);
  if (!members.length) continue;
  lines.push(`    subgraph J_${id(j.id)} [${quote(j.label)}]`, '        direction TB');
  for (const op of members) {
    lines.push(`        ${node(`p_${op.id}`, `${op.name}<br/>(${op.kind})`, SHAPES[op.kind] ?? 'rect')}`);
  }
  lines.push('    end');
}

// Forge is drawn thick, censor solid, disclose-only dotted. Mermaid 12 uses
// its own dash pattern to draw edges, so the styles are set per link index.
const yes = (v) => v === 'yes';
const linkStyles = [];
for (const [i, l] of links.entries()) {
  const powers = [yes(l.forge) && 'F', yes(l.censor) && 'C', yes(l.disclose) && 'D'].filter(Boolean);
  const label = quote(`${l.layer}: ${powers.join(' · ') || 'none'}`);
  const from = id(`o_${l.offering}`);
  const to = id(`p_${l.operator}`);
  lines.push(`    ${from} -- ${label} --> ${to}`);
  if (yes(l.forge)) linkStyles.push(`    linkStyle ${i} stroke:${INK.primary},stroke-width:3.5px`);
  else if (yes(l.censor)) linkStyles.push(`    linkStyle ${i} stroke:${INK.primary},stroke-width:1.5px`);
  else linkStyles.push(`    linkStyle ${i} stroke:${INK.secondary},stroke-width:1.5px,stroke-dasharray:3 4`);
}
lines.push(...linkStyles);

lines.push(
  `    classDef offering fill:${INK.surface},stroke:${INK.secondary},stroke-width:1px,color:${INK.primary}`,
  `    class ${offerings.filter((o) => used.has(o.id)).map((o) => id(`o_${o.id}`)).join(',')} offering`,
  `    style OFFERINGS fill:none,stroke:${INK.secondary}`,
);
for (const j of JURISDICTIONS) {
  const members = operators.filter((op) => op.jurisdiction === j.id);
  if (!members.length) continue;
  const dash = j.dashed ? ',stroke-dasharray:4 3' : '';
  lines.push(
    `    classDef j_${id(j.id)} fill:${INK.surface},stroke:${j.color},stroke-width:3px,color:${INK.primary}${dash}`,
    `    class ${members.map((op) => id(`p_${op.id}`)).join(',')} j_${id(j.id)}`,
    `    style J_${id(j.id)} fill:${j.color}14,stroke:${j.color}${dash}`,
  );
}

write('sovereignty.mmd', `${lines.join('\n')}\n`);
