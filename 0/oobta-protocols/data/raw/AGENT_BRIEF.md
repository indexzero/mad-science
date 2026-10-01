# Brief for research agents

You are gathering facts for a study of out-of-band trust anchoring (OOBTA):
protocols that link a self-certifying key identity (DID, nostr npub, PGP key,
raw ed25519 key) to an existing account people already trust (GitHub, X, a
domain, email), so a third party can verify both have the same controller.

The study does NOT pick a winner. It records atomic, checkable facts. Lenses
are computed from the facts later. Your job is facts, not opinions.

Today is 2026-10-01. The ecosystem changes fast: prefer 2025-2026 sources,
and prefer the spec or reference implementation over blogs.

## Facts to record

For EVERY offering assigned to you, give a value for EVERY fact id below.

- Values: `yes`, `no`, or `unknown`. `adoption.spec_maturity` takes `0`-`3`.
- Use `unknown` when you cannot find a source. Never guess. `unknown` is fine.
- Every non-unknown value needs a `source_url` you actually read, and a
  `source_date` (YYYY-MM-DD, or YYYY-MM, or YYYY: the date of the source or
  of its last change). Add a one-line `note` with the reason.
- Answer for the offering as specified and as deployed today. If spec and
  deployment differ, answer for deployment and say so in the note.

- `proof.key_signs_claim` (C1): Does the identity key sign a statement that names the anchor account or domain?
- `proof.anchor_publishes_key` (C1): Does the anchor account or domain publish content that names the key or identifier?
- `proof.third_party_signs_binding` (C1): Does a party other than the key holder and the anchor platform sign the binding?
- `proof.uses_oauth_oidc` (C1): Does creating the link require an OAuth or OIDC login to the anchor?
- `proof.capability_delegation` (C1): Is the link expressed as a delegation of authority (a capability), not a claim of sameness?
- `proof.anchor_is_dns` (C3): Is a DNS name or web domain a supported anchor?
- `proof.anchor_is_email` (C3): Is an email address a supported anchor?
- `proof.anchor_is_social` (C3): Is a centralized social or developer platform (GitHub, X, Mastodon, Reddit) a supported anchor?
- `verify.offline_possible` (C2): Can a verifier check the link from presented data alone, with no network fetch?
- `verify.fetches_anchor` (C2): Must the verifier fetch from the anchor platform or domain?
- `verify.needs_issuer_trust` (C2): Must the verifier trust the key of a third-party issuer?
- `verify.needs_registry` (C2): Must the verifier query a registry, directory, log, or chain?
- `verify.no_author_service` (C2): Can a verifier check the link without any service run by the authors of the offering?
- `verify.breaks_if_api_closed` (C2): Does verification stop working if the anchor platform closes its public API or blocks scraping?
- `lifecycle.survives_key_rotation` (C4): Do existing links stay valid after the identity key rotates?
- `lifecycle.explicit_revocation` (C4): Is there a defined mechanism to revoke a link, other than deleting the published proof?
- `lifecycle.expiry` (C5): Do links or proofs expire by design?
- `lifecycle.key_recovery` (C4): Is recovery after loss of the identity key defined?
- `lifecycle.replay_protected` (C5): Do timestamps, nonces, expiry, or a log stop an old proof from being replayed after the anchor changes owner?
- `record.transparency_log` (C5): Is the link or the identity record kept in an append-only transparency log?
- `record.self_hosted_possible` (C10): Can the user host the identity record or proof without any third-party operator?
- `record.multi_operator` (C10): Is the identity record replicated across several independent operators?
- `portability.generic_key` (C7): Can the mechanism anchor a generic DID or a raw ed25519 key, not only its own key type?
- `portability.extensible_anchors` (C3): Can new anchor platforms be added without a spec change?
- `adoption.spec_maturity` (C8): Ordinal: 0 vendor-only or none, 1 draft or proposal, 2 community spec (NIP, WG, DIF), 3 formal standard (W3C Rec, IETF RFC).
- `adoption.active_2026` (C8): Was the offering maintained or changed in 2025 or 2026?
- `adoption.client_display` (C8): Does at least one widely used client display the verified link?
- `effort.attachable` (C9): Can the mechanism be added to a key system that I already own (attach tier)?
- `effort.requires_platform_migration` (C9): Does getting the link require adopting the identity system of the offering (migrate tier)?

## Operators and links (sovereignty)

For each offering, list the operators that hold its parts, for three layers:

- `record`: where the identity record lives (DID doc, PLC log, kind-0 profile,
  sigchain, DHT record, chain state).
- `proof`: where the linkage proof lives, if separate (gist, DNS TXT, Rekor
  entry, signed VC, verification record).
- `anchor`: the anchor account itself (GitHub, X, email provider, DNS
  registrar).

For each (offering, layer, operator) give `forge`, `censor`, `disclose` as
yes/no:
- forge: can this operator, alone, create a link the verifier will accept
  that the key holder never made?
- censor: can it refuse, delay, or delete the link or record?
- disclose: does it hold data (logs, request metadata, private account data)
  it could hand over under subpoena?

Use these operator ids when they apply, so results from different agents
merge. Add new ids in the same style when needed.

github, x, mastodon (instances, kind platform, jurisdiction other), reddit,
hn, google (OIDC), email-provider, dns-registrar, web-host,
plc-bsky (PLC directory as run by Bluesky Social PBC),
plc-org (PLC directory under the Swiss PLC Organization),
bluesky (Bluesky Social PBC AppView / app), keybase (Keybase, owned by Zoom),
keys-openpgp-org, fulcio, rekor, storacha, human-passport,
farcaster-hubs, optimism (OP Mainnet chain), nostr-relays, mainline-dht.

Operator `kind` is one of: platform, registry, log, ca, dns, relay-set, dht,
chain, keyserver, issuer.
Operator `jurisdiction` is one of: US, CH, other, none (no single operator).
Put the specific country or reason in `jurisdiction_note`, with a source.
For PLC, record whether the transfer to the PLC Organization is complete as
of the newest source you find.

## Narrative

For each offering, write 2-4 plain sentences for each criterion C1-C10
(C1 proof mechanism, C2 verifier independence, C3 platform coverage and
fragility, C4 key lifecycle, C5 freshness and replay, C6 threat model,
C7 key system portability, C8 adoption and status, C9 effort tier: build /
attach / migrate, C10 sovereignty). Cite URLs inline.

Then write `misfit_notes`: where this offering fails to fit a map with three
proof families (bidirectional public proof; issuer attestation after OAuth;
capability delegation) and three effort tiers (build; attach to a key system
I own; migrate to the platform). Be concrete. "Fits cleanly" is a valid
answer.

Then `surprises`: facts that would surprise someone who knows these systems
only casually.

## Output

Write ONE JSON file to the path you were given, with this shape:

{
  "group": "<group id>",
  "offerings": [
    {
      "id": "<offering id>",
      "facts": [
        {"fact": "<fact id>", "value": "yes", "source_url": "...", "source_date": "2025-04", "note": "..."}
      ],
      "summary": {"C1": "...", "C2": "...", "C3": "...", "C4": "...", "C5": "...",
                  "C6": "...", "C7": "...", "C8": "...", "C9": "...", "C10": "..."},
      "misfit_notes": "...",
      "surprises": "..."
    }
  ],
  "operators": [
    {"id": "...", "name": "...", "kind": "...", "jurisdiction": "US", "jurisdiction_note": "...", "source_url": "..."}
  ],
  "links": [
    {"offering": "...", "layer": "record", "operator": "...", "forge": "no", "censor": "yes", "disclose": "yes", "note": "..."}
  ],
  "sources": [{"title": "...", "url": "...", "date": "..."}]
}

Validate the file with `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' <path>`
before you finish. Then reply with at most 150 words: what you covered, and
the facts you could not source.
