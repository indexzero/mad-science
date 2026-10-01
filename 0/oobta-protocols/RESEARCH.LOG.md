---
status: "running log of the research run"
started: "2026-10-01T04:35:52Z"
---

# Research log

## 2026-10-01T04:35:52Z — pre-registration

These files were fixed before any research agent started. Their
SHA-256 hashes at that time:

| File | SHA-256 |
|---|---|
| `data/fact-definitions.csv` | `676dccfb35da4a68280b10e2a6e6dcf532a719990cf45a3e26b1e4bfca9f9549` |
| `data/offerings.csv` | `2e8bf947b9481b1348c4cbac91f645a406ac864c185e9eced0e7852431fec1a7` |
| `data/lenses.csv` | `c2ff01578f3bdaad4698b024337be6bfb068a4537d32649bfbcb18e601b038b5` |
| `data/predictions.csv` | `78ec272c3fcf22df740b9c6da047061f09d3f0bbbb4d121fd0f0d3fb56b22a28` |
| `scripts/lenses.mjs` | `7907d400c8c92e737545a17c094c715d5e95bbb37dc44c56f901ad6b81e34d1a` |

The predictions are Claude's, not Charlie's. Charlie went to sleep
before step 2 of the pipeline. The predictions are a stand-in, so that
the surprise score has a baseline. They measure Claude's model of
OOBTA, not Charlie's. Predictions that Charlie writes after reading the
results are not a fair test.

## 2026-10-01 — agent returns and checks

- `others` (farcaster, pkarr): all 29 facts each. The agent reports weak
  sources for `adoption.client_display` (farcaster), and for the
  jurisdiction of the `optimism` operator, which came from model
  knowledge and not from a source.
- `atproto` (atproto-handle, bsky-verification): the transfer of the
  PLC directory to the PLC Organization is not complete as of
  2026-09-28. Bluesky Social PBC (US) still operates it.
- `ucan` (ucan, storacha-mailto, recap): Storacha stopped writes on
  2026-05-15. The agent sourced this from third-party notes only.
  Claude checked it against Storacha's own merged pull requests:
  - [upload-service issues](https://github.com/storacha/upload-service/issues)
    (the `writesDisabled` switch, upload-service#708, and w3infra#636,
    merged 2026-05-15)
  - [orbitdb-storage-bridge](https://github.com/NiKrause/orbitdb-storage-bridge)
    (DNS and redirect state checked 2026-09-05)
  - [orbitdb-storage-bridge PR #113](https://github.com/NiKrause/orbitdb-storage-bridge/pull/113)
    (`ipfs.io` and `dweb.link` retired 2026-09-21)
  - [fil-forge/piri PR #131](https://github.com/fil-forge/piri/pull/131)
    (Storacha telemetry endpoint removed because it no longer resolves)
  - [FilOzone link checker #365](https://github.com/FilOzone/filecoin-cloud/issues/365)
    (storacha.network redirects to fil.one)
  No official Storacha announcement was found.
- `classic` (keybase, keyoxide, indieweb): IndieWeb uses no key, so two
  key facts do not apply. Claude added the value `na` (does not apply)
  and `data/overrides.csv` to record such corrections with a reason.
- `nostr` (nip39, nip05): NIP-39 claims moved from kind 0 to kind 10011
  on 2026-02-10. No major client verifies NIP-39 claims.
- `issuers` (sigstore, passport, dif-wellknown, did-web): all facts
  sourced. Some dates are year-only.

## 2026-10-01 — changes after pre-registration

Each change below came after the facts. None changes the pre-registered
lens rules, offerings, fact definitions, or predictions.

1. **Held-out scoring.** A lens is computed from facts, so its category
   utility over those same facts is partly circular. `scripts/score.mjs`
   now also scores each lens only on the facts that its rules do not
   read. The report uses the held-out score as the main measure.
2. **Forge coding harmonized.** The brief defined forge as "a link the
   key holder never made". Agents read this two ways. The nostr, issuers
   (sigstore, passport), and ucan agents read it as account-side forgery:
   the anchor operator binds an account it controls to a key it holds.
   The classic agent, and the issuers agent for dif-wellknown, read it as
   key-side forgery: a claim that the victim's key controls an account,
   without that key's signature. `data/link-overrides.csv` sets 14
   anchor-layer links to the account-side reading, with a reason for each.
   The scores before this change are kept in
   `data/scores.before-forge-harmonization.md`. The ambiguity is itself a
   finding: the map must split forge into two powers.
3. **Operator corrections.** `data/operator-overrides.csv` sets the
   jurisdiction of `optimism` to US (one sequencer, run by OP Labs; source:
   https://optimism.io/blog/what-is-op-enterprise), and gives `web-host` a
   generic name.
4. **Sovereignty views.** The full bipartite graph has 90 edges and is
   not readable. The score step now writes `data/concentration.csv`, and
   each offering page has its own small sovereignty graph.

## 2026-10-01 — follow-up: Storacha, FilOne, and UCAN in production

Charlie asked about Storacha after it became FilOne, and about UCAN at
scale. These are notes for the next round. They do not change the fact
base.

### Storacha (w3up) layers

| Layer | Identifier | Key holder | Verifiable without Storacha |
|---|---|---|---|
| Space (data) | `did:key`, made on the device | the user | yes (UCAN chains) |
| Agent (device, CLI) | `did:key` | the user | yes |
| Account | `did:mailto:…` | nobody (no key) | no |
| Attester | `did:web:up.storacha.network` | Storacha | no |

The account link was issuer attestation: a delegation "from" the email
identity with a zero-byte signature, plus a `ucan/attest` from Storacha.
The DKIM-signed mode in the spec was never implemented. The capability
layer was the decentralized part. The identity link was the centralized
part.

### Checks on 2026-10-01

- `up.storacha.network` has no DNS A record. The attester
  `did:web:up.storacha.network` cannot resolve.
- `https://storacha.network/.well-known/did.json` redirects to
  `https://www.fil.one/.well-known/did.json`, which returns the FilOne
  marketing page as `text/html` with status 200, not a DID document.
- As a result, no did:mailto attestation can be verified. UCAN chains
  rooted in space keys still verify.

### FilOne

From [Account security](https://docs.fil.one/security/account-security),
[API keys](https://docs.fil.one/security/api-keys), and
[Encryption](https://docs.fil.one/security/encryption):

- Login: passkeys (primary), Google or GitHub OAuth, email and password.
  Optional TOTP or WebAuthn second factor. Recovery codes. No SMS or
  email codes.
- API: S3-style access key ID and secret, scoped by region and bucket,
  with optional expiry and revocation.
- Encryption at rest is mandatory. Keys are held by the regional storage
  operator, "not by Fil One and not by you". No customer-managed keys.
- No mention of DIDs, UCAN, delegation, wallets, CIDs, IPFS, Filecoin
  deals, or verifiability on these pages.

The passkey is the only key that the user holds. WebAuthn binds it to
one origin, so it proves nothing to any other party.

### UCAN at scale

Short answer: no, not at scale in the sense Charlie probably meant.
UCAN's one large production deployment was Storacha, which is now shut
down. The idea of signed, chained capability tokens has spread, but
mostly in simpler forks rather than as UCAN itself.

#### Where UCAN actually ran

| Deployment | Scale | Status |
|---|---|---|
| **web3.storage → Storacha** (w3up, built on `ucanto`) | The largest. It handled petabytes of data, but nobody published how many users or tokens. | Writes switched off 2026-05-15; now FilOne, with S3 keys. |
| **Fission** (where UCAN was created; WNFS) | Small. A developer platform. | Wound down by May 2024. The specs moved to community working groups. |
| **Bluesky / atproto** | Early permission model, with WRITE and MAINTENANCE levels. | Dropped quietly. Apps now use OAuth with scopes; servers use short-lived signed JWTs. |
| **Infura** | Storacha's blog lists Infura as an adopter. | No Infura docs found. A February 2026 design for Infura/MetaMask access to the DIN network explicitly chose "no wallets, no on-chain, no UCAN" and used an Ed25519-signed JWT instead. |

UCAN 1.0 only left release-candidate status in July 2026, years after
these deployments shipped.

#### Where the idea survived, in simpler forms

These forks are the relevant modern work. Each one keeps the signed,
scoped token and drops part of UCAN.

- **Bluesky service-auth JWTs.** Short-lived tokens signed with the key
  in the user's DID document, valid for one endpoint (`lxm`) and one
  target service (`aud`). That is a UCAN with a single step and no
  further delegation. A Bluesky engineer wrote in January 2025 that
  these "aren't UCANs or Macaroons (for now)".
  - Spec: [atproto XRPC: Inter-Service Authentication (JWT)](https://atproto.com/specs/xrpc#inter-service-authentication-jwt)
  - Discussion: [atproto #3424: Service Auth token spec](https://github.com/bluesky-social/atproto/discussions/3424)
  - Archived: `specs/_forks/atproto-xrpc.html`
- **n0's RCAN (iroh).** "Really simple user Controlled Authorization
  Networks": UCAN-style capability chains on raw Ed25519 keys, with no
  DIDs. Used in iroh-services, iroh-doctor, and paid relay tokens.
  Version 2 is in progress.
  - Repo: [n0-computer/rcan](https://github.com/n0-computer/rcan)
  - V2 work: [rcan issue #43](https://github.com/n0-computer/rcan/issues/43)
  - Use: [iroh-services-proto](https://docs.rs/iroh-services-proto/latest/iroh_services_proto/),
    [iroh: Relays](https://docs.iroh.computer/concepts/relays)
  - Archived: `specs/_forks/rcan-readme.md`
- **CACAO (CAIP-74).** Chain Agnostic CApability Object: a signed
  Sign-In-with-X payload as an IPLD object. Ceramic built it for
  capability-based writes. Status: Review.
  - Spec: [CAIP-74: CACAO](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-74.md)
  - Companion: [CAIP-122: Sign in With X (SIWx)](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-122.md)
  - Use: [Ceramic: capability-based data security](https://blog.ceramic.network/capability-based-data-security-on-ceramic/)
  - Archived: `specs/_forks/caip-74-cacao.md`, `specs/_forks/caip-122-siwx.md`
- **ReCap (ERC-5573).** Capabilities attached to Sign-In with Ethereum
  (ERC-4361). Ships in WalletConnect's default sign-in flow. Status:
  Draft, unchanged since March 2024.
  - Spec: [ERC-5573: SIWE ReCap](https://eips.ethereum.org/EIPS/eip-5573)
  - Base: [ERC-4361: Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361)
  - Use: [WalletConnect One-click Auth](https://docs.walletconnect.network/wallet-sdk/web/one-click-auth)
  - Archived: `specs/recap/`
- **Macaroons and Biscuits** are older relatives. Fly.io runs macaroon
  tokens in production. They are verified by one central service:
  "Verification occurs only on a physically isolated token-verification
  service; to verify a token's tag, you HTTP POST the token to the
  verifier." Biscuits use public-key signatures, so anyone with the root
  public key can verify them.
  - [Fly.io: Macaroons Escalated Quickly](https://fly.io/blog/macaroons-escalated-quickly/)
  - [Biscuit](https://www.biscuitsec.org/)

#### Why, in Claude's reading (not stated by any source)

UCAN's distinctive feature is delegation across several steps that
anyone can verify without a server. That only matters when there is no
central server. Every deployment above had one anyway (Storacha's API,
a Bluesky host), and once a server checks every request, server-side
scopes are simpler. The format also kept changing (it moved from JWT to
DAG-CBOR for 1.0), and its creator company and its biggest user both
shut down. The forks that survived kept the signed, scoped, short-lived
token and dropped the long delegation chains and the DIDs.

#### What this means for the OOBTA map

UCAN never provided the anchoring itself. In Storacha, the anchor was
did:mailto, and that was the centralized, attestation-based part. So
the history supports moving UCAN off the map into the list of building
blocks. Bluesky's service-auth tokens are a second building block like
this, and probably the most widely used one, because every Bluesky
video upload depends on them.

### Proposals for the next round

1. Add a fact: `lifecycle.survives_operator_exit` — can a link still be
   verified after the operator of the offering stops? Storacha shows
   that an attested link dies with its attester, and a did:web attester
   dies with its DNS.
2. Record what remains verifiable for dead or dying offerings: Keybase,
   nostr.band, Storacha.
3. Mark the `storacha-mailto` entry as historical.
4. Add Bluesky service-auth JWTs, RCAN, and CACAO to the substrate
   list beside UCAN, ReCap, and Pkarr. Archive their specs (done:
   `specs/_forks/`).

### Sources

- [UCAN Working Group (GitHub)](https://github.com/ucan-wg)
- [ucan-wg/spec](https://github.com/ucan-wg/spec)
- [Boris Mann: UCAN notes](https://bmannconsulting.com/notes/ucan/)
- [Storacha – Filecoin ecosystem listing](https://fil.org/ecosystem-explorer/storacha-network)
- [UCANs and Storacha](https://docs.storacha.network/concepts/ucans-and-storacha/)
- [Storacha: UCAN concepts](https://docs.storacha.network/concepts/ucan/)
- [Storacha: "The Internet Is Permissioned Wrong. But UCAN Fix It."](https://medium.com/@storacha/the-internet-is-permissioned-wrong-but-ucan-fix-it-439c36c5dc79)
- [Storacha elizaOS plugin](https://medium.com/@storacha/supercharge-your-ai-agents-with-decentralized-storage-storacha-plugin-for-elizaos-e81d3deb59ff)
- [An up-close look at UCANs in the wild](https://www.meje.dev/blog/ucans-in-the-wild)
- [Farewell from Fission](https://fission.codes/blog/farewell-from-fission/)
- [Fission in 2024 (forum)](https://talk.fission.codes/t/fission-in-2024-fission/5293)
- [A Guide to UCANs (Fission)](https://fission.codes/blog/a-guide-to-ucans/)
- [atproto issue #85: More granular UCAN permissions](https://github.com/bluesky-social/atproto/issues/85)
- [2023 Protocol Roadmap – AT Protocol](https://atproto.com/blog/protocol-roadmap)
- [atproto discussion #1711](https://github.com/bluesky-social/atproto/discussions/1711)
- [atproto discussion #2656: OAuth Roadmap](https://github.com/bluesky-social/atproto/discussions/2656)
- [atproto discussion #3424: Service Auth token spec](https://github.com/bluesky-social/atproto/discussions/3424)
- [Bluesky: TS API auth refactor](https://docs.bsky.app/blog/ts-api-refactor)
- [Bluesky: API hosts and auth](https://bsky.network/docs/api-directory/)
- [n0-computer/rcan (DeepWiki)](https://deepwiki.com/n0-computer/rcan)
- [n0-computer/rcan issue #43](https://github.com/n0-computer/rcan/issues/43)
- [iroh-services-proto](https://docs.rs/iroh-services-proto/latest/iroh_services_proto/)
- [iroh: Relays](https://docs.iroh.computer/concepts/relays)
- [Ceramic: capability-based data security (CACAO)](https://blog.ceramic.network/capability-based-data-security-on-ceramic/)
- [DIN direct provider access MVP (issue #196)](https://github.com/DIN-center/din-caddy-plugins/issues/196)
- [NFT.Storage: UCAN delegated authorization](https://classic-app.nft.storage/docs/how-to/ucan/)
- [FilOne: Account security](https://docs.fil.one/security/account-security)
- [FilOne: API keys](https://docs.fil.one/security/api-keys)
- [FilOne: Encryption](https://docs.fil.one/security/encryption)
- [atproto XRPC: Inter-Service Authentication (JWT)](https://atproto.com/specs/xrpc#inter-service-authentication-jwt)
- [n0-computer/rcan](https://github.com/n0-computer/rcan)
- [CAIP-74: CACAO](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-74.md)
- [CAIP-122: Sign in With X (SIWx)](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-122.md)
- [ERC-5573: SIWE ReCap](https://eips.ethereum.org/EIPS/eip-5573)
- [ERC-4361: Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361)
- [WalletConnect One-click Auth](https://docs.walletconnect.network/wallet-sdk/web/one-click-auth)
- [Fly.io: Macaroons Escalated Quickly](https://fly.io/blog/macaroons-escalated-quickly/)
- [Biscuit](https://www.biscuitsec.org/)
