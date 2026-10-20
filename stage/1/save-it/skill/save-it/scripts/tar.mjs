/**
 * A deterministic USTAR writer and a deterministic gzip wrapper.
 * The same entries give the same bytes on every host.
 * Node built-ins only.
 */

import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";

const BLOCK = 512;
const NAME_MAX = 100;

/**
 * Writes an ASCII string into the header at an offset.
 * @param {Buffer} header
 * @param {number} offset
 * @param {string} value
 */
function put(header, offset, value) {
  header.write(value, offset, "ascii");
}

/**
 * Makes sure that the path is relative and has no empty or `..` segment.
 * @param {string} path
 */
function checkPath(path) {
  if (Buffer.byteLength(path, "utf8") > NAME_MAX) {
    throw new Error(`path is too long for USTAR (100 bytes): ${path}`);
  }
  const segments = path.split("/");
  if (path.startsWith("/") || segments.some((segment) => segment === "" || segment === "..")) {
    throw new Error(`path is not valid: ${path}`);
  }
}

/**
 * Makes one 512-byte USTAR header for a regular file.
 * @param {Buffer} name the UTF-8 bytes of the path
 * @param {number} size the data length in bytes
 * @returns {Buffer}
 */
function header(name, size) {
  const block = Buffer.alloc(BLOCK);
  name.copy(block, 0);
  put(block, 100, "0000644\0");
  put(block, 108, "0000000\0");
  put(block, 116, "0000000\0");
  put(block, 124, size.toString(8).padStart(11, "0") + "\0");
  put(block, 136, "00000000000\0");
  put(block, 148, "        ");
  put(block, 156, "0");
  put(block, 257, "ustar\0");
  put(block, 263, "00");
  put(block, 329, "0000000\0");
  put(block, 337, "0000000\0");
  let sum = 0;
  for (const byte of block) sum += byte;
  put(block, 148, sum.toString(8).padStart(6, "0") + "\0 ");
  return block;
}

/**
 * Makes a USTAR archive. Entries are sorted by the byte order of their UTF-8 paths.
 * Every file has mode 0644, uid 0, gid 0, mtime 0, and empty uname and gname.
 * @param {Array<{ path: string, data: Uint8Array }>} entries
 * @returns {Uint8Array} the archive bytes
 */
export function createTar(entries) {
  const items = entries.map((entry) => {
    checkPath(entry.path);
    return { name: Buffer.from(entry.path, "utf8"), data: entry.data };
  });
  items.sort((a, b) => Buffer.compare(a.name, b.name));
  const blocks = [];
  for (const { name, data } of items) {
    blocks.push(header(name, data.length));
    blocks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad > 0) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}

/**
 * Compresses bytes with gzip at level 9.
 * Then it sets MTIME (bytes 4 to 7) to 0 and OS (byte 9) to 3, as RFC 1952 gives them.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array} the gzip bytes
 */
export function gzipDeterministic(bytes) {
  const out = gzipSync(bytes, { level: 9 });
  out.fill(0, 4, 8);
  out[9] = 3;
  return out;
}
