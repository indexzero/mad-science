// Guest worker. It runs under its OWN CSP, sent on this file's response:
//   default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; connect-src 'none'
// It transpiles the guest component with jco, imports the generated glue
// from a blob: URL, runs it, then probes what this agent can and cannot do.

// Record every CSP violation in this agent. originalPolicy tells us which
// policy (the worker's or the page's) the browser applied.
const violations = [];
self.addEventListener('securitypolicyviolation', (e) => {
  violations.push({
    violatedDirective: e.violatedDirective,
    effectiveDirective: e.effectiveDirective,
    blockedURI: e.blockedURI,
    originalPolicy: e.originalPolicy,
    disposition: e.disposition
  });
});

const realFetch = self.fetch.bind(self);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errorOf = (err) => (err ? `${err.name}: ${err.message}` : String(err));

let instance = null;
let loadMessage = null;
const facts = { glueBlobImport: null, generateMs: null };

/**
 * jco's bindgen glue loads its own two core wasm files with
 * fetch(new URL('./x.core.wasm', import.meta.url)). connect-src 'none'
 * blocks that. Instead of widening connect-src, the page fetches those
 * bytes and transfers them here, and this shim answers exactly those two
 * URLs from memory. Every other URL goes to the real fetch, which the CSP
 * refuses.
 */
function installBindgenFetchShim(bindgenCores) {
  const base = new URL('/vendor/jco-transpile/', self.location.href);
  const byUrl = new Map(
    Object.entries(bindgenCores).map(([name, buf]) => [new URL(name, base).href, buf])
  );
  self.fetch = (input, init) => {
    const href = input instanceof Request ? input.url : String(input);
    const buf = byUrl.get(href);
    if (buf) {
      return Promise.resolve(
        new Response(buf, { headers: { 'Content-Type': 'application/wasm' } })
      );
    }
    return realFetch(input, init);
  };
}

async function load({ component, bindgenCores }) {
  installBindgenFetchShim(bindgenCores);

  const t0 = performance.now();
  const jco = await import('/vendor/jco-transpile/js-component-bindgen-component.js');
  await jco.$init;
  const bindgenInitMs = performance.now() - t0;
  self.fetch = realFetch; // the shim is only for jco's own init.

  const t1 = performance.now();
  const output = jco.generate(new Uint8Array(component), {
    name: 'guest',
    noTypescript: true,
    noNodejsCompat: true,
    instantiation: { tag: 'async' },
    base64Cutoff: 0,
    map: []
  });
  const generateMs = performance.now() - t1;
  facts.generateMs = generateMs;

  const glue = output.files.find(([name]) => name === 'guest.js')?.[1];
  if (!glue) throw new Error(`no guest.js in ${output.files.map(([n]) => n)}`);
  const coreModules = new Map(output.files.filter(([name]) => name.endsWith('.wasm')));

  // The generated glue runs from a blob: URL. The page CSP would refuse this.
  const url = URL.createObjectURL(new Blob([glue], { type: 'text/javascript' }));
  let mod;
  try {
    mod = await import(url);
    facts.glueBlobImport = { ok: true };
  } catch (err) {
    facts.glueBlobImport = { ok: false, error: errorOf(err) };
    throw err;
  } finally {
    URL.revokeObjectURL(url);
  }

  const t2 = performance.now();
  instance = await mod.instantiate(
    (name) => {
      const bytes = coreModules.get(name);
      if (!bytes) throw new Error(`unknown core module ${name}`);
      return WebAssembly.compile(bytes);
    },
    {
      // The one import the host supplies. It crosses back to the page.
      'washe:poc/host': { log: (msg) => self.postMessage({ type: 'log', msg }) }
    }
  );
  const instantiateMs = performance.now() - t2;

  self.postMessage({
    type: 'ready',
    exports: Object.keys(instance),
    timings: { bindgenInitMs, generateMs, instantiateMs },
    sizes: {
      glueJs: glue.byteLength,
      coreModules: Object.fromEntries([...coreModules].map(([n, b]) => [n, b.byteLength]))
    }
  });
}

/** Try `fn`; report whether it threw synchronously or rejected. */
async function attempt(fn) {
  try {
    const value = await fn();
    return { refused: false, value: String(value) };
  } catch (err) {
    return { refused: true, error: errorOf(err) };
  }
}

function webSocketProbe(url) {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      resolve({ refused: true, how: 'constructor threw', error: errorOf(err) });
      return;
    }
    const done = (how) => resolve({ refused: how !== 'open', how });
    ws.onopen = () => {
      done('open');
      ws.close();
    };
    ws.onerror = () => done('error event');
    setTimeout(() => done('timeout'), 3000);
  });
}

async function probes() {
  const p = {};
  p.glueBlobImport = facts.glueBlobImport;
  p.generateMs = facts.generateMs;
  p.typeofDocument = typeof document;
  p.typeofWindow = typeof window;
  p.offscreenCanvasAvailable = typeof OffscreenCanvas !== 'undefined';
  p.offscreenCanvasReceived =
    typeof OffscreenCanvas !== 'undefined' &&
    Object.values(loadMessage ?? {}).some((v) => v instanceof OffscreenCanvas);

  p.fetchSelf = await attempt(() => realFetch('/').then((r) => r.status));
  p.fetchCrossOrigin = await attempt(() =>
    realFetch('https://example.com/').then((r) => r.status)
  );
  p.webSocket = await webSocketProbe(`ws://${self.location.host}/ws`);
  p.importScripts = await attempt(() => {
    importScripts('https://example.com/x.js');
    return 'loaded';
  });
  p.importCrossOrigin = await attempt(() =>
    import('https://example.com/x.js').then(() => 'loaded')
  );
  p.newFunction = await attempt(() => new Function('return 1')());

  // Not CSP. These show what else a worker can reach without any network.
  p.selfMadeOffscreenCanvas = await attempt(() => {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    return ctx ? 'got a 2d context' : 'no context';
  });
  p.typeofBroadcastChannel = typeof BroadcastChannel;
  p.typeofIndexedDB = typeof indexedDB;

  await sleep(200); // let queued violation events arrive
  p.violations = violations.slice();
  return p;
}

self.addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'load') {
      loadMessage = data;
      await load(data);
    } else if (data.type === 'call') {
      const output = instance.run(data.input);
      self.postMessage({ type: 'result', input: data.input, output });
      self.postMessage({ type: 'probe-results', probes: await probes() });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: `${data.type}: ${err?.stack ?? err}` });
  }
});
