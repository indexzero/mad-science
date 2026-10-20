import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTar, gzipDeterministic } from "../skill/save-it/scripts/tar.mjs";

const TMP = fileURLToPath(new URL("../.tmp/", import.meta.url));
const ENTRIES = [
  { path: "z", data: Buffer.from("zz") },
  { path: "b/c", data: Buffer.from("c".repeat(600)) },
  { path: "a", data: Buffer.from("") }
];

/**
 * Reads a NUL-terminated ASCII field from a header.
 * @param {Uint8Array} block
 * @param {number} offset
 * @param {number} length
 * @returns {string}
 */
function field(block, offset, length) {
  const text = Buffer.from(block.subarray(offset, offset + length)).toString("latin1");
  const end = text.indexOf("\0");
  return end === -1 ? text : text.slice(0, end);
}

/**
 * Reads the names of the entries in a USTAR archive.
 * @param {Uint8Array} tar
 * @returns {string[]}
 */
function names(tar) {
  const out = [];
  let offset = 0;
  while (offset + 512 <= tar.length && tar[offset] !== 0) {
    out.push(field(tar, offset, 100));
    const size = parseInt(field(tar, offset + 124, 12), 8);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/**
 * Reads every entry of a USTAR archive: the UTF-8 name and the data bytes.
 * @param {Uint8Array} tar
 * @returns {Array<{ name: string, data: Buffer }>}
 */
function read(tar) {
  const buf = Buffer.from(tar);
  const out = [];
  let offset = 0;
  while (offset + 512 <= buf.length && buf[offset] !== 0) {
    const raw = buf.subarray(offset, offset + 100);
    const end = raw.indexOf(0);
    const name = raw.subarray(0, end === -1 ? 100 : end).toString("utf8");
    const size = parseInt(field(buf, offset + 124, 12), 8);
    out.push({ name, data: Buffer.from(buf.subarray(offset + 512, offset + 512 + size)) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

let hasTar = true;
try {
  execFileSync("tar", ["--version"], { stdio: "ignore" });
} catch {
  hasTar = false;
}

test("two builds of the same entries are byte-identical", () => {
  const one = gzipDeterministic(createTar(ENTRIES));
  const two = gzipDeterministic(createTar([...ENTRIES].reverse()));
  assert.deepEqual(Buffer.from(one), Buffer.from(two));
});

test("entries are sorted by byte order", () => {
  const tar = createTar(ENTRIES);
  assert.deepEqual(names(tar), ["a", "b/c", "z"]);
  assert.equal(tar.length % 512, 0);
  assert.deepEqual(Buffer.from(tar.subarray(tar.length - 1024)), Buffer.alloc(1024));
});

test("entries are sorted by UTF-8 byte order, not locale order", () => {
  const mixed = ["é", "z", "a", "Z"].map((path) => ({ path, data: Buffer.from(path) }));
  const expected = ["Z", "a", "z", "é"];
  assert.deepEqual(read(createTar(mixed)).map((entry) => entry.name), expected);
  assert.deepEqual(read(createTar([...mixed].reverse())).map((entry) => entry.name), expected);
  assert.deepEqual(Buffer.from(createTar(mixed)), Buffer.from(createTar([...mixed].reverse())));
});

test("each file body is archived byte for byte", () => {
  const binary = Buffer.alloc(700);
  for (let i = 0; i < binary.length; i++) binary[i] = (i * 7 + 1) % 256;
  const backing = new Uint8Array([9, 9, 9, 0x41, 0x42, 0x43, 0xff, 9, 9]);
  const sliced = backing.subarray(3, 7);
  const tar = createTar([
    { path: "bin", data: binary },
    { path: "slice", data: sliced },
    { path: "empty", data: new Uint8Array(0) }
  ]);
  assert.deepEqual(read(tar), [
    { name: "bin", data: binary },
    { name: "empty", data: Buffer.alloc(0) },
    { name: "slice", data: Buffer.from([0x41, 0x42, 0x43, 0xff]) }
  ]);
});

test("the header carries mtime 0, uid 0, gid 0, mode 0644", () => {
  const block = createTar([{ path: "a", data: Buffer.from("x") }]).subarray(0, 512);
  assert.equal(field(block, 100, 8), "0000644");
  assert.equal(field(block, 108, 8), "0000000");
  assert.equal(field(block, 116, 8), "0000000");
  assert.equal(field(block, 124, 12), "00000000001");
  assert.equal(field(block, 136, 12), "00000000000");
  assert.equal(field(block, 156, 1), "0");
  assert.equal(field(block, 257, 6), "ustar");
  assert.equal(field(block, 263, 2), "00");
  assert.equal(field(block, 265, 32), "");
  assert.equal(field(block, 297, 32), "");
  const copy = Buffer.from(block);
  copy.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of copy) sum += byte;
  assert.equal(field(block, 148, 8), sum.toString(8).padStart(6, "0"));
  assert.equal(block[155], 0x20);
});

test("a path over 100 bytes throws with the path in the message", () => {
  const path = "a".repeat(101);
  assert.throws(() => createTar([{ path, data: Buffer.from("") }]), {
    message: `path is too long for USTAR (100 bytes): ${path}`
  });
  assert.doesNotThrow(() => createTar([{ path: "a".repeat(100), data: Buffer.from("") }]));
});

test("the 100-byte limit counts UTF-8 bytes, not characters", () => {
  const fits = "é".repeat(50);
  assert.equal(read(createTar([{ path: fits, data: Buffer.from("") }]))[0].name, fits);
  for (const path of ["é".repeat(51), "a".repeat(99) + "é"]) {
    assert.ok(path.length <= 100);
    assert.throws(() => createTar([{ path, data: Buffer.from("") }]), {
      message: `path is too long for USTAR (100 bytes): ${path}`
    });
  }
});

test("a path with .. throws", () => {
  for (const path of ["../a", "a/../b", "/a", "a//b", "a/"]) {
    assert.throws(() => createTar([{ path, data: Buffer.from("") }]), {
      message: `path is not valid: ${path}`
    });
  }
});

test("gzipDeterministic zeroes MTIME and sets OS to 3", () => {
  const gz = gzipDeterministic(createTar(ENTRIES));
  assert.deepEqual([...gz.subarray(0, 2)], [0x1f, 0x8b]);
  assert.deepEqual([...gz.subarray(4, 8)], [0, 0, 0, 0]);
  assert.equal(gz[9], 3);
});

(hasTar ? test : test.skip)("the system tar lists the paths", { skip: hasTar ? false : "the system tar is absent" }, () => {
  mkdirSync(TMP, { recursive: true });
  const dir = mkdtempSync(join(TMP, "tar-"));
  try {
    const file = join(dir, "a.tgz");
    writeFileSync(file, gzipDeterministic(createTar(ENTRIES)));
    const listed = execFileSync("tar", ["-tzf", file], { encoding: "utf8" }).trim().split("\n");
    assert.deepEqual(listed, ["a", "b/c", "z"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
