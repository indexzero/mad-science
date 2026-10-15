---
name: peerscan
title: "PEERSCAN: a peer-to-peer malware scanner built from reproducible verdicts"
status: "stage 0, idea, not built"
date: 2026-10-15
author: "Charlie Robbins (indexzero), drafted with Claude Fable 5.1"
summary: "Every developer must scan what they fetch anyway. If each scan produces a signed, reproducible verdict, and peers replicate those verdicts over a multi-writer append-only log, then the trustworthy peers reveal themselves: they are the ones whose verdicts keep agreeing with yours."
motivation: "If we are all safe and pay it forward, the trusted peers in the system are revealed as a function of natural law. To be truly safe you have to do the scan yourself anyway. By sharing verdicts peer to peer you organically learn which peers, identified only by their durable keys, are trustworthy, because they are the ones agreeing with you the most. Trusted peers can be poisoned, but the knowledge of whom to trust grows in a natural, organic way."
substrate:
  - "Atomdrift Scan (atomscan): local-first, deterministic, zero-telemetry malware scanner; Apache-2.0; https://github.com/atomdrift-project/scan"
  - "in-toto Simple Verification Result (SVR) v0.2: the verdict record; https://github.com/in-toto/attestation/blob/main/spec/predicates/svr.md"
  - "cosign: signs verdicts as DSSE bundles; https://github.com/sigstore/cosign"
  - "autobee: multi-writer append-only logs folded into one Hyperbee view by a deterministic apply; https://github.com/holepunchto/autobee"
  - "blind-peer and blind-peering: peers that keep hypercores and autobases available without holding keys; https://github.com/holepunchto/blind-peer"
  - "hyperswarm and hyperdht: discovery and connection by key; https://github.com/holepunchto/hyperswarm"
  - "Apple container: one lightweight VM per scan job on macOS 26; https://github.com/apple/container"
  - "hood (experimental): install-time gate that scans artifacts before npm, pip, cargo, brew, and curl receive them; https://github.com/atomdrift-project/hood"
facts_verified: 2026-10-15
see_also:
  - "the three dx-isolation landscape passes of 2026-10-15 in the 0x repository (map/dx-isolation), which produced the single-node design this spec extends"
on_conflict: "A stage-1 PROMPT.md or orckit supersedes this file."
---

# PEERSCAN: a peer-to-peer malware scanner built from reproducible verdicts

## 1. The idea

Every developer who takes supply-chain attacks seriously ends up with the same loop. Before you fetch a repository, a package, or a binary, you scan it in a box. You record the verdict against the content digest so you never scan the same bytes twice. Then you let your fetch tool, your install tool, and your agents consult that record before they act.

That loop produces one thing nobody has pooled: a stream of verdicts that are **reproducible**. The same scanner version, the same rule set, and the same bytes give the same exit code. A verdict is therefore the one kind of security claim a stranger can check cheaply, by rescanning the bytes.

PEERSCAN pools those verdicts. Each node keeps its own append-only log of signed verdicts. Nodes replicate each other's logs and fold them into one shared view. A gate consults the view before any fetch. Blind peers keep the logs available without being able to read them.

Trust is not configured. It is measured. You must scan for yourself anyway, so every foreign verdict you can compare against your own is a free sample. A peer whose verdicts keep agreeing with yours, and whose verdicts survive your spot-check rescans, accrues trust. A peer whose verdict your own rescan contradicts loses it at once. Peers are identified only by their durable signing keys. Nobody has to be known to be trusted, and nobody is trusted because they are known.

## 2. The product motivation, stated by the author

To be truly safe you have to do this yourself anyway. Sharing the result costs nothing and pays it forward. If everyone pays it forward, the set of trustworthy peers reveals itself as a function of agreement, the way natural growth reveals a pattern without anyone designing it. Trusted peers can be poisoned. The defense is that trust was earned by agreement and is lost by disagreement, so poisoning is visible the moment it starts, and the trust you keep is the trust that kept being right.

## 3. What exists today

Verified on 2026-10-15 from each project's own documentation.

| Piece | What it gives PEERSCAN | Facts that matter |
|---|---|---|
| Atomdrift Scan | the engine | exit 0 benign, 1 hostile, 2 suspicious, 3 analysis error, 4 rule set incomplete; `-f json`; `-l<N>` sets the false-positive level; `--no-update` pins the rule set for a run; scans files, dirs, archives, PURLs, URLs; brew tap and static Linux builds; one primary maintainer; the benchmark number is the vendor's own |
| in-toto SVR | the verdict record | fields: `verifier.id` (versioned URI), `verifier.policies` (may be empty, must be present), `timeCreated`, `properties` (passing properties only); time-bounded properties by naming convention, for example `PEERSCAN_SCANNED_30`; subject digests accept `sha256` and `gitCommit`; two digest sets match if any field matches |
| cosign | signing | `cosign attest-blob --predicate svr.json --type https://in-toto.io/attestation/svr/v0.2 --hash <sha256> --bundle out.sigstore.json`; a local key for one node, keyless (Fulcio and Rekor) when others must verify; cannot sign a hand-written Statement, so the subject is always the sha256 of the bytes and the git commit rides in the name until a small custom signer exists |
| autobee | the fold | each writer appends to its own hypercore; `apply(nodes, view, host)` folds them into one Hyperbee deterministically; optimistic appends from unknown writers always reach `apply`, which admits with `host.addWriter` or ignores; `isTrusted(key, reference)` and witness weights drive fast-forward; `encryptionKey` encrypts the view at rest; version 2.12.1 |
| blind-peer, blind-peering | durability without keys | `blindPeering.addAutobaseBackground(autobase)` keeps an autobase's cores at mirrors; mirrors are `{ key, group }` and `pick` (default 2) chooses mirrors across groups; a mirror announces a core only when the requesting peer's DHT key is in its trusted set; `addCore` resolving does not prove the data is held, so commitment must be confirmed by reading the mirror's length |
| hyperswarm | discovery | topic is the discovery key, a one-way hash of the core key; it finds peers, it does not decide whom to trust |
| Apple container | the box | one VM per scan job, no host mounts by default, named volume for the clone, deleted after; macOS 26 on Apple silicon; Linux nodes use Incus or Lima with no mounts |
| hood | the install gate | loopback proxy with a per-child CA; fails closed; covers npm, pip, cargo, brew, curl, and more; experimental |

## 4. Architecture

```text
                       ┌──────────────────────────────────────────────────────┐
                       │  ONE NODE (a laptop, or a box that runs all the time)│
                       │                                                      │
   ghcd user/repo ───▶ │  gate ──lookup──▶ view ──miss──▶ box ──▶ scanner     │
   hood (npm, curl)──▶ │   │                ▲              │        │         │
   MCP: check/scan ──▶ │   │                │              │   exit 0/1/2/3/4 │
                       │   │                │              │        │         │
                       │   │           autobee fold        │     svr.json     │
                       │   │        (apply = trust)        │        │         │
                       │   ▼                │              ▼        ▼         │
                       │  clone to ~/Git    │        cosign attest-blob       │
                       │  (only on benign)  │              │                  │
                       │                    │              ▼                  │
                       │              ┌─────┴────┐   my writer log            │
                       │              │ other    │   (append-only,            │
                       │              │ writers' │    encrypted at rest)      │
                       │              │ logs     │◀───── replicate ─────┐     │
                       │              └──────────┘                      │     │
                       └────────────────────────────────────────────────┼─────┘
                                                                        │
          ═════════════ HyperDHT: topic = discoveryKey(view key) ═══════╪═════
                                                                        │
     ┌──────────────────┐   ┌──────────────────┐   ┌───────────────────┴──┐
     │ peer B (friend)  │   │ peer C (stranger)│   │ blind peers (seeds)  │
     │ own writer log   │   │ own writer log   │   │ hold ciphertext only │
     │ own scanner, box │   │ own scanner, box │   │ group: home | paid   │
     └──────────────────┘   └──────────────────┘   └──────────────────────┘

   trust(peer) = f(agreements with my own verdicts, confirmed disagreements, audits passed)
   a verdict is BELIEVED only if:  hostile from anyone I have not caught lying
                                   benign from k trusted peers across ≥2 groups, fresh, or from me
```

The gate is any consumer of the view: the clone-time check in `ghcd`, the install-time proxy `hood`, or an MCP tool an agent calls. The box is where bytes are fetched and scanned. The scanner never runs on the host. The verdict is signed before it is appended. The fold is where every trust decision lives.

## 5. The verdict record

One autobee operation is one DSSE-signed in-toto Statement with the SVR predicate. The view indexes it three ways.

```jsonc
// the statement (inside the DSSE envelope cosign emits)
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{
    "name": "git+https://github.com/user/repo@<commit>",      // or pkg:npm/left-pad@1.3.0, or a URL
    "digest": { "sha256": "<sha256 of the exact bytes scanned>" }
  }],
  "predicateType": "https://in-toto.io/attestation/svr/v0.2",
  "predicate": {
    "verifier": { "id": "https://peerscan.dev/verifier/<writer-key>/v1", "policies": [] },
    "timeCreated": "2026-10-15T20:00:00Z",
    "properties": [
      "PEERSCAN_ATOMDRIFT_2_12_1_BENIGN_L25",   // scanner version and level are in the name
      "PEERSCAN_RULESET_COMPLETE",              // exit was not 4
      "PEERSCAN_FOLLOWED_REFERENCES",           // --follow was on
      "PEERSCAN_SCANNED_30"                     // consumers re-check after 30 days
    ]
  }
}
```

Rules for the record:

- Exit 0 produces properties. Exit 1 and 2 produce an SVR with an empty `properties` array and the scan JSON beside it as evidence, so a refusal is remembered. Exit 3 and 4 produce nothing.
- The subject is the sha256 of the exact bytes scanned. For a git commit, v0 uses `git archive --format=tar <commit>` as the bytes and keeps the commit in the name. Measure that the archive is byte-stable before relying on it.
- The verifier id contains the writer's public key and a version. Bump the version when the scanner major, the level, or the policy changes.
- The rule-set version is recorded in the evidence JSON; the property name carries the scanner version and level.

View keys, all in one Hyperbee, byte order chosen so the common queries are point reads or bounded seeks:

```text
sub\0<algo>\0<digest>\0<writer>         → the verdict          "what do we know about these bytes"
uri\0<name>\0<writer>                   → the verdict          "what do we know about this URI"
pkg\0<ecosystem>\0<name>\0<version-key>\0<writer>  → the verdict  "newest version with a believed benign"
peer\0<writer>                          → trust record         agreements, disagreements, audits, epoch
sys\0roster                             → optional signed roster of writers and groups
```

The `version-key` encodes SemVer so byte order equals precedence order: `major`, `minor`, `patch` as fixed-width big-endian integers, a kind byte that sorts prereleases before releases, then typed prerelease identifiers. With that key, "the highest version of `left-pad` that k trusted peers call benign" is a handful of reverse seeks, not a scan of every version.

## 6. Trust posture

These rules are the whole product. Everything else is plumbing.

1. **Hostile verdicts travel free. Benign verdicts travel with trust.** A hostile verdict is cheap to confirm by rescanning and nearly useless to fake. A benign verdict is the attacker's target. `apply` records both, but the gate believes a foreign hostile from any peer not yet caught lying, and believes a foreign benign only from trusted peers.
2. **Benign needs k trusted peers across at least two groups, and must be fresh.** `k` and the groups are local policy. A verdict older than its time-bounded property is not believed; it is re-scanned.
3. **Trust is earned by agreement and lost by confirmed disagreement.** Every node keeps a trust record per writer key: the count of foreign verdicts that matched the node's own verdict on the same bytes, the count that the node's own rescan contradicted, and the count of audits passed. A proposed growth rule, to be validated, is that each consecutive agreement adds the sum of the previous two increments, so trust grows like a Fibonacci sequence and only through an unbroken run, and one confirmed disagreement resets the run to zero. This is the author's "natural law" intuition made mechanical; the exact function is a design choice to measure, not a fact.
4. **Spot-check by rescan.** Every node re-verifies a random sample of the foreign verdicts it has relied on, inside its own box, with its own scanner. The sample rate is local policy. A writer whose verdicts fail audit is demoted locally and, if a roster exists, removed by epoch rotation so an old key cannot re-enter.
5. **Logs are encrypted by default.** What you fetch is private. Blind peers hold ciphertext. A node that wants to publish a public verdict log, for public artifacts only, does so as a separate, deliberate writer key.
6. **Every trust decision lives in `apply`.** Nothing outside the fold decides what is believed. The view is a face of the logs; it is never authoritative on its own.
7. **Verdicts are data to agents.** The MCP tool returns subject, verifier, properties, and provenance. A finding string from a foreign writer is untrusted text and is never executed as an instruction.

Poisoning, honestly: a trusted peer can be compromised and start emitting false benigns. The posture does not prevent that. It bounds it. The false benign must survive k-of-n agreement across groups, must beat the next rescan sample, and loses the peer its entire trust run the first time a node's own scan contradicts it. The attacker buys a short window against nodes that happened to trust that peer and did not sample that verdict. That window is the price of a decentralized system, and it is smaller than the window a centralized feed gives when the feed is wrong.

## 7. Invariants every component honors

1. One writer per log. A node's verdicts are appended by exactly one process holding exactly one key.
2. The gate never runs the fetched code. It resolves a digest, looks up, and either clones or runs the box.
3. Durable before visible. A verdict is not believed by others until at least one mirror confirms it holds the log at that length.
4. Subjects are immutable content. A branch, a tag, or `latest` is never a subject.
5. Exit 3 and 4 never produce a believed verdict.
6. Nothing leaves the node by default. Replication to anyone is a configured act.
7. The store holds digests, verdicts, signatures, and evidence JSON. It never holds fetched bytes or fetch credentials.

## 8. Agent surface

Four tools, exposed as an MCP server and as a skill that tells the agent when to call them.

| Tool | Input | Returns | Side effects |
|---|---|---|---|
| `peerscan.check` | a URI, PURL, or digest | believed verdict, or `unknown`, with the verifiers behind it | none |
| `peerscan.scan` | a URI, PURL, or path | the node's own verdict after a box run | appends to the local log |
| `peerscan.explain` | a verdict id | the evidence JSON and which rules fired | none |
| `peerscan.peers` | none | the trust table: writer key, agreements, disagreements, audits, group | none |

An agent inside a box can call `check` before every fetch. An agent is never a writer on its own; the node is.

## 9. Work items for a fresh agent

Each item has a Done that a machine can check.

1. **Single node, no network.** Build the scan box image (Apple container, Atomdrift Scan pinned release, a second engine such as GuardDog), the `ghcheck` function that scans a commit or PURL in the box, and `ghattest`, which turns exit code plus scan JSON into an SVR, signs it with cosign, and stores the bundle under `~/.peerscan/attest/sha256/<digest>`. Done: a known-hostile sample exits 1 and produces an empty-properties SVR; twenty benign repos exit 0 and produce benign SVRs; a repeat lookup returns in under one second; `git archive` sha256 is byte-stable across ten runs.
2. **The log and the fold, one node.** Replace the directory store with an autobee writer log whose ops are the DSSE bundles. Write `apply` so it verifies each bundle's signature, rejects malformed statements as inert, and materializes the three view keys. Done: ten thousand verdicts fold into a view; `sub` lookup is one `get`; the `pkg` range query for "highest benign version" performs a bounded number of seeks that does not grow with version count; a bundle with a bad signature is inert and the log still folds.
3. **Three peers and blind seeds.** Three nodes replicate over hyperswarm, each with its own writer key, each log encrypted at rest, and two blind peers in different groups seeding all three autobases. Implement the trust record and the agreement rule from section 6. Done: all three views converge byte-identical after replication; a verdict is marked believed only after one mirror confirms the length; the trust table on each node shows the other two with growing agreement runs.
4. **Audit by rescan and demotion.** Add the sampling rescan and the confirmed-disagreement reset. Plant one false benign from one peer. Done: the planted verdict is caught by a sampled rescan within the configured sample budget, the peer's trust resets to zero on every node that caught it, and the gate stops believing that peer's benigns.
5. **Gates.** Wire `ghcd` to `check` before clone, run `hood` beside it for installs, and ship the MCP server with the four tools and a skill. Done: an agent in a box calls `check` before a fetch and receives the same answer the shell gate receives; a hostile PURL is refused at both gates.

Items 1 and 2 are the toy that one agent can finish from one PROMPT.md. Items 3 through 5 are an orckit.

## 10. Open questions

1. **Compaction.** Writer logs grow with every verdict and nothing compacts them. Retention policy per node, and whether superseded verdicts are pruned from the view, must be designed.
2. **Verdict volume.** Every package version times every scanner version is millions of rows. Hyperbee holds that; replication cost per new peer does not shrink. Decide whether a new peer receives full logs or a checkpointed view.
3. **The gitCommit subject.** cosign subjects a sha256 only. A small custom signer that emits both `sha256` and `gitCommit` in the digest set removes the archive-determinism dependency.
4. **The agreement function.** The Fibonacci growth rule is an intuition. Simulate it against a Sybil attacker who agrees for a long run and then lies, and measure the window.
5. **Scanner concentration.** Every node running the same scanner agrees for the wrong reason: a shared false negative. Diversity of engines across peers raises the value of agreement. The posture weights agreement from peers running a different engine higher.
6. **Privacy of names.** The log is encrypted, but a published public log exposes the PURLs and URIs a node scanned. Public logs are opt-in per writer key; nothing else is required in v0.

## 11. Not doing

- A central verdict service. The whole point is that there is none.
- Trusting a benign verdict from a stranger. Rule 1.
- Running the scanner on the host. The scanner parses hostile archives; it runs in the box.
- Agents as writers. An agent calls `scan`; the node signs and appends.
- A reputation token or any incentive beyond paying it forward.
