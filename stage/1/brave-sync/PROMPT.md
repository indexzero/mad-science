---
stage: 1
project: brave-sync
status: "designed, not built"
source_chat: 08a1228b
source_messages: [3]
run_issue: "https://github.com/indexzero/orckits/issues/14"
design: "FINDINGS.md, and TECHNICAL.DESIGN.md in the orckits run home indexzero/mad-science/2026-10-brave-sync/"
recovered_on: "2026-10-20"
overrides:
  - "The sync code is read from the file named by BRAVE_SYNC_CODE_FILE, not from the BRAVE_SYNC_CODE environment variable."
  - "The target is stage/1/brave-sync/ in indexzero/mad-science, not a yourbytes package."
  - "Production access is approved, read-only, for the owner's throwaway chain and the types NIGORI, SESSIONS, HISTORY only (Q-001)."
  - "Phases run without owner go-ahead gates between them. The live pull waits only for the chain file."
  - "Tests use public vectors only. The throwaway chain's words never enter a test or a fixture."
---

# brave-sync

brave-sync is a read-only Brave Sync v2 client. It pulls every device's open tabs and synced history from one sync chain and writes them as JSON lines. Read FINDINGS.md first.

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
