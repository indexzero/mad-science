# seedpod — Trust Anchors

## Release ⇔ version ⇔ drive: a 1-to-1 mapping

seedpod's trust rests on one construction: publishing is triggered ONLY by
`release: {types:[published]}`, so there is exactly one workflow run — and one
drive staging — per GitHub Release, per version.

```
GitHub Release  ──1:1──▶  version (tag)  ──1:1──▶  pear:// drive checkout
   (tag v1.2.3)              1.2.3            (staged from that Release's assets)
        │                       │                          ▲
        │                       │                          │
        └── html_url ───────────┴──────── seedpod.json ────┘
            (out-of-band, independently fetchable anchor)
```

- The **tag** names the version (`version` = tag minus a leading `v`).
- The tag resolves to a **commit sha** (the tag object dereferenced, not
  `target_commitish`); that sha is the source coordinate embedded everywhere.
- The **Release** is the out-of-band anchor: independently fetchable, it lists
  the same assets the drive was staged from.
- The **attestation** (public sigstore store, append-only, outside the repo)
  binds the binaries + `SHA256SUMS` + `seedpod.json` to the workflow that built
  them. It — not the mutable Release asset — is the integrity root.

## `seedpod.json` schema

Assembled by the `manifest` job and attested by the `attest` job. Schema:

```json
{
  "name": "<name>",
  "version": "<tag minus leading v>",
  "tag": "<tag_name>",
  "source": "git+https://github.com/<owner>/<repo>.git#<resolved-commit-sha>",
  "release": "<release html_url>",
  "assets": { "<file>": "sha256-<hex>" }
}
```

- `source` is the **literal git URI including the sha** — the required source
  coordinate. `<resolved-commit-sha>` is the tag's commit, asserted at checkout.
- `assets` maps each binary filename to its `sha256-<hex>` digest; the same
  digests appear in `SHA256SUMS`.
- `tag` is carried explicitly so `version` and `tag` never have to
  be re-derived from each other by a consumer.

## Consumer verification commands

Download an asset (or all of them) from the Release, then verify each against
the attestation with the pinned identity predicate. This is the SAME predicate
the `stage` job runs before it lets any asset into the drive:

```sh
# Download the asset(s) for the tag
gh release download <tag> --repo <owner>/<repo> --dir ./verify

# Verify each asset: bound to THIS repo AND the workflow file that signed it,
# not merely "any workflow with id-token in the repo".
gh attestation verify ./verify/<file> \
  --repo <owner>/<repo> \
  --signer-workflow <owner>/<repo>/.github/workflows/release.yml
```

Then corroborate the source coordinate independently:

```sh
# The drive's package.json and seedpod.json both carry the git URI + sha.
jq -r '.source' ./verify/seedpod.json
#  git+https://github.com/<owner>/<repo>.git#<sha>

# Confirm the sha is the tag's COMMIT — dereferencing an annotated tag the SAME
# way release.yml's `resolve` job does. `git/ref/tags/<tag>` returns the tag
# OBJECT sha for an annotated tag, not the commit; deref it via `git/tags/`.
SHA=$(gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '.object.sha')
TYPE=$(gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '.object.type')
if [ "$TYPE" = "tag" ]; then
  SHA=$(gh api repos/<owner>/<repo>/git/tags/"$SHA" --jq '.object.sha')
fi
echo "$SHA"   # compare against the #<sha> in seedpod.json .source
```

### `--signer-workflow` depends on adoption mode

The attestation is signed by whichever workflow file runs the `attest` job, so
the `--signer-workflow` value must name that file:

- **In-tree adoption** (you copied `release.yml` into your own
  `.github/workflows/release.yml`): use
  `<owner>/<repo>/.github/workflows/release.yml` — the default the `stage` job
  computes when `signer-workflow` is unset.
- **Reusable-call adoption** (you `uses:` seedpod's reusable workflow): the
  `attest` job runs under **seedpod's** identity, so use
  `OWNER/seedpod/.github/workflows/release.yml`. Pass it to the reusable
  workflow via the `signer-workflow` input (see
  [`examples/consumer-release.yml`](../examples/consumer-release.yml)), and use
  the same value in your own `gh attestation verify` calls.

## Installing the drive

```sh
npx pear-install pear://<key>      # portable; same module via npm
# Pear v3 CLI also exposes it as:  pear install pear://<key>
```

The `<key>` is the drive's public key, reported as the `pear-link` output of the
`pear-publish` composite. `pear-ci` derives it deterministically from the primary
key + the `namespace` (`--name`), so it is stable across releases (the same key +
namespace stage the same drive every time). Rotating the primary key mints a NEW
drive — consumers must re-anchor via a Release note (see
[`docs/OPERATIONS.md`](OPERATIONS.md) § Key ceremony).
