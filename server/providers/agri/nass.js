import {
  envValue,
  getJson,
  round,
  toNumber,
  upstreamError,
} from './upstream.js';

// USDA NASS Quick Stats (quickstats.nass.usda.gov/api). Free key from
// https://quickstats.nass.usda.gov/api ; sent as ?key=, so it stays
// server-side and never appears in a logged error. Each answer is capped at
// 50,000 rows by NASS, so every query here is national and this year or last.
//   Poultry: prices received (monthly) and the weekly Broiler Hatchery series.
//   Cold Storage: the monthly Cold Storage report's STOCKS for poultry, eggs,
//   beef and pork (end-of-month pounds in refrigerated warehouses).

export const NASS_URL = 'https://quickstats.nass.usda.gov/api/api_GET/';
export const NASS_KEY_ENV = 'USDA_NASS_API_KEY';
const MAX_SERIES = 14;

/** The Quick Stats queries behind each feed, without key, format or year. */
export const NASS_QUERIES = Object.freeze({
  poultry: Object.freeze([
    { commodity_desc: 'CHICKENS', statisticcat_desc: 'PRICE RECEIVED' },
    { commodity_desc: 'TURKEYS', statisticcat_desc: 'PRICE RECEIVED' },
    { commodity_desc: 'EGGS', statisticcat_desc: 'PRICE RECEIVED' },
    { commodity_desc: 'CHICKENS', freq_desc: 'WEEKLY' },
  ]),
  coldStorage: Object.freeze(
    ['CHICKENS', 'TURKEYS', 'EGGS', 'BEEF', 'PORK'].map((commodity_desc) => ({
      commodity_desc,
      statisticcat_desc: 'STOCKS',
    })),
  ),
});

/** A Quick Stats URL. The key rides in the query, so never log this. */
export function nassUrl(key, query, year) {
  const url = new URL(NASS_URL);
  url.searchParams.set('key', key);
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('source_desc', 'SURVEY');
  url.searchParams.set('agg_level_desc', 'NATIONAL');
  url.searchParams.set('year__GE', String(year - 1));
  for (const [name, value] of Object.entries(query))
    url.searchParams.set(name, value);
  return url.toString();
}

const pad2 = (n) => String(n).padStart(2, '0');

/** A sortable period key and a label for one Quick Stats row. */
export function nassPeriod(row) {
  const year = toNumber(row.year);
  const code = toNumber(row.begin_code) ?? 0;
  const week = String(row.week_ending ?? '').trim();
  const sort = week ? week.slice(0, 10) : `${year}-${pad2(code)}`;
  const ref = String(row.reference_period_desc ?? '').trim();
  const label = week
    ? `Week ending ${week.slice(0, 10)}`
    : `${ref && ref !== 'YEAR' ? `${ref} ` : ''}${year ?? ''}`.trim();
  return { sort, label, year, code, weekly: Boolean(week) };
}

/**
 * Quick Stats rows grouped into series, each with its latest value, the change
 * from the period before and, for monthly series, from the same month a year
 * earlier. Withheld cells ("(D)", "(Z)") are skipped.
 */
export function normalizeNassSeries(rows) {
  const bySeries = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = toNumber(row?.Value);
    if (value === null) continue;
    const domain = String(row.domaincat_desc ?? '').trim();
    const name = [
      row.short_desc,
      domain && domain !== 'NOT SPECIFIED' ? domain : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (!name) continue;
    const list = bySeries.get(name) ?? [];
    list.push({
      ...nassPeriod(row),
      value,
      unit: String(row.unit_desc ?? '').trim() || null,
      commodity: row.commodity_desc ?? null,
    });
    bySeries.set(name, list);
  }
  const series = [];
  for (const [name, points] of bySeries) {
    points.sort((a, b) => (a.sort < b.sort ? 1 : -1));
    const [latest, prior] = points;
    const yearAgo = latest.weekly
      ? null
      : points.find(
          (p) => p.year === latest.year - 1 && p.code === latest.code,
        );
    const pct = (a, b) =>
      b && b.value
        ? round(((a.value - b.value) / Math.abs(b.value)) * 100, 1)
        : null;
    series.push({
      name,
      commodity: latest.commodity,
      period: latest.label,
      periodKey: latest.sort,
      value: latest.value,
      unit: latest.unit,
      changePct: pct(latest, prior),
      yoyPct: yearAgo ? pct(latest, yearAgo) : null,
    });
  }
  series.sort((a, b) =>
    a.periodKey < b.periodKey
      ? 1
      : a.periodKey > b.periodKey
        ? -1
        : a.name.localeCompare(b.name),
  );
  return series.slice(0, MAX_SERIES);
}

/**
 * Loaders for the two NASS feeds. A query NASS answers with "no data" (400)
 * contributes nothing; any other failure of every query fails the feed.
 * @param {{fetchImpl: typeof fetch, env: () => object, now?: () => number}} deps
 */
export function nassLoaders({ fetchImpl, env, now = () => Date.now() }) {
  const load = (queries) => async () => {
    const key = envValue(env(), NASS_KEY_ENV);
    if (!key) throw upstreamError('no_key');
    const year = new Date(now()).getUTCFullYear();
    const results = await Promise.allSettled(
      queries.map((q) =>
        getJson(fetchImpl, nassUrl(key, q, year), {
          maxBytes: 16 * 1024 * 1024,
        }),
      ),
    );
    const hard = results.filter(
      (r) => r.status === 'rejected' && r.reason?.status !== 400,
    );
    if (hard.length === results.length) throw hard[0].reason;
    const rows = results.flatMap((r) =>
      r.status === 'fulfilled' && Array.isArray(r.value?.data)
        ? r.value.data
        : [],
    );
    const series = normalizeNassSeries(rows);
    return {
      latestPeriod: series[0]?.period ?? null,
      series,
      partial: hard.length > 0,
    };
  };
  return {
    poultry: load(NASS_QUERIES.poultry),
    coldStorage: load(NASS_QUERIES.coldStorage),
  };
}
