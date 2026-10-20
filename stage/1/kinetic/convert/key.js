// Best-effort .key reader: zip central directory, IWA snappy frames, protobuf wire walk,
// UTF-8 string and font name harvest. No dependencies. On any failure it reports the stage
// reached. When the budget is exhausted or an error occurs it returns `strings: []` and the verdict
// `key path unavailable` (D-009): the harvest is never partial. The budget is checked between entries,
// between archives, and inside the IWA chunk loop. `parseKeyGuarded` runs the parse in a worker thread with
// a hard timeout for the converter.
// CLI: node convert/key.js <deck.key> [--fonts header.json] [--words words.json] [--budget-ms 540000] [--out summary.json] [--dump strings.txt]
import { closeSync, openSync, readSync, fstatSync, writeFileSync, readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// ---------- zip ----------

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buf, done, length - done, offset + done);
    if (n === 0) break;
    done += n;
  }
  return done === length ? buf : buf.subarray(0, done);
}

/** List zip entries by reading the central directory. Returns [{ name, method, compressedSize, size, localOffset }]. */
export function listZip(fd) {
  const total = fstatSync(fd).size;
  const tailLen = Math.min(total, 65557);
  const tail = readAt(fd, total - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  let entries = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  let zip64 = false;
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // zip64: locator sits 20 bytes before the EOCD
    const loc = eocd - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip: zip64 locator not found');
    const z64Offset = Number(tail.readBigUInt64LE(loc + 8));
    const rec = readAt(fd, z64Offset, 56);
    if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error('zip: zip64 EOCD record not found');
    entries = Number(rec.readBigUInt64LE(32));
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOffset = Number(rec.readBigUInt64LE(48));
    zip64 = true;
  }
  const cd = readAt(fd, cdOffset, cdSize);
  const out = [];
  let p = 0;
  for (let i = 0; i < entries && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(`zip: bad central directory signature at ${p}`);
    const method = cd.readUInt16LE(p + 10);
    let compressedSize = cd.readUInt32LE(p + 20);
    let size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let localOffset = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    // zip64 extra field 0x0001 overrides the 0xffffffff placeholders, in order: size, compressedSize, localOffset
    let q = p + 46 + nameLen;
    const extraEnd = q + extraLen;
    while (q + 4 <= extraEnd) {
      const id = cd.readUInt16LE(q);
      const len = cd.readUInt16LE(q + 2);
      if (id === 0x0001) {
        let r = q + 4;
        if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(r)); r += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(cd.readBigUInt64LE(r)); r += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(cd.readBigUInt64LE(r)); r += 8; }
      }
      q += 4 + len;
    }
    out.push({ name, method, compressedSize, size, localOffset });
    p = extraEnd + commentLen;
  }
  return { entries: out, zip64 };
}

/** Read the stored bytes of one entry. Only method 0 (store) is supported; Keynote writes stored IWA entries. */
export function readZipEntry(fd, entry) {
  const lh = readAt(fd, entry.localOffset, 30);
  if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`zip: bad local header for ${entry.name}`);
  const nameLen = lh.readUInt16LE(26);
  const extraLen = lh.readUInt16LE(28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  if (entry.method !== 0) throw new Error(`zip: entry ${entry.name} uses method ${entry.method}, only store (0) is supported`);
  return readAt(fd, start, entry.compressedSize);
}

// ---------- snappy ----------

/** Raw snappy block decompressor. */
export function snappyUncompress(src) {
  let p = 0;
  let outLen = 0;
  let shift = 0;
  for (;;) {
    const b = src[p++];
    outLen |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
    if (shift > 28) throw new Error('snappy: bad length varint');
  }
  const out = Buffer.alloc(outLen);
  let o = 0;
  while (p < src.length) {
    const tag = src[p++];
    const kind = tag & 3;
    if (kind === 0) {
      let len = tag >> 2;
      if (len >= 60) {
        const n = len - 59;
        len = 0;
        for (let i = 0; i < n; i++) len |= src[p + i] << (8 * i);
        p += n;
      }
      len += 1;
      if (o + len > outLen || p + len > src.length) throw new Error('snappy: literal overruns');
      src.copy(out, o, p, p + len);
      o += len;
      p += len;
    } else {
      let len;
      let offset;
      if (kind === 1) {
        len = ((tag >> 2) & 7) + 4;
        offset = ((tag >> 5) << 8) | src[p];
        p += 1;
      } else if (kind === 2) {
        len = (tag >> 2) + 1;
        offset = src[p] | (src[p + 1] << 8);
        p += 2;
      } else {
        len = (tag >> 2) + 1;
        offset = (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24)) >>> 0;
        p += 4;
      }
      if (offset === 0 || offset > o || o + len > outLen) throw new Error(`snappy: bad copy offset ${offset} len ${len} at out ${o}`);
      // byte-wise copy: overlapping copies are the point
      for (let i = 0; i < len; i++) out[o + i] = out[o - offset + i];
      o += len;
    }
  }
  if (o !== outLen) throw new Error(`snappy: produced ${o} of ${outLen} bytes`);
  return out;
}

/** Decode the IWA framing: chunks of 1 byte type 0x00, 3 byte little-endian length, then a raw snappy block. Returns { data, chunks }. */
export function decodeIwa(buf, deadline = Infinity) {
  const parts = [];
  let p = 0;
  let chunks = 0;
  let exhausted = false;
  while (p + 4 <= buf.length) {
    if (Date.now() >= deadline) { exhausted = true; break; }
    const type = buf[p];
    const len = buf[p + 1] | (buf[p + 2] << 8) | (buf[p + 3] << 16);
    p += 4;
    if (type !== 0) throw new Error(`iwa: chunk type ${type} at ${p - 4}, expected 0`);
    if (p + len > buf.length) throw new Error(`iwa: chunk length ${len} overruns at ${p}`);
    parts.push(snappyUncompress(buf.subarray(p, p + len)));
    p += len;
    chunks += 1;
  }
  return { data: Buffer.concat(parts), chunks, exhausted };
}

// ---------- protobuf wire walk ----------

function readVarint(buf, p) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (p >= buf.length) return null;
    const b = buf[p++];
    result |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return [result, p];
    shift += 7n;
    if (shift > 70n) return null;
  }
}

/** Parse one message's fields. Returns [{ field, wire, value|bytes }] or null when the bytes are not a well-formed message. */
export function parseMessage(buf) {
  const fields = [];
  let p = 0;
  while (p < buf.length) {
    const r = readVarint(buf, p);
    if (!r) return null;
    const [key, q] = r;
    p = q;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 0 || field > 536870911) return null;
    if (wire === 0) {
      const v = readVarint(buf, p);
      if (!v) return null;
      fields.push({ field, wire, value: v[0] });
      p = v[1];
    } else if (wire === 1) {
      if (p + 8 > buf.length) return null;
      fields.push({ field, wire, bytes: buf.subarray(p, p + 8) });
      p += 8;
    } else if (wire === 5) {
      if (p + 4 > buf.length) return null;
      fields.push({ field, wire, bytes: buf.subarray(p, p + 4) });
      p += 4;
    } else if (wire === 2) {
      const l = readVarint(buf, p);
      if (!l) return null;
      const len = Number(l[0]);
      p = l[1];
      if (len < 0 || p + len > buf.length) return null;
      fields.push({ field, wire, bytes: buf.subarray(p, p + len) });
      p += len;
    } else {
      return null; // groups (3, 4) and unknown wire types: not a message we understand
    }
  }
  return fields;
}

const STRING_RE = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}\n\t]+$/u;

/** True when bytes are valid UTF-8 and look like text: 2 to 200 chars, only letters, digits, punctuation, symbols, spaces, and at least one letter or digit. */
export function looksLikeString(bytes) {
  if (bytes.length < 2 || bytes.length > 800) return false;
  let s;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  if (s.length < 2 || s.length > 200) return false;
  if (!STRING_RE.test(s)) return false;
  if (!/[\p{L}\p{N}]/u.test(s)) return false;
  return s;
}

/** Walk a message recursively and harvest strings from length-delimited fields. */
export function harvestStrings(buf, out, depth = 0, budget = { nodes: 0 }) {
  if (depth > 12) return;
  const fields = parseMessage(buf);
  if (!fields) return;
  for (const f of fields) {
    if (f.wire !== 2) continue;
    budget.nodes += 1;
    const s = looksLikeString(f.bytes);
    if (s) out.push(s);
    // a string can also parse as a message by accident; recurse only when the first byte is a plausible key
    if (f.bytes.length >= 2 && !s) harvestStrings(f.bytes, out, depth + 1, budget);
    else if (f.bytes.length >= 4 && s && /[\x00-\x1f]/.test(s) === false && (f.bytes[0] & 7) <= 2 && (f.bytes[0] >> 3) > 0) {
      // ambiguous: short printable bytes that also start like a key. Try both, keep both.
      harvestStrings(f.bytes, out, depth + 1, budget);
    }
  }
}

/**
 * Split a decompressed IWA stream into archive payloads. Each archive: varint length, ArchiveInfo message
 * (field 2 = repeated MessageInfo, whose field 3 = payload length), then the payloads in order.
 */
export function* iwaArchives(data) {
  let p = 0;
  while (p < data.length) {
    const r = readVarint(data, p);
    if (!r) throw new Error(`iwa: bad archive length varint at ${p}`);
    const infoLen = Number(r[0]);
    p = r[1];
    const info = parseMessage(data.subarray(p, p + infoLen));
    if (!info) throw new Error(`iwa: ArchiveInfo at ${p} did not parse`);
    p += infoLen;
    const identifier = info.find((f) => f.field === 1 && f.wire === 0)?.value ?? null;
    const payloads = [];
    for (const mi of info.filter((f) => f.field === 2 && f.wire === 2)) {
      const m = parseMessage(mi.bytes);
      if (!m) throw new Error(`iwa: MessageInfo at ${p} did not parse`);
      const type = Number(m.find((f) => f.field === 1 && f.wire === 0)?.value ?? -1);
      const len = Number(m.find((f) => f.field === 3 && f.wire === 0)?.value ?? 0);
      payloads.push({ type, bytes: data.subarray(p, p + len) });
      p += len;
    }
    yield { identifier: identifier === null ? null : Number(identifier), payloads };
  }
}

// ---------- driver ----------

function parseArgs(argv) {
  const o = { key: null, fonts: null, words: null, budgetMs: 540000, out: null, dump: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fonts') o.fonts = argv[++i];
    else if (a === '--words') o.words = argv[++i];
    else if (a === '--budget-ms') o.budgetMs = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--dump') o.dump = argv[++i];
    else if (!o.key) o.key = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.key) throw new Error('usage: node convert/key.js <deck.key> [--fonts header.json] [--words words.json] [--budget-ms N] [--out summary.json] [--dump strings.txt]');
  return o;
}

/** Parse a .key. Returns the summary the report needs. Never throws past stage recording. */
export function parseKey(keyPath, { fonts = [], words = [], budgetMs = 540000, onProgress = null } = {}) {
  const t0 = Date.now();
  const summary = {
    attempted: true,
    key: keyPath,
    stage: 'open',
    iwaEntries: 0,
    iwaEntriesRead: 0,
    chunks: 0,
    compressedBytes: 0,
    decompressedBytes: 0,
    archives: 0,
    payloads: 0,
    strings: 0,
    distinctStrings: 0,
    wordMatchesExact: 0,
    wordsMatched: [],
    wordsTotal: words.length,
    fontsFound: [],
    fontsTotal: fonts.length,
    budgetExhausted: false,
    error: null,
    wallMs: 0,
  };
  const strings = [];
  let fd = null;
  try {
    fd = openSync(keyPath, 'r');
    summary.stage = 'zip central directory';
    const { entries, zip64 } = listZip(fd);
    summary.zip64 = zip64;
    summary.zipEntries = entries.length;
    const iwa = entries.filter((e) => /^Index\/.*\.iwa$/.test(e.name));
    summary.iwaEntries = iwa.length;
    summary.iwaNames = iwa.map((e) => e.name);
    summary.stage = 'iwa decode';
    const deadline = t0 + budgetMs;
    for (const e of iwa) {
      if (Date.now() >= deadline) { summary.budgetExhausted = true; break; }
      const raw = readZipEntry(fd, e);
      summary.compressedBytes += raw.length;
      summary.stage = `iwa decode ${e.name}`;
      const { data, chunks, exhausted } = decodeIwa(raw, deadline);
      summary.chunks += chunks;
      summary.decompressedBytes += data.length;
      if (exhausted) { summary.budgetExhausted = true; break; }
      summary.stage = `protobuf walk ${e.name}`;
      for (const archive of iwaArchives(data)) {
        if (Date.now() >= deadline) { summary.budgetExhausted = true; break; }
        summary.archives += 1;
        for (const payload of archive.payloads) {
          summary.payloads += 1;
          harvestStrings(payload.bytes, strings);
        }
      }
      if (summary.budgetExhausted) break;
      summary.iwaEntriesRead += 1;
      if (onProgress) onProgress(e.name, summary);
    }
    summary.stage = summary.budgetExhausted ? 'budget exhausted during iwa decode' : 'done';
  } catch (err) {
    summary.error = `${err.name}: ${err.message}`;
  } finally {
    if (fd !== null) closeSync(fd);
  }
  summary.strings = strings.length;
  const distinct = new Set(strings);
  summary.distinctStrings = distinct.size;
  if (words.length) {
    const wordSet = new Set(words);
    const matched = new Set();
    let exact = 0;
    for (const s of strings) if (wordSet.has(s)) { exact += 1; matched.add(s); }
    // a text run holds several words: count words found as whole tokens inside any harvested string
    const tokens = new Set();
    for (const s of distinct) for (const t of s.split(/\s+/)) tokens.add(t);
    const inRuns = words.filter((w) => tokens.has(w));
    summary.wordMatchesExact = exact;
    summary.wordsMatched = [...matched].sort();
    summary.wordsInRuns = inRuns.length;
    summary.wordsInRunsList = inRuns.sort();
  }
  if (fonts.length) {
    const fontSet = new Set(fonts);
    summary.fontsFound = [...distinct].filter((s) => fontSet.has(s)).sort();
    // font names also appear inside longer strings such as "Avenir-Heavy;..." in style archives
    summary.fontsFoundAsSubstring = fonts.filter((f) => [...distinct].some((s) => s !== f && s.includes(f))).sort();
  }
  summary.wallMs = Date.now() - t0;
  const usable = summary.error === null && !summary.budgetExhausted && summary.strings > 0;
  summary.verdict = usable ? 'key path available' : 'key path unavailable';
  return { summary, strings: usable ? [...distinct] : [] };
}

/**
 * parseKey in a worker thread with a hard wall-clock guard. Resolves to the parse result, or to an
 * unavailable result with `stage: 'timeout'` when `timeoutMs` passes first (the worker is terminated).
 */
export function parseKeyGuarded(keyPath, opts = {}, { timeoutMs = 600000 } = {}) {
  return new Promise((resolveP) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { keyPath, opts } });
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveP(result);
    };
    const timer = setTimeout(() => {
      worker.terminate();
      finish({ summary: { attempted: true, key: keyPath, stage: 'timeout', error: `timeout after ${timeoutMs} ms`, budgetExhausted: true, strings: 0, wallMs: timeoutMs, verdict: 'key path unavailable' }, strings: [] });
    }, timeoutMs);
    worker.once('message', (m) => finish(m));
    worker.once('error', (err) => finish({ summary: { attempted: true, key: keyPath, stage: 'worker error', error: `${err.name}: ${err.message}`, strings: 0, wallMs: 0, verdict: 'key path unavailable' }, strings: [] }));
    worker.once('exit', (code) => { if (!done) finish({ summary: { attempted: true, key: keyPath, stage: 'worker exit', error: `exit ${code}`, strings: 0, wallMs: 0, verdict: 'key path unavailable' }, strings: [] }); });
  });
}

if (!isMainThread && workerData && workerData.keyPath) {
  parentPort.postMessage(parseKey(workerData.keyPath, workerData.opts || {}));
}

export function main(argv) {
  const o = parseArgs(argv);
  const fonts = o.fonts ? JSON.parse(readFileSync(o.fonts, 'utf8')).fonts : [];
  const words = o.words ? JSON.parse(readFileSync(o.words, 'utf8')) : [];
  const { summary, strings } = parseKey(resolve(o.key), {
    fonts,
    words,
    budgetMs: o.budgetMs,
    onProgress: (name, s) => console.error(`${name}: ${s.decompressedBytes} bytes, ${s.payloads} payloads, ${Date.now()} `),
  });
  if (o.dump) writeFileSync(o.dump, strings.join('\n') + '\n');
  const text = JSON.stringify(summary, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n';
  if (o.out) writeFileSync(o.out, text);
  process.stdout.write(text);
  return summary.error ? 1 : 0;
}

if (isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
