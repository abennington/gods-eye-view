import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createProductionServer } from './production.js';

test('production serves compiled assets and APIs without development routes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gev-production-'));
  const distDir = path.join(root, 'dist');
  await mkdir(path.join(distDir, 'assets'), { recursive: true });
  await writeFile(path.join(distDir, 'index.html'), '<h1>Built globe</h1>');
  await writeFile(path.join(distDir, 'assets', 'app-abc123.js'), 'export {};');
  await writeFile(path.join(distDir, '.env'), 'must-not-be-served');
  await writeFile(path.join(root, 'package.json'), '{"private":true}');
  let closed = false;
  const server = await createProductionServer({
    distDir,
    allowedHosts: ['allowed.example'],
    providerPlugins: [
      {
        configureServer() {
          assert.fail('Development hooks must never run in production');
        },
        configurePreviewServer({ middlewares, httpServer }) {
          httpServer.once('close', () => { closed = true; });
          middlewares.use('/api/probe', (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ route: req.url }));
          });
          middlewares.use('/api/failure', () => {
            throw new Error('Internal details must not be exposed');
          });
        },
      },
    ],
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    assert.equal(closed, true, 'Provider teardown receives the server close event');
    await rm(root, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const get = (url, { host = 'allowed.example', method = 'GET' } = {}) =>
    new Promise((resolve, reject) => {
      const req = request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: url,
        method,
        headers: { host },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });

  await t.test('root and HEAD return the compiled page with production CSP', async () => {
    const response = await get('/');
    assert.equal(response.status, 200);
    assert.match(response.body, /Built globe/);
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(response.headers['cache-control'], 'no-cache');
    assert.equal(response.headers['x-powered-by'], undefined);
    const head = await get('/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
  });

  await t.test('versioned assets have long-lived caching and JavaScript MIME', async () => {
    const response = await get('/assets/app-abc123.js');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /javascript/);
    assert.match(response.headers['cache-control'], /immutable/);
  });

  await t.test('provider mounts preserve their URL and API security policy', async () => {
    const response = await get('/api/probe/example?q=1');
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { route: '/example?q=1' });
    assert.equal(response.headers['content-security-policy'], "default-src 'none'; sandbox");
    assert.equal((await get('/api/google/tiles-token')).status, 204);
  });

  await t.test('unknown APIs and local setup endpoints do not fall back to HTML', async () => {
    for (const route of ['/api/unknown', '/api/setup/status', '/api/setup/keys']) {
      const response = await get(route);
      assert.equal(response.status, 404);
      assert.deepEqual(JSON.parse(response.body), { error: 'Unknown API route' });
    }
  });

  await t.test('host checks run before provider handlers', async () => {
    for (const route of ['/', '/api/probe']) {
      const response = await get(route, { host: 'attacker.example' });
      assert.equal(response.status, 403);
      assert.match(response.body, /This host is not allowed/);
    }
    assert.equal((await get('/', { host: '127.0.0.1' })).status, 200);
  });

  await t.test('source files, dotenv files, HMR, and path traversal are unavailable', async () => {
    for (const route of [
      '/.env', '/src/main.js', '/@vite/client', '/@fs/etc/passwd',
      '/../package.json', '/%2e%2e/package.json', '/mcp',
    ]) {
      const response = await get(route);
      assert.equal(response.status, 404, route);
      assert.doesNotMatch(response.body, /must-not-be-served/);
    }
  });

  await t.test('unexpected provider errors are sanitized', async () => {
    const response = await get('/api/failure');
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body), { error: 'Internal server error' });
    assert.equal(response.headers['content-security-policy'], "default-src 'none'; sandbox");
  });
});

test('production fails explicitly if the frontend was not built', async () => {
  await assert.rejects(
    createProductionServer({ distDir: '/does-not-exist/gev-dist', providerPlugins: [] }),
    /Run npm run build/,
  );
});

test('real provider adapters remain available without calling upstream services', async (t) => {
  const distDir = await mkdtemp(path.join(tmpdir(), 'gev-production-providers-'));
  await writeFile(path.join(distDir, 'index.html'), '<h1>Built globe</h1>');
  const server = await createProductionServer({ distDir });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(distDir, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const agri = await fetch(`${base}/api/agri/not-a-feed`);
  assert.equal(agri.status, 404);
  assert.deepEqual(await agri.json(), { error: 'unknown_route' });
  assert.equal((await fetch(`${base}/api/google/tiles-token`)).status, 204);
  const crossSite = await fetch(`${base}/api/cctv`, {
    headers: { 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(crossSite.status, 403);
});
