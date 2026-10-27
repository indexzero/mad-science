#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { openChain } from './chain-crypto.js';
import { openArchive } from './archive.js';
import { createTransport } from './transport.js';
import { pull } from './pull.js';
import { tokenMtime } from './proto.js';
import { latestTabs, renderTabs } from './tabs-view.js';

const DEV_SERVER = 'http://localhost:8295/v2';
const PRODUCTION = 'https://sync-v2.brave.com/v2';

const USAGE = `usage: brave-sync <pull|watch|status|tabs> [options]
  --archive DIR     archive directory (default: archive)
  --server URL      sync server (default: ${DEV_SERVER})
  --production      use ${PRODUCTION}
  --interval SECS   watch: seconds between pulls (default: 300)
  --reset           pull: forget progress markers and re-read everything
tabs prints the newest snapshot of each tab in tabs.jsonl, by device.
The sync code is read from the file named by BRAVE_SYNC_CODE_FILE.`;

function die(message) {
  console.error(`brave-sync: ${message}`);
  process.exit(1);
}

function serverUrl({ server, production }) {
  if (production) return PRODUCTION;
  if (new URL(server).hostname.endsWith('brave.com')) die('a brave.com server needs --production');
  return server;
}

async function readSyncCode() {
  const path = process.env.BRAVE_SYNC_CODE_FILE;
  if (!path) die('set BRAVE_SYNC_CODE_FILE to the file that holds the sync code');
  return (await readFile(path, 'utf8')).trim();
}

async function connect(options, archive, state) {
  const server = serverUrl(options);
  const chain = await openChain(await readSyncCode());
  await archive.saveState(state);
  const post = createTransport({ server, chain, cacheGuid: state.cacheGuid });
  return { chain, post };
}

const commands = {
  async pull(options, archive, state) {
    if (options.reset) Object.assign(state, { markers: {}, storeBirthday: null });
    const { chain, post } = await connect(options, archive, state);
    const { records } = await pull({ chain, post, archive, state });
    console.log(`archived ${records} records in ${archive.dir}`);
  },

  async watch(options, archive, state) {
    const { chain, post } = await connect(options, archive, state);
    const interval = Number(options.interval);
    for (;;) {
      try {
        const { records, pollIntervalSeconds } = await pull({ chain, post, archive, state });
        console.log(`${new Date().toISOString()} archived ${records} records`);
        await sleep(1000 * Math.max(interval, pollIntervalSeconds ?? 0));
      } catch (error) {
        if (!error.retryable) throw error;
        console.error(`${new Date().toISOString()} ${error.message}; retrying`);
        await sleep(1000 * interval);
      }
    }
  },

  async status(options, archive, state) {
    console.log(`archive ${archive.dir}`);
    console.log(`store birthday ${state.storeBirthday ?? '(none yet)'}`);
    for (const [type, token] of Object.entries(state.markers)) {
      const mtime = tokenMtime(token);
      console.log(`type ${type}: through ${new Date(Number(mtime)).toISOString()} (mtime ${mtime})`);
    }
    console.log(`devices ${Object.values(state.index.devices).map((d) => d.name).join(', ') || '(none yet)'}`);
  },

  async tabs(options, archive) {
    console.log(renderTabs(await latestTabs(archive.records('tab'))));
  },
};

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    archive: { type: 'string', default: 'archive' },
    server: { type: 'string', default: DEV_SERVER },
    production: { type: 'boolean', default: false },
    interval: { type: 'string', default: '300' },
    reset: { type: 'boolean', default: false },
  },
});

const command = commands[positionals[0]];
if (!command) die(USAGE);
const archive = await openArchive(options.archive);
const state = await archive.loadState();
await command(options, archive, state).catch((error) => die(error.message));
