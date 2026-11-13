'use strict'
// Signed tree heads, following PKV's "Time-Space Dependent Signature":
//   1. hash the serialized time-space information            tsHash = H(ts)
//   2. sign (tsHash || <the thing>)                           sig = Sign(sk, tsHash || commit)
// where <the thing> here is a commitment to the Merkle head:
//   commit = H(0x02 || root || size as 8-byte big-endian)
// 0x02 keeps it distinct from leaf (0x00) and node (0x01) hashes.
//
// sodium: crypto_sign_keypair / crypto_sign_detached / crypto_sign_verify_detached are Ed25519.

const sodium = require('sodium-universal')

const HEAD_PREFIX = Buffer.from([0x02])

function keygen () {
  const publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}

function headCommit (H, head) {
  const size = Buffer.alloc(8)
  size.writeBigUInt64BE(BigInt(head.size))
  return H(HEAD_PREFIX, head.root, size)
}

/** Serialized "time-space" info. Here: ISO-8601 time string, by consensus. */
function signHead (H, secretKey, head, ts = new Date().toISOString()) {
  const message = Buffer.concat([H(ts), headCommit(H, head)])
  const signature = Buffer.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(signature, message, secretKey)
  return { root: Buffer.from(head.root), size: head.size, ts, signature }
}

function verifyHead (H, publicKey, signed) {
  if (!signed || !Buffer.isBuffer(signed.root) || !Number.isInteger(signed.size) || typeof signed.ts !== 'string') return false
  if (!Buffer.isBuffer(signed.signature) || signed.signature.length !== sodium.crypto_sign_BYTES) return false
  const message = Buffer.concat([H(signed.ts), headCommit(H, signed)])
  return sodium.crypto_sign_verify_detached(signed.signature, message, publicKey)
}

module.exports = { keygen, headCommit, signHead, verifyHead }
