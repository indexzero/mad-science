import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createServer as createHTTPServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(here, "public");
const staticFiles = new Map([
  ["/", [join(publicRoot, "index.html"), "text/html; charset=utf-8"]],
  ["/app.js", [join(publicRoot, "app.js"), "text/javascript; charset=utf-8"]],
  ["/style.css", [join(publicRoot, "style.css"), "text/css; charset=utf-8"]],
  ["/scene-graph.js", [join(here, "scene-graph.js"), "text/javascript; charset=utf-8"]]
]);

async function readBody(request, limit = 128 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error("body-too-large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createWorkloadServer({ trialDirectory }) {
  if (!trialDirectory) throw new Error("trialDirectory is required");
  const eventPath = join(trialDirectory, "app-events.jsonl");
  return createHTTPServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/events") {
        const raw = await readBody(request);
        const event = JSON.parse(raw);
        if (typeof event.type !== "string" || typeof event.sequence !== "number") throw new Error("invalid-event");
        event.serverReceivedAt = new Date().toISOString();
        event.serverOrdinal = createWorkloadServer.nextOrdinal++;
        await appendFile(eventPath, `${JSON.stringify(event)}\n`, { encoding: "utf8" });
        response.writeHead(204);
        response.end();
        return;
      }
      const entry = request.method === "GET" && staticFiles.get(url.pathname);
      if (entry) {
        response.writeHead(200, { "content-type": entry[1], "cache-control": "no-store" });
        response.end(await readFile(entry[0]));
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
    } catch (error) {
      response.writeHead(error.message === "body-too-large" ? 413 : 400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
}
createWorkloadServer.nextOrdinal = 0;

export async function sealEventJournal(trialDirectory) {
  const eventPath = join(trialDirectory, "app-events.jsonl");
  let data;
  try {
    data = await readFile(eventPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    data = Buffer.alloc(0);
    await writeFile(eventPath, data);
  }
  const terminal = {
    schemaVersion: 1,
    status: "completed",
    endedAt: new Date().toISOString(),
    eventPath: "app-events.jsonl",
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex")
  };
  await writeFile(join(trialDirectory, "app-terminal.json"), `${JSON.stringify(terminal, null, 2)}\n`);
  return terminal;
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const trialDirectory = option("--trial-dir", process.env.HUMANISH_TRIAL_DIR);
  if (!trialDirectory) throw new Error("Pass --trial-dir or HUMANISH_TRIAL_DIR");
  const port = Number(option("--port", "4173"));
  const server = createWorkloadServer({ trialDirectory });
  server.listen(port, "127.0.0.1", () => {
    console.log(`humanish workload: http://127.0.0.1:${port}/?condition=computer-accessibility`);
  });
  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    server.close(async error => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
        return;
      }
      try {
        await sealEventJournal(trialDirectory);
        console.log(`humanish workload: sealed after ${signal}`);
      } catch (sealError) {
        console.error(sealError);
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}
