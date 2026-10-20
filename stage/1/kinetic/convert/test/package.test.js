import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));

test('package.json names the scripts the design names', () => {
  assert.equal(pkg.name, 'kinetic');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.packageManager, 'pnpm@10.34.0');
  assert.equal(pkg.scripts.test, 'node --test convert/test/*.test.js');
  assert.equal(pkg.scripts.convert, 'node convert/index.js');
  assert.equal(pkg.scripts.e2e, 'playwright test');
  assert.equal(pkg.scripts.validate, 'node convert/validate.js decks/_all_docs/deck.json');
});

test('dev dependencies are pinned to exact versions', () => {
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is not an exact pin: ${version}`);
  }
});
