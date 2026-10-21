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

// ---------- checkpoint 2 (G3 CP1 fixes, D-009) ----------
import { parseKey, parseKeyGuarded } from '../key.js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, '..', '..', '.cache', 'test', `key-${process.pid}`);
mkdirSync(tmp, { recursive: true });

/** A stored zip with one entry, built by hand: local header, data, central directory, EOCD. */
function storedZip(name, data) {
  const n = Buffer.from(name);
  const crc = 0; // not checked by the reader
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + n.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + n.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, data, central, n, eocd]);
}

// one IWA entry: a framed snappy block holding an archive with the string OCTOBER
const inner = Buffer.from([0x0a, 12, ...Buffer.from('Avenir-Heavy')]);
const payload = Buffer.from([0x0a, 7, ...Buffer.from('OCTOBER'), 0x12, inner.length, ...inner]);
const mi = Buffer.from([0x08, 1, 0x18, payload.length]);
const ai = Buffer.from([0x08, 42, 0x12, mi.length, ...mi]);
const stream = Buffer.from([ai.length, ...ai, ...payload]);
const literal = Buffer.concat([Buffer.from([stream.length, (stream.length - 1) << 2]), stream]);
const framed = Buffer.concat([Buffer.from([0, literal.length, 0, 0]), literal]);
const keyFixture = join(tmp, 'tiny.key');
writeFileSync(keyFixture, storedZip('Index/Document.iwa', framed));

test('parseKey harvests the tiny fixture when the budget allows', () => {
  const { summary, strings } = parseKey(keyFixture, { fonts: ['Avenir-Heavy'], words: ['OCTOBER'] });
  assert.equal(summary.error, null);
  assert.equal(summary.budgetExhausted, false);
  assert.equal(summary.verdict, 'key path available');
  assert.deepEqual(strings.sort(), ['Avenir-Heavy', 'OCTOBER']);
  assert.deepEqual(summary.fontsFound, ['Avenir-Heavy']);
});

test('an exhausted budget returns no strings and the verdict unavailable (D-009)', () => {
  const { summary, strings } = parseKey(keyFixture, { budgetMs: 0 });
  assert.equal(summary.budgetExhausted, true);
  assert.deepEqual(strings, []);
  assert.equal(summary.strings, 0);
  assert.equal(summary.verdict, 'key path unavailable');
  assert.match(summary.stage, /budget exhausted/);
});

test('an error returns no strings and the verdict unavailable', () => {
  const bogus = join(tmp, 'bogus.key');
  writeFileSync(bogus, 'not a zip');
  const { summary, strings } = parseKey(bogus);
  assert.match(summary.error, /zip/);
  assert.deepEqual(strings, []);
  assert.equal(summary.verdict, 'key path unavailable');
});

test('parseKeyGuarded runs in a worker and times out hard', async () => {
  const ok = await parseKeyGuarded(keyFixture, { fonts: ['Avenir-Heavy'] }, { timeoutMs: 10000 });
  assert.equal(ok.summary.verdict, 'key path available');
  assert.deepEqual(ok.strings.sort(), ['Avenir-Heavy', 'OCTOBER']);
  const late = await parseKeyGuarded(keyFixture, {}, { timeoutMs: 0 });
  assert.equal(late.summary.stage, 'timeout');
  assert.equal(late.summary.verdict, 'key path unavailable');
  assert.deepEqual(late.strings, []);
});

const REAL_KEY = '/Users/cjr/Git/indexzero/presentations/2025/_all_docs.final.key';
test('CLI --budget-ms 1 on the real deck reports the budget exhausted and zero strings', { skip: !existsSync(REAL_KEY) }, () => {
  const out = join(tmp, 'summary.json');
  execFileSync(process.execPath, [join(here, '..', 'key.js'), REAL_KEY, '--budget-ms', '1', '--out', out], { stdio: ['ignore', 'pipe', 'ignore'] });
  const summary = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(summary.budgetExhausted, true);
  assert.equal(summary.strings, 0);
  assert.equal(summary.verdict, 'key path unavailable');
});

test.after(() => rmSync(tmp, { recursive: true, force: true }));
