import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFeedCache } from './cache.js';
import { createAgriFeeds } from './index.js';
import {
  normalizeDiesel,
  normalizeReeferRates,
  normalizeReeferVolumes,
  normalizeTsi,
} from './logistics.js';
import { marsDate, normalizeMarsReport, pickPoultryReports } from './mars.js';
import { nassUrl, normalizeNassSeries } from './nass.js';

const jsonResponse = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('feed cache serves fresh, refreshes when due and falls back to stale', async () => {
  let clock = 0;
  let calls = 0;
  let fail = false;
  const cache = createFeedCache({
    ttlMs: 100,
    staleMs: 1000,
    retryMs: 50,
    now: () => clock,
  });
  const load = async () => {
    calls += 1;
    if (fail) throw Object.assign(new Error('x'), { code: 'upstream_500' });
    return calls;
  };
  assert.deepEqual(await cache.get('a', load), {
    value: 1,
    fetchedAt: 0,
    stale: false,
  });
  clock = 50;
  assert.equal((await cache.get('a', load)).value, 1);
  assert.equal(calls, 1);
  clock = 150;
  fail = true;
  const stale = await cache.get('a', load);
  assert.equal(stale.value, 1);
  assert.equal(stale.stale, true);
  clock = 160; // inside retry window: no new call
  await cache.get('a', load);
  assert.equal(calls, 2);
  clock = 2000;
  await assert.rejects(cache.get('a', load), { code: 'upstream_500' });
});

test('feed cache shares one upstream call between concurrent misses', async () => {
  let calls = 0;
  const cache = createFeedCache({ ttlMs: 100, staleMs: 100 });
  const load = () =>
    new Promise((resolve) => setTimeout(() => resolve(++calls), 5));
  const [a, b] = await Promise.all([
    cache.get('k', load),
    cache.get('k', load),
  ]);
  assert.equal(a.value, 1);
  assert.equal(b.value, 1);
  assert.equal(calls, 1);
});

test('reefer rates average by region for the newest week only', () => {
  const rows = [
    {
      date: '2026-11-17T00:00:00.000',
      region: 'ARIZONA',
      rpm: '4',
      midpoint: '10000',
      availability: '4',
    },
    {
      date: '2026-11-17T00:00:00.000',
      region: 'ARIZONA',
      rpm: '5',
      midpoint: '12000',
      availability: '3',
    },
    {
      date: '2026-11-17T00:00:00.000',
      region: 'FLORIDA',
      rpm: '3',
      midpoint: '5000',
      availability: '2',
    },
    {
      date: '2026-11-10T00:00:00.000',
      region: 'ARIZONA',
      rpm: '9',
      midpoint: '1',
      availability: '1',
    },
  ];
  const out = normalizeReeferRates(rows);
  assert.equal(out.reportDate, '2026-11-17');
  assert.equal(out.lanes, 3);
  assert.deepEqual(out.regions[0], {
    region: 'Arizona',
    lanes: 2,
    avgRatePerMile: 4.5,
    avgLoadRate: 11000,
    availability: 3.5,
  });
});

test('reefer volumes sum truck loads by region', () => {
  const out = normalizeReeferVolumes([
    {
      date: '2026-11-17T00:00:00.000',
      region: 'CALIFORNIA',
      mode: 'TRUCK',
      tenkunits: '2.28',
    },
    {
      date: '2026-11-17T00:00:00.000',
      region: 'CALIFORNIA',
      mode: 'TRUCK',
      tenkunits: '9.89',
    },
    {
      date: '2026-11-17T00:00:00.000',
      region: 'CALIFORNIA',
      mode: 'RAIL',
      tenkunits: '50',
    },
  ]);
  assert.equal(out.total, 12.2);
  assert.deepEqual(out.regions, [{ region: 'California', tenKUnits: 12.2 }]);
});

test('diesel reports the latest week and its weekly change', () => {
  const out = normalizeDiesel([
    { date: '2026-11-16T00:00:00.000', region: 'US', diesel_price: '5.937' },
    { date: '2026-11-09T00:00:00.000', region: 'US', diesel_price: '6.127' },
  ]);
  assert.equal(out.reportDate, '2026-11-16');
  assert.deepEqual(out.us, { region: 'US', price: 5.937, change: -0.19 });
});

test('freight TSI is newest first', () => {
  const out = normalizeTsi([
    {
      obs_date: '2026-08-01T00:00:00.000',
      tsi_freight: '135.3',
      truck_d11: '113.1',
    },
    {
      obs_date: '2026-09-01T00:00:00.000',
      tsi_freight: '135.8',
      tsi_freight_c: '0.4',
      truck_d11: '113.7',
    },
  ]);
  assert.deepEqual(out.latest, {
    month: '2026-09',
    freightTsi: 135.8,
    freightTsiChangePct: 0.4,
    truckTonnage: 113.7,
  });
});

test('MARS: poultry reports are picked by title, newest first, and rows normalised', () => {
  assert.equal(marsDate('11/23/2026 14:05:33'), '2026-11-23T14:05:33.000Z');
  const picked = pickPoultryReports([
    {
      slug_id: 1,
      report_title: 'National Daily Hog Report',
      published_date: '11/23/2026',
    },
    {
      slug_id: 2,
      report_title: 'Weekly National Chicken Report',
      published_date: '11/20/2026',
    },
    {
      slug_id: 3,
      report_title: 'Daily National Shell Egg Index',
      published_date: '11/23/2026',
    },
  ]);
  assert.deepEqual(
    picked.map((r) => r.slug),
    ['3', '2'],
  );
  assert.deepEqual(
    pickPoultryReports([{ slug_id: 1, report_title: 'Hogs' }], {
      slugs: ['1'],
    }).map((r) => r.slug),
    ['1'],
  );
  const report = normalizeMarsReport({
    results: [
      {
        report_date: '11/23/2026',
        commodity: 'Eggs',
        class: 'Large',
        wtd_avg_price: '1.2345',
        price_unit: 'Per Dozen',
      },
      {
        report_date: '11/23/2026',
        commodity: 'Eggs',
        class: 'Medium',
        price_min: '1',
        price_max: '2',
      },
      { report_date: '11/23/2026', commodity: 'Eggs', note: 'no prices' },
    ],
  });
  assert.equal(report.reportDate, '2026-11-23T00:00:00.000Z');
  assert.deepEqual(report.items[0], {
    label: 'Eggs · Large',
    value: 1.2345,
    low: null,
    high: null,
    unit: 'Per Dozen',
  });
  assert.equal(report.items[1].value, 1.5);
  assert.equal(report.items.length, 2);
});

test('NASS: series keep latest, prior and year-ago changes; withheld cells skipped', () => {
  const row = (year, code, ref, Value) => ({
    short_desc: 'CHICKENS, BROILERS - STOCKS, MEASURED IN LB',
    year,
    begin_code: code,
    reference_period_desc: ref,
    Value,
    unit_desc: 'LB',
    commodity_desc: 'CHICKENS',
  });
  const [series] = normalizeNassSeries([
    row(2026, 10, 'END OF OCT', '800,000,000'),
    row(2026, 9, 'END OF SEP', '750,000,000'),
    row(2025, 10, 'END OF OCT', '1,000,000,000'),
    row(2026, 11, 'END OF NOV', '(D)'),
  ]);
  assert.equal(series.value, 800000000);
  assert.equal(series.period, 'END OF OCT 2026');
  assert.equal(series.changePct, 6.7);
  assert.equal(series.yoyPct, -20);
  const url = new URL(nassUrl('secret', { commodity_desc: 'EGGS' }, 2026));
  assert.equal(url.searchParams.get('year__GE'), '2025');
  assert.equal(url.searchParams.get('agg_level_desc'), 'NATIONAL');
});

test('service: keyed feeds say no_key without calling upstream; keyless feeds load', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (String(url).includes('x88w-atzp'))
      return jsonResponse([
        { date: '2026-11-16T00:00:00.000', region: 'US', diesel_price: '5.9' },
      ]);
    return jsonResponse([]);
  };
  const service = createAgriFeeds({ fetchImpl, env: () => ({}) });
  const summary = await service.summary();
  assert.equal(summary.feeds['poultry-market'].status, 'no_key');
  assert.equal(summary.feeds['poultry-market'].keyEnv, 'USDA_MARS_API_KEY');
  assert.equal(summary.feeds['cold-storage'].status, 'no_key');
  assert.equal(summary.feeds.diesel.status, 'ok');
  assert.equal(summary.feeds.diesel.data.us.price, 5.9);
  assert.ok(
    urls.every((u) => !u.includes('marsapi') && !u.includes('quickstats')),
  );
});

test('service: MARS key goes in Basic auth and errors never carry a URL', async () => {
  let auth = null;
  const fetchImpl = async (url, init) => {
    if (String(url).includes('marsapi')) {
      auth = init.headers.Authorization;
      return jsonResponse({ message: 'nope' }, 401);
    }
    if (String(url).includes('quickstats'))
      return jsonResponse({ error: ['bad key'] }, 401);
    return jsonResponse([]);
  };
  const service = createAgriFeeds({
    fetchImpl,
    env: () => ({ USDA_MARS_API_KEY: 'k1', USDA_NASS_API_KEY: 'k2' }),
  });
  const mars = await service.read('poultry-market');
  assert.equal(auth, `Basic ${Buffer.from('k1:').toString('base64')}`);
  assert.equal(mars.status, 'error');
  assert.equal(mars.error, 'key_rejected');
  const nass = await service.read('cold-storage');
  assert.equal(nass.error, 'key_rejected');
  assert.ok(!JSON.stringify([mars, nass]).includes('k2'));
});
