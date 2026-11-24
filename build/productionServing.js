/**
 * Production serving for `vite build` + `vite preview` (the hosted path).
 *
 * The dev server is the upstream default and is right for local work, but a
 * hosted instance (Replit, a VM) pays for it on every cold start: dependency
 * optimisation, hundreds of unbundled module requests per page load and no
 * compression. Every provider route already runs under `vite preview`
 * (configurePreviewServer), so production only needs three things the
 * preview server lacks:
 *
 * 1. Precompressed assets: brotli + gzip siblings written once at build time,
 *    so the ~9 MB main chunk goes out at ~3 MB without per-request CPU.
 * 2. Immutable caching for content-hashed files under /assets/.
 * 3. The same HOST / PORT / allowed-hosts policy as the dev server (preview
 *    has its own settings and would otherwise listen on 4173, localhost only).
 */

import {
  createReadStream,
  readdirSync,
  statSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';

/** Extensions worth compressing, with the Content-Type to serve them as. */
export const COMPRESSIBLE = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', // precompressed, served by Vite (CSP)
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.geojson': 'application/geo+json',
});

const MIN_BYTES = 1024;
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Pick the best encoding the client accepts that we have a file for.
 * @param {string|undefined} acceptEncoding
 * @param {{br: boolean, gzip: boolean}} available
 * @returns {'br'|'gzip'|null}
 */
export function chooseEncoding(acceptEncoding, available) {
  const accepted = new Map();
  for (const part of String(acceptEncoding ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    accepted.set(name, q ? Number.parseFloat(q.slice(2)) : 1);
  }
  const ok = (name) => (accepted.get(name) ?? accepted.get('*') ?? 0) > 0;
  if (available.br && ok('br')) return 'br';
  if (available.gzip && ok('gzip')) return 'gzip';
  return null;
}

/**
 * Map a request path onto a file inside `outDir`, or null. Refuses anything
 * that is not a plain path (no `..`, no encoded separators, no NUL), so the
 * middleware can never read outside the build output.
 * @param {string} outDir absolute
 * @param {string} url request URL
 */
export function resolveAssetPath(outDir, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://x').pathname);
  } catch {
    return null;
  }
  if (!/^\/[A-Za-z0-9._@~\-/]*$/.test(pathname) || pathname.includes('..'))
    return null;
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(outDir, pathname);
  return file.startsWith(outDir + path.sep) ? file : null;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Write `.br` and `.gz` siblings for every compressible file in `outDir`.
 * @param {string} outDir
 * @returns {{files: number, before: number, afterBr: number}}
 */
export function precompress(outDir) {
  const totals = { files: 0, before: 0, afterBr: 0 };
  for (const file of walk(outDir)) {
    if (!(path.extname(file) in COMPRESSIBLE)) continue;
    const body = readFileSync(file);
    if (body.length < MIN_BYTES) continue;
    const br = brotliCompressSync(body, {
      params: {
        // Quality 9 is within a few percent of 11 at a fraction of the time
        // on the multi-megabyte chunks.
        [zlib.BROTLI_PARAM_QUALITY]: 9,
        [zlib.BROTLI_PARAM_SIZE_HINT]: body.length,
      },
    });
    writeFileSync(`${file}.br`, br);
    writeFileSync(`${file}.gz`, gzipSync(body, { level: 9 }));
    totals.files += 1;
    totals.before += body.length;
    totals.afterBr += br.length;
  }
  return totals;
}

/**
 * Middleware serving precompressed siblings. Falls through (next) for
 * anything it does not handle, so Vite's own static server and every API
 * route keep working unchanged.
 * @param {string} outDir absolute build output directory
 */
export function precompressedMiddleware(outDir, headers = {}) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.url?.startsWith('/api/')) return next();
    const file = resolveAssetPath(outDir, req.url ?? '/');
    if (!file) return next();
    const type = COMPRESSIBLE[path.extname(file)];
    // Documents stay with Vite's static server, which attaches the page CSP
    // and framing headers; they are small, and the policy must never drift.
    if (path.extname(file) === '.html') return next();
    if (!type) {
      if (req.url.startsWith('/assets/'))
        res.setHeader('Cache-Control', IMMUTABLE);
      return next();
    }
    const exists = (f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    };
    if (!exists(file)) return next();
    const encoding = chooseEncoding(req.headers['accept-encoding'], {
      br: exists(`${file}.br`),
      gzip: exists(`${file}.gz`),
    });
    if (!encoding) return next();
    const served = `${file}.${encoding === 'br' ? 'br' : 'gz'}`;
    res.statusCode = 200;
    for (const [name, value] of Object.entries(headers))
      res.setHeader(name, value);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('Content-Length', statSync(served).size);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader(
      'Cache-Control',
      req.url.startsWith('/assets/') ? IMMUTABLE : 'no-cache',
    );
    if (req.method === 'HEAD') return res.end();
    createReadStream(served)
      .on('error', () => res.destroy())
      .pipe(res);
  };
}

/**
 * Vite plugin. Build: precompress the output. Preview: serve it, and listen
 * where the dev server would.
 */
export function productionServingPlugin() {
  let outDir = '';
  let headers = {};
  return {
    name: 'gev-production-serving',
    config(config) {
      const server = config.server ?? {};
      return {
        preview: {
          host: server.host,
          port: server.port,
          strictPort: true,
          allowedHosts: server.allowedHosts,
        },
      };
    },
    configResolved(resolved) {
      outDir = path.resolve(resolved.root, resolved.build.outDir);
      headers = resolved.preview?.headers ?? {};
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        const { files, before, afterBr } = precompress(outDir);
        if (files) {
          const mb = (n) => (n / 1048576).toFixed(1);
          console.log(
            `[gev-production-serving] precompressed ${files} files: ${mb(before)} MB -> ${mb(afterBr)} MB (brotli)`,
          );
        }
      },
    },
    configurePreviewServer(server) {
      server.middlewares.use(precompressedMiddleware(outDir, headers));
    },
  };
}
