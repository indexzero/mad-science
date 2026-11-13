#!/usr/bin/env node
'use strict'
// Usage: node repl.js [--algo blake2b|sha256|sha512] [--ns github,username] [name ...]
//
// A tiny REPL over a MembershipSet (prover) and a Verifier (light client).
// Neither object stores subject or namespace strings. `dump` shows you exactly
// what is in memory. readline history is disabled so typed names do not linger.

const readline = require('node:readline')
const { createHasher, pkvPrefixes, MembershipSet, Verifier, keygen } = require('./index')

const argv = process.argv.slice(2)
const opt = (flag, dflt) => { const i = argv.indexOf(flag); return i === -1 ? dflt : argv.splice(i, 2)[1] }
const algorithm = opt('--algo', 'blake2b')
const nsParts = opt('--ns', 'github,username').split(',')
const seed = argv.length ? argv : ['alice', 'bob', 'charlie', 'david', 'ellis']

const H = createHasher(algorithm)
const hex = b => b.toString('hex')
const short = b => `${hex(b).slice(0, 8)}…${hex(b).slice(-4)}`

// --- the only moment ns strings exist: turn them into hashes, print, forget ---
const prefixes = pkvPrefixes(H, nsParts)
console.log(`hash: ${algorithm} (${H.bytes * 8}-bit) via sodium-universal`)
console.log('namespace PKV-KEY chain (computed once, strings not retained):')
nsParts.forEach((_, i) => console.log(`  KEY(ns[0..${i}]) = ${hex(prefixes[i])}`))
// --- publisher keypair: the prover signs heads, the verifier pins the public key ---
const { publicKey, secretKey } = keygen()
let lastTs = ''
const nextTs = () => { let ts = new Date().toISOString(); if (ts <= lastTs) ts = lastTs.replace(/\.(\d{3})Z$/, (_, ms) => `.${String(Number(ms) + 1).padStart(3, '0')}Z`); lastTs = ts; return ts }

const prover = new MembershipSet(H, prefixes[prefixes.length - 1], { secretKey })
for (const name of seed) prover.add(name)
const verifier = new Verifier(H, prover.nsHash, prover.signedHead(nextTs()), { publicKey })
console.log(`publisher pubkey (Ed25519) = ${hex(publicKey)}`)
console.log(`seeded ${prover.leaves.length} leaves; signed head accepted, root = ${hex(verifier.root)}\n`)

const HELP = `commands:
  add <name> [name ...]   derive leaf = H(nsHash || H(name)), insert, sign new head, verifier accepts it
  has <name>              prover builds a proof, verifier checks it against root+size only
  proof <name>            print the inclusion/absence proof as JSON
  head                    print the latest signed head (root, size, ts, Ed25519 signature)
  forge                   try to feed the verifier a head signed by a different key
  root                    print verifier state (root, size, pinned pubkey, ts)
  dump                    print EVERYTHING the prover and verifier hold (all hex)
  help | exit`

function fmtProof (p) {
  const step = s => ({ side: s.side, hash: hex(s.hash) })
  const incl = q => q && { leaf: hex(q.leaf), index: q.index, path: q.path.map(step) }
  return p.kind === 'inclusion'
    ? { kind: p.kind, ...incl(p) }
    : { kind: p.kind, leaf: hex(p.leaf), left: incl(p.left), right: incl(p.right) }
}

function run (line) {
  const [cmd, ...args] = line.trim().split(/\s+/)
  switch (cmd) {
    case '': return
    case 'help': return console.log(HELP)
    case 'exit': case 'quit': return rl.close()
    case 'add': {
      if (!args.length) return console.log('usage: add <name>')
      for (const name of args) {
        const { leaf, added } = prover.add(name)
        console.log(`${added ? 'added ' : 'exists'} leaf ${short(leaf)}`)
      }
      verifier.accept(prover.signedHead(nextTs()))
      return console.log(`signed head accepted; root -> ${hex(verifier.root)} (size ${verifier.size}, ts ${verifier.ts})`)
    }
    case 'has': {
      if (args.length !== 1) return console.log('usage: has <name>')
      const proof = prover.prove(args[0])
      try {
        const { member, leaf } = verifier.check(args[0], proof)
        const where = proof.kind === 'inclusion' ? `index ${proof.index}, path ${proof.path.length}` : `between ${proof.left ? proof.left.index : '-∞'} and ${proof.right ? proof.right.index : '+∞'}`
        return console.log(`${member ? 'MEMBER    ' : 'NOT MEMBER'} leaf ${short(leaf)}  ${proof.kind} proof verified against root ${short(verifier.root)} (${where})`)
      } catch (err) {
        return console.log(`PROOF REJECTED: ${err.message}`)
      }
    }
    case 'proof': {
      if (args.length !== 1) return console.log('usage: proof <name>')
      return console.log(JSON.stringify(fmtProof(prover.prove(args[0])), null, 2))
    }
    case 'head': {
      const h = prover.signedHead(nextTs())
      return console.log(JSON.stringify({ root: hex(h.root), size: h.size, ts: h.ts, signature: hex(h.signature) }, null, 2))
    }
    case 'forge': {
      const mallory = keygen()
      const fake = new MembershipSet(H, prover.nsHash, { secretKey: mallory.secretKey })
      fake.add('mallory')
      try { verifier.accept(fake.signedHead(nextTs())); return console.log('!!! verifier accepted a forged head') } catch (err) { return console.log(`verifier refused: ${err.message}`) }
    }
    case 'root': return console.log(JSON.stringify(verifier.state(), null, 2))
    case 'dump': return console.log(JSON.stringify({ prover: prover.state(), verifier: verifier.state() }, null, 2))
    default: return console.log(`unknown command "${cmd}"; try help`)
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'merkle-pkv> ', historySize: 0, terminal: process.stdin.isTTY })
console.log(HELP + '\n')
rl.prompt()
rl.on('line', line => { run(line); rl.prompt() })
rl.on('close', () => { console.log(); process.exit(0) })
