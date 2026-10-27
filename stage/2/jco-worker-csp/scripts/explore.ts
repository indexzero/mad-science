// Exploratory run: load the page in each browser, sort every CSP refusal
// into expected (a probe meant to be refused) or unexpected, and tag each
// console line with the probe that caused it.
//   node scripts/explore.ts [--json] [chromium|firefox|webkit ...]
// --json also prints the raw window.__poc report, which is what the tests read.
// Exits 1 if any browser shows an unexpected refusal, an unexpected console
// error, or an expected refusal that did not happen.
// Firefox runs as the system Firefox over WebDriver BiDi (channel
// moz-firefox) unless PW_FIREFOX_CHANNEL=bundled. See README "Open issues".
import { chromium, firefox, webkit, type BrowserType } from '@playwright/test';
import { start } from '../src/server.ts';

const all: Record<string, [BrowserType, object]> = {
  chromium: [chromium, {}],
  firefox: [
    firefox,
    process.env.PW_FIREFOX_CHANNEL === 'bundled' ? {} : { channel: 'moz-firefox' }
  ],
  webkit: [webkit, {}]
};
const args = process.argv.slice(2);
const showJson = args.includes('--json');
const picked = args.filter((a) => !a.startsWith('--'));
const names = picked.length ? picked : Object.keys(all);

type Scope = 'page' | 'worker';
interface Violation {
  effectiveDirective: string;
  blockedURI: string;
  originalPolicy: string;
}
interface Expected {
  probe: string;
  scope: Scope;
  directive: string;
  /** Matches the event's blockedURI. `origin` is the server's origin. */
  uri: (blockedURI: string, origin: string) => boolean;
  /** Which report array the event lands in. */
  source: (report: any) => Violation[];
  /** Browsers that block the action but fire no event, with the reason. */
  noEvent?: Record<string, string>;
}

// Every refusal the probes are built to cause. One row per probe.
const EXPECTED: Expected[] = [
  {
    probe: 'page.blobImport',
    scope: 'page',
    directive: 'script-src-elem',
    uri: (u) => u === 'blob' || u.startsWith('blob:'),
    source: (r) => r?.page?.violations ?? []
  },
  {
    probe: 'page.newFunction',
    scope: 'page',
    directive: 'script-src',
    uri: (u) => u === 'eval',
    source: (r) => r?.page?.violations ?? []
  },
  {
    probe: 'glue.onPage',
    scope: 'page',
    directive: 'script-src-elem',
    uri: (u) => u === 'blob' || u.startsWith('blob:'),
    source: (r) => r?.glue?.onPage?.violations ?? []
  },
  {
    probe: 'worker.fetchSelf',
    scope: 'worker',
    directive: 'connect-src',
    uri: (u, origin) => u === `${origin}/`,
    source: (r) => r?.worker?.violations ?? []
  },
  {
    probe: 'worker.fetchCrossOrigin',
    scope: 'worker',
    directive: 'connect-src',
    uri: (u) => u === 'https://example.com/',
    source: (r) => r?.worker?.violations ?? []
  },
  {
    probe: 'worker.webSocket',
    scope: 'worker',
    directive: 'connect-src',
    uri: (u) => u.startsWith('ws://') && u.endsWith('/ws'),
    source: (r) => r?.worker?.violations ?? []
  },
  {
    probe: 'worker.importCrossOrigin',
    scope: 'worker',
    directive: 'script-src-elem',
    uri: (u) => u === 'https://example.com/x.js',
    source: (r) => r?.worker?.violations ?? []
  },
  {
    probe: 'worker.newFunction',
    scope: 'worker',
    directive: 'script-src',
    uri: (u) => u === 'eval',
    source: (r) => r?.worker?.violations ?? [],
    noEvent: { webkit: 'WebKit blocks eval in the worker but fires no event (README "Known gaps")' }
  }
];

const CSP_LINE = /Content Security Policy|violates the following directive|blocked a (script|JavaScript eval)/i;

/** Name the probe behind one console line, or null if no probe explains it. */
function probeForLine(line: string, report: any, origin: string): string | null {
  const blob = line.match(/blob:[^\s'"”]+/)?.[0];
  if (blob) {
    if (blob === report?.page?.blobImport?.url) return 'page.blobImport';
    if (blob === report?.glue?.onPage?.url) return 'glue.onPage';
    return null;
  }
  if (/eval/i.test(line)) {
    // The quoted policy says which scope logged it: only the worker's has blob:.
    return /script-src 'self' blob:/.test(line) ? 'worker.newFunction' : 'page.newFunction';
  }
  if (line.includes('https://example.com/x.js')) return 'worker.importCrossOrigin';
  if (line.includes('https://example.com/')) return 'worker.fetchCrossOrigin';
  if (/ws:\/\/\S+\/ws/.test(line)) return 'worker.webSocket';
  if (line.includes(`${origin}/`)) return 'worker.fetchSelf';
  return null;
}

function short(s: string, n = 150): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

let failed = false;
const { server, url } = await start(0);
const origin = new URL(url).origin;
try {
  for (const name of names) {
    const [type, options] = all[name];
    const browser = await type.launch(options);
    const page = await browser.newPage();
    const consoleLines: { type: string; text: string }[] = [];
    page.on('console', (m) => consoleLines.push({ type: m.type(), text: m.text() }));
    page.on('pageerror', (e) => consoleLines.push({ type: 'pageerror', text: e.message }));
    await page.goto(url);
    const done = await page
      .waitForFunction(() => (window as any).__pocDone === true, null, { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    const report = await page.evaluate(() => (window as any).__poc);
    await browser.close();

    console.log(`\n===== ${name} ${browser.version()}`);
    if (showJson) console.log(JSON.stringify(report, null, 2));
    const problems: string[] = [];
    if (!done) problems.push('TIMEOUT waiting for __pocDone');
    if (!report) problems.push('no window.__poc report');
    for (const err of report?.errors ?? []) problems.push(`page reported an error: ${short(String(err?.message ?? err), 120)}`);
    for (const [label, part] of [['page', report?.page], ['glue.onPage', report?.glue?.onPage], ['worker', report?.worker]] as const) {
      if (!part) problems.push(`the ${label} section of __poc is missing (that stage never ran)`);
    }

    // 1. Violation events: claim each one for exactly one expected probe.
    const policyOf: Record<Scope, string> = { page: report?.csp?.page ?? '', worker: report?.csp?.worker ?? '' };
    const claimed = new Set<Violation>();
    console.log('\nExpected refusals (event · which policy · console line):');
    for (const e of EXPECTED) {
      const event = e
        .source(report)
        .find((v) => !claimed.has(v) && v.effectiveDirective === e.directive && e.uri(v.blockedURI, origin));
      const known = e.noEvent?.[name];
      let eventCell: string;
      if (event) {
        claimed.add(event);
        const right = event.originalPolicy.trim() === policyOf[e.scope].trim();
        eventCell = right ? `event ✓ · ${e.scope} policy ✓` : `event ✓ · WRONG POLICY`;
        if (!right) problems.push(`${e.probe}: refused by a policy other than the ${e.scope}'s: ${short(event.originalPolicy, 90)}`);
      } else if (known) {
        eventCell = 'no event (known)';
      } else {
        eventCell = 'NO EVENT';
        problems.push(`${e.probe}: expected a ${e.directive} refusal, saw no event`);
      }
      const lines = consoleLines.filter((l) => probeForLine(l.text, report, origin) === e.probe).length;
      console.log(`  [${e.probe}]`.padEnd(28) + `${e.scope.padEnd(7)}${e.directive.padEnd(16)}${eventCell.padEnd(28)}console ${lines}`);
      if (!event && known) console.log(`${' '.repeat(28)}${known}`);
    }

    // 2. Any event no probe claimed is a refusal nobody planned.
    const strays = [
      ...(report?.page?.violations ?? []).map((v: Violation) => ['page', v] as const),
      ...(report?.glue?.onPage?.violations ?? []).map((v: Violation) => ['page', v] as const),
      ...(report?.worker?.violations ?? []).map((v: Violation) => ['worker', v] as const)
    ].filter(([, v]) => !claimed.has(v));
    for (const [scope, v] of strays) {
      problems.push(`unexpected ${scope} refusal: ${v.effectiveDirective} ${v.blockedURI}`);
    }

    // 3. Console lines, each tagged with its probe.
    console.log('\nConsole:');
    if (!consoleLines.length) console.log('  (none)');
    for (const l of consoleLines) {
      const csp = CSP_LINE.test(l.text);
      const probe = csp ? probeForLine(l.text, report, origin) : null;
      const isError = l.type === 'error' || l.type === 'pageerror';
      let tag: string;
      if (probe) tag = `[${probe}]`;
      else if (csp) {
        tag = '[UNEXPECTED CSP]';
        problems.push(`unexpected CSP console line: ${short(l.text, 120)}`);
      } else if (isError) {
        tag = '[UNEXPECTED ERROR]';
        problems.push(`unexpected console error: ${short(l.text, 120)}`);
      } else tag = '[other]';
      console.log(`  ${tag.padEnd(28)}${l.type}: ${short(l.text)}`);
    }

    console.log(`\nUnexpected (${problems.length}):`);
    if (!problems.length) console.log('  none');
    for (const p of problems) console.log(`  ✗ ${p}`);
    if (problems.length) failed = true;
  }
} finally {
  server.close();
}
process.exitCode = failed ? 1 : 0;
