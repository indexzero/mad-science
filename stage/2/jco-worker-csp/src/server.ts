// A Hono server for the jco-worker-csp POC.
//
// The page gets the strict CSP of charlie.dev. The guest worker script gets
// its OWN, different CSP. The claim under test: browsers apply the worker's
// response CSP inside the worker, not the page's.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serve, type ServerType } from '@hono/node-server';
import { Hono, type Context } from 'hono';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * The page CSP, copied verbatim from
 * ~/Git/indexzero/charlie.dev/render/site/src/app.ts lines 119-131 (the `CSP`
 * constant). Do not edit it here. If that file changes, copy it again.
 */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

/**
 * The guest worker CSP. It is sent on the /guest-worker.js response only.
 *   default-src 'none'      nothing unless allowed below.
 *   script-src 'self'       the worker imports jco from /vendor/.
 *              blob:        the worker import()s the glue that jco generates.
 *              'wasm-unsafe-eval'  the worker compiles WebAssembly.
 *   connect-src 'none'      no fetch, XHR, WebSocket or EventSource.
 * No directive was widened: jco's own core wasm is fetched by the PAGE and
 * transferred in (see public/guest-worker.js).
 */
export const WORKER_CSP = [
  "default-src 'none'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "connect-src 'none'"
].join('; ');

/** Same as baseSecurity() in charlie.dev render/site/src/app.ts. */
function baseSecurity(c: Context): void {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm'
};

function typeOf(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? undefined : TYPES[path.slice(dot)];
}

/** Vendor roots: URL prefix -> directory in node_modules. */
const VENDOR: Record<string, string> = {
  'jco-transpile': 'node_modules/@bytecodealliance/jco-transpile/vendor/',
  'preview2-shim': 'node_modules/@bytecodealliance/preview2-shim/dist/browser/',
  // Prism 1.30.0 (core + clike + javascript), copied into the project.
  prism: 'public/vendor/prism/'
};

/** jco's two prebuilt glue files that import preview2-shim by bare name. */
const NEEDS_REWRITE = new Set(['js-component-bindgen-component.js', 'wasm-tools.js']);

/**
 * jco's prebuilt glue (bindgen and wasm-tools) imports bare specifiers such as
 * '@bytecodealliance/preview2-shim/cli'. Module workers have no import maps,
 * so the server rewrites those four specifiers to same-origin /vendor/ URLs.
 * Nothing else in the file changes.
 */
function rewriteShimSpecifiers(source: string): string {
  return source.replace(
    /from '@bytecodealliance\/preview2-shim\/([a-z0-9-]+)'/g,
    "from '/vendor/preview2-shim/$1.js'"
  );
}

async function sendFile(c: Context, path: string, transform?: (s: string) => string) {
  const type = typeOf(path);
  if (!type) return c.notFound();
  let body: Uint8Array | string;
  try {
    body = await readFile(root + path);
  } catch {
    return c.notFound();
  }
  if (transform) body = transform(new TextDecoder().decode(body));
  baseSecurity(c);
  c.header('Content-Type', type);
  c.header('Cache-Control', 'no-store');
  return c.body(body as never);
}

const SAFE = /^[A-Za-z0-9._/-]+$/;

export function createApp(): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    c.header('Content-Security-Policy', PAGE_CSP);
    return sendFile(c, 'public/index.html');
  });

  app.get('/main.js', (c) => sendFile(c, 'public/main.js'));
  app.get('/style.css', (c) => sendFile(c, 'public/style.css'));
  app.get('/prism-manual.js', (c) => sendFile(c, 'public/prism-manual.js'));

  app.get('/guest-worker.js', (c) => {
    c.header('Content-Security-Policy', WORKER_CSP);
    return sendFile(c, 'public/guest-worker.js');
  });

  app.get('/vendor/:pkg/*', (c) => {
    const dir = VENDOR[c.req.param('pkg')];
    const rest = c.req.path.slice(`/vendor/${c.req.param('pkg')}/`.length);
    if (!dir || !SAFE.test(rest) || rest.includes('..')) return c.notFound();
    const transform =
      c.req.param('pkg') === 'jco-transpile' && NEEDS_REWRITE.has(rest)
        ? rewriteShimSpecifiers
        : undefined;
    return sendFile(c, dir + rest, transform);
  });

  app.get('/components/:name', (c) => {
    const name = c.req.param('name');
    if (!/^[a-z0-9-]+\.wasm$/.test(name)) return c.notFound();
    return sendFile(c, `components/${name}`);
  });

  return app;
}

/** Start on `port` (0 = random). Resolves with the server and its base URL. */
export function start(port = 0): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: createApp().fetch, port, hostname: '127.0.0.1' }, (info) => {
      resolve({ server, url: `http://127.0.0.1:${info.port}` });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await start(Number(process.env.PORT ?? 8787));
  console.log(`jco-worker-csp listening on ${url}`);
}
