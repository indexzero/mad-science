// Score every lens over the fact base, and write data/scores.csv,
// data/lens-agreement.csv, and out/scores.md.
//
// - category utility (Gluck & Corter, 1985): members of a group are alike and
//   groups differ. Facts are categorical; `unknown` is its own value.
// - permutation p: the share of 2000 random partitions, with the same group
//   sizes, whose category utility is at least as high. Small is good.
// - misfits: offerings the lens places in `hybrid` or `misfit`.
// - stability: the range of category utility when each offering is left out.
// - surprise: the share of offerings where the lens disagrees with the
//   pre-registered prediction for that lens.
// - held-out category utility and p: the same two scores, computed only on
//   the facts that the lens rules do NOT read. A lens always groups well on
//   its own inputs, so this is the honest test of what it reveals.
// - agreement: normalized mutual information between each pair of lenses.
//   Near 1 means one lens is redundant with the other.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { csvFormat, csvParse } from 'd3';
import { NON_FITS, dataDir, write } from './lib.mjs';

const dir = dataDir();
const read = (name) => csvParse(readFileSync(join(dir, `${name}.csv`), 'utf8'));
const offerings = read('offerings').map((o) => o.id);
const lenses = read('lenses');
const facts = read('facts');
const assignments = read('assignments');
const predictions = read('predictions');
const links = read('links');
const operators = new Map(read('operators').map((o) => [o.id, o]));

const allFacts = [...new Set(facts.map((f) => f.fact))];
let factIds = allFacts;

// The facts each lens rule reads (see scripts/lenses.mjs). The prediction is
// not computed from facts, and trust-surface reads links, so both use none.
const USES = {
  prediction: [],
  family: ['proof.key_signs_claim', 'proof.anchor_publishes_key', 'proof.third_party_signs_binding', 'proof.capability_delegation'],
  'verify-trust': ['verify.offline_possible', 'verify.fetches_anchor', 'verify.needs_issuer_trust', 'verify.needs_registry'],
  pki: ['proof.key_signs_claim', 'proof.third_party_signs_binding'],
  'anchor-role': ['proof.anchor_is_social', 'proof.anchor_publishes_key', 'proof.uses_oauth_oidc', 'proof.anchor_is_dns'],
  lifecycle: ['lifecycle.explicit_revocation', 'lifecycle.expiry'],
  'effort-tier': ['effort.attachable', 'effort.requires_platform_migration'],
  'trust-surface': [],
};
const value = new Map(facts.map((f) => [`${f.offering}\u0000${f.fact}`, f.value]));
const partition = (lens) => new Map(
  assignments.filter((a) => a.lens === lens).map((a) => [a.offering, a.category]),
);

function categoryUtility(items, groupOf) {
  const sumSq = (members) => {
    let total = 0;
    for (const fact of factIds) {
      const counts = new Map();
      for (const o of members) {
        const v = value.get(`${o}\u0000${fact}`) ?? 'unknown';
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      for (const n of counts.values()) total += (n / members.length) ** 2;
    }
    return total;
  };
  const base = sumSq(items);
  const groups = new Map();
  for (const o of items) {
    const g = groupOf(o);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(o);
  }
  let cu = 0;
  for (const members of groups.values()) cu += (members.length / items.length) * (sumSq(members) - base);
  return cu / groups.size;
}

// Deterministic shuffle so the scores do not change between runs.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
function permutationP(items, groupOf, cu, runs = 2000) {
  const random = rng(42);
  const labels = items.map(groupOf);
  let atLeast = 0;
  for (let r = 0; r < runs; r++) {
    const shuffled = [...labels];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const map = new Map(items.map((o, i) => [o, shuffled[i]]));
    if (categoryUtility(items, (o) => map.get(o)) >= cu - 1e-12) atLeast++;
  }
  return (atLeast + 1) / (runs + 1);
}

function nmi(a, b) {
  const n = offerings.length;
  const count = (f) => {
    const m = new Map();
    for (const o of offerings) m.set(f(o), (m.get(f(o)) ?? 0) + 1);
    return m;
  };
  const pa = count((o) => a.get(o));
  const pb = count((o) => b.get(o));
  const pab = count((o) => `${a.get(o)}\u0000${b.get(o)}`);
  const h = (m) => -[...m.values()].reduce((s, c) => s + (c / n) * Math.log(c / n), 0);
  let mi = 0;
  for (const [k, c] of pab) {
    const [x, y] = k.split('\u0000');
    mi += (c / n) * Math.log((c / n) / ((pa.get(x) / n) * (pb.get(y) / n)));
  }
  const denom = Math.sqrt(h(pa) * h(pb));
  return denom === 0 ? 0 : mi / denom;
}

const rows = [];
for (const lens of lenses) {
  const p = partition(lens.id);
  const groupOf = (o) => p.get(o) ?? 'misfit';
  factIds = allFacts;
  const cu = categoryUtility(offerings, groupOf);
  const p_all = permutationP(offerings, groupOf, cu);
  factIds = allFacts.filter((f) => !(USES[lens.id] ?? []).includes(f));
  const heldOut = categoryUtility(offerings, groupOf);
  const p_held = permutationP(offerings, groupOf, heldOut);
  factIds = allFacts;
  const loo = offerings.map((left) => categoryUtility(offerings.filter((o) => o !== left), groupOf));
  const predicted = new Map(predictions.filter((x) => x.lens === lens.id).map((x) => [x.offering, x.category]));
  const compared = offerings.filter((o) => predicted.has(o));
  const surprise = compared.length
    ? compared.filter((o) => predicted.get(o) !== groupOf(o)).length / compared.length
    : null;
  rows.push({
    lens: lens.id,
    label: lens.label,
    groups: new Set(offerings.map(groupOf)).size,
    category_utility: cu.toFixed(3),
    permutation_p: p_all.toFixed(3),
    held_out_cu: heldOut.toFixed(3),
    held_out_p: p_held.toFixed(3),
    misfits: offerings.filter((o) => NON_FITS.includes(groupOf(o))).length,
    stability_range: (Math.max(...loo) - Math.min(...loo)).toFixed(3),
    surprise: surprise === null ? '' : surprise.toFixed(2),
  });
}

const agreement = [];
for (const a of lenses) {
  for (const b of lenses) {
    agreement.push({ a: a.id, b: b.id, nmi: nmi(partition(a.id), partition(b.id)).toFixed(2) });
  }
}

writeFileSync(join(dir, 'scores.csv'), `${csvFormat(rows)}\n`);
writeFileSync(join(dir, 'lens-agreement.csv'), `${csvFormat(agreement)}\n`);
console.log(`wrote ${join(dir, 'scores.csv')} and lens-agreement.csv`);

const md = [
  '| Lens | Groups | Category utility | p | Held-out CU | Held-out p | Misfits | Stability range | Surprise |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.label} | ${r.groups} | ${r.category_utility} | ${r.permutation_p} | ${r.held_out_cu} | ${r.held_out_p} | ${r.misfits} | ${r.stability_range} | ${r.surprise} |`),
  '',
  `| NMI | ${lenses.map((l) => l.id).join(' | ')} |`,
  `|---|${lenses.map(() => '---').join('|')}|`,
  ...lenses.map((a) => `| ${a.id} | ${lenses.map((b) => agreement.find((x) => x.a === a.id && x.b === b.id).nmi).join(' | ')} |`),
];
// Sovereignty concentration: how many offerings depend on each operator.
const byOperator = new Map();
for (const l of links) {
  if (!byOperator.has(l.operator)) byOperator.set(l.operator, { offerings: new Set(), forge: new Set(), layers: new Set() });
  const b = byOperator.get(l.operator);
  b.offerings.add(l.offering);
  b.layers.add(l.layer);
  if (l.forge === 'yes') b.forge.add(l.offering);
}
const concentration = [...byOperator]
  .map(([id, b]) => ({
    operator: id,
    name: operators.get(id)?.name ?? id,
    kind: operators.get(id)?.kind ?? '',
    jurisdiction: operators.get(id)?.jurisdiction ?? '',
    offerings: b.offerings.size,
    can_forge_in: b.forge.size,
    layers: [...b.layers].sort().join('+'),
  }))
  .sort((a, b) => b.offerings - a.offerings || b.can_forge_in - a.can_forge_in || a.operator.localeCompare(b.operator));
writeFileSync(join(dir, 'concentration.csv'), `${csvFormat(concentration)}\n`);

const linked = [...new Set(links.map((l) => l.offering))];
const forgedFrom = (j) => linked.filter((o) => links.some((l) => l.offering === o && l.forge === 'yes'
  && operators.get(l.operator)?.jurisdiction === j));
md.push(
  '',
  `Offerings with operators: ${linked.length}. Offerings where a US operator can forge a link: ${forgedFrom('US').length}.`,
  `Offerings where a CH operator can forge a link: ${forgedFrom('CH').length}.`,
  '',
  '| Operator | Kind | Jurisdiction | Offerings | Can forge in | Layers |',
  '|---|---|---|---|---|---|',
  ...concentration.map((c) => `| ${c.name.replace(/\|/g, '/')} | ${c.kind} | ${c.jurisdiction} | ${c.offerings} | ${c.can_forge_in} | ${c.layers} |`),
);
write('scores.md', `${md.join('\n')}\n`);
