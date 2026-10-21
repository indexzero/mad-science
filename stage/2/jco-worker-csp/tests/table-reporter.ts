// Prints a per-browser table of probe results and the measured numbers.
import { statSync } from 'node:fs';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

type Report = {
  browser: string;
  rows: { probe: string; status: string; detail: string }[];
  numbers: Record<string, unknown>;
};

const BINDGEN_JS = 'node_modules/@bytecodealliance/jco-transpile/vendor/js-component-bindgen-component.js';

export default class TableReporter implements Reporter {
  private reports: Report[] = [];

  onTestEnd(_test: TestCase, result: TestResult) {
    for (const a of result.attachments) {
      if (a.name === 'probes' && a.body) this.reports.push(JSON.parse(a.body.toString()));
    }
  }

  onEnd(_result: FullResult) {
    if (!this.reports.length) return;
    const order = ['chromium', 'firefox', 'webkit'];
    const reports = this.reports.sort(
      (a, b) => order.indexOf(a.browser.split(' ')[0]) - order.indexOf(b.browser.split(' ')[0])
    );
    const probes = reports[0].rows.map((r) => r.probe);
    const header = ['probe', ...reports.map((r) => r.browser)];
    const body = probes.map((p) => [
      p,
      ...reports.map((r) => r.rows.find((x) => x.probe === p)?.status ?? '-')
    ]);
    const widths = header.map((_, i) => Math.max(...[header, ...body].map((row) => row[i].length)));
    const line = (row: string[]) => `| ${row.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;

    console.log('\nProbe results (PASS, FAIL, XFAIL = expected failure, XPASS, INFO)\n');
    console.log(line(header));
    console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
    for (const row of body) console.log(line(row));

    for (const r of reports) {
      const odd = r.rows.filter((x) => x.status !== 'PASS');
      if (odd.length) {
        console.log(`\n${r.browser}:`);
        for (const x of odd) console.log(`  ${x.status} ${x.probe}: ${x.detail}`);
      }
    }

    const keys = [
      'generateMs',
      'bindgenInitMs',
      'instantiateMs',
      'coldStartToFirstResultMs',
      'workerCreateToFirstResultMs'
    ];
    console.log('\nTimings (ms, one cold run each):\n');
    console.log(line(['metric', ...reports.map((r) => r.browser)].map(String)));
    for (const k of keys) {
      console.log(
        line([k, ...reports.map((r) => String(Math.round(Number(r.numbers[k]) * 10) / 10))])
      );
    }
    const n = reports[0].numbers as any;
    console.log('\nSizes (bytes):');
    console.log(`  jco bindgen JS          ${statSync(BINDGEN_JS).size}`);
    for (const [k, v] of Object.entries(n.bindgenCoreBytes ?? {})) console.log(`  ${k.padEnd(22)}  ${v}`);
    console.log(`  guest component         ${n.guestComponentBytes}`);
    console.log(`  generated guest glue JS ${n.glueJsBytes}`);
    console.log(`  generated guest cores   ${JSON.stringify(n.guestCoreBytes)}`);
  }
}
