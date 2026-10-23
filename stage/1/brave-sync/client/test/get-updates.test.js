import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReadOnly, TYPES } from '../src/transport.js';
import { buildGetUpdates, getUpdates, shareFor } from '../src/get-updates.js';

const share = shareFor('AB'.repeat(32));

test('share is the client id split in half, as Brave builds the account email', () => {
  assert.equal(shareFor('ABCD'), 'AB CD @brave.com');
});

test('the request asks for exactly NIGORI, SESSIONS and HISTORY, and is read-only', () => {
  const message = buildGetUpdates({ share, storeBirthday: null, markers: {} });
  assert.deepEqual(message.getUpdates.fromProgressMarker.map((m) => m.dataTypeId), [47745, 50119, 963985]);
  assert.equal(message.getUpdates.fetchFolders, true);
  assert.equal(message.storeBirthday, undefined);
  assert.doesNotThrow(() => assertReadOnly(message));
});

test('assertReadOnly refuses commits, NEW_CLIENT and other data types', () => {
  const message = buildGetUpdates({ share, storeBirthday: '1', markers: {} });
  assert.throws(() => assertReadOnly({ ...message, messageContents: 'COMMIT' }), /refusing COMMIT/);
  assert.throws(
    () => assertReadOnly({ ...message, getUpdates: { ...message.getUpdates, getUpdatesOrigin: 'NEW_CLIENT' } }),
    /NEW_CLIENT/,
  );
  const passwords = { ...message.getUpdates, fromProgressMarker: [{ dataTypeId: 45873 }] };
  assert.throws(() => assertReadOnly({ ...message, getUpdates: passwords }), /data type 45873/);
});

function fakePost(responses) {
  const sent = [];
  const post = async (message) => {
    sent.push(structuredClone(message));
    return responses.shift();
  };
  return { post, sent };
}

const page = (token, entries, changesRemaining) => ({
  errorCode: 'SUCCESS',
  storeBirthday: '1',
  clientCommand: { setSyncPollInterval: 30 },
  getUpdates: {
    entries,
    changesRemaining: String(changesRemaining),
    newProgressMarker: [{ dataTypeId: TYPES.HISTORY, token }],
  },
});

test('pages until changes_remaining is 0, sending back each new token', async () => {
  const { post, sent } = fakePost([page('t1', [{ idString: 'a' }], 1), page('t2', [{ idString: 'b' }], 0)]);
  const batches = [];
  for await (const batch of getUpdates({ post, share })) batches.push(batch);
  assert.equal(batches.length, 2);
  assert.equal(batches[1].markers[TYPES.HISTORY], 't2');
  assert.equal(sent[1].getUpdates.fromProgressMarker[2].token, 't1');
  assert.equal(sent[1].storeBirthday, '1');
});

test('stops with STALLED when changes remain but nothing moved', async () => {
  const { post } = fakePost([page('t1', [], 1)]);
  await assert.rejects(async () => {
    for await (const _ of getUpdates({ post, share, markers: { [TYPES.HISTORY]: 't1' } }));
  }, /STALLED/);
});

test('maps sync error codes to retryable and fatal errors', async () => {
  for (const [errorCode, retryable] of [['THROTTLED', true], ['TRANSIENT_ERROR', true], ['DISABLED_BY_ADMIN', false]]) {
    const { post } = fakePost([{ errorCode }]);
    await assert.rejects(
      async () => {
        for await (const _ of getUpdates({ post, share }));
      },
      (error) => error.code === errorCode && error.retryable === retryable,
    );
  }
});

test('a changed store birthday stops the pull', async () => {
  const { post } = fakePost([{ ...page('t1', [], 0), storeBirthday: '2' }]);
  await assert.rejects(async () => {
    for await (const _ of getUpdates({ post, share, storeBirthday: '1' }));
  }, /BIRTHDAY_CHANGED/);
});
