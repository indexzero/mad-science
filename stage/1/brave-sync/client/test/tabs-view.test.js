import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openArchive } from '../src/archive.js';
import { latestTabs, renderTabs } from '../src/tabs-view.js';

const tab = (id, version, fields) => ({
  kind: 'tab',
  sessionTag: 'session_sync_1',
  tabNodeId: 0,
  device: 'Test Laptop',
  entity: { id, version: String(version) },
  ...fields,
});

test('keeps only the newest version of each tab entity', async () => {
  const records = [
    tab('a', 1, { url: 'https://example.com/old' }),
    tab('b', 5, { url: 'https://example.org/' }),
    tab('a', 3, { url: 'https://example.com/new' }),
    tab('a', 2, { url: 'https://example.com/middle' }),
  ];
  const latest = await latestTabs(records);
  assert.deepEqual(latest.map((t) => t.url).sort(), ['https://example.com/new', 'https://example.org/']);
});

test('groups by device, newest activity first, and falls back to the session tag', () => {
  const text = renderTabs([
    tab('a', 1, { title: 'Older', url: 'https://example.com/a', lastActiveAt: '2026-10-21T21:18:14.757Z' }),
    tab('b', 1, { title: 'Newer', url: 'https://example.com/b', lastActiveAt: '2026-10-21T21:19:00.000Z', specifics: { tab: { pinned: true } } }),
    tab('c', 1, { device: null, title: '', url: 'https://example.net/', navigatedAt: '2026-10-20T08:00:00.000Z' }),
  ]);
  assert.equal(
    text,
    [
      'Test Laptop  (2 tabs)',
      '  2026-10-21 21:19Z  Newer  [pinned]',
      '                     https://example.com/b',
      '  2026-10-21 21:18Z  Older',
      '                     https://example.com/a',
      '',
      'session session_sync_1  (1 tab)',
      '  2026-10-20 08:00Z  (untitled)',
      '                     https://example.net/',
    ].join('\n'),
  );
  assert.equal(renderTabs([]), 'no tabs archived yet');
});

test('the archive streams tabs.jsonl, and a missing file is no tabs', async () => {
  const archive = await openArchive(await mkdtemp(join(tmpdir(), 'brave-sync-')));
  assert.deepEqual(await latestTabs(archive.records('tab')), []);
  await archive.append([tab('a', 1, { url: 'https://example.com/' }), { kind: 'visit', url: 'x' }], 't0');
  const tabs = await latestTabs(archive.records('tab'));
  assert.deepEqual(tabs.map((t) => [t.archivedAt, t.url]), [['t0', 'https://example.com/']]);
});
