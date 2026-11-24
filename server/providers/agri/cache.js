import { coalesceProxyRequest } from '../common/http.js';

/**
 * A small keyed cache for slow-moving upstream feeds. Each key keeps its last
 * good value: within `ttlMs` it is served as is; past that a refresh is tried
 * and, if it fails, the last good value is served marked `stale` for up to
 * `staleMs`. A failed key is not asked again for `retryMs`, so a broken
 * upstream is never hammered. Concurrent misses share one upstream call.
 * @param {{ttlMs: number, staleMs: number, retryMs?: number, now?: () => number}} options
 */
export function createFeedCache({
  ttlMs,
  staleMs,
  retryMs = 5 * 60 * 1000,
  now = () => Date.now(),
}) {
  /** @type {Map<string, {good: ?{value: unknown, fetchedAt: number}, retryAt: number, error: ?string}>} */
  const entries = new Map();
  const inFlight = new Map();

  const entryOf = (key) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { good: null, retryAt: 0, error: null };
      entries.set(key, entry);
    }
    return entry;
  };

  /**
   * The value for `key`, loading it with `load()` when due.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} load
   * @returns {Promise<{value: T, fetchedAt: number, stale: boolean}>}
   */
  async function get(key, load) {
    const entry = entryOf(key);
    const at = now();
    const fresh = entry.good && at - entry.good.fetchedAt < ttlMs;
    if (!fresh && at >= entry.retryAt) {
      try {
        await coalesceProxyRequest(inFlight, key, async () => {
          const value = await load();
          entry.good = { value, fetchedAt: now() };
          entry.error = null;
        }).promise;
      } catch (error) {
        entry.retryAt = now() + retryMs;
        entry.error = String(error?.code || error?.message || 'upstream_error');
      }
    }
    const done = now();
    if (entry.good && done - entry.good.fetchedAt <= staleMs) {
      return {
        value: entry.good.value,
        fetchedAt: entry.good.fetchedAt,
        stale: done - entry.good.fetchedAt >= ttlMs,
      };
    }
    const failure = new Error(entry.error || 'upstream_unavailable');
    failure.code = entry.error || 'upstream_unavailable';
    throw failure;
  }

  return { get, clear: () => entries.clear() };
}
