'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const sodium = require('sodium-universal')
const { createHasher, ALGORITHMS, pkvKey, pkvExtend, pkvPrefixes, MembershipSet, Verifier, keygen, signHead, verifyHead } = require('./index')
const merkle = require('./lib/merkle')

const NS = ['github', 'username']
const NAMES = ['alice', 'bob', 'charlie', 'david', 'ellis', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'indexzero']
const STRANGERS = ['mallory', 'trent', 'zed', 'ALICE2', ' bob2 ', '']

for (const algorithm of ALGORITHMS) {
  const H = createHasher(algorithm)

  test(`[${algorithm}] PKV-KEY follows the README recipe step by step`, () => {
    // Hand-computed with raw sodium calls, no helper functions.
    const raw = (...bufs) => {
      const out = Buffer.alloc(H.bytes)
      if (algorithm === 'blake2b') sodium.crypto_generichash_batch(out, bufs)
      else if (algorithm === 'sha256') sodium.crypto_hash_sha256(out, Buffer.concat(bufs))
      else sodium.crypto_hash_sha512(out, Buffer.concat(bufs))
      return out
    }
    const b = s => Buffer.from(s)
    const k0 = raw(raw(b('github')))                 // step 1: double hash
    const k1 = raw(k0, raw(b('username')))           // step 2
    const k2 = raw(k1, raw(b('indexzero')))          // step 3 (repeat)
    assert.deepEqual(pkvKey(H, ['github']), k0)
    assert.deepEqual(pkvKey(H, ['github', 'username']), k1)
    assert.deepEqual(pkvKey(H, ['github', 'username', 'indexzero']), k2)
    assert.deepEqual(pkvPrefixes(H, ['github', 'username', 'indexzero']), [k0, k1, k2])
  })

  test(`[${algorithm}] subjects are canonicalized: case and surrounding whitespace do not matter`, () => {
    const set = MembershipSet.fromNamespace(H, NS, ['Alice'])
    const verifier = new Verifier(H, set.nsHash, set.head())
    for (const variant of ['alice', 'ALICE', ' Alice ', 'aLiCe']) {
      assert.deepEqual(set.leafFor(variant), set.leafFor('alice'))
      assert.equal(verifier.check(variant, set.prove(variant)).member, true, variant)
    }
    assert.equal(set.add('ALICE').added, false, 'no duplicate leaf for a case variant')
    assert.equal(set.leaves.length, 1)
    // the leaf is the PKV-KEY of the lowercased name, so a raw pkvKey call must lowercase too
    assert.deepEqual(set.leafFor('Alice'), pkvKey(H, [...NS, 'alice']))
    assert.notDeepEqual(set.leafFor('Alice'), pkvKey(H, [...NS, 'Alice']))
    // opting out restores case sensitivity (both sides must agree)
    const strict = MembershipSet.fromNamespace(H, NS, ['Alice'], { normalize: s => s })
    assert.equal(strict.has('alice'), false)
    assert.equal(strict.has('Alice'), true)
  })

  test(`[${algorithm}] a namespace hash alone is enough to derive any child key`, () => {
    const nsHash = pkvKey(H, NS)
    assert.deepEqual(pkvExtend(H, nsHash, 'indexzero'), pkvKey(H, [...NS, 'indexzero']))
    // ...and a different namespace gives a different key for the same username
    assert.notDeepEqual(pkvExtend(H, pkvKey(H, ['gitlab', 'username']), 'indexzero'), pkvKey(H, [...NS, 'indexzero']))
  })

  test(`[${algorithm}] the root commits to a SET: insertion order does not matter`, () => {
    const a = MembershipSet.fromNamespace(H, NS, NAMES)
    const b = MembershipSet.fromNamespace(H, NS, [...NAMES].reverse())
    const c = MembershipSet.fromNamespace(H, NS, [...NAMES, 'alice', 'bob']) // duplicates ignored
    assert.deepEqual(a.head(), b.head())
    assert.deepEqual(a.head(), c.head())
    assert.notDeepEqual(a.head().root, MembershipSet.fromNamespace(H, NS, NAMES.slice(1)).head().root)
  })

  test(`[${algorithm}] inclusion proofs verify for every member at every tree size 0..24`, () => {
    for (let n = 0; n <= 24; n++) {
      const names = Array.from({ length: n }, (_, i) => `user${i}`)
      const set = MembershipSet.fromNamespace(H, NS, names)
      const verifier = new Verifier(H, set.nsHash, set.head())
      for (const name of names) {
        const proof = set.prove(name)
        assert.equal(proof.kind, 'inclusion', `${name} in size ${n}`)
        assert.equal(verifier.check(name, proof).member, true)
      }
    }
  })

  test(`[${algorithm}] absence proofs verify for every non-member at every tree size 0..24`, () => {
    for (let n = 0; n <= 24; n++) {
      const names = Array.from({ length: n }, (_, i) => `user${i}`)
      const set = MembershipSet.fromNamespace(H, NS, names)
      const verifier = new Verifier(H, set.nsHash, set.head())
      for (const name of [...STRANGERS, 'user-1', `user${n}`, 'user99']) {
        const proof = set.prove(name)
        assert.equal(proof.kind, 'absence', `${name} in size ${n}`)
        assert.equal(verifier.check(name, proof).member, false)
      }
    }
  })

  test(`[${algorithm}] tampered or mismatched proofs are rejected`, () => {
    const set = MembershipSet.fromNamespace(H, NS, NAMES)
    const verifier = new Verifier(H, set.nsHash, set.head())
    const good = set.prove('charlie')

    // proof for one name presented for another
    assert.throws(() => verifier.check('david', good), /different leaf/)

    // flip one bit in a sibling hash
    const flipped = structuredClone(good)
    if (flipped.path.length) flipped.path[0].hash[0] ^= 1
    else flipped.leaf[0] ^= 1
    assert.throws(() => verifier.check('charlie', flipped), /does not verify|different leaf/)

    // lie about the index
    const wrongIndex = { ...good, index: (good.index + 1) % NAMES.length }
    assert.throws(() => verifier.check('charlie', wrongIndex), /does not verify/)

    // swap a side flag
    if (good.path.length) {
      const swapped = structuredClone(good)
      swapped.path[0].side = swapped.path[0].side === 'left' ? 'right' : 'left'
      assert.throws(() => verifier.check('charlie', swapped), /does not verify/)
    }

    // absence proof whose neighbours are not adjacent
    const absent = set.prove('mallory')
    if (absent.left && absent.right) {
      const gap = { ...absent, right: set.prove(NAMES.find(n => set.prove(n).index === absent.right.index + 1) || NAMES[0]) }
      if (gap.right.index !== absent.left.index + 1) {
        assert.throws(() => verifier.check('mallory', gap), /does not verify/)
      }
    }

    // absence proof for something that is actually present
    const forged = { ...set.prove('zed'), leaf: set.leafFor('alice') }
    assert.throws(() => verifier.check('alice', forged), /does not verify/)

    // stale verifier: root moved after an add
    set.add('newcomer')
    assert.throws(() => verifier.check('newcomer', set.prove('newcomer')), /does not verify/)
    verifier.update(set.head())
    assert.equal(verifier.check('newcomer', set.prove('newcomer')).member, true)
  })

  test(`[${algorithm}] no subject or namespace string is held in memory by prover or verifier`, () => {
    const set = MembershipSet.fromNamespace(H, NS, NAMES)
    const verifier = new Verifier(H, set.nsHash, set.head())
    const plaintexts = [...NS, ...NAMES]

    // 1. Serialized state is hex only.
    for (const dump of [JSON.stringify(set.state()), JSON.stringify(verifier.state())]) {
      for (const p of plaintexts) assert.ok(!dump.includes(p), `found "${p}" in state`)
      assert.ok(!/[g-zG-Z]/.test(dump.replace(/"(algorithm|nsHash|size|root|leaves|blake2b|sha256|sha512)"?/g, '')), 'non-hex content in dump')
    }

    // 2. Reflective walk: every own property is a Buffer, a number, an array of Buffers, or the hasher.
    const walk = (obj) => {
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'H' || k === 'normalize') { assert.equal(typeof v, 'function'); continue }
        if (k === 'ts') { assert.ok(v === '' || !Number.isNaN(Date.parse(v)), 'ts must be empty or an ISO date'); continue }
        if (v === null || Buffer.isBuffer(v) || typeof v === 'number') continue
        if (Array.isArray(v)) { v.forEach(x => assert.ok(Buffer.isBuffer(x), `${k}[] holds a non-Buffer`)); continue }
        assert.fail(`${k} holds a ${typeof v}`)
      }
    }
    walk(set)
    walk(verifier)

    // 3. Same again with a signing prover and a pinned verifier.
    const { publicKey, secretKey } = keygen()
    const signer = MembershipSet.fromNamespace(H, NS, NAMES, { secretKey })
    const pinned = new Verifier(H, signer.nsHash, signer.signedHead('2026-11-06T00:00:00.000Z'), { publicKey })
    for (const p of plaintexts) assert.ok(!JSON.stringify(signer.state()).includes(p) && !JSON.stringify(pinned.state()).includes(p))
    walk(signer)
    walk(pinned)
  })

  test(`[${algorithm}] signed heads: the verifier only moves on a valid, newer, non-shrinking head`, () => {
    const { publicKey, secretKey } = keygen()
    const other = keygen()
    const set = MembershipSet.fromNamespace(H, NS, NAMES.slice(0, 5), { secretKey })
    const t = (i) => `2026-11-06T00:00:0${i}.000Z`

    const h0 = set.signedHead(t(0))
    assert.equal(verifyHead(H, publicKey, h0), true)
    assert.equal(verifyHead(H, other.publicKey, h0), false, 'wrong publisher key')

    const verifier = new Verifier(H, set.nsHash, h0, { publicKey })
    assert.equal(verifier.check('alice', set.prove('alice')).member, true)
    assert.throws(() => verifier.update(set.head()), /pinned/)

    // grow the set, publish a new head
    set.add('indexzero')
    assert.throws(() => verifier.check('indexzero', set.prove('indexzero')), /does not verify/, 'old root')
    const h1 = set.signedHead(t(1))
    verifier.accept(h1)
    assert.equal(verifier.check('indexzero', set.prove('indexzero')).member, true)

    // replays and tampering
    assert.throws(() => verifier.accept(h1), /stale/)
    assert.throws(() => verifier.accept(h0), /stale/)
    const tamperedRoot = { ...set.signedHead(t(2)), root: Buffer.alloc(H.bytes, 9) }
    assert.throws(() => verifier.accept(tamperedRoot), /signature/)
    const tamperedSize = { ...set.signedHead(t(2)), size: 99 }
    assert.throws(() => verifier.accept(tamperedSize), /signature/)
    const tamperedTs = { ...set.signedHead(t(2)), ts: t(3) }
    assert.throws(() => verifier.accept(tamperedTs), /signature/)
    const forged = signHead(H, other.secretKey, set.head(), t(2))
    assert.throws(() => verifier.accept(forged), /signature/)

    // rollback: a validly signed head with fewer leaves is refused
    const smaller = MembershipSet.fromNamespace(H, NS, ['alice'], { secretKey })
    assert.throws(() => verifier.accept(smaller.signedHead(t(2))), /rollback/)

    // a prover without a key cannot sign
    assert.throws(() => MembershipSet.fromNamespace(H, NS, ['a']).signedHead(), /no signing key/)
  })
}

test('the hash allowlist rejects unknown algorithms and bad keys', () => {
  assert.throws(() => createHasher('md5'), /unknown hash/)
  assert.throws(() => createHasher('sha256', { key: Buffer.alloc(32) }), /only blake2b/)
  assert.throws(() => createHasher('blake2b', { key: Buffer.alloc(4) }), /key must be/)
})

test('a keyed BLAKE2b namespace yields leaves nobody without the key can derive', () => {
  const key = Buffer.alloc(32, 7)
  const open = createHasher('blake2b')
  const keyed = createHasher('blake2b', { key })
  assert.notDeepEqual(pkvKey(open, [...NS, 'alice']), pkvKey(keyed, [...NS, 'alice']))
  const set = MembershipSet.fromNamespace(keyed, NS, NAMES)
  const verifier = new Verifier(keyed, set.nsHash, set.head())
  assert.equal(verifier.check('alice', set.prove('alice')).member, true)
})

test('merkle primitives: leaf and node hashes are domain separated', () => {
  const H = createHasher()
  const x = Buffer.alloc(32, 1); const y = Buffer.alloc(32, 2)
  assert.notDeepEqual(merkle.leafHash(H, Buffer.concat([x, y])), merkle.nodeHash(H, x, y))
  assert.notDeepEqual(merkle.merkleRoot(H, []), merkle.leafHash(H, Buffer.alloc(0)))
})
