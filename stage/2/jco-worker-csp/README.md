---
stage: 2
status: "Tried. Nothing depends on it."
date: 2026-10-21
claim: "jco can run inside a guest Web Worker. A worker loaded from a 'self' URL gets its own CSP from its own HTTP response. That worker CSP can allow blob: and 'wasm-unsafe-eval' with connect-src 'none'. The glue that jco generates then runs in a separate agent with no DOM and no network, while the page keeps a CSP that refuses the same glue."
result: proved
browsers:
  - "chromium 156.0.8078.4 (Playwright bundled)"
  - "firefox 158.0.1 (system Firefox, WebDriver BiDi)"
  - "webkit 27.2 (Playwright bundled)"
versions:
  - "@bytecodealliance/jco-transpile 0.20.0"
  - "@bytecodealliance/preview2-shim 0.30.0"
  - "prismjs 1.30.0 (vendored: core, clike, javascript)"
  - "hono 4.13.13"
  - "@hono/node-server 2.1.5"
  - "@playwright/test 1.64.1"
  - "node 24.16.0"
sources:
  - "https://html.spec.whatwg.org/multipage/browsers.html#initialize-worker-policy-container"
  - "https://www.w3.org/TR/CSP3/#run-global-object-csp-initialization"
  - "https://github.com/WebAssembly/component-model/blob/d095e2f60ddae1f9a1e9b1e2fb547ec1114da677/design/mvp/Binary.md#component-definitions"
  - "https://github.com/bytecodealliance/jco/tree/0c03780b6f1a8b7c1f4c4ff6d9e2ce20b8bfcbb8"
  - "charlie.dev render/site/src/app.ts lines 119-131 at 7541d979 (private repo)"
---

# jco-worker-csp

jco-worker-csp shows that JavaScript generated from a WebAssembly component
can run in a Web Worker whose CSP allows it, on a page whose CSP refuses it.

## Run it

```sh
pnpm install
pnpm install-browsers   # chromium, firefox, webkit for Playwright
pnpm test               # Done: 28 tests, 3 browsers, prints the tables below
pnpm start              # http://127.0.0.1:8787 (PORT=...)
```

`pnpm test` drives the system Firefox at `/Applications/Firefox.app` over
WebDriver BiDi, because Playwright's Firefox 157 build exits at launch on
this macOS 27 host ("Could not find profile folder"). Use
`PW_FIREFOX_CHANNEL=bundled pnpm test` for the bundled build.

Other scripts:

| command | output |
|---|---|
| `pnpm build` | rebuilds `components/guest.wasm` from `guest/guest.wat` + `guest/guest.wit` |
| `node scripts/screenshot.ts <browser>` | 4 pages + both panels, light and dark, 1280×800 and 390×844, in `screenshots/` (gitignored) |
| `node scripts/check-citations.mjs` | HTTP status and anchor check for every citation link |
| `node scripts/inspect-component.mjs` | preamble, custom sections, WIT and canon lines of guest.wasm |
| `node scripts/requests.ts <browser>` | every request event the browser reports, page and worker |
| `node scripts/explore.ts [--json] [browser…]` | each expected CSP refusal checked by its event and by the policy that refused it (page or worker); each console line tagged with the probe that caused it; anything no probe explains listed as unexpected, with exit 1. `--json` adds the raw `window.__poc` |
| `node scripts/smoke-node.mjs` | guest.wasm through jco in Node, no browser |

## What it proves

Each line is on screen and asserted by `pnpm test` in Chromium 156,
Firefox 158 and WebKit 27.2.

- The page's response carries the page CSP, copied verbatim from
  charlie.dev `render/site/src/app.ts` lines 119-131. Page 2 shows the
  header as the page reads it.
- On the page, `import()` of the glue from a `blob:` URL is refused:
  `securitypolicyviolation { effectiveDirective: script-src-elem, blockedURI: blob }`.
- The worker's response carries
  `default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; connect-src 'none'`.
  Page 3 shows the header and a directive diff against the page CSP.
- The worker imports the same glue (same sha256, computed on the page and
  in the worker) from a `blob:` URL, instantiates it, and `run("a b c")`
  returns `"3"` to the page by `postMessage`.
- In the worker, `fetch('/')`, `fetch('https://example.com/')`,
  `new WebSocket(...)`, `import('https://example.com/x.js')` and
  `new Function(...)` are refused. Every worker violation event has
  `originalPolicy` equal to the worker CSP. No event carries the page CSP.
- Sending the page CSP on `/guest-worker.js` instead makes the worker's
  `blob:` import fail and the suite fail (checked by hand, 2026-10-21).

## The page

Four pages, one screen each. `[ ← ]` / `[ → ]` and ArrowLeft /
ArrowRight move between them. The document never scrolls; a box whose
content is taller than its share scrolls inside itself. A text diagram at
the top of every page highlights the part the page is about:

```
page ─► loader ─► worker ─► glue ─► guest.wasm
                                    │
page ◄─ postMessage ◄─ log import ◄─┘
```

| page | diagram | contents |
|---|---|---|
| 1/4 The component | guest.wasm, glue | bytes 0-7 of guest.wasm, `componentWit` and `print` output, glue size, sha256 and excerpt |
| 2/4 Refused on the page | page ✗ glue | page CSP header, `import(blob: glue)` refused with its violation event, the two controls, the loader code that tried |
| 3/4 Run in the worker | loader → worker → glue → guest.wasm → log import | worker CSP diff, sha256 match, live `run()` input, `log` import modes, the worker code that supplies `log` |
| 4/4 What got out | postMessage → page, ✗ per escape attempt | the 6 attempts with their violation events, the result by `postMessage`, known gaps |

Two buttons sit under the pages. `[ devtools ]` opens "postMessage (ONE
PING ONLY)" and "BUNDLE STATS". `[ citations ]` opens the citations,
below devtools when both are open. Open panels shrink the page area.

One ping only: the page sends one `ping` to the worker and gets one `pong`
(the text reversed). The button then locks. The worker refuses a second
ping on its own; the test sends one around the locked button to check.

JS excerpts are highlighted by Prism 1.30.0, served from
`/vendor/prism/` with `Prism.manual = true` set in `/prism-manual.js`.

## How guest.wasm is built

guest.wasm is one WebAssembly component: a binary whose preamble is
`00 61 73 6D` · version `0d 00` · layer `01 00` (a core module's layer is
`00 00`). Its interface types are part of the binary. `componentEmbed`,
jco-transpile's build of `wasm-tools component embed`, encodes the WIT
world `guest` into a `component-type` custom section of the core module.
`componentNew` (`wasm-tools component new`) then reads that section and
wraps the core module in component-level type, import and export
definitions, joined to the core functions by `canon lift` / `canon lower`
(the Canonical ABI). The page recovers the WIT from the bytes alone with
`componentWit` (`wasm-tools component wit`), so no .wit file ships. The
recovered world is named `root` in package `root:component`: the name
`guest` does not come back. The signature of `log` is in the component's
type section: `(type (func (param "msg" string)))`.

The core module is hand-written WAT (`guest/guest.wat`), because this host
has no `wasm32-wasip2` target, `cargo component` or `wasm-tools` binary.
`scripts/build-component.mjs` runs `parse`, `componentEmbed` and
`componentNew` from `@bytecodealliance/jco-transpile/wasm-tools`. Two
builds give sha256
`e47d67624c48e9655ece855945b27f8a2adce1dbb72a2fd3bf716bc269cdef80`.
guest.wasm imports `washe:poc/host` only; it imports no WASI interface.

## Results per browser

`pnpm test`, 2026-10-21: 28 passed. 4 HTTP tests, and per browser 7
layout tests plus 1 probe test. The probe test also walks all 4 pages and
uses every control; its video is the walk-through.

| probe | chromium 156.0.8078.4 | firefox 158.0.1 | webkit 27.2 |
|---|---|---|---|
| p1: guest.wasm preamble = 00 61 73 6d 0d 00 01 00 | PASS | PASS | PASS |
| p1: componentWit recovers the world from the bytes | PASS | PASS | PASS |
| p1: print shows log type, canon lift and canon lower | PASS | PASS | PASS |
| p1: glue excerpt highlighted by Prism | PASS | PASS | PASS |
| p2: page reads its own CSP header (exact copy) | PASS | PASS | PASS |
| p2: glue refused on the page | PASS | PASS | PASS |
| p3: page and worker glue have the same sha256 | PASS | PASS | PASS |
| p3: worker CSP read from its header | PASS | PASS | PASS |
| page: blob: import() refused | PASS | PASS | PASS |
| page: new Function throws | PASS | PASS | PASS |
| worker: jco glue import()ed from blob: | PASS | PASS | PASS |
| end to end: run("a b c") === "3" via postMessage | PASS | PASS | PASS |
| end to end: host log import called | PASS | PASS | PASS |
| worker: no document, no window | PASS | PASS | PASS |
| worker: no OffscreenCanvas transferred | PASS | PASS | PASS |
| worker: fetch('/') refused by connect-src | PASS | PASS | PASS |
| worker: fetch(https://example.com/) refused by connect-src | PASS | PASS | PASS |
| worker: new WebSocket refused by connect-src | PASS | PASS | PASS |
| worker: importScripts(cross-origin) refused | PASS | PASS | PASS |
| worker: import(cross-origin) refused by script-src | PASS | PASS | PASS |
| worker: new Function throws | PASS | PASS | PASS |
| worker: eval fires a violation event | PASS | PASS | XFAIL |
| worker: every violation's originalPolicy is the worker CSP | PASS | PASS | PASS |
| info: worker can make its own OffscreenCanvas | 2d context | 2d context | 2d context |
| info: worker has BroadcastChannel / indexedDB | both | both | both |
| walk: [ → ] to page 2 | PASS | PASS | PASS |
| p2: import(blob: glue) button refused again | PASS | PASS | PASS |
| walk: ArrowRight to page 3 | PASS | PASS | PASS |
| p3: live input -> run() -> "4" | PASS | PASS | PASS |
| p3: host swaps the log import (SHOUT) | PASS | PASS | PASS |
| walk: [ → ] to page 4 | PASS | PASS | PASS |
| p4: run the attempts again -> 6 x REFUSED | PASS | PASS | PASS |
| ping: one ping in, one pong out | PASS | PASS | PASS |
| ping: worker refuses a second ping | PASS | PASS | PASS |
| walk: ArrowLeft x3 back to page 1 | PASS | PASS | PASS |

Layout tests, all PASS in all 3 browsers (`tests/layout.spec.ts`):
buttons and arrow keys walk all 4 pages and the diagram highlight changes
per page; devtools and citations toggle, citations below devtools;
`scrollHeight <= innerHeight` and `scrollWidth <= innerWidth` on every
page, panels closed and open, at 1280×800 and 390×844; no "Pledge",
"Prestige", "Turn", "Act " or "Under the table" in the document; every
citation has `target="_blank"` and `rel="noopener noreferrer"`; Prism
loads from `/vendor/prism/` and no cross-origin request gets a response.

The WebKit XFAIL: `new Function` in the worker throws an `EvalError`
quoting the worker's `script-src`, and no `securitypolicyviolation` event
fires. The test asserts this, so a change in WebKit shows as XPASS and
fails the run.

Videos: `test-results/probes-guest-worker-probes-<browser>/video.webm`.

## Numbers

Bytes, as served (Resource Timing `decodedBodySize`, shown in BUNDLE STATS):

| file | bytes |
|---|---|
| guest.wasm | 1,467 |
| glue `guest.js` (generated in the worker) | 130,809 |
| glue core modules | 609 + 109 + 107 |
| jco bindgen JS (served, specifiers rewritten; 478,146 on disk) | 478,118 |
| jco bindgen core wasm | 3,538,381 + 14,120 |
| jco wasm-tools JS (served, rewritten) | 493,536 |
| jco wasm-tools core wasm | 2,391,321 + 14,120 |
| Prism 1.30.0: core + clike + javascript | 7,461 + 708 + 4,611 = 12,780 |

Milliseconds, one cold load, `pnpm exec playwright test probes --workers 1`:

| step | chromium | firefox | webkit |
|---|---|---|---|
| `generate()` in the worker | 41 | 6 | 25 |
| bindgen `$init` in the worker | 20.7 | 96 | 76 |
| `instantiate()` in the worker | 0.8 | 1 | 2 |
| navigation start → first result | 353.5 | 537 | 375 |

Under the full parallel `pnpm test` run, navigation → first result was
420 / 823 / 401 ms. Before the page ran wasm-tools and fetched its own
source for the excerpts, it was 228 / 417 / 261 ms.

## Known gaps (2026-10-21)

- OffscreenCanvas with a 2d context is available in the worker:
  `new OffscreenCanvas(1, 1).getContext('2d')` returns a context in all 3
  browsers.
- IndexedDB and BroadcastChannel reach the page's origin from the worker.
  `connect-src` does not cover them.
- WebKit 27.2 fires no `securitypolicyviolation` event for eval in the
  worker.
- Workaround 1: a `self.fetch` shim in the worker answers only the two
  bindgen URLs (`js-component-bindgen-component.core.wasm`, `.core2.wasm`)
  with bytes the loader transferred, then the real `fetch` is put back.
  `connect-src 'none'` is not widened.
- Workaround 2: the server rewrites the bare specifiers
  `@bytecodealliance/preview2-shim/{cli,filesystem,io,random}` in jco's
  prebuilt glue (`js-component-bindgen-component.js`, `wasm-tools.js`) to
  `/vendor/preview2-shim/*.js`. Module workers have no import maps.
- The page runs jco's wasm-tools build (a same-origin static module, which
  `script-src 'self'` allows) to read the WIT. That adds 2.9 MB to the page
  load.

## Decisions where the spec was silent

- **Where `componentWit` runs:** on the page, as the paragraph says. jco's
  `wasm-tools.js` is a same-origin static file, so the page CSP allows it.
  The server rewrite from Workaround 2 now covers this file too.
- **Arrow keys in a text input:** they move the caret, not the page.
- **First and last page:** no wrap-around. `[ ← ]` is disabled on 1/4 and
  `[ → ]` on 4/4.
- **The two panels:** fixed heights, devtools 30% and citations 24% of the
  viewport height. Their boxes scroll inside.
- **Prism size:** the JavaScript grammar extends `clike`, so three files
  are vendored: 12,780 bytes, not the 7 kB the spec estimated.
- **Bundle stats:** the server sends no `Content-Length` on HEAD, so sizes
  come from Resource Timing (`decodedBodySize`). The worker reports its own
  entries, with a GET byte count as the fallback.
- **"No cross-origin requests":** Chromium reports the worker's blocked
  `import('https://example.com/x.js')` as a request that fails with `csp`
  before reaching the network. The test asserts that no cross-origin
  request gets a response and that every cross-origin request event fails.
- **The header test** now expects 5 external scripts (4 Prism files and
  `main.js`), each with an empty body. Before, it expected 1.
- **Code excerpts** on pages 2 and 3 are read live from `/main.js` and
  `/guest-worker.js`, between `// <excerpt:name>` markers. They are not
  copies.
- **The diagram note line** on page 4 lists `fetch`, `WebSocket`,
  `import()` and `eval`. It leaves out `importScripts`, which module
  workers ban whether or not a CSP is set.

## Where the spec's paragraph changed

- The tool is jco-transpile's in-process build of wasm-tools
  (`componentEmbed`, `componentNew`, `componentWit`), not the
  `wasm-tools` CLI.
- `componentWit` names the world `root` in package `root:component`. The
  name `guest` does not come back.
- The printed WIT shows `import washe:poc/host;` but not the body of
  `host`. The `log` signature is in the type section, so page 1 shows the
  `print` lines instead.
- The custom section is named exactly `component-type`, as the paragraph
  says.

## Citations

| claim | source |
|---|---|
| A worker's policy comes from its own response, unless its URL is local and not `blob:` | [WHATWG HTML, initialize a worker global scope's policy container](https://html.spec.whatwg.org/multipage/browsers.html#initialize-worker-policy-container) |
| CSP runs on the worker's global object with that policy list | [W3C CSP3 §4.2.6 Run CSP initialization for a global object](https://www.w3.org/TR/CSP3/#run-global-object-csp-initialization) |
| The worker script is fetched, then its response sets up the worker | [WHATWG HTML, run a worker](https://html.spec.whatwg.org/multipage/workers.html#run-a-worker) |
| The page's `worker-src` decides which URLs may start a worker | [MDN, CSP worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src) |
| The other isolation primitive, an opaque origin (not used here) | [MDN, iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox) |
| Preamble `00 61 73 6D` · `0d 00` · `01 00`; a core module's layer is 0x0 | [component-model Binary.md @ d095e2f](https://github.com/WebAssembly/component-model/blob/d095e2f60ddae1f9a1e9b1e2fb547ec1114da677/design/mvp/Binary.md#component-definitions) |
| A world lists the imports and exports of guest | [component-model WIT.md, WIT worlds @ d095e2f](https://github.com/WebAssembly/component-model/blob/d095e2f60ddae1f9a1e9b1e2fb547ec1114da677/design/mvp/WIT.md#wit-worlds) |
| Browsers run components through JS glue | [component-model Explainer.md §JS API @ d095e2f](https://github.com/WebAssembly/component-model/blob/d095e2f60ddae1f9a1e9b1e2fb547ec1114da677/design/mvp/Explainer.md#js-api) |
| Toolchains carry WIT type information in a custom section | [component-model Linking.md L60-L65 @ d095e2f](https://github.com/WebAssembly/component-model/blob/d095e2f60ddae1f9a1e9b1e2fb547ec1114da677/design/mvp/Linking.md#L60-L65) |
| Custom WIT interfaces are contracts the host supplies | [wasmCloud, Interfaces](https://wasmcloud.com/docs/overview/interfaces/) |
| `generate()` in the browser awaits the bindgen `$init` | [jco packages/jco/src/browser.ts @ 0c03780b](https://github.com/bytecodealliance/jco/blob/0c03780b6f1a8b7c1f4c4ff6d9e2ce20b8bfcbb8/packages/jco/src/browser.ts) |
| The `generate-options` the worker passes | [jco js-component-bindgen.wit L37-L63 @ 0c03780b](https://github.com/bytecodealliance/jco/blob/0c03780b6f1a8b7c1f4c4ff6d9e2ce20b8bfcbb8/crates/js-component-bindgen-component/wit/js-component-bindgen.wit#L37-L63) |
| `componentEmbed` writes the custom section `component-type` | [jco wasm-tools-component/src/lib.rs L280-L291 @ 0c03780b](https://github.com/bytecodealliance/jco/blob/0c03780b6f1a8b7c1f4c4ff6d9e2ce20b8bfcbb8/crates/wasm-tools-component/src/lib.rs#L280-L291) |
| The `wasi:cli` shim the bindgen glue imports; stdout goes to `console.log` | [jco preview2-shim src/browser/cli.ts L83-L119 @ 0c03780b](https://github.com/bytecodealliance/jco/blob/0c03780b6f1a8b7c1f4c4ff6d9e2ce20b8bfcbb8/packages/preview2-shim/src/browser/cli.ts#L83-L119) |
| WASI 0.3 is ratified; guest imports no WASI interface | [Bytecode Alliance, WASI 0.3 Launched (2026-06-11)](https://bytecodealliance.org/articles/WASI-0.3) |
| The Component Model is not 1.0; version `0d 00` is pre-1.0 | [Bytecode Alliance, The Road to Component Model 1.0 (2026-06-08)](https://bytecodealliance.org/articles/the-road-to-component-model-1-0) |
| The page CSP, copied verbatim | [charlie.dev render/site/src/app.ts L119-L131 @ 7541d979](https://github.com/indexzero/charlie.dev/blob/7541d9792eaabb1ac75c7e27edba2f5a86087bc6/render/site/src/app.ts#L119-L131) |

`node scripts/check-citations.mjs` (2026-10-21): 16 of 17 links return
200 with their anchor present. The charlie.dev link returns 404 without
authentication, because the repo is private. `gh api` confirms that the
file exists at that commit. The spec's suggested anchor
`https://www.w3.org/TR/CSP3/#initialize-global-object-csp` no longer exists
in the CSP3 TR. The HTML policy-container link and CSP3 §4.2.6 replace it.
