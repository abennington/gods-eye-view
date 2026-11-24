import { envValue, getJson, toNumber, upstreamError } from './upstream.js';

// USDA AMS Market News (MARS API, marsapi.ams.usda.gov). Free key from
// https://mymarketnews.ams.usda.gov/mymarketnews-api ; it is sent as the HTTP
// Basic username with an empty password. Server-side only.
//   GET /services/v1.2/reports            every report with its slug and publish time
//   GET /services/v1.2/reports/{slug}     a report's rows; ?lastReports=1 = newest only
// USDA_MARS_POULTRY_SLUGS (comma list) pins the reports; otherwise the newest
// poultry/egg reports are picked from the catalogue by title.

export const MARS_BASE = 'https://marsapi.ams.usda.gov/services/v1.2';
export const MARS_KEY_ENV = 'USDA_MARS_API_KEY';
const POULTRY_RE =
  /\b(chickens?|broilers?|fryers?|turkeys?|eggs?|poultry|fowl|hens?|ducks?)\b/i;
const DEFAULT_REPORT_COUNT = 6;
const ROWS_PER_REPORT = 8;

/** "11/23/2026 14:05:33" (MARS) or ISO, as an ISO string; null when unreadable. */
export function marsDate(value) {
  const text = String(value ?? '').trim();
  const us = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (us) {
    const [, m, d, y, hh = '0', mm = '0', ss = '0'] = us;
    return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss)).toISOString();
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

const textOf = (value) =>
  (Array.isArray(value) ? value.join(', ') : String(value ?? '')).trim();

/** Poultry and egg reports from the MARS catalogue, newest published first. */
export function pickPoultryReports(
  catalogue,
  { slugs = [], limit = DEFAULT_REPORT_COUNT } = {},
) {
  const list = Array.isArray(catalogue)
    ? catalogue
    : (catalogue?.results ?? []);
  const wanted = new Set(slugs.map(String));
  return list
    .filter((r) => r && r.slug_id !== undefined)
    .filter((r) =>
      wanted.size
        ? wanted.has(String(r.slug_id))
        : POULTRY_RE.test(
            `${textOf(r.report_title)} ${textOf(r.market_types)} ${textOf(r.slug_name)}`,
          ),
    )
    .map((r) => ({
      slug: String(r.slug_id),
      title: textOf(r.report_title) || textOf(r.slug_name),
      published: marsDate(r.published_date),
      office: textOf(r.offices) || null,
      marketTypes: textOf(r.market_types) || null,
    }))
    .sort((a, b) =>
      String(b.published ?? '').localeCompare(String(a.published ?? '')),
    )
    .slice(0, limit);
}

const LABEL_FIELDS = [
  'commodity',
  'class',
  'item',
  'description',
  'grade',
  'size',
  'region',
  'delivery_point',
  'market_location_name',
  'pack',
];
const VALUE_FIELDS = [
  'weighted_avg',
  'wtd_avg',
  'wtd_avg_price',
  'avg_price',
  'price_avg',
  'avg',
  'price',
  'price_mostly',
  'current',
];
const LOW_FIELDS = ['price_min', 'low_price', 'price_low', 'low'];
const HIGH_FIELDS = ['price_max', 'high_price', 'price_high', 'high'];
const UNIT_FIELDS = [
  'price_unit',
  'unit',
  'uom',
  'unit_of_measure',
  'quote_unit',
];

const firstNumber = (row, fields) => {
  for (const f of fields) {
    const n = toNumber(row[f]);
    if (n !== null) return n;
  }
  return null;
};
const firstText = (row, fields) =>
  fields.map((f) => textOf(row[f])).find(Boolean) || null;

/**
 * A report's newest rows as `{label, value, low, high, unit}`. MARS columns
 * differ per report, so the label joins whichever descriptive columns exist
 * and the value is the first price-like column.
 */
export function normalizeMarsReport(payload) {
  const rows = Array.isArray(payload?.results)
    ? payload.results
    : Array.isArray(payload)
      ? payload
      : [];
  const reportDate =
    rows
      .map((r) => marsDate(r.report_date ?? r.published_date))
      .find(Boolean) ?? null;
  const items = [];
  for (const row of rows) {
    const value = firstNumber(row, VALUE_FIELDS);
    const low = firstNumber(row, LOW_FIELDS);
    const high = firstNumber(row, HIGH_FIELDS);
    if (value === null && low === null && high === null) continue;
    const label = LABEL_FIELDS.map((f) => textOf(row[f]))
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(' · ');
    items.push({
      label: label || 'Quote',
      value:
        value ??
        (low !== null && high !== null ? (low + high) / 2 : (low ?? high)),
      low,
      high,
      unit: firstText(row, UNIT_FIELDS),
    });
    if (items.length >= ROWS_PER_REPORT) break;
  }
  return { reportDate, rowCount: rows.length, items };
}

/**
 * The MARS poultry loader, or null while no key is set.
 * @param {{fetchImpl: typeof fetch, env: () => object}} deps
 */
export function marsLoader({ fetchImpl, env }) {
  return async () => {
    const key = envValue(env(), MARS_KEY_ENV);
    if (!key) throw upstreamError('no_key');
    const headers = {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
    };
    const slugs = envValue(env(), 'USDA_MARS_POULTRY_SLUGS')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{1,6}$/.test(s));
    const catalogue = await getJson(fetchImpl, `${MARS_BASE}/reports`, {
      headers,
      maxBytes: 16 * 1024 * 1024,
    });
    const reports = pickPoultryReports(catalogue, { slugs });
    const detailed = await Promise.allSettled(
      reports.map((r) =>
        getJson(
          fetchImpl,
          `${MARS_BASE}/reports/${encodeURIComponent(r.slug)}?lastReports=1`,
          { headers },
        ),
      ),
    );
    if (detailed.length && detailed.every((d) => d.status === 'rejected'))
      throw detailed[0].reason;
    return {
      reports: reports.map((r, i) => {
        const d = detailed[i];
        return d.status === 'fulfilled'
          ? {
              ...r,
              ...normalizeMarsReport(d.value),
              url: `https://mymarketnews.ams.usda.gov/viewReport/${r.slug}`,
            }
          : { ...r, error: d.reason?.code || 'upstream_error', items: [] };
      }),
    };
  };
}
