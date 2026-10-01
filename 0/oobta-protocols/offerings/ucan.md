---
id: "ucan"
name: "UCAN"
research_group: "ucan"
facts_known: 29
facts_unknown: 0
---

# UCAN

## C1. Proof mechanism

UCAN has no out-of-band anchor. A UCAN is a signed capability delegation from one DID to another (https://github.com/ucan-wg/spec), so its only 'proof' is a DID-to-DID delegation chain. It never claims that a key and an external account have the same controller.

## C2. Verifier independence

Verification works fully offline: the verifier checks did:key signatures along the chain, plus time bounds and its own local revocation cache (https://github.com/ucan-wg/revocation). There is no issuer, registry or anchor fetch.

## C3. Platform coverage and fragility

No platforms are covered. DNS, email and social anchors are all absent from the core spec. The spec's 'Wrapping Existing Systems' section admits that bridging to outside auth systems is possible but gives weaker guarantees (https://raw.githubusercontent.com/ucan-wg/spec/main/README.md).

## C4. Key lifecycle

Explicit, irreversible revocation by delegation CID is defined in the revocation sub-spec. Key rotation and key recovery are out of scope, and did:key cannot rotate.

## C5. Freshness and replay

A nonce is required, exp is RECOMMENDED (null is allowed), and nbf is optional. Replay protection is therefore part of the token format, but there is no anchor whose ownership could change.

## C6. Threat model

The threat model is about confused-deputy and over-delegation. Attenuation, time bounds and revocation limit damage from a stolen delegation, but nothing protects against impersonating an external identity, because no external identity is modelled.

## C7. Key system portability

UCAN is DID-agnostic. did:key is mandatory, other DID methods are allowed, and any ed25519 key can participate.

## C8. Adoption and status

This is a community Working Group spec, which reached v1.0.0 on 2026-07-08 (https://github.com/ucan-wg/spec/commits/main). Its largest deployment, Storacha, switched off writes in May 2026.

## C9. Effort tier

It attaches to any key you already hold, at the attach tier. However, it gives no out-of-band link: to anchor to an account you would have to build the anchor yourself, as Storacha did with did:mailto.

## C10. Sovereignty

There are no operators. Tokens are self-contained and held by the parties.

## Misfit notes

UCAN is the substrate of the 'capability delegation' proof family, not an OOBTA offering. It supplies the delegation format but no anchor. Placing it on the map means treating it as a building block for build-tier projects (e.g. Storacha's did:mailto layer), not as a peer of Keybase or ATProto handles.

## Surprises

UCAN 1.0 only left RC status in July 2026, years after deployment. Core UCAN has no notion of identity sameness: a UCAN can say 'A may act as B for X' but never 'A is B'.

## Facts

| Fact | Value | Source | Date | Note |
|---|---|---|---|---|
| `proof.key_signs_claim` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | UCAN delegations name only DIDs in iss/aud/sub; the spec defines no statement naming an external account or domain. |
| `proof.anchor_publishes_key` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | No anchor concept in UCAN; nothing is published by any external account. |
| `proof.third_party_signs_binding` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | Only principals in the delegation chain sign; no attester role in core UCAN 1.0. |
| `proof.uses_oauth_oidc` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | Pure signed delegations between DIDs; no OAuth/OIDC flow. |
| `proof.capability_delegation` | yes | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | Every UCAN link is a capability delegation (iss -> aud), never a sameness claim; but it links DID to DID, not key to external account. |
| `proof.anchor_is_dns` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | Only did:key is required; no DNS/domain anchor defined (an implementation could accept did:web, outside the spec). |
| `proof.anchor_is_email` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | Email anchoring only exists in the separate did:mailto / Storacha specs, not UCAN core. |
| `proof.anchor_is_social` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | No social platform anchor defined. |
| `verify.offline_possible` | yes | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | did:key chains verify from presented tokens alone; revocation check is against the resource owner's own local cache. |
| `verify.fetches_anchor` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | No anchor exists to fetch. |
| `verify.needs_issuer_trust` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | Trust root is the resource subject's own DID, not a third-party issuer. |
| `verify.needs_registry` | no | [link](https://github.com/ucan-wg/revocation) | 2026 | Revocations are checked against a cache the resource-controlling agent itself maintains; no global registry required. |
| `verify.no_author_service` | yes | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | The UCAN WG runs no service; verification is local. |
| `verify.breaks_if_api_closed` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | No anchor platform API involved. |
| `lifecycle.survives_key_rotation` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | did:key cannot rotate; delegations are bound to the key, and the spec does not address rotation. |
| `lifecycle.explicit_revocation` | yes | [link](https://github.com/ucan-wg/revocation) | 2026 | Revocation sub-spec: any issuer in a chain may revoke its delegation by CID; revocations are irreversible. |
| `lifecycle.expiry` | yes | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | exp is RECOMMENDED and time-bounding is a design principle, but exp: null (never expires) is allowed. |
| `lifecycle.key_recovery` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | Key recovery is out of scope of the spec; it is left to implementations. |
| `lifecycle.replay_protected` | yes | [link](https://github.com/ucan-wg/spec) | 2026-07 | Required nonce plus exp/nbf; but no anchor exists, so 'anchor changes owner' does not apply. |
| `record.transparency_log` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | No log; tokens are passed in-band. |
| `record.self_hosted_possible` | yes | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | Tokens are self-contained and held by the parties. |
| `record.multi_operator` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | No replicated identity record exists. |
| `portability.generic_key` | yes | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | Principals are any DID; did:key (incl. ed25519) is the required baseline. |
| `portability.extensible_anchors` | no | [link](https://github.com/storacha/specs/blob/main/w3-account.md) | 2026-01 | UCAN has no anchor concept; adding one (e.g. email) took a new DID method plus an attestation spec outside UCAN. |
| `adoption.spec_maturity` | 2 | [link](https://github.com/ucan-wg/spec/commits/main) | 2026-07-08 | UCAN Working Group community spec; bumped to v1.0.0 (RC dropped) on 2026-07-08. |
| `adoption.active_2026` | yes | [link](https://github.com/ucan-wg/spec/commits/main) | 2026-07-08 | Commits in Feb, Mar and Jul 2026. |
| `adoption.client_display` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | No account link exists to display. |
| `effort.attachable` | yes | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | Any did:key / ed25519 key can issue UCANs with no platform. |
| `effort.requires_platform_migration` | no | [link](https://raw.githubusercontent.com/ucan-wg/spec/main/README.md) | 2026-07 | No identity platform to adopt. |
