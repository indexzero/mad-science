---
stage: 1
project: brave-sync
status: "designed, not built"
source_chat: 08a1228b
source_messages: [3]
run_issue: "https://github.com/indexzero/orckits/issues/14"
design: "The Architecture section below is authoritative. FINDINGS.md and TECHNICAL.DESIGN.md follow it."
recovered_on: "2026-10-20"
overrides:
  - "The sync code is read from the file named by BRAVE_SYNC_CODE_FILE, not from the BRAVE_SYNC_CODE environment variable."
  - "The target is stage/1/brave-sync/ in indexzero/mad-science, not a yourbytes package."
  - "Production access is approved, read-only, for the owner's throwaway chain and the types NIGORI, SESSIONS, HISTORY only (Q-001)."
  - "Phases run without owner go-ahead gates between them. The live pull waits only for the chain file."
  - "Tests use public vectors only. The throwaway chain's words never enter a test or a fixture."
  - "BOOKMARKS (type 32904) is intended scope as of 2026-10-23, not built (A9). Until it is built and Q-001 names it, the client requests NIGORI, SESSIONS and HISTORY only."
---

# brave-sync

brave-sync is a custom Brave Sync v2 client that joins the owner's sync chain as one more member, read-only, and keeps every device's open tabs and synced history with no retention limit. Brave keeps hosting the sync. Read the Architecture section first.

## Architecture (owner decisions, 2026-10-21, updated 2026-10-23)

This section maps the choices. It wins over anything below it that disagrees.

### What the owner wants

- "I want to have Brave sync my things." Brave's own sync service stays the server of record for the chain. Every device keeps syncing to Brave as it does today.
- "I do want a custom client that's part of my sync cluster." brave-sync is one more member of that chain. It reads what the other devices sync.
- "I want that sync client to have infinite storage, as opposed to the local SQLite database that Brave uses, which truncates after a certain period of time." The client's value is retention: it keeps what Brave's own local history drops.
- Bookmarks belong in the archive too (2026-10-23). They are intended, not built yet.
- Long term, capture runs at the edge, like everything in yourbytes, and the hardest sources get three to five capture implementations so the owner can choose.

### The choices

| # | Choice | Decision | Why |
|---|---|---|---|
| A1 | Who hosts the sync chain | Brave's production sync service | Owner: "I want to have Brave sync my things." |
| A2 | Self-host go-sync for real data | Rejected | Owner: "self-hosting the sync server myself, is something I do not want to do." |
| A3 | What brave-sync is | A read-only member of the chain, talking the sync protocol | The owner wants a member of the cluster, not a scraper of one device. |
| A4 | Where the client stores data | Its own append-only store with no retention limit, starting as JSON lines on disk | Brave's local history truncates. The archive must not. |
| A5 | Dev and test server | brave/go-sync, vendored at a pinned commit by `hack/vendor.sh`, run locally by `hack/dev.sh` | The client needs a server it can be tested against without touching a real chain. |
| A6 | Dev server backends | First the upstream compose stack (dynamo-local plus Redis). Then a SQLite backend for both datastore and cache, so the dev server is one native binary. | Dev only. SQLite for both is fine for testing (owner). |
| A7 | Runtime of the client | Node, unless a Zig or JS Brave Sync client exists that Bun can reuse | Owner: "an exploratory node.js (or bun if there's like a Zig Brave Sync client already) implementation." |
| A8 | Portability | Web Crypto and `fetch` in the core, Node-only APIs behind one adapter | The client moves to the edge later. |
| A9 | Data types | NIGORI, SESSIONS and HISTORY now. BOOKMARKS intended next, not built. | Owner, 2026-10-23: "include bookmarks (but do not implement it)". |

### Bookmarks, intended and not built (A9)

Nothing in the client requests or decodes bookmarks yet. When they are built:

- First, an override in the frontmatter extends Q-001 and the ground rule "Request only NIGORI, SESSIONS, and the history data type" to name BOOKMARKS. The verbatim prompt stays as written. Then `TYPES` in `client/src/transport.js` gains 32904. The read-only guard refuses every type not in `TYPES` (LITERATE.md §4.1).
- Bookmarks will arrive encrypted: the throwaway chain's NIGORI sets `encrypt_everything`. They use ChainCrypto's `decrypt` unchanged, then a new decoder for `BookmarkSpecifics`.
- Bookmarks form a tree: each entity names its parent folder, and a unique position orders siblings. The archive appends every version, as for tabs and visits, and rebuilding the tree at a given time is a read-side job.
- go-sync expires only HISTORY and its delete directives (LITERATE.md §8.4). Bookmarks stay on the server until deleted, so the archive protects against deletions and edits, not expiry.
- The throwaway chain has only the four folders go-sync creates for every chain. Testing needs real bookmarks added in the throwaway profile first.

### Other capture approaches, all valid, each its own future implementation

1. The sync-chain member (this project).
2. Local profile readers: Brave's history SQLite and session files, one device at a time.
3. The DOM history scraper (the owner's gist d6d4801d).

### Status note

The investigation phase below (FINDINGS.md) was refused by the host's safety check on 2026-10-20 and has not been written. Work on the dev server (A5, A6) does not depend on it.

## The prompt, verbatim from [3]

<!-- BEGIN VERBATIM [3] -->
One finding shaped the history section: since Chromium 117 dropped typed URLs, Brave moved History sync onto Chromium's HISTORY data type, and history that existed before you enabled sync doesn't get uploaded. So the archive only starts from when each device began syncing history. The prompt has Claude Code confirm both.

```
# Goal
Build a read-only client for Brave Sync v2 that archives my synced browsing
history and open tabs from every device on my sync chain, including mobile.
Before writing the client, investigate the protocol from source and report back.

# Ground rules
- Read-only. Never send a Commit. Request only NIGORI, SESSIONS, and the
  history data type. Never request PASSWORDS or any other type.
- The sync code is a master key to my browsing data. Read it only from the
  BRAVE_SYNC_CODE environment variable. Never write it, the seed, derived keys,
  or access tokens to disk, logs, fixtures, or git history.
- Do not contact Brave's production sync server until I explicitly approve it.
  All testing runs against a local go-sync with a throwaway chain.
- Do not extract keys or secrets from Brave binaries. If production requires
  something like a BRAVE_SERVICES_KEY header, stop and report it.
- Cite every finding: repo, file path, commit SHA, line range. Mark each as
  verified-in-code, verified-by-test, or inferred.
- Batch questions for me at phase boundaries. Don't interrupt mid-phase.
- Build the simplest thing that works at each phase, then grow it. No
  speculative abstraction.

# Sources
- brave/go-sync: auth, command handling, datastore, retention.
- brave/brave-core (huge; use a sparse or shallow checkout):
  components/brave_sync, the sync auth manager, chromium_src overrides under
  components/sync, and ios/ for the iOS client.
- Chromium components/sync/protocol/*.proto and components/sync/engine/nigori.
  Fetch individual files from chromium.googlesource.com; do not clone
  Chromium. Match the Chromium version brave-core currently targets.

# Phase 1: Investigation
Deliverable: FINDINGS.md, then stop. Answer each with citations.

1. Sync code to seed. How do the 24 words map to the 32-byte seed (BIP39
   entropy? which wordlist? any v1/v2 word variants)? How is the 25th
   time-limited word computed, and how is it stripped?
2. Signing identity. Exact HKDF-SHA512 parameters (salt constant, info,
   output length) and how the Ed25519 keypair is built from the output. Is the
   salt the same constant as v1's lib/crypto.js?
3. Access token. Exact bytes signed, encodings, delimiter, base64 variant,
   freshness window, and the source of server time (/v2/timestamp,
   Sane-Time-Millis).
4. Transport. Production base URL as brave-core configures it. Every HTTP
   header Brave sends on sync requests (content type, user agent, any services
   key). Which of these go-sync itself checks, and which a production gateway
   might check.
5. Protocol envelope. Required ClientToServerMessage fields for GetUpdates as
   go-sync validates them: share, protocol_version, store_birthday, cache GUID,
   bag_of_chips, progress markers, get_updates_origin, batch size,
   changes_remaining pagination. Error codes and throttling. Can a client that
   never commits DEVICE_INFO read successfully? Per-chain client limits, chain
   deletion, blocked-ID behavior.
6. Encryption. The exact passphrase string Brave sets (which function builds
   it, spacing, 24 vs 25 words). Where NigoriSpecifics stores the key
   derivation method and salt. The full path: passphrase to Nigori keys,
   encryption_keybag to NigoriKeyBag, key_name lookup, blob layout (IV, cipher
   mode, what the MAC covers) per nigori.cc. Key rotation handling.
7. Open tabs. SessionSpecifics model: header vs tab entities, session_tag,
   tab_node_id recycling, how Chromium reconstructs foreign sessions and drops
   stale nodes, timestamp epochs, device name and type fields.
8. History. Which data type Brave uses today (HISTORY vs legacy TYPED_URLS) and
   since which version. The HistorySpecifics schema (visit times, redirect
   chains, transitions, originator device). What triggers a device to commit
   visits, and whether pre-existing history is ever uploaded. Whether go-sync
   expires or caps history entities server-side. How
   HISTORY_DELETE_DIRECTIVES work, so I can decide how the archive treats
   deletions.
9. Archival implications. Given 7 and 8, what polling interval avoids losing
   data to session churn or server-side expiry, and what would still be missed.

End FINDINGS.md with open questions, risks, and a proposed module layout.

# Phase 2: Spike against local go-sync (after my go-ahead)
- Run go-sync with its Docker + DynamoDB Local setup.
- I'll drive the browser. Give me exact steps to create a throwaway chain in a
  disposable Brave profile using --sync-url, enable History and Open Tabs, and
  generate activity.
- Implement: words to seed, keypair, token, GetUpdates for NIGORI, keybag
  decryption.
- Golden test: the public key hex the code derives equals the client ID
  go-sync records for that chain.

# Phase 3: Read-only archiver (after my go-ahead)
- Decode SESSIONS and history. Persist progress markers and store_birthday.
- Output append-only JSONL: one record per tab snapshot and per visit, with
  device, timestamps, and source entity version.
- Storage beyond local JSONL is out of scope for now.

# Implementation constraints
- Node.js current LTS, ESM.
- Minimal, pinned, well-audited dependencies (e.g. @scure/bip39,
  @noble/hashes, @noble/ed25519, protobufjs). Use node:crypto where it
  suffices. Commit a lockfile.
- Generate protobuf bindings from go-sync's vendored .proto files.
- Tests use only the throwaway chain's words.
```

I left two calls with you rather than baking them in: when to approve production access, and whether the archive should honor delete directives or record them alongside the visits they delete.
<!-- END VERBATIM [3] -->
