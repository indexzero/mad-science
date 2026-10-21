---
stage: 2
project: kinetic
status: "publish notes only; no upload was performed by this run"
measured: "2026-10-21, at the checkpoint 4 head of branch 1/kinetic"
---

# Publish notes

These notes tell the owner what a publish uploads and how to verify it. No upload was performed by this run. The run wrote to no bucket, no DNS record, and no live site.

## What to upload

Upload three paths and keep their relative layout. The player finds the deck through `../decks/_all_docs/deck.json`, so `player/` and `decks/` must be siblings under one root.

| path | files | bytes |
|---|---|---|
| `player/` | 6 | 34,806 |
| `decks/_all_docs/deck.json` | 1 | 12,390,998 |
| `decks/_all_docs/media/` | 344 | 57,865,608 |
| total | 351 | 70,291,412 |

`media/` holds 161 PNG, 37 JPEG, 73 MP4, and 73 WebM files. A viewer fetches one of the two video formats. A WebM browser downloads at most 56,338,886 bytes, the total less the 13,952,526 bytes of MP4.

Do not upload `convert/`, `e2e/`, `node_modules/`, `.cache/`, or `schema/`. The player does not read them.

## MIME types

The server must send these `Content-Type` values. A browser refuses a module script with a wrong type, so a wrong type on `.js` stops the player. The video `Blob` carries the served type, so a wrong type on `.webm` or `.mp4` can stop a video.

| extension | `Content-Type` |
|---|---|
| `.html` | `text/html; charset=utf-8` |
| `.js` | `text/javascript; charset=utf-8` |
| `.json` | `application/json; charset=utf-8` |
| `.png` | `image/png` |
| `.jpg` | `image/jpeg` |
| `.mp4` | `video/mp4` |
| `.webm` | `video/webm` |

`e2e/serve.js` uses the same table.

## Compress deck.json

`deck.json` holds every glyph outline inline, so it is large. Under the suite's throttle (1.5 Mbit/s, 150 ms latency) the first slide draws about 67.0 s after navigation (`firstSlideMs` 67,037 in `e2e/captures/preload.json`). Serve it compressed. This is a hosting step, not a code change.

| encoding | bytes | transfer floor at 1.5 Mbit/s |
|---|---|---|
| none | 12,390,998 | 66.1 s |
| gzip (`gzip -9`) | 3,179,506 | 17.0 s |
| brotli (`brotli -q 11`) | 2,071,563 | 11.0 s |

The floor is the byte count over 187,500 bytes per second. It is arithmetic, not a measured page load. Upload a precompressed copy with `Content-Encoding: gzip` or `br`, or turn on compression at the server or CDN. Do not compress the media. PNG, JPEG, MP4, and WebM are compressed already.

## Cache headers

- `decks/_all_docs/media/shared/*`: a file name is the first 12 hex characters of the sha256 of the source GIF. The name keys the input, not the output bytes. A converter change can write new bytes under the same name: `c9cced4b0ea5.webm` changed at `d65ddf5`. `Cache-Control: public, max-age=31536000, immutable` is safe only under a versioned path, such as a directory per upload, or with a name that hashes the output bytes.
- `decks/_all_docs/media/<slide UUID>/*`: a name is the KPF asset id. A new convert of the same export writes the same bytes. A long `max-age` is safe for one export. Use a short one if the deck is exported again under the same names.
- `decks/_all_docs/deck.json` and `player/*`: names do not change between versions. Use `Cache-Control: no-cache` (revalidate with an ETag) or a short `max-age`.

The player fetches each video as a whole file into a `Blob`, so the server needs no range requests.

## Verify

URL grammar: `https://<host>/player/index.html?deck=../decks/_all_docs/deck.json#<n>`, with `n` the 1-based slide.

1. Open `#1`. The first slide draws. ArrowRight and space advance. ArrowLeft goes back.
2. Open `#2`. The GIF of slide 2 plays as a video.
3. Check the types of one file of each kind:

   ```sh
   curl -sI "https://<host>/decks/_all_docs/deck.json" | grep -i -E '^content-(type|encoding)'
   curl -sI "https://<host>/decks/_all_docs/media/shared/c9cced4b0ea5.webm" | grep -i '^content-type'
   curl -sI "https://<host>/decks/_all_docs/media/shared/c9cced4b0ea5.mp4" | grep -i '^content-type'
   curl -sI "https://<host>/player/player.js" | grep -i '^content-type'
   ```

4. Run the suite against the local copy first: `bash check.sh` exits 0.
