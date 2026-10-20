/**
 * Packs the skill: `pnpm skill:pack <host>`.
 * It writes the host into line 1 of `bundle.mjs` and makes `dist/save-it.zip`
 * with the system `zip`. The zip root is `save-it/`.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, "skill", "save-it", "scripts", "bundle.mjs");
const HOST_LINE = /^const WORKER_HOST = ".*";$/m;

const host = process.argv[2];
if (host === undefined || !/^[a-z0-9.-]+$/.test(host)) {
  console.log("not packed: host is not valid");
  process.exit(1);
}

const source = readFileSync(BUNDLE, "utf8");
if (!HOST_LINE.test(source)) {
  console.log("not packed: the WORKER_HOST line is not in bundle.mjs");
  process.exit(1);
}
writeFileSync(BUNDLE, source.replace(HOST_LINE, `const WORKER_HOST = "${host}";`));

mkdirSync(join(ROOT, "dist"), { recursive: true });
rmSync(join(ROOT, "dist", "save-it.zip"), { force: true });
execFileSync("zip", ["-q", "-r", "-X", "../dist/save-it.zip", "save-it"], {
  cwd: join(ROOT, "skill"),
  stdio: "inherit"
});
