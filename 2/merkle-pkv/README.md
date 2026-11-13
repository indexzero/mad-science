---
status: "stage 2: tried, nothing depends on it"
question: "Can a Merkle structure built from PKV subjectHash values alone answer username membership?"
answer: "Yes, with one correction: the PKV hash chain is not itself a Merkle tree. You build a Merkle tree over the PKV leaves and sign its head."
stack:
  - "Node.js >= 22"
  - "sodium-universal 5.0.1 (sodium-native backend)"
hash_default: "BLAKE2b-256 via crypto_generichash"
signature: "Ed25519 via crypto_sign_detached, PKV time-dependent form"
hash_allowed:
  - blake2b
  - sha256
  - sha512
sources_read:
  - "mikeal/pkv README (local checkout)"
  - "ProtoSchool: Merkle DAGs, lessons 4 and 5 (https://proto.school/merkle-dags/04, /05)"
  - "ProtoSchool: Content Addressing, lesson 3 (https://proto.school/content-addressing/03)"
  - "ProtoSchool tutorials index and tutorials.json resource lists"
  - "mikeal/prolly-trees README (hash-consistent search trees)"
  - "ipld/specs commit history (Mikeal as IPLD spec author)"
  - "RFC 6962 (Certificate Transparency) Merkle tree shape, from memory"
  - "trailofbits/skills sharp-edges (vendored under vendor/skills)"
skills_used:
  - "addyosmani/agent-skills interview-me (hypothesis + confidence; questions deferred, see Interview)"
  - "addyosmani/agent-skills idea-refine (one-pager at the end)"
  - "trailofbits/skills sharp-edges (crypto API footgun checklist)"
---

# merkle-pkv

Membership of a GitHub username, proven and checked using nothing but hashes
derived from PKV `subjectHash` values. No `subject` string, no `ns` string is
retained by the prover or the verifier. `dump` in the REPL shows you that.

```sh
npm test            # 30 tests across blake2b / sha256 / sha512
npm start           # REPL seeded with alice bob charlie david ellis
node repl.js --ns github,username indexzero mikeal   # your own seed
node repl.js --algo sha256
```

## 1. The short answer

Your data structure:

```js
{ subject: 'indexzero', ns: ['github', 'username'], subjectHash: 'd7e2…0a2f' }
```

`subjectHash` is `PKV-KEY(['github', 'username', 'indexzero'])`. The partial
hashes for `['github']` and `['github', 'username']` are the two earlier links
of the same chain.

**Does membership checking work from the hashes alone? Yes.** Given the
namespace hash (32 bytes) and a candidate name, anyone can recompute the
candidate's leaf and look it up. Given a Merkle root over the set of leaves,
anyone holding only that root can verify a short proof that a leaf is (or is
not) in the set.

**But the correction matters:** the chain `KEY(['github']) → KEY(['github','username']) → subjectHash`
is **not a Merkle tree over the usernames**. It is a *hash chain* that runs
top-down. `KEY(['github','username'])` is computed from the two namespace
strings only. It does not depend on which usernames exist underneath it, so it
cannot commit to them, and it cannot be used to verify that `indexzero` is a
member. The PKV README warns about exactly this: "cryptographically speaking,
this is a sequence and not a hierarchy."

A Merkle tree runs the other way: **parents are hashed from children**, so the
root depends on every leaf (ProtoSchool, Merkle DAGs lesson 4: "parent nodes
cannot be created until CIDs of their children can be determined"). To get
membership proofs you build that second structure over the PKV leaves.

So the design is two hash structures glued at the leaf:

```
        PKV chain (top-down, addressing)          Merkle tree (bottom-up, commitment)

 H(H('github'))            = K0
 H(K0 || H('username'))    = K1   = nsHash                      root = H(0x01 || A || B)
 H(K1 || H('alice'))       = leaf_alice   ─┐                    /                    \
 H(K1 || H('bob'))         = leaf_bob     ─┼─ sorted leaves ─▶  A = H(0x01||l0||l1)   B = H(0x01||l2||l3)
 H(K1 || H('indexzero'))   = leaf_indexzero┘                    l_i = H(0x00 || leaf_i)
```

PKV answers "what is the ID of this (ns, subject)?" deterministically, so two
parties who agree on the encoding and hash get the same leaf without talking.
The Merkle tree answers "is this ID in the set?" with a proof the size of
log2(n) hashes, checkable against a single root.

## 2. Vocabulary, from soup

- **Hash function.** A function from any bytes to a fixed-size digest that is
  deterministic (same bytes, same digest), one-way (digest does not reveal the
  bytes) and collision resistant (nobody can find two inputs with one digest).
  ProtoSchool's content-addressing lesson: "anyone using the same algorithm on
  the same data will arrive at the same hash."
- **Hash chain.** `k_i = H(k_{i-1} || x_i)`. Each link depends on everything
  before it and nothing after it. PKV-KEY is a hash chain over the key parts.
- **Merkle tree.** Leaves are hashed, pairs of hashes are hashed together, up
  to a single root. The root depends on every leaf. Change one leaf and the
  root changes.
- **Inclusion proof (audit path).** For one leaf, the list of sibling hashes
  on the way to the root. A verifier recomputes the root from the leaf and the
  siblings. If it matches, the leaf is in the tree.
- **Absence proof.** Only possible if leaves are **sorted**. Show the two
  adjacent leaves the missing one would sit between, each with an inclusion
  proof, and the verifier checks the ordering and adjacency.
- **Head.** What a verifier must hold: the root plus the leaf count. In
  Certificate Transparency this is the "signed tree head". Section 5b signs it
  the way PKV's time-dependent signatures work.

## 3. PKV-KEY, step by step, in sodium

From the PKV README:

1. Double-hash the first part: `K0 = H(H('github'))`.
2. For each later part: `K_i = H(K_{i-1} || H(part_i))`.
3. The last `K_i` is PKV-KEY. Each intermediate `K_i` is the PKV-KEY of the
   prefix, which is what PKV calls a namespace.

With BLAKE2b from sodium (hex, from `npm start`):

```
H('github')                        9b5ff339d2cd791974c67d6539258941934ad558518dc883dd698b87104a563b
KEY(['github'])                    475d6ddd64fa7468d42eaf60e119a3c0be17acaf1ba4daec31db2f5d56dfbc76
KEY(['github','username'])         3732dbfcb2324a22710938b8737c404cfe8e933ce92ff5c4258285b45d77c1dd
KEY(['github','username','indexzero'])
                                   dcaa27c76726fa77809dcd0415cc331d60ae790731666bd238851bbb0b3aca42
```

Your `d7e2…0a2f` will differ unless we agree on the same hash function, output
length, and string encoding. PKV says all three are consensus parameters, not
part of the spec. The code in `lib/pkv.js` is nine lines; the test in
`test.js` recomputes the chain with raw `sodium.crypto_generichash_batch` calls
to show nothing is hidden.

**Why the double hash on the first part?** Without it, a one-part key
`['z']` with `z = H('x') || H('y')` would equal the two-part key `['x','y']`.
Double hashing makes a one-part key `H(H(z))`, which can only collide if
`H(z)` equals a 64-byte string, and `H(z)` is 32 bytes. That is domain
separation by length.

## 4. Which sodium hash functions make this work

sodium-universal 5 re-exports sodium-native. Its hash-shaped exports, and
whether they fit:

| export | algorithm | output | fit |
|---|---|---|---|
| `crypto_generichash`, `_batch`, `_init/_update/_final` | BLAKE2b, optional 16..64 byte key | 16..64 bytes (default 32) | **yes, default here.** `_batch` hashes a list of buffers as one message, so `H(a \|\| b)` needs no concat. The key gives you a secret namespace salt for free. |
| `crypto_hash_sha256` (+ streaming) | SHA-256 | 32 | yes |
| `crypto_hash_sha512`, `crypto_hash` | SHA-512 | 64 | yes, bigger leaves |
| `crypto_shorthash` | SipHash-2-4, keyed | 8 | **no.** A MAC for hash tables, not collision resistant. 64-bit output is forgeable. |
| `crypto_pwhash*` | Argon2id, scrypt | any | **no.** Deliberately slow password stretching. Wrong tool. |
| `crypto_kdf_derive_from_key` | BLAKE2b subkeys | 16..64 | no. Derives keys from a master key, not a general hash. |
| `extension_pbkdf2_sha512` | PBKDF2 | any | no. Password stretching. |

Any collision-resistant hash works because both structures only need
determinism plus collision resistance. `lib/hash.js` exposes an allowlist of
three rather than a free algorithm string, following the Trail of Bits
sharp-edges rule that "APIs that accept algorithm as string" are a footgun.

## 5. What this implementation does and does not store

`MembershipSet` (prover) holds:

- `nsHash`: 32 bytes, `PKV-KEY(['github','username'])`.
- `leaves`: sorted, de-duplicated 32-byte PKV-KEYs, one per username.

`Verifier` (light client) holds:

- `nsHash`, `root`, `size`, and when pinned to a publisher, `publicKey` and the
  last accepted `ts`.

Neither holds a string. `test.js` proves it two ways: it serialises both
objects and asserts no namespace or username appears, and it walks every own
property and asserts each is a Buffer, a number, or an array of Buffers. The
REPL disables readline history so typed names do not linger in the process
either. The one unavoidable exception is the line you just typed, which exists
until `leafFor()` returns.

Checking a name (`has alice` in the REPL) runs the full protocol:

1. Prover canonicalizes the name (trim, lowercase) and computes
   `leaf = H(nsHash || H('alice'))`, binary-searches its sorted
   leaves, and builds either an inclusion proof (index + sibling path) or an
   absence proof (the two neighbours, each with its own inclusion proof).
2. Verifier independently computes the same leaf from its `nsHash`, then checks
   the proof against its `root` and `size`. It never sees the leaf list.

The tree shape is RFC 6962: split at the largest power of two below `n`, no
padding, `0x00` prefix for leaves and `0x01` for interior nodes so a leaf can
never be passed off as a node. The verifier re-derives the leaf index from the
path's left/right flags and the tree size, so a prover cannot lie about
adjacency in an absence proof. Tests cover every tree size from 0 to 24, and
reject bit flips, swapped sides, wrong indexes, stale roots, and forged leaves.

### 5b. Signed heads, so the verifier can learn a new root

A Merkle root is only as trustworthy as the channel that delivered it. PKV's
answer is a signature, and its recommended form is time dependent: hash the
serialized time, then sign that hash followed by the thing being signed.
`lib/head.js` does exactly that with sodium's Ed25519:

```
commit  = H(0x02 || root || size as 8-byte big-endian)   0x02 keeps it apart from leaves/nodes
message = H(ts) || commit                                 ts is an ISO-8601 string, by consensus
sig     = crypto_sign_detached(message, secretKey)
```

The prover is given a `secretKey` at construction and publishes
`signedHead(ts)`. The verifier is constructed with the publisher's `publicKey`
and from then on only `accept(signedHead)` can move its root. It refuses:

- a signature that does not verify (wrong key, altered root, size or ts),
- a `ts` that is not strictly newer than the last accepted one (replay),
- a `size` smaller than the last one (rollback of an append-only set).

In the REPL every `add` signs a new head and the verifier accepts it. `head`
prints the latest signed head. `forge` has a second keypair sign a head over a
set containing "mallory" and shows the verifier refusing it.

## 6. Things that do NOT work, or work differently than you might expect

- **The partial hashes do not authenticate anything.** `KEY(['github'])` and
  `KEY(['github','username'])` are prefixes, not Merkle inner nodes. Holding
  them tells you nothing about which usernames exist. You cannot walk down a
  hash chain; hashes are one way.
- **Hashing usernames hides nothing.** Anyone who knows (or guesses) the
  namespace can compute `nsHash`, then test every GitHub username against the
  leaf set or against the root with proofs. `node attack.js` demonstrates it:
  given only `ns` and the published subjectHash values, a dictionary of one
  million names is inverted in about 1.5 s on one Node thread, recovering every
  member. Omitting `subject` from a published record and sharing the
  hash-to-name mapping out of band does not help, because the mapping is
  recomputable from public inputs. This is accepted here on purpose: the scope
  is "is this name taken?", which must be computable from subjectHash values
  by anyone, and that is PKV's stated purpose for public data. If a future
  scope needs a set only key holders can query, `node attack.js --keyed` shows
  keyed BLAKE2b (`createHasher('blake2b', { key })`) recovering zero names.
  Slow hashes and an oblivious PRF are discussed in the session notes, not built.
- **The root is not self-authenticating.** A Merkle root proves consistency
  with itself. Someone still has to tell you which root is the real one. This
  repo signs the head (section 5b), but the verifier still has to get the
  publisher's public key from somewhere it trusts. Key distribution is out of
  scope here, as it is in PKV.
- **Adds change the root.** Every `add` re-roots, the prover signs the new
  head, and the verifier must accept it. Proofs against the old root fail
  (tested). Removal is not supported; a shrinking size is treated as rollback.
- **No encoding, no consensus.** PKV does not define string encoding. This
  code uses UTF-8 and no length prefixes, and canonicalizes the subject by
  trimming and lowercasing before hashing, because GitHub usernames are
  case-insensitive and `Alice` must not read as "not taken" when `alice` is.
  Namespace parts are NOT lowercased. Both prover and verifier apply the same
  `normalize` function; pass `normalize: s => s` to both to opt out. Change
  any of this and every hash changes.
- **A nit on the PKV README.** It claims PKV-VALUE "cannot conflict with
  PKV-KEY". Both have the shape `H(32 bytes || 32 bytes)`:
  `PKV-VALUE = H(H(value) || KEY)` and `KEY' = H(KEY_prefix || H(part))`. With
  adversarially chosen byte-string parts (parts are unencoded bytes) a value
  hash can be made to equal a key hash. Natural inputs never collide, but the
  guarantee is weaker than "cannot". A fixed type prefix, like the `0x00`/`0x01`
  bytes in `lib/merkle.js`, would make the claim strictly true.

## 7. Files

| file | what |
|---|---|
| `lib/hash.js` | sodium hash allowlist; `H(...parts)` = hash of concatenation |
| `lib/pkv.js` | PKV-KEY, prefixes, PKV-VALUE, PKV-KV per the README |
| `lib/merkle.js` | RFC 6962 tree over sorted leaves, inclusion and absence proofs |
| `lib/head.js` | Ed25519 signed heads in PKV's time-dependent form |
| `lib/membership.js` | `MembershipSet` (prover, optionally signing) and `Verifier` (light client, optionally pinned) |
| `repl.js` | the REPL (`add`, `has`, `proof`, `head`, `forge`, `root`, `dump`) |
| `test.js` | 30 tests via `node --test` |
| `attack.js` | dictionary-attack demo: enumeration is possible by design, keyed variant resists it |
| `.vlurpfile`, `vendor/skills/` | vendored Trail of Bits sharp-edges skill, fetched with vlurp under Node 22 |

## 8. One-pager (idea-refine)

**How might we** let anyone check whether a GitHub username is in a set using
only hashes, so the set can be published without publishing the names?

**Recommended direction.** PKV-KEY for addressing (deterministic leaf per
`(ns, subject)`), a sorted RFC 6962 Merkle tree for commitment, a
head-plus-proof protocol between prover and verifier. This repo is that MVP.

**Key assumptions to validate**

- [ ] The consumers of this set will agree on hash + encoding. Test: publish
      the `nsHash` and three known leaves; a second implementation must match.
- [ ] Dictionary enumeration is acceptable because the data is public. Test:
      decide whether the keyed variant is the default before any real set ships.
- [x] Someone will sign the head. Done in `lib/head.js`; `add` in the REPL is
      still one command. Remaining: how the verifier learns the publisher key.

**MVP scope.** In: PKV leaves, sorted tree, inclusion and absence proofs,
no-plaintext prover and verifier, signed heads, REPL, tests. Out: persistence,
key distribution, networking, removal, more than one namespace per tree.

**Not doing, and why**

- Merkle-izing the PKV chain itself. It is a chain; the README says so.
- A prolly tree or HAMT (Mikeal's `prolly-trees`). Right tool for a large,
  mutable, replicated set; wrong size for understanding the idea.
- Hiding usernames with a slow hash. Argon2 over a 40-million-name dictionary
  still finishes; secrecy comes from a key, not from slowness.
- Storing names in the REPL history or anywhere else.

**Open questions**

- How does a verifier learn the publisher's public key? (The head itself is now signed.)
- Is the set per namespace or is one tree meant to hold several namespaces?
- Should the leaf be PKV-KEY or PKV-KV, so that a value (say, a profile hash)
  travels with the membership proof?

## 9. Interview (interview-me)

This ran unattended, so the one-question-at-a-time loop could not block on
you. Hypothesis and confidence are recorded here; the next three questions,
with guesses, are in the final chat message.

```
HYPOTHESIS: You want to publish "who is in this set of GitHub users" as hashes,
            and have anyone verify a name against it without a names list.
CONFIDENCE: ~70%. Unresolved: whether the goal is bandwidth (small proofs),
            deniability (no names on the wire), or both; and who signs the root.
```

## 10. Sources

Mikeal-involved first:

- `mikeal/pkv` README, read in full. Defines the chain this repo implements.
- `mikeal/prolly-trees` README. Hash-consistent search trees; the production-scale
  cousin of the toy tree here, "does not have an opinion about how blocks are
  encoded and hashed", same stance as PKV.
- IPLD specs (`ipld/specs`), where Mikeal was a primary author (commits through
  2020 confirmed with `gh api`). The IPLD stance that a link is a hash and that
  structure is a view over hashes is the lens used in section 1.
- ProtoSchool "Merkle DAGs: Structuring Data for the Distributed Web", lessons 4
  (CIDs of parents depend on children) and 5 (verifiability, subgraph retrieval).
  ProtoSchool is Protocol Labs; the tutorial's resource list links IPLD docs.
- ProtoSchool "Content Addressing on the Decentralized Web", lesson 3
  (hash properties). Also skimmed the tutorials index and
  `src/static/tutorials.json`; no per-tutorial author credits are published, so
  I cannot confirm Mikeal authored any ProtoSchool page.
- RFC 6962 section 2.1 (Certificate Transparency) for the tree shape, audit
  path, and the `0x00`/`0x01` domain separation. From memory, not fetched.
- `trailofbits/skills` sharp-edges, vendored via `.vlurpfile`. Applied: no free
  algorithm string, no "fast hash for secrecy", explicit domain separation.
