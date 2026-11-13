'use strict'
// Hash primitives from libsodium (via sodium-universal -> sodium-native).
//
// sodium exposes these hash families. Only the first three are usable here,
// because a Merkle tree (and PKV) needs a *collision-resistant* hash:
//
//   crypto_generichash          BLAKE2b, 16..64 byte output, optional key   <- default
//   crypto_hash_sha256          SHA-256, 32 bytes
//   crypto_hash_sha512          SHA-512, 64 bytes  (crypto_hash is an alias)
//   crypto_shorthash            SipHash-2-4, 8 bytes, keyed. NOT collision resistant. Unusable.
//   crypto_pwhash               Argon2id / scrypt. Slow by design, for passwords. Wrong tool.
//   crypto_kdf_derive_from_key  BLAKE2b-based subkey derivation. Not a general hash.
//   extension_pbkdf2_sha512     PBKDF2. Password stretching. Wrong tool.
//
// PKV deliberately does not fix a hash function; it is a consensus parameter.
// We expose a tiny allowlist instead of a free-form algorithm string
// (see Trail of Bits "sharp-edges": free algorithm choice is a footgun).

const sodium = require('sodium-universal')

const ALGORITHMS = {
  blake2b: {
    bytes: sodium.crypto_generichash_BYTES, // 32
    digest (out, inputs, key) {
      // crypto_generichash_batch hashes the concatenation of `inputs`,
      // so H(a || b) needs no manual Buffer.concat.
      sodium.crypto_generichash_batch(out, inputs, key)
    }
  },
  sha256: {
    bytes: sodium.crypto_hash_sha256_BYTES, // 32
    digest (out, inputs) {
      const state = Buffer.alloc(sodium.crypto_hash_sha256_STATEBYTES)
      sodium.crypto_hash_sha256_init(state)
      for (const b of inputs) sodium.crypto_hash_sha256_update(state, b)
      sodium.crypto_hash_sha256_final(state, out)
    }
  },
  sha512: {
    bytes: sodium.crypto_hash_sha512_BYTES, // 64
    digest (out, inputs) {
      const state = Buffer.alloc(sodium.crypto_hash_sha512_STATEBYTES)
      sodium.crypto_hash_sha512_init(state)
      for (const b of inputs) sodium.crypto_hash_sha512_update(state, b)
      sodium.crypto_hash_sha512_final(state, out)
    }
  }
}

function toBuffer (x) {
  if (Buffer.isBuffer(x)) return x
  if (typeof x === 'string') return Buffer.from(x, 'utf8') // encoding is a consensus choice too
  if (x instanceof Uint8Array) return Buffer.from(x.buffer, x.byteOffset, x.byteLength)
  throw new TypeError(`cannot hash a ${typeof x}; pass a Buffer or a string`)
}

/**
 * createHasher('blake2b' | 'sha256' | 'sha512', { key }) -> H
 * H(...parts) hashes the byte concatenation of parts and returns a fresh Buffer.
 * `key` (16..64 bytes, blake2b only) turns BLAKE2b into a keyed hash: anyone
 * without the key cannot compute leaves at all. See README "Fork cryptography".
 */
function createHasher (name = 'blake2b', { key } = {}) {
  const algo = ALGORITHMS[name]
  if (!algo) throw new RangeError(`unknown hash "${name}"; allowed: ${Object.keys(ALGORITHMS).join(', ')}`)
  if (key && name !== 'blake2b') throw new RangeError('only blake2b supports a key')
  if (key && (key.length < sodium.crypto_generichash_KEYBYTES_MIN || key.length > sodium.crypto_generichash_KEYBYTES_MAX)) {
    throw new RangeError(`blake2b key must be ${sodium.crypto_generichash_KEYBYTES_MIN}..${sodium.crypto_generichash_KEYBYTES_MAX} bytes`)
  }
  function H (...parts) {
    const out = Buffer.alloc(algo.bytes)
    algo.digest(out, parts.map(toBuffer), key)
    return out
  }
  H.algorithm = name
  H.bytes = algo.bytes
  H.keyed = Boolean(key)
  return H
}

module.exports = { createHasher, ALGORITHMS: Object.keys(ALGORITHMS), toBuffer }
