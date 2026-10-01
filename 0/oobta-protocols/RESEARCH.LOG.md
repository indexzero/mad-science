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
