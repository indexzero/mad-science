---
status: "first research run, complete; awaiting Charlie's review"
date: 2026-10-01
criteria: "RESEARCH.CRITERIA.md"
log: "RESEARCH.LOG.md"
offerings: 16
facts: 464
sources_cited: 141
specs_archived: 69
predictions: "Claude's stand-in, pre-registered at 2026-10-01T04:35:52Z; not Charlie's"
on_conflict: "The fact base in data/ wins over this summary. Each offering page in offerings/ gives the facts with sources."
---

# OOBTA: findings of the first research run

## Summary

1. **The most informative lens is "what the verifier must trust at
   verify time"**, not the proof family. On the facts that it does not
   read, it scores a category utility of 1.14 (p < 0.001). The proof
   family scores 0.81 (p = 0.02).
2. **The effort tier (build, attach, migrate) does not find structure**
   on held-out facts (p = 0.10). A deeper property drives it: whether
   the identifier *is* the key, or *points to* a key.
3. **Key lifecycle needs indirection.** Exactly five offerings keep their
   links when the key rotates. All five put a registry or a domain name
   between the identifier and the key, and all five require migration.
   No offering that attaches to a key you own survives key rotation.
4. **Many offerings do not claim sameness.** Passport proves that an
   address controls *some* GitHub account. Sigstore proves who
   controlled an account during a 10-minute window. UCAN and ReCap say
   "may act for". A Bluesky check says "authentic and notable". The map
   needs an axis for what the link asserts.
5. **A link cannot be more sovereign than its anchor.** In 10 of the 15
   offerings that have operators, a US operator can forge a link. The move of the PLC
   directory to Switzerland protects records from censorship and
   disclosure. It does not protect against forgery, which sits with the
   DNS anchor of the handle. The transfer is not complete. Almost every
   operator that cannot forge is in the record layer.
6. **"Forge" is two powers, not one.** The research agents coded it two
   ways. Account-side forgery (an anchor operator binds its account to a
   key it holds) is universal. Key-side forgery (an issuer or registry
   claims that your key controls an account, without your key) is a
   design choice.
7. **Five of the sixteen offerings are outside OOBTA as defined:** UCAN,
   ReCap, Pkarr, did:web, and IndieWeb rel=me. They are substrates or
   anchor-side tools, not links. Two more, Bluesky verification and
   Passport, are inside the definition only in form.
8. **Claude's stand-in predictions matched the proof family 87% of the
   time** (surprise 0.13). The proof family mostly confirms what Claude
   already believed. The lifecycle lens (0.38) and the forge lens (0.56)
   surprised it most.

## Lens scores

Category utility (CU) measures how alike the members of a group are,
and how different the groups are. "Held-out" scores use only the facts
that the lens rules do not read. p is the share of 2000 random
partitions, with the same group sizes, that score at least as high.
Surprise is the share of offerings where the lens disagrees with the
pre-registered prediction.

| Lens | Groups | CU | p | Held-out CU | Held-out p | Hybrid or misfit | Stability range | Surprise |
|---|---|---|---|---|---|---|---|---|
| Claude's prediction (stand-in) | 5 | 1.077 | 0.001 | 1.077 | 0.001 | 5 | 0.176 | — |
| Proof family | 4 | 1.150 | 0.001 | 0.812 | 0.021 | 3 | 0.164 | 0.13 |
| **Trusted at verify time** | 4 | **1.523** | < 0.001 | **1.142** | < 0.001 | 4 | **0.138** | 0.31 |
| PKI vocabulary | 4 | 1.100 | 0.002 | 0.869 | 0.026 | 8 | 0.138 | 0.31 |
| Anchor's role | 5 | 1.179 | < 0.001 | 0.821 | 0.017 | 8 | 0.220 | 0.25 |
| How a link dies | 4 | 1.112 | 0.002 | 0.870 | 0.021 | 3 | 0.217 | 0.38 |
| Effort tier | 3 | 1.014 | 0.003 | 0.694 | **0.101** | 1 | 0.168 | 0.13 |
| Who can forge | 3 | 0.881 | 0.026 | 0.881 | 0.026 | **11** | 0.192 | 0.56 |

Before the forge coding was harmonized, "Who can forge" scored 0.558
(p = 0.48), which is not different from chance. See
`data/scores.before-forge-harmonization.md` and the log.

Redundancy between lenses (normalized mutual information, NMI):

- Proof family and PKI vocabulary agree strongly (NMI 0.76). One of
  them is redundant. The proof family is the better of the two, with
  three misfits against eight.
- The effort tier is nearly independent of every other lens (NMI 0.08 to
  0.40). Its strongest link is with "How a link dies" (0.40).
- "Who can forge" is weakly related to the proof family (NMI 0.34). The
  way a link is proved predicts little about who can forge it.

The full matrix is in `data/lens-agreement.csv`. The diagrams are in
`out/` after `pnpm build`.

## Finding: key lifecycle needs indirection

| Offering | Needs registry | Survives rotation | Key recovery | Requires migration |
|---|---|---|---|---|
| ATProto handle + did:plc | yes | yes | yes | yes |
| Bluesky verification | yes | yes | yes | yes |
| Keybase | yes | yes | yes | yes |
| Farcaster verifications | yes | yes | yes | yes |
| did:web | no (DNS name) | yes | yes | yes |
| All 11 others | no | no (IndieWeb: `na`) | 9 no, 1 yes (Storacha), 1 `na` | mixed |

The five offerings that survive rotation all resolve the identifier to
a key through something mutable: a registry (PLC, the Keybase sigchain
server, the Farcaster IdRegistry on OP Mainnet) or a DNS name. Each one
also requires migration to its system. The cost of the indirection is
an operator who can censor or disclose. In did:web and NIP-05 the
indirection can also forge: whoever controls the domain controls the
identity.

The offerings where the identifier is the key (did:key, a nostr npub, an
OpenPGP key, an Ethereum address, a Pkarr key) need no operator. They
also have no way to keep a link when the key changes. This is the
trade-off behind "attach or migrate".

Two partial exceptions:

- **Storacha did:mailto** supports recovery: the email address is the
  root, and a new key gets a new delegation. The cost is a service that
  can forge any account's delegation (the did:mailto signature is zero
  bytes).
- **Nostr NIP-05** lets the domain owner point a name at a new key
  without the old key. For users who rotate, DNS, not the Nostr key,
  becomes the stable root.

## Finding: what the link asserts

| Assertion | Offerings |
|---|---|
| **Sameness**: this key and this account have one controller | NIP-39, NIP-05, ATProto handle, Keybase, Keyoxide, DIF Well-Known, Farcaster (wallet links) |
| **Time-bound control**: this account controlled this key at time T | Sigstore (10-minute certificates, account email, not username) |
| **Anonymous control**: this key controls *some* account at this provider | Passport (only a provider name and hashes) |
| **Platform attestation**: an app says this account is linked | Farcaster (X link: FIP-19 says attestations are not verified) |
| **Editorial**: this account is authentic and notable | Bluesky verification |
| **Authority**: this key may act for that principal | UCAN, ReCap, Storacha did:mailto |
| **None**: no link between two identities | did:web (domain is the identity), Pkarr (key is the root), IndieWeb rel=me (no key) |

Only the first row matches the definition of OOBTA in the criteria. The
rest are adjacent. A verifier that treats a Passport stamp or a
Bluesky check as a sameness proof makes an error that the spec does not
support.

## Finding: sovereignty

The operators that the most offerings depend on (from
`data/concentration.csv`):

| Operator | Jurisdiction | Offerings | Can forge in | Layers |
|---|---|---|---|---|
| DNS registrar | varies | 7 | 7 | anchor, proof, record |
| GitHub | US | 7 | 7 | anchor, proof |
| Web host for the user's domain | varies | 7 | 5 | proof, record |
| X | US | 5 | 4 | anchor, proof |
| Mastodon instances | varies | 4 | 4 | anchor, proof |

- GitHub and DNS are the two shared chokepoints.
- In 10 of 15 offerings with operators, a US operator can forge a link.
  No Swiss operator can forge in any offering.
- Of the 14 operators that cannot forge in any offering, 12 are only in
  the record layer: both PLC directories, the Keybase server, OP
  Mainnet, Ethereum, the Nostr relays, the Mainline DHT, the Pkarr
  relays, Stellar (for Keybase roots), the Rekor log, keys.openpgp.org,
  and the Keyoxide ASPE server. The two exceptions are the WebPKI CA for
  did:web (anchor layer) and the Snapchain validators (proof and record
  layers). Signed records protect themselves. Anchors do not.
- **PLC transfer status.** The PLC Organization formally exists as of
  2026-09-28 and is getting ready to take over. Bluesky Social PBC (US)
  still operates `plc.directory`. The directory can censor, delay, and
  disclose. It cannot forge, because operations are signed by rotation
  keys. Most users' rotation keys are held by their PDS, which for most
  users is Bluesky.
- **Ownership concentration.** Since January 2026, Neynar owns the
  Farcaster protocol, the main client, and the only deployed attestor.
  Keybase belongs to Zoom.

## Misfit log

| Offering | Axis | Why it does not fit | Change to the map |
|---|---|---|---|
| UCAN | proof family, anchor role | Delegation substrate. It never says "A is B". | Out of OOBTA. List as a substrate. |
| ReCap | proof family, anchor role | Delegation from a wallet to a session key. No anchor. | Out of OOBTA. Substrate. |
| Pkarr | all | The key is the root; DNS records are its content. No anchor. | Out of OOBTA. Record substrate (did:dht uses it). |
| did:web | proof family, effort tier | The domain is the identity. No second identity to link. | Out of OOBTA. Indirection example. |
| IndieWeb rel=me | key facts | No key. Links two URLs. | Out of OOBTA. Anchor-side tool. |
| Bluesky verification | anchor role | Editorial judgement. No external account. | Assertion axis: "editorial". |
| Passport | proof family | Hides which account. Not a sameness proof. | Assertion axis: "anonymous control". |
| Sigstore | proof family, lifecycle | Binds for 10 minutes; email, not username. | Assertion axis: "time-bound control". |
| Storacha did:mailto | proof family | Delegation in form, issuer attestation in security. Email is the root, key is the delegate. | Hybrid. The direction of the link is a property to record. |
| Farcaster | proof family | App key delegated by the user signs the X attestation. Self-claim and attestation blur. | Hybrid. Assertion axis: "platform attestation". |
| Keybase | proof family | Bidirectional proofs plus a mandatory vendor log. | Verify-trust: anchor + registry. |
| ATProto handle | proof family | One direction lives in a registry. The PDS often holds both ends. | Verify-trust: anchor + registry. Custody is a property to record. |
| NIP-39, NIP-05 | effort tier | Attach only if you already hold a Nostr key. | Effort tier depends on the user, not the offering. Replace it. |
| Who can forge (lens) | overlay | 11 of 16 offerings are hybrid. | Split forge into account-side and key-side. |
| Effort tier (lens) | axis 2 | No structure on held-out facts. | Replace with the indirection axis. |

## Revised map (v2)

### Axis 1: trusted at verify time

What the verifier must trust when it checks the link: **nothing**
(self-contained), the **anchor**, an **issuer**, or a **registry**.
Combinations are common: Keybase, ATProto, Farcaster, and Bluesky
verification each need anchor plus registry, or issuer plus registry.
Record the set, not one value.

### Axis 2: identifier binding

- **Identifier is the key.** did:key, npub, OpenPGP fingerprint,
  Ethereum address, Pkarr key. No operator. No rotation.
- **Identifier points to a key.** Through a registry (PLC, Keybase,
  Farcaster IdRegistry) or a name (did:web, NIP-05). Rotation and
  recovery are possible. An operator holds the pointer.

This replaces build / attach / migrate. The effort tier follows from it:
"migrate" means "adopt someone else's pointer".

### Axis 3: what the link asserts

Sameness, time-bound control, anonymous control, platform attestation,
editorial, or authority. Only sameness is OOBTA in the narrow sense.

### Overlay: sovereignty

For each layer (record, proof, anchor), record the operator, the legal
home, read and write exit, and four powers:

- **Account-side forge**: bind the anchor to a key the operator holds.
  Every anchor operator has this power.
- **Key-side forge**: claim that a key controls an account without that
  key's signature. Issuers, CAs, and some registries have this power.
- **Censor**: refuse, delay, or delete.
- **Disclose**: hand over logs or account data.

### Scope

OOBTA is a sameness claim between a key-rooted identifier and an
account that existed before it. Substrates (UCAN, ReCap, Pkarr, did:web)
and anchor-side tools (rel=me) are listed beside the map, not on it.

### Changelog against RESEARCH.CRITERIA.md

- Axis 1 was the proof family. It is now "trusted at verify time". The
  proof family becomes a property of each offering. It is mostly
  redundant with the PKI vocabulary.
- Axis 2 was the effort tier. It is now identifier binding.
- Axis 3 is new: what the link asserts.
- The forge power is split into account-side and key-side.
- Capability delegation moves from a proof family to the substrate list.
- The scope now excludes offerings that do not claim sameness, and lists
  them as adjacent.

## The spectrum from the first conversation

Charlie asked where options sit on the spectrum from "build everything"
to "attach a protocol" to "migrate to ATProto or Nostr". This study
gives no recommendation. These are the facts that bear on the question:

- **Attach** options for a key you own: Keyoxide or ASP (spec v0 is
  still a draft; main-repo activity stopped in 2025), DIF Well-Known
  (domains only; expiry required), Sigstore (10-minute binding; email,
  not username), and Passport (EVM keys only; hides the account). None
  of them survives key rotation.
- **Migrate** options: ATProto (rotation and recovery, but the PDS
  usually holds the rotation keys, and the directory is still run by
  Bluesky PBC), Nostr (no rotation; NIP-39 claims are not verified by
  major clients), Farcaster (owned by one company since January 2026).
- **Build** means choosing a place on axis 2. A key-rooted identifier
  needs no operator and cannot rotate. A pointer can rotate, and someone
  must run it.

## Notable facts

- NIP-39 claims moved from the profile (kind 0) to kind 10011 on
  2026-02-10. Only 27 of 611 live proofs used the exact spec text.
- Mastodon never checks a verified link again. The checkmark stays after
  the backlink is removed.
- Keybase still ships releases and posts Merkle roots to Stellar every
  hour. New X and Reddit proofs have been broken since 2024.
- Storacha disabled writes on 2026-05-15. Its hosts were gone by
  September 2026. `ipfs.io` and `dweb.link` were retired on 2026-09-21.
- A did:web identity passes to whoever registers the domain after it
  expires. Nothing records the change.
- UCAN 1.0 left release-candidate status in July 2026.
- Rekor v2 reached general availability in October 2025. In June 2026,
  Sigstore kept Rekor v1 as the default.
- The IETF chartered an ATP working group in March 2026.

## Limits

- **Predictions.** The predictions are Claude's stand-in, not
  Charlie's. They test Claude's model of OOBTA. Predictions that Charlie
  writes after reading this are not a fair test.
- **One agent per offering.** No fact was checked by a second agent.
  Claude checked only the Storacha shutdown and the OP Mainnet operator.
- **Coding drift.** The forge coding drifted between agents. Other
  facts can have drifted in ways that the scores do not show.
  `data/merge-warnings.txt` lists the conflicts that the merge found.
- **Binary facts.** Yes and no flatten nuance. The notes column in
  `data/facts.csv` and the offering pages keep the nuance.
- **Small sample.** 16 offerings. The permutation test guards against
  chance, but one changed fact can move a lens. The stability ranges
  (0.14 to 0.22) show how much one offering moves each score.
- **Changes after pre-registration.** The held-out score, the forge
  harmonization, and the operator corrections came after the facts. The
  log records each one.

## Where to look

- `offerings/<id>.md`: one page per offering, with C1–C10, misfit
  notes, surprises, every fact with its source, and a sovereignty graph.
- `data/`: the fact base, overrides, scores, and concentration table.
- `specs/`: 69 primary spec documents, with `MANIFEST.csv`.
- `out/index.html` after `pnpm build`: every diagram and the scores.
