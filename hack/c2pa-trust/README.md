# c2pa-strip-verify

A deliberately small, one-shot experiment for C2PA stripping and perceptual laundering.

The shell entry point:

1. removes embedded metadata with ExifTool without decoding the image payload;
2. applies exactly one user-selected ImageMagick transform;
3. asks the C2PA Web SDK once whether the result still contains a discoverable manifest; and
4. exits without adapting or trying another transform.

## Requirements

- Node.js 20 or newer;
- pnpm;
- ExifTool;
- ImageMagick 7 (`magick`);
- Chrome or Chromium; set `CHROME_BIN` if it is not in a standard location; and
- network access to the live Verify WASM and trust resources.

Install dependencies from this directory (`hack/c2pa-trust`):

```sh
pnpm install
```

## Usage

```sh
hack/c2pa-trust/c2pa-strip-verify.sh [options] INPUT
```

Examples:

```sh
# Default: PNG becomes JPEG; JPEG becomes PNG.
hack/c2pa-trust/c2pa-strip-verify.sh image.png

# Strip, then perform a color-space round trip.
hack/c2pa-trust/c2pa-strip-verify.sh \
  --transform colorspace \
  --output /tmp/image-colorspace.png \
  image.png

# Strip, then recompress once.
hack/c2pa-trust/c2pa-strip-verify.sh --transform recompress image.jpg

# Strip, scale to 99%, then scale back to the original dimensions.
hack/c2pa-trust/c2pa-strip-verify.sh --transform scale image.png
```

The available transforms are:

| Name | Operation |
| --- | --- |
| `format` | PNG → JPEG or JPEG → PNG; this is the default |
| `colorspace` | sRGB-compatible input → Lab → sRGB |
| `recompress` | PNG compression level 9 or JPEG quality 90 |
| `scale` | resize to 99%, then return to the original dimensions |

The default output is written beside the input as `NAME.stripped.jpg` or `NAME.stripped.png`. Existing output is preserved unless `--force` is supplied.

## Results

The verifier prints one JSON result and exits:

| Exit | Status | Meaning |
| ---: | --- | --- |
| `0` | `no-manifest` | The SDK found no C2PA manifest |
| `3` | `manifest-found` | The SDK still found a manifest; no second transform is attempted |
| `4` | `error` | Verification could not be completed |

Argument and prerequisite errors exit with status `2`.

## Verification implementation

The verifier uses `@contentauth/c2pa-web@0.11.0`, the exact version pinned by the official Verify site, with the site's live [`c2pa.wasm`](https://verify.contentauthenticity.org/c2pa.wasm). The package version is taken from the official [`verify-site` lockfile](https://github.com/contentauth/verify-site/blob/main/pnpm-lock.yaml); the site copies that package's WASM into place during installation, as shown in its [`package.json`](https://github.com/contentauth/verify-site/blob/main/package.json).

It reproduces the official Verify site configuration in one reader call:

- the [official C2PA trust list](https://raw.githubusercontent.com/c2pa-org/conformance-public/refs/heads/main/trust-list/C2PA-TRUST-LIST.pem);
- the [official TSA trust list](https://raw.githubusercontent.com/c2pa-org/conformance-public/refs/heads/main/trust-list/C2PA-TSA-TRUST-LIST.pem);
- Verify's legacy anchors and allowed list; and
- `verifyTrust` and `verifyAfterReading` enabled.

The browser SDK is run in system Chrome through `playwright-core`; Vite only serves the local verifier module. No browser is downloaded by this package.

## Important limitation

`no-manifest` means only that the supplied C2PA Web reader did not discover a C2PA manifest in the transformed asset. It does **not** establish that:

- OpenAI's invisible watermark was removed;
- LinkedIn, OpenAI, or another platform cannot recognize the image using a proprietary detector;
- a perceptual-fingerprint database cannot associate the output with the source; or
- the output was not produced by generative AI.

The example manifest that motivated this experiment carried `c2pa.watermarked.unbound`: a watermark was added, but it was not registered as an interoperable C2PA soft binding. This command tests the embedded/linked C2PA reader path, not every possible content-recognition system.

## Tests

```sh
pnpm test
```

The shell tests cover the default transform, explicit transform selection, invalid input, and the requirement to stop after one verification even when a manifest remains discoverable.
