/**
 * The Markets & Freight panel's owner: polls /api/agri/summary (the server
 * caches every upstream, so polling costs no upstream calls) and publishes
 * what the panel renders. Framework-free: it takes `publish` and timers, and
 * pauses while the page is hidden.
 */

export const AGRI_SUMMARY_URL = '/api/agri/summary';
export const AGRI_POLL_MS = 5 * 60 * 1000;

/** Feed name → the panel section that shows it. */
export const AGRI_SECTIONS = Object.freeze([
  { id: 'poultry', feeds: ['poultry-market', 'nass-poultry'] },
  { id: 'cold', feeds: ['cold-storage'] },
  {
    id: 'freight',
    feeds: ['diesel', 'reefer-rates', 'reefer-volumes', 'freight-index'],
  },
]);

/**
 * @param {{
 *   publish: (view: object) => void,
 *   fetchImpl?: typeof fetch,
 *   intervalMs?: number,
 *   url?: string,
 *   doc?: Document,
 *   setTimer?: typeof setTimeout,
 *   clearTimer?: typeof clearTimeout,
 *   now?: () => number,
 * }} options
 */
export function createAgriMarketsOwner({
  publish,
  fetchImpl = (...args) => globalThis.fetch(...args),
  intervalMs = AGRI_POLL_MS,
  url = AGRI_SUMMARY_URL,
  doc = globalThis.document,
  setTimer = (...args) => globalThis.setTimeout(...args),
  clearTimer = (...args) => globalThis.clearTimeout(...args),
  now = () => Date.now(),
}) {
  let view = { loading: false, error: null, checkedAt: null, feeds: {} };
  let timer = null;
  let running = false;
  let inFlight = null;

  const emit = (patch) => {
    view = { ...view, ...patch };
    publish(view);
  };
  const hidden = () => doc?.visibilityState === 'hidden';

  function schedule() {
    clearTimer(timer);
    timer = running ? setTimer(tick, intervalMs) : null;
  }

  function tick() {
    if (!running) return;
    if (hidden()) return schedule();
    refresh().finally(schedule);
  }

  /** Fetch the summary now; concurrent calls share one request. */
  function refresh() {
    if (inFlight) return inFlight;
    emit({ loading: true });
    inFlight = (async () => {
      try {
        const response = await fetchImpl(url, {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`http_${response.status}`);
        const body = await response.json();
        emit({
          loading: false,
          error: null,
          checkedAt: now(),
          feeds: body?.feeds ?? {},
        });
      } catch (error) {
        // Keep the last feeds on screen; say the refresh failed.
        emit({
          loading: false,
          error: String(error?.message || 'unreachable'),
          checkedAt: now(),
        });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  const onVisible = () => {
    if (running && !hidden()) tick();
  };

  return {
    start() {
      if (running) return;
      running = true;
      doc?.addEventListener?.('visibilitychange', onVisible);
      tick();
    },
    stop() {
      running = false;
      clearTimer(timer);
      timer = null;
      doc?.removeEventListener?.('visibilitychange', onVisible);
    },
    refresh,
    get view() {
      return view;
    },
  };
}

/** One feed's state as the panel's status chip names it. */
export function feedState(feed) {
  if (!feed) return 'loading';
  if (feed.status === 'ok') return 'live';
  if (feed.status === 'stale') return 'stale';
  if (feed.status === 'no_key') return 'key';
  return 'error';
}
