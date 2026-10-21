---
stage: 2
status: "Tried. Nothing depends on it."
date: 2026-10-21
claim: "jco can run inside a guest Web Worker. A worker loaded from a 'self' URL gets its own CSP from its own HTTP response. That worker CSP can allow blob: and 'wasm-unsafe-eval' with connect-src 'none'. The JS glue that jco generates then runs in a separate agent with no canvas, no DOM and no network, while the page keeps a strict CSP that would block the same glue."
result: proved
browsers:
  - "chromium 156.0.8078.4 (Playwright bundled)"
  - "firefox 158.0.1 (system Firefox, WebDriver BiDi)"
  - "webkit 27.2 (Playwright bundled)"
versions:
  - "@bytecodealliance/jco-transpile 0.20.0"
  - "@bytecodealliance/preview2-shim 0.30.0"
  - "hono 4.13.13"
  - "@hono/node-server 2.1.5"
  - "@playwright/test 1.64.1"
  - "node 24.16.0"
sources:
  - "~/Git/indexzero/charlie.dev/render/site/src/app.ts lines 119-131 (page CSP)"
  - "~/Git/bytecodealliance/jco packages/jco/src/browser.ts (commit 0c03780b)"
  - "~/Git/bytecodealliance/jco packages/jco-transpile/test/fixtures/browser/transpile.js (commit 0c03780b)"
  - "https://www.w3.org/TR/CSP3/#initialize-global-object-csp"
  - "https://html.spec.whatwg.org/multipage/workers.html#run-a-worker"
---

# jco-worker-csp

## The claim

jco can run inside a guest Web Worker. A worker loaded from a `'self'` URL
gets its own CSP from its own HTTP response. That worker CSP can allow
`blob:` and `'wasm-unsafe-eval'` with `connect-src 'none'`. The JS glue that
jco generates then runs in a separate agent with no canvas, no DOM and no
network. The page keeps a strict CSP that would block the same glue.

## Result

The claim is proved in Chromium, Firefox and WebKit, with one change to
the wording: "no canvas" is too strong (see below).

- Each browser applies the worker's own response CSP inside the worker.
  Every violation event in the worker has `originalPolicy` equal to the
  worker policy. No event ever showed the page policy.
- The page refuses a `blob:` module import and `new Function`. The worker
  imports jco's glue from a `blob:` URL and runs it.
- If the server sends the page CSP on `/guest-worker.js` as well, the glue
  import fails in the worker and the suite fails. So the probes can tell
  the two policies apart. (This was a manual check. The code was put back
  after it.)

Where the claim is too strong:

- **Canvas.** No canvas from the page reaches the worker. But
  `new OffscreenCanvas(1, 1).getContext('2d')` works inside the worker in
  all three browsers. CSP does not control this. The worker can draw. It
  cannot show what it draws, or send it anywhere, except by `postMessage`
  to the host.
- **Other same-origin channels.** `BroadcastChannel` and `indexedDB` exist
  in the worker. They are not network, and `connect-src` does not cover
  them. A guest could use them to talk to other tabs on the same origin.
  This POC does not block them.

## How to run

```sh
pnpm install
pnpm install-browsers   # chromium, firefox, webkit for Playwright
pnpm test               # Done: header checks + probes in 3 browsers + table
```

Other commands:

```sh
pnpm build              # rebuild components/guest.wasm from guest/
pnpm start              # serve on http://127.0.0.1:8787 (PORT=...)
pnpm explore            # dump the raw probe report per browser
node scripts/smoke-node.mjs         # run the guest in Node, no browser
node scripts/firefox-bidi-check.ts  # which Firefox launches here
```

Firefox note: `pnpm test` uses the system Firefox at
`/Applications/Firefox.app` over WebDriver BiDi. Playwright's own Firefox
build does not start on this machine (see Open issues). To use the
Playwright build, run `PW_FIREFOX_CHANNEL=bundled pnpm test`.

## How it works

```
page (strict CSP)                        guest worker (its own CSP)
-----------------                        --------------------------
main.js
  fetch /components/guest.wasm
  fetch jco's 2 core .wasm files
  new Worker('/guest-worker.js')  ---->  import /vendor/jco-transpile/...js
  postMessage load (transfer)     ---->  jco generate(guest.wasm)
                                         import(blob: glue)
                                         instantiate(getCoreModule, {log})
                                  <----  ready
  postMessage call "a b c"        ---->  run("a b c")
                                  <----  log "guest: run called"
                                  <----  result "3"
                                  <----  probe-results
```

- `src/server.ts` is the Hono server. It sets headers the way
  `charlie.dev/render/site/src/app.ts` does. `/` gets the page CSP, copied
  verbatim. `/guest-worker.js` gets the worker CSP. Every response gets
  `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: strict-origin-when-cross-origin`.
- `public/index.html` has one external module script and no inline script.
- `public/main.js` runs the page probes, then loads the worker.
- `public/guest-worker.js` runs jco, the glue and the worker probes.
- `tests/headers.spec.ts` checks the headers over HTTP.
- `tests/probes.spec.ts` checks every probe in each browser.
- `tests/table-reporter.ts` prints the tables below.

### The guest component

`components/guest.wasm` is 1,467 bytes. Its WIT is embedded in it.

```wit
package washe:poc;
interface host { log: func(msg: string); }
world guest {
  import host;
  export run: func(input: string) -> string;
}
```

`run` counts words: `"a b c"` gives `"3"`. Each call first calls the host's
`log` import. The worker supplies `log` as a function that `postMessage`s to
the page. So the host decides what each import does.

Build route: this machine has no `wasm32-wasip2` Rust target, no
`cargo component` and no `wasm-tools` binary. So the core module is
written by hand in WAT (`guest/guest.wat`), following the canonical ABI.
`scripts/build-component.mjs` turns it into a component with the
wasm-tools build that ships inside `@bytecodealliance/jco-transpile`
(`parse`, `componentEmbed`, `componentNew`). The build is reproducible: two
runs gave the same sha256,
`e47d67624c48e9655ece855945b27f8a2adce1dbb72a2fd3bf716bc269cdef80`. The
guest has no WASI imports, so the generated glue needs no preview2-shim.

## Policies

Page CSP, copied verbatim from `render/site/src/app.ts` lines 119-131:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Worker CSP, on `/guest-worker.js` only:

```
default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; connect-src 'none'
```

### Directives widened

None. The worker CSP is exactly the target.

jco did need two things that the target CSP does not give it. Both were
solved without changing the CSP:

1. **jco's bindgen fetches its own core wasm.** The vendored
   `js-component-bindgen-component.js` runs
   `fetch(new URL('./…core.wasm', import.meta.url))` when it is imported.
   `connect-src 'none'` blocks that. Instead, the page fetches the two
   files (the page may: `connect-src 'self'`) and transfers the
   ArrayBuffers to the worker. Before the import, the worker replaces
   `self.fetch` with a shim that answers only those two URLs from memory.
   After `$init` it puts the real `fetch` back. The probes use the real
   `fetch`.
2. **Bare specifiers.** The bindgen glue imports
   `@bytecodealliance/preview2-shim/{cli,filesystem,io,random}`. Module
   workers have no import maps. So the server rewrites those four
   specifiers to `/vendor/preview2-shim/<name>.js` when it serves that one
   file. Nothing else in the file changes.

## Results per browser

`pnpm test` output, 2026-10-21. 7 tests passed: 4 HTTP checks and 1 probe
test per browser.

| probe | chromium 156.0.8078.4 | firefox 158.0.1 | webkit 27.2 |
|---|---|---|---|
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
| info: worker can make its own OffscreenCanvas | yes | yes | yes |
| info: worker has BroadcastChannel / indexedDB | yes | yes | yes |

A refusal passes only if it fails in the code AND a matching
`securitypolicyviolation` event fires (except `importScripts` and
`new Function` in the worker, which only need to fail).

What each browser did:

- **WebSocket.** Chromium fires an `error` event. Firefox throws
  `NS_ERROR_CONTENT_BLOCKED` from the constructor. WebKit throws
  `SecurityError` from the constructor. All three fire a `connect-src`
  violation with the worker policy.
- **importScripts.** All three throw a `TypeError` because module workers
  do not allow `importScripts` at all. This is not a CSP check. The CSP
  result for cross-origin script is the `import()` row.
- **XFAIL, WebKit 27.2.** `new Function` in the worker throws an
  `EvalError`, and the message quotes the worker's `script-src`. So the
  worker policy is enforced. But WebKit fires no `securitypolicyviolation`
  event for it. The test asserts what WebKit does now, so if WebKit
  changes, the row shows XPASS and the test fails until someone updates
  `EXPECTED_FAILURES` in `tests/probes.spec.ts`.

## Measured numbers

Sizes, in bytes:

| item | bytes |
|---|---|
| jco bindgen JS (`js-component-bindgen-component.js`) | 478,146 |
| jco bindgen core wasm (`.core.wasm`) | 3,538,381 |
| jco bindgen core wasm (`.core2.wasm`) | 14,120 |
| guest component (`components/guest.wasm`) | 1,467 |
| generated guest glue JS (`guest.js`) | 130,809 |
| generated guest core wasm (core, core2, core3) | 609, 109, 107 |

Timings, in ms, from one cold `pnpm test` run (localhost, no cache). The
numbers change by about 10-20% from run to run. Firefox rounds
`performance.now()` to 1 ms.

| metric | chromium | firefox | webkit |
|---|---|---|---|
| `generate` in the worker | 42 | 7 | 28 |
| bindgen `$init` (import + compile 3.5 MB wasm) | 37 | 103 | 50 |
| `instantiate` the guest | 0.7 | 1 | 1 |
| worker created -> first `result` | 96 | 133 | 94 |
| navigation start -> first `result` (cold start) | 228 | 417 | 261 |

## Open issues

- **Playwright's Firefox does not start here.** On this macOS 27 machine,
  Playwright's Firefox build (`firefox-1555`, Firefox 157) exits at once
  with "Could not find profile folder", inside or outside the tool
  sandbox. `scripts/firefox-bidi-check.ts bundled` shows it. The suite uses
  the system Firefox 158.0.1 over WebDriver BiDi (`channel: 'moz-firefox'`)
  instead. So the Firefox result depends on the Firefox installed on the
  machine.
- **Same-origin channels.** `BroadcastChannel`, `indexedDB` and
  `OffscreenCanvas` are open to the worker. CSP cannot close them. If the
  guest must not reach other same-origin contexts, the host would need to
  delete these globals before it imports the glue, or run the worker on a
  separate origin.
- **The fetch shim is a patch on jco.** It depends on jco's bindgen
  calling `fetch` with those two exact URLs. A newer jco could change
  that. A cleaner fix would be for jco to accept the core modules as an
  argument, as instantiation mode already does for the generated glue.
- **Glue size.** The glue for a 1,467-byte guest is 130,809 bytes, about
  90 times larger. This POC does not try to shrink it.
- **One run, one machine.** The timings are from one cold run each. They
  are not a benchmark.
- **Layout.** The README of this repo says projects live at
  `stage/<N>/<project>/`. The one older project, c2pa-trust, sits at
  `hack/c2pa-trust/`. This project follows the README.
