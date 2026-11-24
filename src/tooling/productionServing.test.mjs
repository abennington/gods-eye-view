import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import {
  chooseEncoding,
  precompress,
  precompressedMiddleware,
  productionServingPlugin,
  resolveAssetPath,
} from '../../build/productionServing.js';

const fixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-prod-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(
    path.join(dir, 'assets', 'app-abc.js'),
    'console.log(1);'.repeat(500),
  );
  writeFileSync(path.join(dir, 'assets', 'tiny.js'), 'x');
  writeFileSync(path.join(dir, 'assets', 'logo.png'), Buffer.alloc(4096));
  writeFileSync(
    path.join(dir, 'index.html'),
    '<html>' + ' '.repeat(4096) + '</html>',
  );
  return dir;
};

/** Minimal req/res pair for the middleware. */
const run = (mw, url, { method = 'GET', encoding = 'br, gzip' } = {}) =>
  new Promise((resolve) => {
    const headers = {};
    const chunks = [];
    const res = {
      statusCode: 0,
      setHeader: (k, v) => (headers[k.toLowerCase()] = String(v)),
      write: (c) => chunks.push(Buffer.from(c)),
      end: (c) => {
        if (c) chunks.push(Buffer.from(c));
        resolve({
          handled: true,
          status: res.statusCode,
          headers,
          body: Buffer.concat(chunks),
        });
      },
      on: () => res,
      once: () => res,
      emit: () => true,
      destroy: () => resolve({ handled: true, destroyed: true }),
      removeListener: () => res,
    };
    // Stream piping needs a Writable; emulate by collecting via end().
    res.write = res.write.bind(res);
    const req = { method, url, headers: { 'accept-encoding': encoding } };
    mw(req, res, () => resolve({ handled: false, headers }));
  });

test('chooseEncoding prefers brotli, honours q=0 and missing files', () => {
  assert.equal(chooseEncoding('gzip, br', { br: true, gzip: true }), 'br');
  assert.equal(chooseEncoding('gzip', { br: true, gzip: true }), 'gzip');
  assert.equal(
    chooseEncoding('br;q=0, gzip', { br: true, gzip: true }),
    'gzip',
  );
  assert.equal(chooseEncoding('br', { br: false, gzip: true }), null);
  assert.equal(chooseEncoding('', { br: true, gzip: true }), null);
  assert.equal(chooseEncoding('*', { br: true, gzip: true }), 'br');
});

test('resolveAssetPath never leaves the output directory', () => {
  const dir = '/srv/dist';
  assert.equal(
    resolveAssetPath(dir, '/assets/a.js?v=1'),
    '/srv/dist/assets/a.js',
  );
  assert.equal(resolveAssetPath(dir, '/'), '/srv/dist/index.html');
  // The URL parser folds encoded dot-segments; the result stays inside dir.
  assert.equal(
    resolveAssetPath(dir, '/%2e%2e/%2e%2e/etc/passwd'),
    '/srv/dist/etc/passwd',
  );
  assert.equal(resolveAssetPath(dir, '/assets/%00.js'), null);
  assert.equal(resolveAssetPath(dir, '/a b.js'), null);
});

test('precompress writes br and gz siblings for compressible files only', () => {
  const dir = fixture();
  try {
    const totals = precompress(dir);
    assert.equal(totals.files, 2); // app-abc.js and index.html
    assert.ok(existsSync(path.join(dir, 'assets', 'app-abc.js.br')));
    assert.ok(existsSync(path.join(dir, 'assets', 'app-abc.js.gz')));
    assert.ok(!existsSync(path.join(dir, 'assets', 'tiny.js.br')));
    assert.ok(!existsSync(path.join(dir, 'assets', 'logo.png.br')));
    assert.ok(totals.afterBr < totals.before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('middleware serves the brotli sibling with immutable caching and the preview headers', async () => {
  const dir = fixture();
  try {
    precompress(dir);
    const mw = precompressedMiddleware(dir, {
      'X-Content-Type-Options': 'nosniff',
    });
    const out = await run(mw, '/assets/app-abc.js', { method: 'HEAD' });
    assert.equal(out.handled, true);
    assert.equal(out.headers['content-encoding'], 'br');
    assert.equal(
      out.headers['cache-control'],
      'public, max-age=31536000, immutable',
    );
    assert.equal(out.headers['x-content-type-options'], 'nosniff');
    assert.equal(out.headers.vary, 'Accept-Encoding');
    assert.match(out.headers['content-type'], /javascript/);
    const br = brotliDecompressSync(
      (await import('node:fs')).readFileSync(
        path.join(dir, 'assets', 'app-abc.js.br'),
      ),
    ).toString();
    assert.equal(br, 'console.log(1);'.repeat(500));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('middleware leaves HTML, API routes, other methods and identity clients to Vite', async () => {
  const dir = fixture();
  try {
    precompress(dir);
    const mw = precompressedMiddleware(dir);
    assert.equal((await run(mw, '/')).handled, false);
    assert.equal((await run(mw, '/index.html')).handled, false);
    assert.equal((await run(mw, '/api/radio/stations')).handled, false);
    assert.equal(
      (await run(mw, '/assets/app-abc.js', { method: 'POST' })).handled,
      false,
    );
    assert.equal(
      (await run(mw, '/assets/app-abc.js', { encoding: 'identity' })).handled,
      false,
    );
    const png = await run(mw, '/assets/logo.png');
    assert.equal(png.handled, false);
    assert.equal(
      png.headers['cache-control'],
      'public, max-age=31536000, immutable',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the plugin mirrors the dev server host, port and allowed hosts onto preview', () => {
  const out = productionServingPlugin().config({
    server: {
      host: '0.0.0.0',
      port: 5000,
      allowedHosts: ['localhost', 'app.replit.app'],
    },
  });
  assert.deepEqual(out.preview, {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: ['localhost', 'app.replit.app'],
  });
});
