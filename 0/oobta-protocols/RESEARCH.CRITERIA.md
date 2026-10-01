---
status: "draft — criteria for a deep research run, not findings"
stage: 0
created: 2026-09-30
updated: 2026-10-01
question: "What is the shape of out-of-band trust anchoring (OOBTA)? Build a map of how self-certifying key identities get linked to existing accounts, then pressure-test the map by placing real offerings on it."
intent:
  outcome: "A map of OOBTA (proof families × build / attach / migrate effort) with a sovereignty overlay, tested by placing existing offerings on it."
  user: "Me, building understanding before any product exists."
  success: "Every offering is placed on the map or logged as a misfit, with a note on what the misfit says about the map. The map is revised until it holds."
  out_of_scope: "Recommendations, product requirements, KYC, proof of personhood."
  confirmed: 2026-09-30
seed_offerings:
  - "Nostr NIP-39 (external identities in kind-0 profiles)"
  - "Nostr NIP-05 (DNS / .well-known name to pubkey mapping)"
  - "ATProto handles (DNS TXT _atproto / .well-known/atproto-did, DID doc alsoKnownAs)"
  - "did:plc and the PLC directory (moving to the PLC Organization, a Swiss Association)"
  - "Bluesky verification records (trusted verifier accounts)"
  - "UCAN WG family (UCAN delegation, invocation, revocation; did:key)"
  - "Storacha / w3up (formerly web3.storage; UCAN with did:mailto)"
  - "ReCap (SIWE with capabilities)"
  - "Keybase sigchain proofs"
  - "Keyoxide / Ariadne Identity (OpenPGP notations, Ariadne Signature Profiles)"
  - "DIF Well-Known DID Configuration (domain linkage credentials)"
  - "did:web"
  - "Sigstore / Fulcio (OIDC to short-lived cert, Rekor transparency log)"
  - "W3C Verifiable Credentials issued after OAuth (e.g. Human/Gitcoin Passport stamps)"
  - "IndieWeb rel=me and IndieAuth"
  - "Farcaster verifications and connected accounts"
  - "Pkarr / Pubky (signed DNS records on the Mainline DHT)"
on_conflict: "Prefer the protocol's own spec or reference implementation over blog posts. Note the date of every source; this space changes fast."
sources:
  atproto_plc:
    - title: "First steps of the PLC organization"
      url: "https://blog.plcred.org/3mwlphq42d227"
    - title: "Public Ledger of Credentials Organization blog"
      url: "https://blog.plcred.org/"
    - title: "Minimal web-of-trust governance for did:plc (atproto discussion #4002)"
      url: "https://github.com/bluesky-social/atproto/discussions/4002"
    - title: "Adversarial PLC directory migration – microcosm"
      url: "https://updates.microcosm.blue/3lz7nwvh4zc2u?auth_completed=true"
    - title: "Rethinking Bluesky's \"Decentralization\": An Assessment as of January 2026"
      url: "https://plurality.leaflet.pub/3mfergx7i7c2b"
    - title: "AT Protocol – Wikipedia"
      url: "https://en.wikipedia.org/wiki/AT_Protocol"
  storacha_web3_storage:
    - title: "Introducing Web3.Storage"
      url: "https://filecoin.io/blog/posts/introducing-web3-storage/"
    - title: "Dag.house — Laura Winn Studio"
      url: "https://laurawinn.studio/Dag-house"
    - title: "DAG House w3up notes (olizilla)"
      url: "https://hackmd.io/@olizilla/SJ1B-okaj"
    - title: "Introducing Storacha"
      url: "https://filecoin.io/blog/posts/introducing-storacha---the-future-of-hot-decentralized-data/"
    - title: "Storacha documentation"
      url: "https://docs-beta.web3.storage/"
  visualization:
    - title: "Parallel Sets (D3 / Observable)"
      url: "https://observablehq.com/@d3/parallel-sets"
  mikeal_rogers:
    - title: "Mikeal Rogers on GitHub"
      url: "https://rat.dev/mikeal"
    - title: "EP63: David Choi & Mikeal Rogers from Protocol Labs building Filecoin and NFT.Storage"
      url: "https://www.ivoox.com/ep63-david-choi-amp-mikeal-rogers-from-protocol-audios-mp3_rf_83754051_1.html"
    - title: "Sustain Episode 57: Mikeal Rogers"
      url: "https://podcast.sustainoss.org/57"
    - title: "Mikeal Rogers obituary, New York Times"
      url: "https://www.legacy.com/us/obituaries/nytimes/name/mikeal-rogers-obituary?id=58676316"
---

# Out-of-band trust anchoring (OOBTA): research criteria

## Purpose

This research builds a map of OOBTA and then tests it. It does not pick a
winner. Each offering in the market is placed on the map. When an
offering does not fit, the misfit is the finding: it shows where the map,
or my understanding, is wrong.

## Background

A key-based identity is self-certifying: whoever holds the key is the
identity. Nobody else knows who that is. OOBTA links the key to an
account that people already trust, through a channel outside the key
system.

## The map under test

The map has two axes and one overlay. All three are hypotheses. The
research should challenge them, not assume them.

### Axis 1: proof family

1. **Bidirectional public proof.** The key signs a claim that names the
   account. The account publishes content that names the key, such as a
   gist, a post, a DNS record, or a `rel=me` link. Anyone can check both
   sides without asking a third party. Examples: Keybase, Keyoxide,
   NIP-39, ATProto handles.
2. **Issuer attestation.** The user signs in to a service with OAuth or
   OIDC. The service then signs a statement that binds the key to the
   account. The verifier must trust that service. Examples: Sigstore
   Fulcio, Passport stamps, Bluesky verifiers.
3. **Capability delegation (suspected misfit).** An account grants
   authority to a key, and the key never claims to *be* the account.
   UCAN with `did:mailto` is the example: a confirmed email delegates
   to a key. Decide whether this is a third family, a variant of family
   2, or outside OOBTA.

Classify each offering by the family closest to it, and name any part
that comes from another family.

### Axis 2: effort tier

The effort to get the link for a new key-based identity:

- **Build.** Write the linking mechanism from scratch.
- **Attach.** Add an existing linking protocol to a key system I own
  (for example, Keyoxide proofs or DIF domain linkage on a raw ed25519
  key or DID).
- **Migrate.** Adopt a platform that links natively (ATProto, Nostr,
  Farcaster), and accept its key types, hosting, and governance.

For each offering, record the tiers it supports, the work in each tier,
and what is given up.

### Overlay: sovereignty

Where each part of the link is stored, and who can act on it. Record
three layers for each offering:

| Layer | Examples |
|---|---|
| Identity record | DID document, PLC operation log, nostr kind-0 profile, Keybase sigchain |
| Linkage proof | gist, DNS TXT record, Rekor entry, UCAN, verification record |
| Anchor account | GitHub, X, domain registrar, email provider |

For each layer, record:

- **Location.** Where the data is stored: a central server, user-chosen
  relays, a DHT, DNS, or nowhere (`did:key`).
- **Operator.** Who runs the storage.
- **Legal home.** The jurisdiction of the operator. The PLC directory is
  the main case: it is moving from Bluesky PBC (US) to the PLC
  Organization, a Swiss Association. Record the transfer status as of
  the source date.
- **Exit.** Can the data be mirrored, moved, or re-hosted without the
  operator? Separate read exit (mirrors) from write exit (a new
  operator accepts updates).
- **Powers.** For each operator, can it **forge** a record, **censor**
  it (refuse, delay, delete), or **disclose** it (logs, request
  metadata, under subpoena)?

The overlay should test one claim: a link cannot be more sovereign than
its anchor account. A DID record held in Switzerland that links to a
GitHub account still depends on a US platform.

## Scope

In scope:

- Offerings with a written spec, or one widely deployed reference
  implementation.
- Anchors to centralized accounts (GitHub, X, Reddit, Mastodon, Google,
  email) and to DNS or domains.
- The UCAN WG family, even where it fits poorly.
- Offerings that are dead or broken, if they teach a lesson. Keybase
  and the X API shutdown are examples.

Out of scope:

- Recommendations, or which offering to use.
- Product requirements, or a preferred key system.
- KYC and government ID checks.
- Proofs of personhood that do not link to an account, such as
  biometrics or Worldcoin.
- Web-of-trust endorsements between keys only, such as PGP key signing,
  unless they are part of an offering that is otherwise in scope.

## Pipeline

Facts come first and lenses are computed from them. No fact list is
lens-neutral, so facts are kept atomic and checkable, and a lens is a
function over the facts, not a rating.

1. **Fact base.** For each offering and layer, record atomic facts that
   can be checked, each with a dated source. Example: "the verifier
   fetches `https://gist.github.com/...`", not "verifier independence:
   high". The criteria below are the checklist of what to record.
2. **Predictions, before any facts.** Write down each lens and where I
   expect every offering to land. Store the predictions as a lens of
   their own, so they show up in the diagrams.
3. **Projections.** Assign every offering to one category per lens.
   `hybrid` and `misfit` are explicit categories, never left blank.
4. **Scoring.** Compare lenses by:
   - **Category utility** (Gluck & Corter, 1985): members of a group
     are alike, and the groups differ from each other.
   - **Misfit count:** offerings the lens has to force into place.
   - **Stability:** remove one offering at a time and check whether the
     groups hold.
   - **Surprise:** distance from my predictions. A lens that never
     surprises me only confirms what I already believed.
5. **Map.** Draw the lens that wins, or the two that disagree most
   usefully. Keep it to about four groups, so it fits in working memory.

With about 17 offerings, some lens will fit by chance. Step 2 is the
guard against that.

## Fact schema

The planned diagrams set the shape of the data. Six CSV files, in
`data/`:

| File | Columns | Needed by |
|---|---|---|
| `offerings.csv` | `id, name` | all |
| `lenses.csv` | `id, label, categories` (`\|`-separated, in order; the first lens is the prediction) | parallel sets, heatmaps |
| `assignments.csv` | `offering, lens, category` | parallel sets, heatmaps |
| `facts.csv` | `offering, fact, value, source_url, source_date`; value is `yes`, `no`, `unknown`, or ordinal `0`–`3` | heatmaps |
| `operators.csv` | `id, name, kind, jurisdiction` | bipartite graph |
| `links.csv` | `offering, layer, operator, forge, censor, disclose` | bipartite graph |

Rules the diagrams impose:

- Facts are binary or ordinal. `unknown` is a value, never a blank;
  unknown is not the same as no.
- Each offering has exactly one category per lens.
- Operators are records of their own with a jurisdiction, not text
  inside an offering.
- Fact ids are prefixed by area (`proof.`, `verify.`, `lifecycle.`,
  `record.`) so heatmap columns group by criterion.

## Planned diagrams

Three diagrams, chosen to compare lenses, not to show one map:

1. **Parallel sets** (after
   [d3/parallel-sets](https://observablehq.com/@d3/parallel-sets)). One
   ribbon per offering. The first column lists offerings, then my
   prediction, then each lens. Ribbons keep the prediction's color, so
   disagreement shows even between columns that are not adjacent.
   Columns without crossings mean a lens is redundant.
2. **Reorderable matrix** (Bertin), with Observable Plot. Offerings ×
   atomic facts, one heatmap per lens. A lens only changes row order and
   group labels. Solid blocks mean the lens finds structure; a
   checkerboard means it does not.
3. **Sovereignty bipartite graph**, with Mermaid. Offerings on one side,
   operators grouped by jurisdiction on the other. Node shape encodes
   operator kind (platform, registry, log, CA, DNS, relay set, DHT).
   Edge weight encodes the strongest power: forge is thick, censor is
   solid, disclose only is thin and gray. It tests whether a few
   operators or one jurisdiction sit behind most offerings.

Also considered:

- **Wardley map:** a lens, not a way to compare lenses.
- **Quadrant chart:** only for a final lens with two continuous axes.
- **Ishikawa:** for post-mortems on single misfits.
- **Radar:** rejected. Its shape depends on axis order, and it implies
  continuity between categories.

## Generating the diagrams

All generation code is in this directory.

```sh
pnpm install
pnpm build          # writes out/: parallel-sets.svg, heatmap.*.html,
                    # sovereignty.mmd, sovereignty.svg, index.html,
                    # and a .png of every diagram
open out/index.html
```

- The scripts read `data/` once `data/offerings.csv` exists. Until then
  they read `data/example/`, which is made up and labeled as such in
  every diagram. `DATA_DIR` overrides both.
- The Mermaid render runs in Playwright. It uses Playwright's Chromium
  if installed (`pnpm browsers`), else the system Chrome.
  `PLAYWRIGHT_CHANNEL` forces a channel.
- Colors come from the validated reference palette: three categorical
  slots that pass all-pairs color-vision checks, with non-fits in
  neutral gray.

## Criteria per offering

Record atomic facts against every criterion below. Cite a dated source
for each fact.

### C1. Proof mechanism

- Family on Axis 1, and any mixed parts.
- Where each half of the link lives: the key side and the account side.
- The exact signed payload and its format.

### C2. Verifier independence

- Can a verifier check the link without a service run by the offering's
  authors?
- What does the verifier fetch, and from where?
- Does verification still work when the platform API is closed or rate
  limited, as on X?

### C3. Platform coverage and fragility

- The supported anchors: GitHub, X, Mastodon, DNS, email, Reddit, HN,
  and others.
- How each proof breaks: account deleted, post edited, API removed,
  scraping blocked.
- Whether the offering can add a new platform without a spec change.

### C4. Key lifecycle

- What happens to existing links when the key rotates.
- Revocation: how a link is withdrawn, and how fast verifiers learn of
  it. Include UCAN revocation.
- Recovery after key loss. Rotation keys in `did:plc` are an example.

### C5. Freshness and replay

- Can an old proof be replayed after the account changes owner?
- Do proofs carry timestamps, nonces, or expiry, or rely on a
  transparency log?

### C6. Threat model

- Who can forge a link: the platform, a DNS registrar, the issuer, or a
  compromised verifier?
- Account takeover: does a stolen GitHub account let the thief claim a
  link to their own key?
- Privacy: does the link expose metadata the user did not mean to
  publish?

### C7. Key system portability

- Is the offering tied to one key system (nostr secp256k1, PGP,
  `did:plc`)?
- Could the same mechanism anchor a generic DID or a raw ed25519 key?

### C8. Adoption and status

- Spec maturity: draft, NIP, W3C Rec, DIF work item, WG spec,
  vendor-only.
- Signs of real use: clients that display the link, number of verified
  links where known, last spec change.
- Maintained, stagnant, or dead.

### C9. Effort tier

- Placement on Axis 2, with the work for each supported tier.
- Libraries, CLIs, and test vectors that exist.

### C10. Sovereignty

- The overlay table for all three layers: location, operator, legal
  home, exit, and powers.

## Misfit log

Log a misfit when an offering cannot be placed on the map without
forcing it. For each misfit, record:

- The offering and the axis or overlay where it does not fit.
- Why it does not fit, in one or two sentences.
- The change to the map that would fix it, or "none, out of OOBTA."

## Deliverables

1. The fact base: the six CSV files in `data/`, every fact sourced
   and dated.
2. My predictions, committed before the facts.
3. One page per offering: its facts for C1–C10, with sources.
4. The three diagrams, built from the fact base by `pnpm build`.
5. Lens scores: category utility, misfit count, stability, and surprise.
6. The misfit log.
7. The revised map: the axes and overlay after the misfits are folded
   in, with a changelog against this document.

No recommendation. That may come later, once there is a product.
