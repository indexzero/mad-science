import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkloadServer, sealEventJournal } from "../server.mjs";

test("server records an event as JSONL", async t => {
  const directory = await mkdtemp(join(tmpdir(), "humanish-web-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = createWorkloadServer({ trialDirectory: directory });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "test", sequence: 4 })
  });
  assert.equal(response.status, 204);
  const event = JSON.parse((await readFile(join(directory, "app-events.jsonl"), "utf8")).trim());
  assert.equal(event.type, "test");
  assert.equal(event.sequence, 4);
  assert.equal(typeof event.serverOrdinal, "number");
});

test("journal seal covers the exact event bytes", async t => {
  const directory = await mkdtemp(join(tmpdir(), "humanish-web-seal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "app-events.jsonl"), '{"type":"one"}\n');
  const terminal = await sealEventJournal(directory);
  assert.equal(terminal.eventPath, "app-events.jsonl");
  assert.equal(terminal.sha256.length, 64);
  const saved = JSON.parse(await readFile(join(directory, "app-terminal.json"), "utf8"));
  assert.equal(saved.sha256, terminal.sha256);
});
