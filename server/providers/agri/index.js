import { clientKey, makeRateLimiter } from '../common/rate-limit.js';
import { createFeedCache } from './cache.js';
import { logisticsLoaders } from './logistics.js';
import { marsLoader, MARS_KEY_ENV } from './mars.js';
import { nassLoaders, NASS_KEY_ENV } from './nass.js';

// Agriculture markets and freight (/api/agri/*): USDA AMS Market News poultry
// reports, NASS Quick Stats poultry and Cold Storage series, and keyless
// trucking signals (AgTransport reefer rates/volumes, diesel, BTS freight TSI).
// Every upstream call is server-side and cached, so the browser never sees a
// key and page views never multiply upstream calls: one refresh per feed per
// TTL, whatever the traffic.
//
//   GET /api/agri/summary   every feed in one answer (what the panel polls)
//   GET /api/agri/<feed>    one feed: poultry-market, nass-poultry,
//                           cold-storage, reefer-rates, reefer-volumes,
//                           diesel, freight-index

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * Each feed: its loader, how long an answer is fresh, and its source credit.
 * TTLs follow how often the upstream publishes (MARS: several times a day;
 * NASS and AgTransport: weekly or monthly; BTS: monthly).
 */
function feedTable(deps) {
  const logistics = logisticsLoaders(deps);
  const nass = nassLoaders(deps);
  return {
    'poultry-market': {
      load: marsLoader(deps),
      ttlMs: 15 * MIN,
      keyEnv: MARS_KEY_ENV,
      source: {
        name: 'USDA AMS Market News',
        url: 'https://mymarketnews.ams.usda.gov/',
      },
    },
    'nass-poultry': {
      load: nass.poultry,
      ttlMs: 6 * HOUR,
      keyEnv: NASS_KEY_ENV,
      source: {
        name: 'USDA NASS Quick Stats',
        url: 'https://quickstats.nass.usda.gov/',
      },
    },
    'cold-storage': {
      load: nass.coldStorage,
      ttlMs: 6 * HOUR,
      keyEnv: NASS_KEY_ENV,
      source: {
        name: 'USDA NASS Cold Storage',
        url: 'https://usda.library.cornell.edu/concern/publications/pg15bd892',
      },
    },
    'reefer-rates': {
      load: logistics.reeferRates,
      ttlMs: HOUR,
      source: {
        name: 'USDA AMS AgTransport',
        url: 'https://agtransport.usda.gov/d/acar-e3r8',
      },
    },
    'reefer-volumes': {
      load: logistics.reeferVolumes,
      ttlMs: HOUR,
      source: {
        name: 'USDA AMS AgTransport',
        url: 'https://agtransport.usda.gov/d/rfpn-7etz',
      },
    },
    diesel: {
      load: logistics.diesel,
      ttlMs: HOUR,
      source: {
        name: 'USDA AgTransport (EIA)',
        url: 'https://agtransport.usda.gov/d/x88w-atzp',
      },
    },
    'freight-index': {
      load: logistics.tsi,
      ttlMs: 12 * HOUR,
      source: {
        name: 'BTS Transportation Services Index',
        url: 'https://data.bts.gov/d/bw6n-ddqk',
      },
    },
  };
}

export const AGRI_FEEDS = Object.freeze([
  'poultry-market',
  'nass-poultry',
  'cold-storage',
  'reefer-rates',
  'reefer-volumes',
  'diesel',
  'freight-index',
]);

/**
 * The feed service: `read(name)` answers one feed's envelope, never throwing.
 * @param {{fetchImpl?: typeof fetch, env?: () => object, now?: () => number}} [options]
 */
export function createAgriFeeds({
  fetchImpl = (...args) => globalThis.fetch(...args),
  env = () => process.env,
  now = () => Date.now(),
} = {}) {
  const feeds = feedTable({ fetchImpl, env, now });
  const caches = new Map(
    Object.entries(feeds).map(([name, feed]) => [
      name,
      // Last good answers stay usable for a week, marked stale.
      createFeedCache({
        ttlMs: feed.ttlMs,
        staleMs: 7 * 24 * HOUR,
        retryMs: 5 * MIN,
        now,
      }),
    ]),
  );

  async function read(name) {
    const feed = feeds[name];
    if (!feed) return { feed: name, status: 'unknown_feed' };
    const base = {
      feed: name,
      source: feed.source,
      ttlSeconds: feed.ttlMs / 1000,
    };
    if (feed.keyEnv && !String(env()?.[feed.keyEnv] ?? '').trim())
      return { ...base, status: 'no_key', keyEnv: feed.keyEnv };
    try {
      const { value, fetchedAt, stale } = await caches
        .get(name)
        .get(name, feed.load);
      return {
        ...base,
        status: stale ? 'stale' : 'ok',
        fetchedAt: new Date(fetchedAt).toISOString(),
        data: value,
      };
    } catch (error) {
      return {
        ...base,
        status: 'error',
        error: error?.code || 'upstream_unavailable',
        ...(feed.keyEnv ? { keyEnv: feed.keyEnv } : {}),
      };
    }
  }

  async function summary() {
    const entries = await Promise.all(
      AGRI_FEEDS.map(async (name) => [name, await read(name)]),
    );
    return {
      generatedAt: new Date(now()).toISOString(),
      feeds: Object.fromEntries(entries),
    };
  }

  return { read, summary };
}

/**
 * Vite plugin mounting /api/agri on the dev and preview servers.
 * @param {Parameters<typeof createAgriFeeds>[0]} [options]
 */
export function agriMarketsProxy(options) {
  const service = createAgriFeeds(options);
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 1200 });

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const route = (req.url || '/').split('?')[0].replace(/^\/+|\/+$/g, '');
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    if (route === 'summary' || route === '')
      return json(200, await service.summary());
    if (!AGRI_FEEDS.includes(route))
      return json(404, { error: 'unknown_route' });
    return json(200, await service.read(route));
  }

  return {
    name: 'agri-markets',
    configureServer({ middlewares }) {
      middlewares.use('/api/agri', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/agri', handler);
    },
  };
}
