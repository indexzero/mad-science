// Merge the research agents' JSON in data/raw/ into the fact base:
// facts.csv, operators.csv, links.csv, sources.csv, and one page per
// offering in offerings/. Missing facts become `unknown`, never blank.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { csvFormat, csvParse } from 'd3';
import { ROOT } from './lib.mjs';

const DATA = join(ROOT, 'data');
const RAW = join(DATA, 'raw');
const PAGES = join(ROOT, 'offerings');

const read = (name) => csvParse(readFileSync(join(DATA, `${name}.csv`), 'utf8'));
const offerings = read('offerings');
const definitions = read('fact-definitions');
// Corrections to the agents' facts, each with a reason. `na` means the fact
// does not apply (for example, a key fact for a system with no key).
const overrides = new Map(read('overrides').map((o) => [`${o.offering}\u0000${o.fact}`, o]));

const groups = readdirSync(RAW)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(RAW, f), 'utf8')) }));

const warnings = [];
const found = new Map();
for (const g of groups) for (const o of g.offerings) found.set(o.id, { ...o, group: g.group });

const facts = [];
for (const { id } of offerings) {
  const o = found.get(id);
  if (!o) warnings.push(`no research for offering ${id}`);
  const given = new Map((o?.facts ?? []).map((f) => [f.fact, f]));
  for (const extra of given.keys()) {
    if (!definitions.some((d) => d.id === extra)) warnings.push(`${id}: unknown fact id ${extra}`);
  }
  for (const d of definitions) {
    const f = given.get(d.id);
    const override = overrides.get(`${id}\u0000${d.id}`);
    let value = String(override?.value ?? f?.value ?? 'unknown').toLowerCase();
    if (!['yes', 'no', 'unknown', 'na', '0', '1', '2', '3'].includes(value)) {
      warnings.push(`${id}: ${d.id} has value "${value}", recorded as unknown`);
      value = 'unknown';
    }
    if (!f) warnings.push(`${id}: ${d.id} not reported, recorded as unknown`);
    facts.push({
      offering: id,
      fact: d.id,
      value,
      source_url: f?.source_url ?? '',
      source_date: f?.source_date ?? '',
      note: override ? `Override (was ${f?.value ?? 'unreported'}): ${override.reason}` : (f?.note ?? ''),
    });
    if (!['unknown', 'na'].includes(value) && !f?.source_url) warnings.push(`${id}: ${d.id} = ${value} has no source`);
  }
}

const operators = new Map();
for (const g of groups) {
  for (const op of g.operators ?? []) {
    const prior = operators.get(op.id);
    if (prior && prior.jurisdiction !== op.jurisdiction) {
      warnings.push(`operator ${op.id}: ${g.group} says ${op.jurisdiction}, ${prior.group} says ${prior.jurisdiction}; kept ${prior.jurisdiction}`);
    }
    if (!prior) operators.set(op.id, { ...op, group: g.group });
  }
}

// Corrections to operator fields, each with a reason and a source.
for (const o of read('operator-overrides')) {
  const op = operators.get(o.id);
  if (!op) { warnings.push(`operator override for unknown operator ${o.id}`); continue; }
  op[o.field] = o.value;
  if (o.source_url) op.source_url = o.source_url;
}

const links = [];
for (const g of groups) {
  for (const l of g.links ?? []) {
    if (!operators.has(l.operator)) warnings.push(`link ${l.offering} → ${l.operator}: operator not defined`);
    links.push(l);
  }
}

// Corrections to links, each with a reason.
for (const o of read('link-overrides')) {
  const hits = links.filter((l) => l.offering === o.offering && l.layer === o.layer && l.operator === o.operator);
  if (!hits.length) warnings.push(`link override matches no link: ${o.offering} ${o.layer} ${o.operator}`);
  for (const l of hits) {
    l.note = `Override ${o.field} ${l[o.field]} → ${o.value}. ${l.note ?? ''}`.trim();
    l[o.field] = o.value;
  }
}

const sources = new Map();
for (const g of groups) for (const s of g.sources ?? []) if (s.url && !sources.has(s.url)) sources.set(s.url, s);
for (const f of facts) if (f.source_url && !sources.has(f.source_url)) sources.set(f.source_url, { title: '', url: f.source_url, date: f.source_date });

const write = (name, rows, columns) => {
  writeFileSync(join(DATA, `${name}.csv`), `${csvFormat(rows, columns)}\n`);
  console.log(`wrote data/${name}.csv (${rows.length} rows)`);
};
write('facts', facts, ['offering', 'fact', 'value', 'source_url', 'source_date', 'note']);
write('operators', [...operators.values()], ['id', 'name', 'kind', 'jurisdiction', 'jurisdiction_note', 'source_url']);
write('links', links, ['offering', 'layer', 'operator', 'forge', 'censor', 'disclose', 'note']);
write('sources', [...sources.values()], ['title', 'url', 'date']);

// One page per offering.
const CRITERIA = {
  C1: 'Proof mechanism', C2: 'Verifier independence', C3: 'Platform coverage and fragility',
  C4: 'Key lifecycle', C5: 'Freshness and replay', C6: 'Threat model',
  C7: 'Key system portability', C8: 'Adoption and status', C9: 'Effort tier', C10: 'Sovereignty',
};
const yaml = (s) => JSON.stringify(String(s ?? ''));
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
mkdirSync(PAGES, { recursive: true });
for (const { id, name } of offerings) {
  const o = found.get(id);
  if (!o) continue;
  const mine = facts.filter((f) => f.offering === id);
  const unknown = mine.filter((f) => f.value === 'unknown').length;
  const lines = [
    '---',
    `id: ${yaml(id)}`,
    `name: ${yaml(name)}`,
    `research_group: ${yaml(o.group)}`,
    `facts_known: ${mine.length - unknown}`,
    `facts_unknown: ${unknown}`,
    '---',
    '',
    `# ${name}`,
    '',
  ];
  for (const [c, title] of Object.entries(CRITERIA)) {
    lines.push(`## ${c}. ${title}`, '', o.summary?.[c] ?? '_Not reported._', '');
  }
  lines.push('## Misfit notes', '', o.misfit_notes || '_None._', '');
  lines.push('## Surprises', '', o.surprises || '_None._', '');
  lines.push('## Facts', '', '| Fact | Value | Source | Date | Note |', '|---|---|---|---|---|');
  for (const f of mine) {
    const src = f.source_url ? `[link](${f.source_url})` : '';
    lines.push(`| \`${f.fact}\` | ${f.value} | ${src} | ${cell(f.source_date)} | ${cell(f.note)} |`);
  }
  const ls = links.filter((l) => l.offering === id);
  if (ls.length) {
    // A small sovereignty graph for this offering only. GitHub renders it.
    const mid = (s) => s.replace(/[^A-Za-z0-9_]/g, '_');
    const q = (s) => `"${String(s).replace(/"/g, '#quot;')}"`;
    const graph = ['', '## Sovereignty', '', '```mermaid', 'flowchart LR', `    O[${q(name)}]`];
    for (const [i, l] of ls.entries()) {
      const op = operators.get(l.operator);
      const powers = [l.forge === 'yes' && 'forge', l.censor === 'yes' && 'censor', l.disclose === 'yes' && 'disclose'].filter(Boolean).join(', ') || 'none';
      graph.push(`    O -- ${q(`${l.layer}: ${powers}`)} --> P${i}[${q(`${op?.name ?? l.operator} (${op?.jurisdiction ?? '?'})`)}]`);
    }
    graph.push('```');
    lines.push(...graph);
    lines.push('', '## Operators', '', '| Layer | Operator | Forge | Censor | Disclose | Note |', '|---|---|---|---|---|---|');
    for (const l of ls) {
      const op = operators.get(l.operator);
      lines.push(`| ${l.layer} | ${cell(op?.name ?? l.operator)} (${cell(op?.jurisdiction ?? '?')}) | ${l.forge} | ${l.censor} | ${l.disclose} | ${cell(l.note)} |`);
    }
  }
  writeFileSync(join(PAGES, `${id}.md`), `${lines.join('\n')}\n`);
}
console.log(`wrote offerings/*.md (${found.size} pages)`);

writeFileSync(join(DATA, 'merge-warnings.txt'), `${warnings.join('\n')}\n`);
console.log(`${warnings.length} warnings in data/merge-warnings.txt`);
