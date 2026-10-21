// First-party loader. Runs on the main thread under the strict page CSP.
const INPUT = 'a b c';
const BINDGEN_CORES = [
  'js-component-bindgen-component.core.wasm',
  'js-component-bindgen-component.core2.wasm'
];

const report = {
  page: {},
  worker: null,
  logs: [],
  result: null,
  ready: null,
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
    disposition: e.disposition
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function errorOf(err) {
  return err ? `${err.name}: ${err.message}` : String(err);
}

/** Page negative controls. Both must be refused by the page CSP. */
async function pageProbes() {
  const blobUrl = URL.createObjectURL(
    new Blob(['export default 1'], { type: 'text/javascript' })
  );
  try {
    const m = await import(blobUrl);
    report.page.blobImport = { refused: false, value: m.default };
  } catch (err) {
    report.page.blobImport = { refused: true, error: errorOf(err) };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  try {
    const value = new Function('return 1')();
    report.page.newFunction = { threw: false, value };
  } catch (err) {
    report.page.newFunction = { threw: true, error: errorOf(err) };
  }

  // Violation events are queued; give them a moment to arrive.
  await sleep(100);
  report.page.violations = pageViolations.slice();
}

function render() {
  document.getElementById('out').textContent = JSON.stringify(report, null, 2);
}

function finish() {
  report.timings.done = performance.now();
  render();
  window.__pocDone = true;
}

async function main() {
  await pageProbes();

  const t0 = performance.now();
  const [component, ...cores] = await Promise.all([
    fetch('/components/guest.wasm').then((r) => r.arrayBuffer()),
    ...BINDGEN_CORES.map((n) =>
      fetch(`/vendor/jco-transpile/${n}`).then((r) => r.arrayBuffer())
    )
  ]);
  report.timings.pageFetch = performance.now() - t0;
  report.sizes.guestComponent = component.byteLength;
  report.sizes.bindgenCores = Object.fromEntries(
    BINDGEN_CORES.map((n, i) => [n, cores[i].byteLength])
  );

  const worker = new Worker('/guest-worker.js', { type: 'module' });
  const tWorker = performance.now();

  worker.addEventListener('error', (e) => {
    report.errors.push(`worker error event: ${e.message ?? 'no message'}`);
    finish();
  });

  worker.addEventListener('message', ({ data }) => {
    switch (data.type) {
      case 'ready':
        report.ready = data;
        report.timings.ready = performance.now();
        worker.postMessage({ type: 'call', input: INPUT });
        break;
      case 'log':
        report.logs.push(data.msg);
        break;
      case 'result':
        report.result = { input: data.input, output: data.output };
        report.timings.firstResult = performance.now();
        report.timings.workerToFirstResult = report.timings.firstResult - tWorker;
        break;
      case 'probe-results':
        report.worker = data.probes;
        finish();
        break;
      case 'error':
        report.errors.push(data.error);
        finish();
        break;
    }
  });

  // Transfer, not copy: the page keeps no reference to these buffers.
  const bindgenCores = Object.fromEntries(BINDGEN_CORES.map((n, i) => [n, cores[i]]));
  worker.postMessage({ type: 'load', component, bindgenCores }, [component, ...cores]);
}

main().catch((err) => {
  report.errors.push(`main: ${err?.stack ?? err}`);
  finish();
});
