// The loader. Runs on the page, under the page CSP. It fetches guest.wasm,
// starts the worker, and renders four pages. Everything it measures goes into
// window.__poc, which the Playwright tests read.
const INPUT = 'a b c';
const BINDGEN_CORES = [
  'js-component-bindgen-component.core.wasm',
  'js-component-bindgen-component.core2.wasm'
];
const PRISM_VERSION = '1.30.0'; // public/vendor/prism, from the prismjs npm package
const PRISM_FILES = ['prism-core.min.js', 'prism-clike.min.js', 'prism-javascript.min.js'];

const report = {
  page: {},
  component: {},
  glue: {},
  csp: {},
  worker: null,
  logs: [],
  result: null,
  live: null,
  pong: null,
  ready: null,
  nav: { page: 1 },
  errors: [],
  timings: { mainStart: performance.now() },
  sizes: {}
};
window.__poc = report;

const pageViolations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  pageViolations.push({
    violatedDirective: e.violatedDirective,
    effectiveDirective: e.effectiveDirective,
    blockedURI: e.blockedURI,
    originalPolicy: e.originalPolicy,
    disposition: e.disposition
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errorOf = (err) => (err ? `${err.name}: ${err.message}` : String(err));
const $ = (id) => document.getElementById(id);
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en') : '-');
const ms = (n) => (n == null ? '-' : `${Math.round(n * 10) / 10} ms`);

// ---- DOM helpers (textContent only, except Prism's escaped output) ----

function el(tag, cls, ...kids) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const k of kids) node.append(k);
  return node;
}
/** [ TEXT ], green when the outcome is the expected one. */
function stamp(text, good) {
  return el('span', `stamp ${good ? 'ok' : 'bad'}`, `[ ${text} ]`);
}
const refusedStamp = (refused) => stamp(refused ? 'REFUSED' : 'RAN', refused);
function put(id, ...kids) {
  $(id).replaceChildren(...kids);
}
function flash(node) {
  node.classList.remove('flash');
  void node.offsetWidth;
  node.classList.add('flash');
}
function eventText(v) {
  if (!v) return 'no securitypolicyviolation event';
  return `securitypolicyviolation { effectiveDirective: ${v.effectiveDirective}, blockedURI: ${v.blockedURI}, disposition: ${v.disposition} }`;
}
/** Highlight JS with the vendored Prism. Prism escapes the source itself. */
function showCode(id, source) {
  const node = $(id);
  if (window.Prism?.languages?.javascript) {
    node.innerHTML = window.Prism.highlight(source, window.Prism.languages.javascript, 'javascript');
    report.prismHighlighted = (report.prismHighlighted ?? 0) + 1;
  } else {
    node.textContent = source;
  }
}
/** The text between `// <excerpt:name>` and `// </excerpt:name>`, dedented. */
function excerptOf(source, name) {
  const start = source.indexOf(`// <excerpt:${name}>`);
  const end = source.indexOf(`// </excerpt:${name}>`);
  if (start === -1 || end === -1) return `(excerpt ${name} not found)`;
  const lines = source.slice(source.indexOf('\n', start) + 1, end).split('\n');
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function head(path) {
  const res = await fetch(path, { method: 'HEAD', cache: 'no-store' });
  return res.headers;
}

// <excerpt:import-on-page>
/** Import JS from a blob: URL on the page. The page CSP has no blob: in script-src. */
async function importOnPage(source) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const m = await import(url);
    return { url, refused: false, value: String(m.default ?? Object.keys(m)) };
  } catch (err) {
    return { url, refused: true, error: errorOf(err) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
// </excerpt:import-on-page>

// ---- pages and the diagram ----

const LEDGER = [
  ['fetchSelf', "fetch('/')", 'fetch', (v) => v.effectiveDirective === 'connect-src' && v.blockedURI.startsWith(location.origin)],
  ['fetchCrossOrigin', "fetch('https://example.com/')", 'fetch', (v) => v.effectiveDirective === 'connect-src' && v.blockedURI.startsWith('https://example.com')],
  ['webSocket', `new WebSocket('ws://${location.host}/ws')`, 'WebSocket', (v) => v.effectiveDirective === 'connect-src' && v.blockedURI.startsWith('ws')],
  ['importCrossOrigin', "import('https://example.com/x.js')", 'import()', (v) => v.effectiveDirective === 'script-src-elem' && v.blockedURI.startsWith('https://example.com')],
  ['importScripts', "importScripts('https://example.com/x.js')", 'importScripts', null],
  ['newFunction', "new Function('return 1')", 'eval', (v) => v.effectiveDirective === 'script-src' && v.blockedURI === 'eval']
];

/**
 * What the diagram highlights on each page. hl and refused list data-node
 * and data-edge names; note is the fourth diagram line.
 */
const DIAGRAM = {
  1: { hl: ['guest', 'glue'], refused: [], note: () => [['guest.wasm ─(jco generate)─► glue', 'hl']] },
  2: { hl: [], refused: ['page-in', 'glue'], note: () => [['page ✗ glue: import(blob:) refused', 'refused']] },
  3: {
    hl: ['loader', 'loader-worker', 'worker', 'worker-glue', 'glue', 'glue-guest', 'guest', 'guest-log', 'log'],
    refused: [],
    note: () => [['worker CSP: script-src blob: \'wasm-unsafe-eval\'', 'hl']]
  },
  4: {
    hl: ['postMessage', 'postmessage-page', 'page-out'],
    refused: [],
    note: () => {
      const p = report.worker;
      const seen = new Set();
      const parts = [['worker ', '']];
      for (const [key, , short] of LEDGER) {
        if (seen.has(short) || short === 'importScripts') continue; // not a CSP check
        seen.add(short);
        const refused = p ? p[key]?.refused === true : null;
        parts.push([`${refused === false ? '✓' : '✗'} ${short}`, refused === false ? 'hl' : 'refused']);
        parts.push([' ', '']);
      }
      return parts;
    }
  }
};

function renderDiagram(n) {
  const { hl, refused, note } = DIAGRAM[n];
  for (const node of document.querySelectorAll('#diagram [data-node], #diagram [data-edge]')) {
    const name = node.dataset.node ?? node.dataset.edge;
    node.classList.toggle('hl', hl.includes(name));
    node.classList.toggle('refused', refused.includes(name));
  }
  put('diagram-note', ...note().map(([text, cls]) => (cls ? el('span', cls, text) : text)));
}

function setPage(n) {
  n = Math.max(1, Math.min(4, n));
  report.nav.page = n;
  for (const section of document.querySelectorAll('.page')) {
    section.hidden = Number(section.dataset.page) !== n;
  }
  const title = document.querySelector(`.page[data-page="${n}"]`).dataset.title;
  $('page-no').textContent = `${n}/4`;
  $('page-no-nav').textContent = `${n}/4`;
  $('page-title').textContent = title;
  document.title = `jco-worker-csp ${n}/4 ${title}`;
  $('prev').disabled = n === 1;
  $('next').disabled = n === 4;
  renderDiagram(n);
}

$('prev').addEventListener('click', () => setPage(report.nav.page - 1));
$('next').addEventListener('click', () => setPage(report.nav.page + 1));
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return; // keep the caret keys
  if (e.key === 'ArrowLeft') setPage(report.nav.page - 1);
  else if (e.key === 'ArrowRight') setPage(report.nav.page + 1);
});

function togglePanel(buttonId, panelId) {
  const open = $(panelId).hidden;
  $(panelId).hidden = !open;
  $(buttonId).setAttribute('aria-expanded', String(open));
}
$('toggle-devtools').addEventListener('click', () => togglePanel('toggle-devtools', 'devtools'));
$('toggle-citations').addEventListener('click', () => togglePanel('toggle-citations', 'citations'));

setPage(1);

// ---- page 1: the component ----

function showMagic(bytes) {
  const b = [...new Uint8Array(bytes, 0, 8)].map((x) => x.toString(16).padStart(2, '0'));
  report.component.magic = b.join(' ');
  report.component.size = bytes.byteLength;
  $('c-size').textContent = `${fmt(bytes.byteLength)} bytes`;
  $('c-magic').textContent = `${b.slice(0, 4).join(' ')} · ${b.slice(4, 6).join(' ')} · ${b.slice(6, 8).join(' ')}`;
  const ok = report.component.magic === '00 61 73 6d 0d 00 01 00';
  put('c-magic-check', stamp(ok ? 'MATCHES' : 'DIFFERS', ok), ' magic 00 61 73 6D · version 0d 00 · layer 01 00 (Binary.md)');
}

/** Run jco's wasm-tools build on the page: WIT and WAT from the bytes alone. */
async function readComponent(bytes) {
  const t0 = performance.now();
  const wt = await import('/vendor/jco-transpile/wasm-tools.js');
  await wt.$init;
  report.timings.wasmToolsInit = performance.now() - t0;
  const t1 = performance.now();
  const wit = wt.tools.componentWit(bytes);
  report.timings.componentWit = performance.now() - t1;
  const wat = wt.tools.print(bytes);
  const lines = wat.split('\n');
  const importAt = lines.findIndex((l) => l.trim().startsWith('(import '));
  const picked = [
    ...lines.slice(0, importAt + 1),
    '  ...',
    ...lines.filter((l) => /canon (lift|lower)/.test(l)).map((l) => `  ${l.trim()}`)
  ];
  report.component.wit = wit.trim();
  report.component.printLines = picked;
  report.component.hasCanonLift = picked.some((l) => l.includes('canon lift'));
  report.component.hasCanonLower = picked.some((l) => l.includes('canon lower'));
  $('c-wit').textContent = report.component.wit;
  $('c-print').textContent = picked.join('\n');
}

function showGlue(glue, sha) {
  const text = new TextDecoder().decode(glue);
  const at = text.indexOf('export async function instantiate');
  const excerpt = text.slice(Math.max(0, at)).split('\n').slice(0, 14).join('\n');
  $('glue-size').textContent = `guest.js, ${fmt(glue.byteLength)} bytes, ${fmt(text.split('\n').length)} lines`;
  $('glue-sha').textContent = sha;
  $('p2-sha').textContent = sha;
  showCode('glue-excerpt', `${excerpt}\n// ... ${fmt(text.split('\n').length)} lines in all`);
  return text;
}

// ---- page 2: refused on the page ----

async function pageProbes() {
  report.page.blobImport = await importOnPage('export default 1');
  try {
    const value = new Function('return 1')();
    report.page.newFunction = { threw: false, value };
  } catch (err) {
    report.page.newFunction = { threw: true, error: errorOf(err) };
  }
  await sleep(100); // violation events are queued
  report.page.violations = pageViolations.slice();
  const blobEvent = pageViolations.find((v) => v.blockedURI.startsWith('blob'));
  const evalEvent = pageViolations.find((v) => v.blockedURI === 'eval');
  put(
    'page-controls',
    el('div', '', refusedStamp(report.page.blobImport.refused), " import(blob: 'export default 1')", el('span', 'event', eventText(blobEvent))),
    el('div', '', refusedStamp(report.page.newFunction.threw), " new Function('return 1')", el('span', 'event', eventText(evalEvent)))
  );
}

async function runGlueHere() {
  const before = pageViolations.length;
  const attempt = await importOnPage(report.glue.text);
  await sleep(100);
  const events = pageViolations.slice(before);
  report.glue.onPage = { ...attempt, violations: events };
  put(
    'run-here-out',
    refusedStamp(attempt.refused),
    ` ${attempt.error ?? attempt.value}`,
    el('span', 'event', eventText(events[0]))
  );
  flash($('run-here-out'));
}

// ---- page 3: run in the worker ----

function directives(policy) {
  return (policy ?? '').split(';').map((d) => d.trim()).filter(Boolean);
}
function showCspDiff(pageCsp, workerCsp) {
  const page = directives(pageCsp);
  const worker = directives(workerCsp);
  put(
    'csp-diff',
    el('span', 'dim', '- page CSP only   + worker CSP only\n'),
    ...page.filter((d) => !worker.includes(d)).map((d) => el('span', 'del', `- ${d}\n`)),
    ...worker.map((d) => (page.includes(d) ? `  ${d}\n` : el('span', 'add', `+ ${d}\n`)))
  );
}
function hostLogLine(text) {
  const box = $('host-log');
  const lines = (box.textContent ? box.textContent.split('\n') : []).slice(-3);
  lines.push(`worker: log(${JSON.stringify(text)}) -> postMessage`);
  box.textContent = lines.join('\n');
  flash(box);
}

// ---- page 4: what got out ----

function showLedger(p) {
  const workerCsp = report.csp.worker;
  put(
    'ledger',
    ...LEDGER.map(([key, label, , matches]) => {
      const r = p[key] ?? {};
      const v = matches && p.violations.find(matches);
      let why;
      if (v) why = `${eventText(v)}, originalPolicy ${v.originalPolicy === workerCsp ? '= worker CSP' : `= ${v.originalPolicy}`}`;
      else if (key === 'importScripts') why = `${r.error} (module workers have no importScripts; not a CSP check)`;
      else why = `no securitypolicyviolation event; ${r.error ?? r.how ?? '?'}`;
      return el('li', '', stamp(r.refused ? 'REFUSED' : 'GOT OUT', r.refused), ` ${label}`, el('span', 'why', why));
    })
  );
  $('gap-canvas').textContent = `new OffscreenCanvas(1, 1).getContext('2d') -> ${p.selfMadeOffscreenCanvas?.value ?? p.selfMadeOffscreenCanvas?.error}`;
  $('gap-storage').textContent = `typeof indexedDB = ${p.typeofIndexedDB}, typeof BroadcastChannel = ${p.typeofBroadcastChannel}`;
  if (report.nav.page === 4) renderDiagram(4);
}

function showDoor() {
  if (!report.result) return;
  put(
    'door',
    `worker -> postMessage({ type: 'result', input: ${JSON.stringify(report.result.input)}, output: `,
    el('span', 'ok', JSON.stringify(report.result.output)),
    ' }) -> page'
  );
  const logs = report.logs.length;
  $('door-note').textContent = `${fmt(logs)} log ${logs === 1 ? 'message' : 'messages'} and 1 result reached the page by postMessage. The 6 attempts in "escape attempts from the worker" reached nothing.`;
}

// ---- devtools: bundle stats ----

/**
 * Bytes served for a same-origin path. Resource Timing decodedBodySize first
 * (from this page, or from the worker's own timeline); a GET byte count when
 * that is 0 or missing. HEAD responses from the server carry no Content-Length.
 */
async function contentLength(path) {
  const href = new URL(path, location.href).href;
  const entry =
    performance.getEntriesByName(href)[0] ??
    (report.ready?.resources ?? []).find((r) => r.name === href);
  if (entry?.decodedBodySize > 0) return entry.decodedBodySize;
  const buf = await fetch(path).then((r) => r.arrayBuffer());
  return buf.byteLength;
}

async function showNumbers() {
  const r = report.ready;
  if (!r) return;
  const prism = await Promise.all(PRISM_FILES.map((f) => contentLength(`/vendor/prism/${f}`)));
  const wasmTools = await Promise.all(
    ['wasm-tools.js', 'wasm-tools.core.wasm', 'wasm-tools.core2.wasm'].map((f) => contentLength(`/vendor/jco-transpile/${f}`))
  );
  const bindgenJs = await contentLength('/vendor/jco-transpile/js-component-bindgen-component.js');
  report.sizes.prism = Object.fromEntries(PRISM_FILES.map((f, i) => [f, prism[i]]));
  report.sizes.prismTotal = prism.reduce((a, b) => a + b, 0);
  report.sizes.prismVersion = PRISM_VERSION;
  report.sizes.wasmTools = wasmTools;
  report.sizes.bindgenJs = bindgenJs;
  const t = report.timings;
  const lines = [
    `Prism ${PRISM_VERSION}             ${fmt(report.sizes.prismTotal)} B`,
    `  ${PRISM_FILES.map((f, i) => `${f.replace('prism-', '').replace('.min.js', '')} ${fmt(prism[i])}`).join(' + ')}`,
    `guest.wasm               ${fmt(report.sizes.guestComponent)} B`,
    `glue (guest.js)          ${fmt(r.sizes.glueJs)} B`,
    `glue core modules        ${Object.values(r.sizes.coreModules).map(fmt).join(' + ')} B`,
    `jco bindgen (worker)     js ${fmt(bindgenJs)} + core ${Object.values(report.sizes.bindgenCores).map(fmt).join(' + ')} B`,
    `jco wasm-tools (page)    js ${fmt(wasmTools[0])} + core ${fmt(wasmTools[1])} + ${fmt(wasmTools[2])} B`,
    '',
    `bindgen $init (worker)   ${ms(r.timings.bindgenInitMs)}`,
    `generate() (worker)      ${ms(r.timings.generateMs)}`,
    `instantiate() (worker)   ${ms(r.timings.instantiateMs)}`,
    `wasm-tools $init (page)  ${ms(t.wasmToolsInit)}`,
    `componentWit() (page)    ${ms(t.componentWit)}`,
    `navigation -> 1st result ${ms(t.firstResult)}`
  ];
  $('numbers').textContent = lines.join('\n');
}

// ---- the run ----

let worker;
let seq = 0;
function call(input) {
  seq += 1;
  worker.postMessage({ type: 'call', input, seq });
}

let probesDone;
const probesSeen = new Promise((r) => (probesDone = r));

async function main() {
  const [pageHeaders, workerHeaders, mainSrc, workerSrc] = await Promise.all([
    head('/'),
    head('/guest-worker.js'),
    fetch('/main.js').then((r) => r.text()),
    fetch('/guest-worker.js').then((r) => r.text())
  ]);
  report.csp.page = pageHeaders.get('content-security-policy');
  report.csp.worker = workerHeaders.get('content-security-policy');
  $('page-csp').textContent = directives(report.csp.page).join(';\n');
  showCspDiff(report.csp.page, report.csp.worker);
  showCode('src-import-on-page', excerptOf(mainSrc, 'import-on-page'));
  showCode('src-instantiate', `${excerptOf(workerSrc, 'host-log')}\n\n${excerptOf(workerSrc, 'instantiate')}`);

  await pageProbes();

  const t0 = performance.now();
  const [component, ...cores] = await Promise.all([
    fetch('/components/guest.wasm').then((r) => r.arrayBuffer()),
    ...BINDGEN_CORES.map((n) => fetch(`/vendor/jco-transpile/${n}`).then((r) => r.arrayBuffer()))
  ]);
  report.timings.pageFetch = performance.now() - t0;
  report.sizes.guestComponent = component.byteLength;
  report.sizes.bindgenCores = Object.fromEntries(BINDGEN_CORES.map((n, i) => [n, cores[i].byteLength]));
  showMagic(component);
  const componentCopy = new Uint8Array(component.slice(0)); // the original is transferred

  worker = new Worker('/guest-worker.js', { type: 'module' });
  const tWorker = performance.now();

  worker.addEventListener('error', (e) => {
    report.errors.push(`worker error event: ${e.message ?? 'no message'}`);
    probesDone();
  });

  worker.addEventListener('message', async ({ data }) => {
    switch (data.type) {
      case 'ready': {
        const { glue, ...rest } = data;
        report.ready = rest;
        report.timings.ready = performance.now();
        report.glue.pageSha256 = await sha256(glue);
        report.glue.workerSha256 = data.glueSha256;
        report.glue.text = showGlue(glue, report.glue.pageSha256);
        report.glue.bytes = glue.byteLength;

        await runGlueHere();
        $('run-here').disabled = false;

        const same = report.glue.pageSha256 === data.glueSha256;
        put(
          'turn-sha',
          stamp(same ? 'SAME BYTES' : 'DIFFERENT', same),
          ` sha256 on the page ${report.glue.pageSha256.slice(0, 16)}… = in the worker ${data.glueSha256.slice(0, 16)}…`
        );
        put(
          'turn-import',
          stamp('RAN', true),
          ` import(blob: glue) in the worker, then instantiate(getCoreModule, { 'washe:poc/host': { log } }). Exports: ${data.exports.join(', ')}`
        );
        $('ping-btn').disabled = false;
        call(INPUT);
        break;
      }
      case 'log':
        report.logs.push(data.msg);
        hostLogLine(data.msg);
        break;
      case 'result':
        if (!report.result) {
          report.result = { input: data.input, output: data.output };
          report.timings.firstResult = performance.now();
          report.timings.workerToFirstResult = report.timings.firstResult - tWorker;
          $('status').textContent = `1st result at ${ms(report.timings.firstResult)}`;
        }
        report.live = { input: data.input, output: data.output, seq: data.seq };
        if (data.seq === seq) $('live-out').textContent = `= ${JSON.stringify(data.output)}`;
        showDoor();
        break;
      case 'probe-results':
        report.worker = data.probes;
        showLedger(data.probes);
        showDoor();
        $('rerun').disabled = false;
        probesDone();
        break;
      case 'pong':
        report.pong = data;
        $('pong').textContent = data.refused
          ? `worker -> page: ${data.reply}`
          : [
              `page -> worker: { type: 'ping', msg: ${JSON.stringify(data.echo)} }`,
              `worker -> page: { type: 'pong', reply: 'pong', reversed: ${JSON.stringify(data.reversed)} }`,
              `(sent from ${data.from})`
            ].join('\n');
        flash($('pong'));
        $('ping-btn').textContent = 'one ping only';
        break;
      case 'error':
        report.errors.push(data.error);
        $('status').textContent = `error: ${data.error.split('\n')[0]}`;
        probesDone();
        break;
    }
  });

  // Transfer, not copy: the page keeps no reference to these buffers.
  const bindgenCores = Object.fromEntries(BINDGEN_CORES.map((n, i) => [n, cores[i]]));
  worker.postMessage({ type: 'load', component, bindgenCores }, [component, ...cores]);

  // jco's wasm-tools build runs on the page while the worker works.
  const witDone = readComponent(componentCopy).catch((err) => {
    report.errors.push(`componentWit: ${errorOf(err)}`);
  });

  await Promise.all([witDone, probesSeen]);
  await showNumbers();
  report.timings.done = performance.now();
  window.__pocDone = true;
}

// ---- controls ----

$('run-here').addEventListener('click', runGlueHere);
$('live').addEventListener('input', (e) => {
  if (worker && report.ready) call(e.target.value);
});
$('log-modes').addEventListener('change', (e) => {
  if (worker && e.target.name === 'log-mode') {
    worker.postMessage({ type: 'set-log-mode', mode: e.target.value });
    call($('live').value); // one call, so the new log mode shows
  }
});
$('rerun').addEventListener('click', () => {
  $('rerun').disabled = true;
  put('ledger', el('li', 'dim', '...'));
  worker.postMessage({ type: 'probe' });
});

/** One ping only. The button sends one; the worker refuses any second ping. */
function ping(msg) {
  worker.postMessage({ type: 'ping', msg });
}
$('ping-btn').addEventListener('click', () => {
  $('ping-btn').disabled = true;
  ping($('ping-in').value);
});
window.__pocPing = ping; // test hook: proves the worker refuses a second ping

main().catch((err) => {
  report.errors.push(`main: ${err?.stack ?? err}`);
  $('status').textContent = 'error: see window.__poc.errors';
  window.__pocDone = true;
});
