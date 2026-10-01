// Compute every lens from the fact base, and write data/assignments.csv.
// A lens is a set of rules over facts. When no rule matches, the offering is
// a misfit. When more than one matches, it is a hybrid. The rules were fixed
// before any facts were collected (see RESEARCH.LOG.md).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { csvFormat, csvParse } from 'd3';
import { dataDir } from './lib.mjs';

const dir = dataDir();
const read = (name) => csvParse(readFileSync(join(dir, `${name}.csv`), 'utf8'));

const offerings = read('offerings');
const facts = read('facts');
const links = read('links');
const predictions = read('predictions');

const value = new Map(facts.map((f) => [`${f.offering}\u0000${f.fact}`, f.value]));
const yes = (o, fact) => value.get(`${o}\u0000${fact}`) === 'yes';
const no = (o, fact) => value.get(`${o}\u0000${fact}`) === 'no';

// Each lens maps a category to a predicate over one offering.
export const LENSES = {
  family: {
    bidirectional: (o) => yes(o, 'proof.key_signs_claim') && yes(o, 'proof.anchor_publishes_key')
      && !yes(o, 'proof.third_party_signs_binding'),
    issuer: (o) => yes(o, 'proof.third_party_signs_binding') && !yes(o, 'proof.capability_delegation'),
    delegation: (o) => yes(o, 'proof.capability_delegation'),
  },
  'verify-trust': {
    nobody: (o) => yes(o, 'verify.offline_possible') && !yes(o, 'verify.fetches_anchor')
      && !yes(o, 'verify.needs_issuer_trust') && !yes(o, 'verify.needs_registry'),
    anchor: (o) => yes(o, 'verify.fetches_anchor'),
    issuer: (o) => yes(o, 'verify.needs_issuer_trust'),
    registry: (o) => yes(o, 'verify.needs_registry'),
  },
  pki: {
    'self-issued': (o) => yes(o, 'proof.key_signs_claim'),
    'third-party': (o) => yes(o, 'proof.third_party_signs_binding'),
  },
  'anchor-role': {
    passive: (o) => yes(o, 'proof.anchor_is_social') && yes(o, 'proof.anchor_publishes_key')
      && !yes(o, 'proof.uses_oauth_oidc'),
    cooperative: (o) => yes(o, 'proof.uses_oauth_oidc'),
    dns: (o) => yes(o, 'proof.anchor_is_dns') && yes(o, 'proof.anchor_publishes_key'),
  },
  lifecycle: {
    revoked: (o) => yes(o, 'lifecycle.explicit_revocation'),
    expires: (o) => yes(o, 'lifecycle.expiry'),
    deleted: (o) => no(o, 'lifecycle.explicit_revocation') && no(o, 'lifecycle.expiry'),
  },
  'effort-tier': {
    attach: (o) => yes(o, 'effort.attachable'),
    migrate: (o) => yes(o, 'effort.requires_platform_migration'),
  },
  'trust-surface': {
    none: (o) => !links.some((l) => l.offering === o && l.forge === 'yes'),
    anchor: (o) => links.some((l) => l.offering === o && l.forge === 'yes' && l.layer === 'anchor'),
    'third-party': (o) => links.some((l) => l.offering === o && l.forge === 'yes' && l.layer !== 'anchor'),
  },
};

export function assign(o, rules) {
  const matches = Object.entries(rules).filter(([, rule]) => rule(o)).map(([c]) => c);
  if (matches.length === 1) return matches[0];
  return matches.length ? 'hybrid' : 'misfit';
}

const rows = [];
for (const { offering, lens, category } of predictions) {
  if (lens === 'family') rows.push({ offering, lens: 'prediction', category });
}
for (const [lens, rules] of Object.entries(LENSES)) {
  for (const { id } of offerings) rows.push({ offering: id, lens, category: assign(id, rules) });
}
writeFileSync(join(dir, 'assignments.csv'), `${csvFormat(rows)}\n`);
console.log(`wrote ${join(dir, 'assignments.csv')}`);
