import express from 'express';
import { createServer } from 'node:http';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostCheckPlugin, resolveAllowedHosts } from '../../build/allowedHosts.js';
import {
  apiResponseHeadersPlugin,
  BROWSER_HEADERS,
} from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { googleTokenUnavailablePlugin } from './google-token-unavailable.js';
import { standaloneVoiceTools } from './voiceTools.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Serve only compiled assets, with the existing provider middleware.
 * This does not create a Vite server, compiler, HMR socket, or source-file route.
 * Preview hooks are the providers' existing non-development HTTP adapters;
 * development-only hooks (including the credential writer) never run here.
 */
export async function createProductionServer({
  distDir = path.join(root, 'dist'),
  host = process.env.HOST || '0.0.0.0',
  allowedHosts = resolveAllowedHosts(
    [process.env.GEV_ALLOWED_HOSTS, process.env.REPLIT_DOMAINS]
      .filter(Boolean)
      .join(','),
  ),
  providerPlugins,
} = {}) {
  await access(path.join(distDir, 'index.html')).catch(() => {
    throw new Error('Missing built frontend. Run npm run build before npm start.');
  });

  const app = express();
  app.disable('x-powered-by');
  // Do not trust arbitrary forwarded IP/Host headers. Provider middleware
  // retains its own admission checks and key-bearing endpoint rate limits.
  const httpServer = createServer(app);
  const context = {
    middlewares: app,
    httpServer,
    config: {
      root,
      server: { host, allowedHosts },
      preview: { host, allowedHosts },
    },
  };

  // Share the upstream API policy, including on host refusals and errors.
  apiResponseHeadersPlugin().configurePreviewServer(context);
  hostCheckPlugin().configurePreviewServer(context);
  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(BROWSER_HEADERS)) {
      // API responses already carry the stricter API-only policy.
      if (!res.hasHeader(name)) res.setHeader(name, value);
    }
    next();
  });

  const tools = standaloneVoiceTools();
  const plugins =
    providerPlugins ??
    localProviderPlugins({ realtime: { tools }, gemini: { tools } });
  for (const plugin of plugins.flat(Infinity).filter(Boolean)) {
    if (typeof plugin.configurePreviewServer === 'function')
      await plugin.configurePreviewServer(context);
  }
  googleTokenUnavailablePlugin().configurePreviewServer(context);

  // Never turn a missing API, local MCP, or development route into HTML.
  app.use((req, res, next) => {
    if (/^\/api(?:$|[/.])/i.test(req.path)) {
      res.status(404).set('Cache-Control', 'no-store').json({
        error: 'Unknown API route',
      });
      return;
    }
    next();
  });
  app.use(
    express.static(distDir, {
      dotfiles: 'deny',
      redirect: false,
      etag: true,
      setHeaders(res, file) {
        // Revalidate HTML and unversioned public files on each visit.
        res.setHeader(
          'Cache-Control',
          file.startsWith(path.join(distDir, 'assets') + path.sep)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    }),
  );
  app.use((_req, res) => res.status(404).type('text').send('Not found'));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    // Do not expose upstream request URLs, keys, or error stacks.
    const status = error.status === 400 ? 400 : 500;
    res.status(status).json({
      error: status === 400 ? 'Bad request' : 'Internal server error',
    });
  });
  return httpServer;
}

export async function startProductionServer() {
  process.env.NODE_ENV = 'production';
  process.env.HOST ||= '0.0.0.0';
  process.env.GEV_ALLOWED_HOSTS = resolveAllowedHosts(
    [process.env.GEV_ALLOWED_HOSTS, process.env.REPLIT_DOMAINS]
      .filter(Boolean)
      .join(','),
  ).join(',');
  const port = Number(process.env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer between 1 and 65535');
  const server = await createProductionServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, process.env.HOST, resolve);
  });
  console.log(`Production server listening on port ${port}`);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startProductionServer().catch(() => {
    console.error(
      'Production startup failed. Ensure npm run build succeeded and PORT is available.',
    );
    process.exit(1);
  });
}
