import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const FILES = {
  'session-header': 'sessions.jsonl',
  'session-invalid': 'invalid.jsonl',
  tab: 'tabs.jsonl',
  visit: 'visits.jsonl',
  tombstone: 'tombstones.jsonl',
  nigori: 'nigori.jsonl',
};

export function freshState() {
  return {
    version: 1,
    cacheGuid: globalThis.crypto.randomUUID(),
    storeBirthday: null,
    markers: {},
    index: { devices: {}, cacheGuids: {}, sessionEntities: {} },
  };
}

async function writeDurably(path, text, flags) {
  const file = await open(path, flags);
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function openArchive(dir) {
  await mkdir(dir, { recursive: true });
  const statePath = join(dir, 'state.json');

  return {
    dir,

    async append(records, archivedAt) {
      const lines = {};
      for (const record of records) {
        const file = FILES[record.kind];
        lines[file] = (lines[file] ?? '') + JSON.stringify({ archivedAt, ...record }) + '\n';
      }
      for (const [file, text] of Object.entries(lines)) {
        await writeDurably(join(dir, file), text, 'a');
      }
    },

    async *records(kind) {
      const lines = createInterface({ input: createReadStream(join(dir, FILES[kind])), crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (line) yield JSON.parse(line);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    },

    async loadState() {
      try {
        return JSON.parse(await readFile(statePath, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return freshState();
        throw error;
      }
    },

    async saveState(state) {
      await writeDurably(`${statePath}.tmp`, JSON.stringify(state, null, 2) + '\n', 'w');
      await rename(`${statePath}.tmp`, statePath);
    },
  };
}
