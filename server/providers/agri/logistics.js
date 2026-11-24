import { envValue, getJson, round, toNumber } from './upstream.js';

// Keyless public trucking / freight signals, all Socrata (SODA) datasets:
//   USDA AMS AgTransport (agtransport.usda.gov), weekly, USDA public domain
//     acar-e3r8  Refrigerated Truck Rates and Availability (from the AMS
//                Specialty Crops Truck Rate Report)
//     rfpn-7etz  Refrigerated Truck Volumes
//     x88w-atzp  Weekly On-Highway Diesel Fuel Prices (from EIA)
//   BTS (data.bts.gov), monthly, public domain
//     bw6n-ddqk  Transportation Services Index (freight TSI, truck tonnage)
// SOCRATA_APP_TOKEN is optional: it raises the shared anonymous rate limit.

export const AGTRANSPORT_ORIGIN = 'https://agtransport.usda.gov';
export const BTS_ORIGIN = 'https://data.bts.gov';
export const DATASETS = Object.freeze({
  reeferRates: 'acar-e3r8',
  reeferVolumes: 'rfpn-7etz',
  diesel: 'x88w-atzp',
  tsi: 'bw6n-ddqk',
});

/** A SODA query URL. */
export function sodaUrl(origin, id, params) {
  const url = new URL(`/resource/${id}.json`, origin);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, String(value));
  return url.toString();
}

const isoDay = (value) =>
  typeof value === 'string' ? value.slice(0, 10) : null;
const titleCase = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();

/** The rows of the newest `date` only. */
function latestRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const latest = list.reduce(
    (max, row) => (row?.date > max ? row.date : max),
    '',
  );
  return {
    date: isoDay(latest),
    rows: list.filter((row) => row?.date === latest),
  };
}

/**
 * Reefer truck rates for the latest report week, averaged by shipping region.
 * `rpm` is dollars per mile; `availability` is AMS's 1 (surplus) to 5 (shortage) scale.
 */
export function normalizeReeferRates(rows) {
  const { date, rows: week } = latestRows(rows);
  const byRegion = new Map();
  for (const row of week) {
    const region = titleCase(row.region) || 'Unknown';
    const rpm = toNumber(row.rpm);
    const load = toNumber(row.midpoint);
    const availability = toNumber(row.availability);
    const bucket = byRegion.get(region) ?? {
      region,
      lanes: 0,
      rpm: [],
      load: [],
      availability: [],
    };
    bucket.lanes += 1;
    if (rpm !== null) bucket.rpm.push(rpm);
    if (load !== null) bucket.load.push(load);
    if (availability !== null) bucket.availability.push(availability);
    byRegion.set(region, bucket);
  }
  const mean = (list) =>
    list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
  const regions = [...byRegion.values()]
    .map((b) => ({
      region: b.region,
      lanes: b.lanes,
      avgRatePerMile: round(mean(b.rpm)),
      avgLoadRate: round(mean(b.load), 0),
      availability: round(mean(b.availability), 1),
    }))
    .sort((a, b) => (b.avgRatePerMile ?? 0) - (a.avgRatePerMile ?? 0));
  return { reportDate: date, lanes: week.length, regions };
}

/** Reefer truck shipments (10,000-unit loads) for the latest week, by region. */
export function normalizeReeferVolumes(rows) {
  const { date, rows: week } = latestRows(rows);
  const byRegion = new Map();
  for (const row of week) {
    if (row.mode && String(row.mode).toUpperCase() !== 'TRUCK') continue;
    const value = toNumber(row.tenkunits);
    if (value === null) continue;
    const region = titleCase(row.region) || 'Unknown';
    byRegion.set(region, (byRegion.get(region) ?? 0) + value);
  }
  const regions = [...byRegion.entries()]
    .map(([region, tenKUnits]) => ({ region, tenKUnits: round(tenKUnits, 1) }))
    .sort((a, b) => b.tenKUnits - a.tenKUnits);
  const total = round(
    regions.reduce((sum, r) => sum + r.tenKUnits, 0),
    1,
  );
  return { reportDate: date, total, regions };
}

/** Diesel $/gal by region for the latest week, with the change from the week before. */
export function normalizeDiesel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const dates = [...new Set(list.map((r) => r?.date).filter(Boolean))]
    .sort()
    .reverse();
  const [latest, prior] = dates;
  const priceAt = (date, region) =>
    toNumber(
      list.find((r) => r.date === date && r.region === region)?.diesel_price,
    );
  const regions = list
    .filter((r) => r.date === latest)
    .map((r) => {
      const price = toNumber(r.diesel_price);
      const before = prior ? priceAt(prior, r.region) : null;
      return {
        region: r.region,
        price: round(price, 3),
        change:
          price !== null && before !== null ? round(price - before, 3) : null,
      };
    });
  return {
    reportDate: isoDay(latest),
    us: regions.find((r) => r.region === 'US') ?? null,
    regions,
  };
}

/** BTS freight TSI and seasonally adjusted truck tonnage index, newest first. */
export function normalizeTsi(rows) {
  const series = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      month: isoDay(r.obs_date)?.slice(0, 7) ?? null,
      freightTsi: toNumber(r.tsi_freight),
      freightTsiChangePct: toNumber(r.tsi_freight_c),
      truckTonnage: toNumber(r.truck_d11),
    }))
    .filter((r) => r.month && r.freightTsi !== null)
    .sort((a, b) => (a.month < b.month ? 1 : -1));
  return { latest: series[0] ?? null, series: series.slice(0, 13) };
}

/**
 * Loaders for the keyless logistics feeds.
 * @param {{fetchImpl: typeof fetch, env: () => object}} deps
 */
export function logisticsLoaders({ fetchImpl, env }) {
  const headers = () => {
    const token = envValue(env(), 'SOCRATA_APP_TOKEN');
    return token ? { 'X-App-Token': token } : {};
  };
  const soda = (origin, id, params) =>
    getJson(fetchImpl, sodaUrl(origin, id, params), { headers: headers() });
  // Newest rows only: a week of rates is a few hundred lanes.
  return {
    reeferRates: async () =>
      normalizeReeferRates(
        await soda(AGTRANSPORT_ORIGIN, DATASETS.reeferRates, {
          $order: 'date DESC',
          $limit: 500,
        }),
      ),
    reeferVolumes: async () =>
      normalizeReeferVolumes(
        await soda(AGTRANSPORT_ORIGIN, DATASETS.reeferVolumes, {
          $order: 'date DESC',
          $limit: 2000,
        }),
      ),
    diesel: async () =>
      normalizeDiesel(
        await soda(AGTRANSPORT_ORIGIN, DATASETS.diesel, {
          $order: 'date DESC',
          $limit: 40,
        }),
      ),
    tsi: async () =>
      normalizeTsi(
        await soda(BTS_ORIGIN, DATASETS.tsi, {
          $select: 'obs_date,tsi_freight,tsi_freight_c,truck_d11',
          $where: 'tsi_freight IS NOT NULL',
          $order: 'obs_date DESC',
          $limit: 13,
        }),
      ),
  };
}
