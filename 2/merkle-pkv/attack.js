#!/usr/bin/env node
'use strict'
// Dictionary attack against a published leaf set.
//
// The "publisher" builds a MembershipSet and publishes ONLY what the user's
// proposed record contains: ns (public) and the subjectHash values. No names.
// The "attacker" has the same public ns and a dictionary of candidate names.
//
//   node attack.js            unkeyed BLAKE2b (the design as proposed)
//   node attack.js --keyed    publisher uses keyed BLAKE2b; attacker lacks the key

const sodium = require('sodium-universal')
const { createHasher, pkvKey, pkvExtend, MembershipSet } = require('./index')

const keyed = process.argv.includes('--keyed')
const NS = ['github', 'username']
const DICT_SIZE = 1_000_000
const MEMBERS = 1_000

// A synthetic "GitHub": a million candidate usernames. Real GitHub is ~150M and public.
const dictionary = Array.from({ length: DICT_SIZE }, (_, i) => `user${i.toString(36)}`)
const secretMembers = new Set()
while (secretMembers.size < MEMBERS) secretMembers.add(dictionary[Math.floor(Math.random() * DICT_SIZE)])

// ---- publisher side -------------------------------------------------------
const key = keyed ? Buffer.alloc(32) : null
if (key) sodium.randombytes_buf(key)
const Hpub = createHasher('blake2b', key ? { key } : {})
const set = MembershipSet.fromNamespace(Hpub, NS, [...secretMembers])
const published = { ns: NS, leaves: set.state().leaves } // hex strings, no names
console.log(`published: ns=${JSON.stringify(published.ns)} + ${published.leaves.length} subjectHash values (${keyed ? 'KEYED' : 'unkeyed'} BLAKE2b)`)

// ---- attacker side --------------------------------------------------------
const Hatk = createHasher('blake2b') // attacker never has the key
const nsHash = pkvKey(Hatk, published.ns)  // computable from the public ns
const targets = new Set(published.leaves)
const recovered = []
const t0 = process.hrtime.bigint()
for (const name of dictionary) {
  if (targets.has(pkvExtend(Hatk, nsHash, name).toString('hex'))) recovered.push(name)
}
const secs = Number(process.hrtime.bigint() - t0) / 1e9
const rate = DICT_SIZE / secs

console.log(`attacker: hashed ${DICT_SIZE.toLocaleString()} candidates in ${secs.toFixed(2)}s  (${Math.round(rate).toLocaleString()} leaves/s, single Node thread)`)
console.log(`recovered ${recovered.length}/${MEMBERS} member names  e.g. ${recovered.slice(0, 5).join(', ') || '(none)'}`)
console.log(`extrapolation: 150,000,000 GitHub usernames at this rate = ${(150e6 / rate / 60).toFixed(1)} minutes on one core`)

// ---- what a slow hash would buy -------------------------------------------
const out = Buffer.alloc(32); const salt = Buffer.alloc(sodium.crypto_pwhash_SALTBYTES)
const t1 = process.hrtime.bigint()
sodium.crypto_pwhash(out, Buffer.from('user1'), salt, sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE, sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE, sodium.crypto_pwhash_ALG_ARGON2ID13)
const argon = Number(process.hrtime.bigint() - t1) / 1e9
console.log(`argon2id (interactive, 64 MiB) = ${(argon * 1000).toFixed(0)} ms/guess -> 150M names = ${(150e6 * argon / 86400).toFixed(0)} core-days, or ${(150e6 * argon / 3600 / 1000).toFixed(1)} hours on 1,000 cores`)
