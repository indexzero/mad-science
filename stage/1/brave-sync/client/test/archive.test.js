import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openArchive } from '../src/archive.js';
import { pull } from '../src/pull.js';
import { TYPES } from '../src/transport.js';
import { encrypted, fakeChain } from './fakes.js';

const tempArchive = async () => openArchive(await mkdtemp(join(tmpdir(), 'brave-sync-')));

test('append only ever adds lines', async () => {
  const archive = await tempArchive();
  await archive.append([{ kind: 'visit', url: 'a' }], 't0');
  await archive.append([{ kind: 'visit', url: 'b' }], 't1');
  const lines = (await readFile(join(archive.dir, 'visits.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines, [{ archivedAt: 't0', kind: 'visit', url: 'a' }, { archivedAt: 't1', kind: 'visit', url: 'b' }]);
});

test('pull archives, then saves markers without the NIGORI marker', async () => {
  const archive = await tempArchive();
  const state = await archive.loadState();
  const visit = { visitTimeWindowsEpochMicros: '13404146400000000', redirectEntries: [{ url: 'https://example.com/' }] };
  const sent = [];
  const post = async (message) => {
    sent.push(message);
    return {
      storeBirthday: '1',
      getUpdates: {
        changesRemaining: '0',
        entries: [
          { idString: 'n', version: '1', folder: true, specifics: { specificsVariant: 'nigori', nigori: {} } },
          { idString: 'v', version: '1', specifics: encrypted('history', visit) },
        ],
        newProgressMarker: [
          { dataTypeId: TYPES.NIGORI, token: 'nigori-token' },
          { dataTypeId: TYPES.HISTORY, token: 'history-token' },
        ],
      },
    };
  };
  const result = await pull({ chain: fakeChain(), post, archive, state, now: () => new Date(0) });
  assert.equal(result.records, 2);
  const saved = await archive.loadState();
  assert.deepEqual(saved.markers, { [TYPES.HISTORY]: 'history-token' });
  assert.equal(saved.storeBirthday, '1');
  assert.equal(sent[0].getUpdates.fromProgressMarker[0].token, undefined);
  const visits = await readFile(join(archive.dir, 'visits.jsonl'), 'utf8');
  assert.match(visits, /"url":"https:\/\/example.com\/"/);
});
