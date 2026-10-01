---
status: "draft — criteria for a deep research run, not findings"
stage: 0
created: 2026-09-30
question: "Which protocols let a self-certifying key-based identity (DID, nostr npub, PGP key, etc.) be linked to an existing account (GitHub, X/Twitter, a domain, Mastodon, ...) so that a third party can verify both belong to the same controller?"
seed_protocols:
  - "Nostr NIP-39 (external identities in kind-0 profiles)"
  - "Nostr NIP-05 (DNS / .well-known name to pubkey mapping)"
  - "ATProto handles (DNS TXT _atproto / .well-known/atproto-did, DID doc alsoKnownAs)"
  - "Bluesky verification records (trusted verifier accounts)"
  - "Keybase sigchain proofs"
  - "Keyoxide / Ariadne Identity (OpenPGP notations, Ariadne Signature Profiles)"
  - "DIF Well-Known DID Configuration (domain linkage credentials)"
  - "Sigstore / Fulcio (OIDC to short-lived cert, Rekor transparency log)"
  - "W3C Verifiable Credentials issued after OAuth (e.g. Human/Gitcoin Passport stamps)"
  - "IndieWeb rel=me and IndieAuth"
  - "Farcaster verifications and connected accounts"
  - "Pkarr / Pubky (signed DNS records on the Mainline DHT)"
on_conflict: "Prefer the protocol's own spec or reference implementation over blog posts. Note the date of every source; this space changes fast."
---

# Out-of-band trust anchoring (OOBTA): research criteria

## Background

A key-based identity is self-certifying: whoever holds the key is the
identity. Nobody else knows who that is. OOBTA links the key to an
account that people already trust, through a channel outside the key
system.

Two families of mechanism exist. The research must keep them apart,
because their trust models differ:

1. **Bidirectional public proof.** The key signs a claim that names the
   account. The account publishes content that names the key, such as a
   gist, a post, a DNS record, or a `rel=me` link. Anyone can check both
   sides without asking a third party. Examples: Keybase, Keyoxide,
   NIP-39, ATProto handles.
2. **Issuer attestation.** The user signs in to a service with OAuth or
   OIDC. The service then signs a statement that binds the key to the
   account. The verifier must trust that service. Examples: Sigstore
   Fulcio, Passport stamps, Bluesky verifiers.

Some protocols mix the two. Classify each protocol by the family it is
closest to, and note any part that comes from the other family.

## Scope

In scope:

- Protocols with a written spec, or one widely deployed reference
  implementation.
- Anchors to centralized accounts (GitHub, X, Reddit, Mastodon, Google)
  and to DNS or domains.
- Mechanisms that are dead or broken, if they teach a lesson. Keybase
  and the X API shutdown are examples.

Out of scope:

- KYC and government ID checks.
- Proofs of personhood that do not link to an account, such as
  biometrics or Worldcoin.
- Web-of-trust endorsements between keys only, such as PGP key signing,
  unless they are part of a protocol that is otherwise in scope.

## Evaluation criteria

Rate each protocol on every criterion below. Cite a source for each
rating.

### C1. Proof mechanism

- Family: bidirectional proof, issuer attestation, or hybrid.
- Where each half of the link lives: the key side and the account side.
- The exact signed payload and its format.

### C2. Verifier independence

- Can a verifier check the link without a service run by the protocol
  authors?
- What does the verifier fetch, and from where?
- Does verification still work when the platform API is closed or rate
  limited, as on X?

### C3. Platform coverage and fragility

- The supported anchors: GitHub, X, Mastodon, DNS, Reddit, HN, and
  others.
- How each proof breaks: account deleted, post edited, API removed,
  scraping blocked.
- Whether the protocol can add a new platform without a spec change.

### C4. Key lifecycle

- What happens to existing links when the key rotates.
- Revocation: how a link is withdrawn, and how fast verifiers learn of
  it.
- Recovery after key loss. Rotation keys in `did:plc` are an example.

### C5. Freshness and replay

- Can an old proof be replayed after the account changes owner?
- Do proofs carry timestamps or nonces, or rely on a transparency log?

### C6. Threat model

- Who can forge a link: the platform, a DNS registrar, the issuer, or a
  compromised verifier?
- Account takeover: does a stolen GitHub account let the thief claim a
  link to their own key?
- Privacy: does the link expose metadata the user did not mean to
  publish?

### C7. Identity system portability

- Is the protocol tied to one key system (nostr secp256k1, PGP,
  `did:plc`)?
- Could the same mechanism anchor a generic DID or a raw ed25519 key?

### C8. Adoption and status

- Spec maturity: draft, NIP, W3C Rec, DIF work item, vendor-only.
- Signs of real use: clients that display the link, number of verified
  links where known, last spec change.
- Maintained, stagnant, or dead.

### C9. Builder ergonomics

- Libraries, CLIs, and test vectors that exist.
- The effort to add the link to a new identity, for the user and for a
  verifying client.

## Deliverables

1. One page per protocol, with ratings for C1–C9 and sources.
2. A comparison table: protocols as rows, criteria as columns.
3. A short list of open gaps. An example: no protocol does X for a
   generic DID.
4. A recommendation. Which mechanism should a new p2p identity reuse, and
   which parts would have to be built?

## Open decisions before the run

- **Target key system.** Is there one DID method or key type to judge
  C7 against, or is it generic?
- **Weighting.** Rank C2 (verifier independence) above C8 (adoption), or
  the reverse?
- **Depth on dead systems.** Is Keybase a full entry, or a section on
  lessons learned?
