const WORKER_HOST = "example.invalid";

/**
 * Makes one save-it bundle in the claude.ai sandbox.
 * `--check` asks the Worker for `/health`.
 * The bundle run collects the uploads, the outputs, and the transcript.
 * It writes a deterministic `.tgz` and prints one JSON line.
 * Node built-ins only.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createTar, gzipDeterministic } from "./tar.mjs";

const UPLOADS = "/mnt/user-data/uploads";
const OUTPUTS = "/mnt/user-data/outputs";
const OUT_DIR = "/tmp/save-it";
const ARGUMENTS = ["date", "source", "topic", "transcript"];
const PREFIX = { input: "inputs", output: "outputs" };

/**
 * @typedef {{ path: string, data: Uint8Array, origin: "input" | "output" | "transcript" }} BundleFile
 */

/**
 * Collects every regular file under a root. Symbolic links are skipped.
 * Subdirectories are walked. A missing root gives an empty array.
 * @param {string} root the directory to walk
 * @param {"input" | "output"} origin `input` puts files under `inputs/`, `output` under `outputs/`
 * @returns {BundleFile[]} each path is `<prefix>/<path relative to root>` with `/` separators
 */
export function collectFiles(root, origin) {
  const prefix = PREFIX[origin];
  if (prefix === undefined) throw new Error(`origin is not valid: ${origin}`);
  /** @type {BundleFile[]} */
  const files = [];
  /** @param {string} dir */
  const walk = (dir) => {
    let dirents;
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (dir === root && error.code === "ENOENT") return;
      throw error;
    }
    for (const dirent of dirents) {
      const full = join(dir, dirent.name);
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        walk(full);
      } else if (dirent.isFile()) {
        const rel = relative(root, full).split(sep).join("/");
        files.push({ path: `${prefix}/${rel}`, data: readFileSync(full), origin });
      }
    }
  };
  walk(root);
  return files;
}

/**
 * Builds the manifest object. The manifest does not list itself.
 * @param {BundleFile[]} files
 * @param {{ date: string, source: string, topic: string }} meta
 * @returns {{ date: string, source: string, topic: string, transcript: "reconstructed",
 *   files: Array<{ path: string, sha256: string, size: number, origin: string }> }}
 */
export function buildManifest(files, { date, source, topic }) {
  const items = files.map(({ path, data, origin }) => ({
    path,
    sha256: createHash("sha256").update(data).digest("hex"),
    size: data.length,
    origin
  }));
  items.sort((a, b) => Buffer.compare(Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8")));
  return { date, source, topic, transcript: "reconstructed", files: items };
}

/**
 * Asks the Worker for `/health` through curl. Prints `ok` or the failure line.
 * @returns {number} the exit code
 */
function check() {
  let body = "";
  try {
    body = execFileSync(
      "curl",
      ["--fail", "--silent", "--show-error", `https://${WORKER_HOST}/health`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch {
    body = "";
  }
  if (body === "ok") {
    console.log("ok");
    return 0;
  }
  console.log(
    `not saved: the Worker did not answer /health. fix: check the network allow list for ${WORKER_HOST}`
  );
  return 1;
}

/**
 * Reads `--name value` pairs.
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArguments(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith("--") ? argv[i].slice(2) : "";
    if (ARGUMENTS.includes(name) && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      values[name] = argv[i + 1];
      i++;
    }
  }
  return values;
}

/**
 * Makes the bundle and prints one JSON line.
 * @param {string[]} argv
 * @returns {number} the exit code
 */
function bundle(argv) {
  const args = parseArguments(argv);
  for (const name of ARGUMENTS) {
    if (args[name] === undefined || args[name] === "") {
      console.log(`not saved: ${name} is missing. fix: pass --${name}`);
      return 1;
    }
  }
  const { date, source, topic, transcript } = args;
  /** @type {BundleFile[]} */
  const files = [
    ...collectFiles(UPLOADS, "input"),
    ...collectFiles(OUTPUTS, "output"),
    { path: "TRANSCRIPT.md", data: readFileSync(transcript), origin: "transcript" }
  ];
  const manifest = buildManifest(files, { date, source, topic });
  const entries = files.map(({ path, data }) => ({ path, data }));
  entries.push({ path: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8") });
  const gz = gzipDeterministic(createTar(entries));
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${date}-${source}-${topic}.tgz`;
  writeFileSync(path, gz);
  const written = readFileSync(path);
  const sha256 = createHash("sha256").update(written).digest("hex");
  console.log(JSON.stringify({ date, source, topic, sha256, size: written.length, path }));
  return 0;
}

/**
 * Runs `--check` or the bundle run.
 * @param {string[]} argv the arguments after the script path
 * @returns {number} the exit code
 */
function main(argv) {
  if (argv.includes("--check")) return check();
  try {
    return bundle(argv);
  } catch (error) {
    console.log(`not saved: ${error.message}. fix: correct the input and run the script again`);
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = main(process.argv.slice(2));
}
