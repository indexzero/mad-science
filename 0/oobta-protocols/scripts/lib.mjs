import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvParse } from 'd3';
import { JSDOM } from 'jsdom';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, 'out');

// The real fact base lives in data/. Until it exists, fall back to the
// illustrative rows in data/example/. DATA_DIR overrides both.
export function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const real = join(ROOT, 'data');
  return existsSync(join(real, 'offerings.csv')) ? real : join(real, 'example');
}

export function isExample() {
  return dataDir().endsWith(join('data', 'example'));
}

function read(name) {
  return csvParse(readFileSync(join(dataDir(), `${name}.csv`), 'utf8'));
}

export function load() {
  const offerings = read('offerings');
  const lenses = read('lenses').map((l) => ({
    ...l,
    categories: l.categories.split('|'),
  }));
  return {
    offerings,
    lenses,
    assignments: read('assignments'),
    facts: read('facts'),
    operators: read('operators'),
    links: read('links'),
  };
}

export function document() {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

export function write(file, contents) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, file), contents);
  console.log(`wrote out/${file}`);
}

export const EXAMPLE_NOTE = 'ILLUSTRATIVE example data, not findings';

// Reference palette from the dataviz skill (light mode). Categorical slots
// 1-3 validate all-pairs; anything past three folds to neutral gray.
export const INK = {
  surface: '#fcfcfb',
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  neutral: '#f0efec',
  fold: '#a8a7a1',
};
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a'];
export const SEQUENTIAL = ['#86b6ef', '#3987e5', '#256abf', '#0d366b'];

// Categories that mark a lens failing to place an offering. They always sort
// last and always render in neutral gray.
export const NON_FITS = ['hybrid', 'misfit'];
