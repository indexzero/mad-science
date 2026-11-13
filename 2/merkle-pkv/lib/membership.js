'use strict'
// Two roles:
//
//   MembershipSet  (the prover)  stores nsHash + sorted leaf hashes. Nothing else.
//   Verifier       (light client) stores nsHash + root + size.          Nothing else.
//
// Neither role ever stores a `subject` or `ns` string. Strings pass through
// `leafFor()` and are gone; what remains is a 32-byte PKV-KEY.

const { pkvKey, pkvExtend } = require('./pkv')
const merkle = require('./merkle')

/**
 * Subject canonicalization. GitHub usernames are case-insensitive, so "Alice"
 * and "alice" must derive the same leaf or "not taken" lies. Prover and
 * verifier MUST apply the same function; it is part of the encoding consensus.
 * Default: Unicode lowercase and trimmed. Pass `normalize: s => s` to opt out.
 */
const defaultNormalize = (subject) => {
  if (typeof subject !== 'string') throw new TypeError('subject must be a string')
  return subject.trim().toLowerCase()
}
const { signHead, verifyHead } = require('./head')

class MembershipSet {
  constructor (H, nsHash, { secretKey, normalize = defaultNormalize } = {}) {
    if (!Buffer.isBuffer(nsHash) || nsHash.length !== H.bytes) throw new TypeError('nsHash must be a hash-sized Buffer')
    this.H = H
    this.normalize = normalize
    this.nsHash = Buffer.from(nsHash) // PKV-KEY of the namespace parts, e.g. ['github','username']
    this.leaves = [] // sorted, unique PKV-KEYs of ns + [subject]
    this.secretKey = secretKey ? Buffer.from(secretKey) : null // Ed25519, only if this prover publishes signed heads
  }

  /** Build from namespace parts. The parts are hashed once and dropped. */
  static fromNamespace (H, nsParts, subjects = [], opts = {}) {
    const set = new MembershipSet(H, pkvKey(H, nsParts), opts)
    for (const s of subjects) set.add(s)
    return set
  }

  /** subjectHash = PKV-KEY(ns + [normalize(subject)]) = H(nsHash || H(subject)). Pure function, stores nothing. */
  leafFor (subject) {
    return pkvExtend(this.H, this.nsHash, this.normalize(subject))
  }

  /** Insert the subject's leaf (sorted). Returns { leaf, added }. */
  add (subject) {
    const leaf = this.leafFor(subject)
    const i = merkle.lowerBound(this.leaves, leaf)
    if (i < this.leaves.length && this.leaves[i].equals(leaf)) return { leaf, added: false }
    this.leaves.splice(i, 0, leaf)
    return { leaf, added: true }
  }

  /** Local lookup against the leaf set only. */
  has (subject) {
    const leaf = this.leafFor(subject)
    const i = merkle.lowerBound(this.leaves, leaf)
    return i < this.leaves.length && this.leaves[i].equals(leaf)
  }

  /** The "signed tree head" a verifier needs: root + size. */
  head () {
    return { root: merkle.merkleRoot(this.H, this.leaves), size: this.leaves.length }
  }

  /** head() plus an Ed25519 signature over H(ts) || H(0x02 || root || size). Requires a secretKey. */
  signedHead (ts) {
    if (!this.secretKey) throw new Error('this prover has no signing key')
    return signHead(this.H, this.secretKey, this.head(), ts)
  }

  /** Inclusion proof if present, absence proof otherwise. */
  prove (subject) {
    const leaf = this.leafFor(subject)
    const i = merkle.lowerBound(this.leaves, leaf)
    if (i < this.leaves.length && this.leaves[i].equals(leaf)) {
      return { kind: 'inclusion', leaf, index: i, path: merkle.auditPath(this.H, this.leaves, i) }
    }
    return { kind: 'absence', leaf, ...merkle.proveAbsence(this.H, this.leaves, leaf) }
  }

  /** Everything this object holds, as hex. Used by the REPL `dump` and by the no-plaintext test. */
  state () {
    const { root, size } = this.head()
    return {
      algorithm: this.H.algorithm,
      nsHash: this.nsHash.toString('hex'),
      size,
      root: root.toString('hex'),
      leaves: this.leaves.map(l => l.toString('hex')),
      ...(this.secretKey ? { secretKey: '<redacted 64 bytes>' } : {})
    }
  }
}

class Verifier {
  /**
   * `head` may be a bare {root,size} (trusted out of band) or a signed head.
   * With `publicKey` set, only accept() can move the root, and only forward.
   */
  constructor (H, nsHash, head, { publicKey, normalize = defaultNormalize } = {}) {
    this.H = H
    this.normalize = normalize
    this.nsHash = Buffer.from(nsHash)
    this.publicKey = publicKey ? Buffer.from(publicKey) : null
    this.ts = ''
    if (this.publicKey) this.accept(head)
    else this.update(head)
  }

  /** Trust a head without a signature. Refused once a publisher key is pinned. */
  update (head) {
    if (this.publicKey) throw new Error('verifier is pinned to a publisher; use accept(signedHead)')
    this.root = Buffer.from(head.root)
    this.size = head.size
  }

  /**
   * Accept a signed head: valid signature from the pinned publisher, timestamp
   * strictly newer than the last one, and size never shrinking (the set is
   * append-only, so a smaller size is a rollback).
   */
  accept (signed) {
    if (!this.publicKey) throw new Error('verifier has no publisher key; use update(head)')
    if (!verifyHead(this.H, this.publicKey, signed)) throw new Error('head signature does not verify')
    if (signed.ts <= this.ts) throw new Error(`stale head: ts ${signed.ts} is not after ${this.ts}`)
    if (this.size !== undefined && signed.size < this.size) throw new Error(`rollback: size ${signed.size} < ${this.size}`)
    this.root = Buffer.from(signed.root)
    this.size = signed.size
    this.ts = signed.ts
  }

  /**
   * Check a candidate subject against a proof using ONLY nsHash + root + size.
   * Returns { member: boolean, leaf } or throws if the proof does not verify.
   */
  check (subject, proof) {
    const leaf = pkvExtend(this.H, this.nsHash, this.normalize(subject))
    if (!leaf.equals(proof.leaf)) throw new Error('proof is for a different leaf than this subject derives to')
    const head = { root: this.root, size: this.size }
    if (proof.kind === 'inclusion') {
      if (!merkle.verifyInclusion(this.H, head, leaf, proof)) throw new Error('inclusion proof does not verify against root')
      return { member: true, leaf }
    }
    if (proof.kind === 'absence') {
      if (!merkle.verifyAbsence(this.H, head, leaf, proof)) throw new Error('absence proof does not verify against root')
      return { member: false, leaf }
    }
    throw new Error(`unknown proof kind ${proof.kind}`)
  }

  state () {
    return {
      algorithm: this.H.algorithm,
      nsHash: this.nsHash.toString('hex'),
      root: this.root.toString('hex'),
      size: this.size,
      ...(this.publicKey ? { publicKey: this.publicKey.toString('hex'), ts: this.ts } : {})
    }
  }
}

module.exports = { MembershipSet, Verifier, defaultNormalize }
