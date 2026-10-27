import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBatch } from '../src/decode.js';
import { invalidReason } from '../src/sessions.js';
import { windowsMicrosToIso } from '../src/time.js';
import { encrypted, fakeChain } from './fakes.js';

const emptyIndex = () => ({ devices: {}, cacheGuids: {}, sessionEntities: {} });

const header = {
  sessionTag: 'session_sync_1',
  header: { clientName: 'Test Phone', deviceFormFactor: 'DEVICE_FORM_FACTOR_PHONE', window: [{ windowId: 1, tab: [7] }] },
};
const tab = {
  sessionTag: 'session_sync_1',
  tabNodeId: 0,
  tab: {
    tabId: 7,
    windowId: 1,
    currentNavigationIndex: 0,
    lastActiveTimeUnixEpochMillis: '1792617501654',
    navigation: [{ virtualUrl: 'https://example.com/', title: 'Example Domain', timestampMsec: '1792617501000' }],
  },
};
const visit = {
  visitTimeWindowsEpochMicros: String(11_644_473_600_000_000n + 1_792_617_501_000_000n),
  originatorCacheGuid: 'cache-guid-1',
  redirectEntries: [
    { url: 'http://example.com/', title: '' },
    { url: 'https://example.com/', title: 'Example Domain' },
  ],
};

const entry = (id, specifics, extra = {}) => ({
  idString: id,
  version: '1',
  mtime: '1792617501654',
  originatorCacheGuid: 'cache-guid-1',
  specifics,
  ...extra,
});

test('Windows epoch micros become ISO time', () => {
  assert.equal(windowsMicrosToIso('11644473600000000'), '1970-01-01T00:00:00.000Z');
  assert.equal(windowsMicrosToIso('13404146400000000'), '2025-10-05T14:00:00.000Z');
});

test('session validity follows SessionStore::AreValidSpecifics', () => {
  assert.equal(invalidReason(header), null);
  assert.equal(invalidReason(tab), null);
  assert.match(invalidReason({ ...tab, sessionTag: '' }), /session_tag/);
  assert.match(invalidReason({ ...tab, header: header.header }), /exactly one/);
  assert.match(invalidReason({ ...tab, tabNodeId: -1 }), /tab_node_id/);
  assert.match(invalidReason({ ...header, tabNodeId: 3 }), /header with/);
  const twice = { ...header, header: { window: [{ tab: [7] }, { tab: [7] }] } };
  assert.match(invalidReason(twice), /twice/);
});

test('decodes nigori first, then sessions and history, joining device names', async () => {
  const chain = fakeChain();
  const nigori = { specificsVariant: 'nigori', nigori: { passphraseType: 4 } };
  const entries = [
    entry('v1', encrypted('history', visit)),
    entry('t1', encrypted('session', tab)),
    entry('h1', encrypted('session', header)),
    entry('n1', nigori, { folder: true }),
  ];
  const { records, index } = await decodeBatch(entries, { chain, index: emptyIndex() });
  assert.deepEqual(records.map((r) => r.kind), ['nigori', 'visit', 'tab', 'session-header']);
  assert.deepEqual(chain.nigori, { passphraseType: 4 });

  const again = await decodeBatch(entries.slice(0, 2), { chain, index });
  const [v, t] = again.records;
  assert.equal(v.visitedAt, '2026-10-21T21:18:21.000Z');
  assert.equal(v.url, 'https://example.com/');
  assert.equal(v.device, 'Test Phone');
  assert.equal(t.device, 'Test Phone');
  assert.equal(t.title, 'Example Domain');
  assert.equal(t.lastActiveAt, '2026-10-21T21:18:21.654Z');
});

test('a tab that arrives before its header in the same batch still gets the device name', async () => {
  const entries = [entry('t1', encrypted('session', tab)), entry('h1', encrypted('session', header))];
  const { records } = await decodeBatch(entries, { chain: fakeChain(), index: emptyIndex() });
  assert.equal(records[0].kind, 'tab');
  assert.equal(records[0].device, 'Test Phone');
});

test('a tombstone keeps the session tag and tab node it deleted', async () => {
  const chain = fakeChain();
  const first = await decodeBatch([entry('t1', encrypted('session', tab))], { chain, index: emptyIndex() });
  const gone = entry('t1', { specificsVariant: 'session', session: {} }, { deleted: true, version: '2' });
  const { records } = await decodeBatch([gone], { chain, index: first.index });
  assert.deepEqual(records[0], {
    kind: 'tombstone',
    type: 'session',
    sessionTag: 'session_sync_1',
    tabNodeId: 0,
    entity: { ...records[0].entity, id: 't1', deleted: true },
  });
});

test('an unknown key fails the whole batch and leaves the index untouched', async () => {
  const index = emptyIndex();
  const entries = [entry('h1', encrypted('session', header)), entry('v1', encrypted('history', visit, 'k2'))];
  await assert.rejects(decodeBatch(entries, { chain: fakeChain(), index }), (e) => e.code === 'UNKNOWN_KEY');
  assert.deepEqual(index, emptyIndex());
});

test('a decrypted payload of the wrong type is refused', async () => {
  const wrong = { ...encrypted('history', visit), session: {}, specificsVariant: 'session' };
  delete wrong.history;
  await assert.rejects(decodeBatch([entry('x', wrong)], { chain: fakeChain(), index: emptyIndex() }), /inside a session/);
});
