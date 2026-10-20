import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snappyUncompress, decodeIwa, parseMessage, looksLikeString, harvestStrings, iwaArchives } from '../key.js';

// A hand-built snappy block: literal "abcd" then a copy of 4 bytes at offset 4 (copy1: len 4, offset 4).
test('snappyUncompress handles literals and overlapping copies', () => {
  const block = Buffer.from([8, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x01, 0x04]);
  assert.equal(snappyUncompress(block).toString(), 'abcdabcd');
  // long literal (len >= 60): tag 60<<2 with one length byte
  const lit = Buffer.alloc(70, 0x41);
  const long = Buffer.concat([Buffer.from([70, 60 << 2, 69]), lit]);
  assert.equal(snappyUncompress(long).toString(), 'A'.repeat(70));
});

test('decodeIwa reads chunk framing: type 0x00 and 3 byte little-endian length', () => {
  const block = Buffer.from([8, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x01, 0x04]);
  const framed = Buffer.concat([Buffer.from([0, block.length, 0, 0]), block, Buffer.from([0, block.length, 0, 0]), block]);
  const { data, chunks } = decodeIwa(framed);
  assert.equal(chunks, 2);
  assert.equal(data.toString(), 'abcdabcdabcdabcd');
  assert.throws(() => decodeIwa(Buffer.from([1, 0, 0, 0])), /chunk type 1/);
});

test('parseMessage walks varint, fixed, and length-delimited fields', () => {
  // field 1 varint 300, field 2 string "hi", field 3 fixed32
  const msg = Buffer.from([0x08, 0xac, 0x02, 0x12, 0x02, 0x68, 0x69, 0x1d, 1, 2, 3, 4]);
  const f = parseMessage(msg);
  assert.equal(f.length, 3);
  assert.equal(f[0].field, 1);
  assert.equal(f[0].value, 300n);
  assert.equal(f[1].bytes.toString(), 'hi');
  assert.equal(f[2].wire, 5);
  assert.equal(parseMessage(Buffer.from([0x0f])), null);
});

test('looksLikeString accepts text and rejects binary', () => {
  assert.equal(looksLikeString(Buffer.from('Avenir-Heavy')), 'Avenir-Heavy');
  assert.equal(looksLikeString(Buffer.from([0x00, 0x01, 0x02])), false);
  assert.equal(looksLikeString(Buffer.from('a')), false);
  assert.equal(looksLikeString(Buffer.from([0xff, 0xfe, 0x41, 0x42])), false);
});

test('iwaArchives splits payloads by ArchiveInfo and harvestStrings finds nested strings', () => {
  // payload: field 1 string "OCTOBER", field 2 message { field 1 string "Avenir-Heavy" }
  const inner = Buffer.from([0x0a, 12, ...Buffer.from('Avenir-Heavy')]);
  const payload = Buffer.from([0x0a, 7, ...Buffer.from('OCTOBER'), 0x12, inner.length, ...inner]);
  // MessageInfo: field 1 type 1, field 3 length
  const mi = Buffer.from([0x08, 1, 0x18, payload.length]);
  // ArchiveInfo: field 1 identifier 42, field 2 MessageInfo
  const ai = Buffer.from([0x08, 42, 0x12, mi.length, ...mi]);
  const stream = Buffer.from([ai.length, ...ai, ...payload]);
  const archives = [...iwaArchives(stream)];
  assert.equal(archives.length, 1);
  assert.equal(archives[0].identifier, 42);
  assert.equal(archives[0].payloads[0].type, 1);
  const out = [];
  harvestStrings(archives[0].payloads[0].bytes, out);
  assert.deepEqual(out, ['OCTOBER', 'Avenir-Heavy']);
});
