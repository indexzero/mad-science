// Tangle LITERATE.md: each fenced block whose info string has file=PATH is
// added, in document order, to PATH under the output directory. Chunks of
// one file are joined by a blank line.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const [source = 'LITERATE.md', out = 'client'] = process.argv.slice(2);
const fence = /^```\w*\s+file=(\S+)\n([\s\S]*?)\n```$/gm;
const files = new Map();
for (const [, path, body] of (await readFile(source, 'utf8')).matchAll(fence)) {
  files.set(path, [...(files.get(path) ?? []), body]);
}
for (const [path, chunks] of files) {
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), chunks.join('\n\n') + '\n');
}
console.log(`tangled ${files.size} files into ${out}/`);
