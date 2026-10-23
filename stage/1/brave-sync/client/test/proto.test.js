import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientToServerMessage, decode, encode, tokenMtime } from '../src/proto.js';

test('a GetUpdates message survives encode and decode', () => {
  const message = {
    share: 'AB CD @brave.com',
    protocolVersion: 99,
    messageContents: 'GET_UPDATES',
    getUpdates: { fetchFolders: true, getUpdatesOrigin: 'PERIODIC', fromProgressMarker: [{ dataTypeId: 47745 }] },
  };
  assert.deepEqual(decode(ClientToServerMessage, encode(ClientToServerMessage, message)), message);
});

test('a progress marker token is a zigzag varint of the mtime, padded to 10 bytes', () => {
  // binary.PutVarint(token, 1792617531700) into make([]byte, binary.MaxVarintLen64), as go-sync writes it.
  assert.equal(tokenMtime('6KSmhaxoAAAAAA=='), '1792617531700');
  // binary.PutVarint(token, 0), the token go-sync returns for a type with no entities.
  assert.equal(tokenMtime('AAAAAAAAAAAAAA=='), '0');
});
