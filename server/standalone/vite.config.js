import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { resolveAllowedHosts } from '../../build/allowedHosts.js';
import { createBrowserViteConfig } from '../../build/vite.js';
import {
  isMomentaTheme,
  momentaThemePlugin,
} from '../../build/momentaTheme.js';
import { localProviderPlugins } from '../providers/local.js';
import { localMcpPlugin } from '../mcp/plugin.js';
import { apiNotFoundPlugin } from './api-not-found.js';
import { conformanceReferencesPlugin } from './conformance-references.js';
import { googleTokenUnavailablePlugin } from './google-token-unavailable.js';
import { standaloneVoiceTools } from './voiceTools.js';
import { unwatchedRuntimeDirsPlugin } from './unwatched-cache.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Load this checkout's configuration and attach its local provider middleware. */
export function standaloneConfig(
  { command, mode },
  { nominatimStorageDir } = {},
) {
  const loaded = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const tools = standaloneVoiceTools();
  const config = createBrowserViteConfig({
    plugins: [
      ...localProviderPlugins({
        realtime: { tools },
        gemini: { tools },
        nominatimStorageDir,
      }),
      localMcpPlugin(),
      googleTokenUnavailablePlugin(),
      conformanceReferencesPlugin(),
      apiNotFoundPlugin(),
      unwatchedRuntimeDirsPlugin(),
      momentaThemePlugin({
        enabled: isMomentaTheme(process.env.GEV_THEME),
        root,
      }),
    ],
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    photonUrl: process.env.PHOTON_URL,
    mapillaryToken: process.env.MAPILLARY_CLIENT_TOKEN,
    host: process.env.HOST,
    port: process.env.PORT,
    allowedHosts: resolveAllowedHosts(process.env.GEV_ALLOWED_HOSTS),
    command,
  });
  // The Replit editor frames the full app, not the restricted embed view.
  // Allow only Replit's editor origins in development; keep the rest of the
  // CSP, API headers, and non-Replit/production framing protections intact.
  if (command === 'serve' && process.env.REPLIT_DEV_DOMAIN) {
    const headers = { ...config.server.headers };
    delete headers['X-Frame-Options'];
    headers['Content-Security-Policy'] = headers[
      'Content-Security-Policy'
    ].replace(
      "frame-ancestors 'none'",
      "frame-ancestors 'self' https://replit.com https://*.replit.com",
    );
    config.server.headers = headers;
  }
  return config;
}

export default defineConfig(standaloneConfig);
