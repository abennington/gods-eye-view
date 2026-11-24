// src/ui/views/panels/AgriMarketsPanel.test.mjs — Markets & Freight renders
// /api/agri/summary: keyed feeds without a key say which Replit Secret to add,
// live feeds show their numbers, and Refresh asks the owner again.
import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import AgriMarketsPanel from './AgriMarketsPanel.vue';
import { createAgriMarketsOwner, feedState } from '../../agri/agriMarketsOwner.js';

const SUMMARY = {
  feeds: {
    'poultry-market': { status: 'no_key', keyEnv: 'USDA_MARS_API_KEY' },
    'nass-poultry': { status: 'no_key', keyEnv: 'USDA_NASS_API_KEY' },
    'cold-storage': {
      status: 'ok',
      data: { series: [{ name: 'CHICKENS, FROZEN - STOCKS, MEASURED IN LB', period: 'END OF OCT 2026', value: 800000000, unit: 'LB', yoyPct: -20 }] },
    },
    diesel: { status: 'ok', data: { reportDate: '2026-11-16', us: { region: 'US', price: 5.937, change: -0.19 } } },
    'reefer-rates': {
      status: 'stale',
      data: { reportDate: '2026-11-17', regions: [{ region: 'Arizona', lanes: 12, avgRatePerMile: 4.54, availability: 4 }] },
    },
    'reefer-volumes': { status: 'ok', data: { reportDate: '2026-11-17', total: 51.2 } },
    'freight-index': { status: 'error', error: 'upstream_503' },
  },
};

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
};

test('panel renders each feed by its state', async (t) => {
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls += 1;
    assert.equal(url, '/api/agri/summary');
    return new Response(JSON.stringify(SUMMARY), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  document.body.replaceChildren();
  const app = createApp(AgriMarketsPanel).use(createPinia());
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  await settle();
  const text = document.getElementById('agri-markets-panel').textContent;
  assert.match(text, /Add USDA_MARS_API_KEY in Replit Secrets/);
  assert.match(text, /Add USDA_NASS_API_KEY in Replit Secrets/);
  assert.match(text, /CHICKENS, FROZEN - STOCKS/);
  assert.match(text, /-20%/);
  assert.match(text, /\$5\.937\/gal/);
  assert.match(text, /Arizona/);
  assert.match(text, /\$4\.54\/mi/);
  assert.match(text, /STALE/);
  const refresh = [...document.querySelectorAll('#agri-markets-panel button')].find((b) => b.textContent.trim() === 'REFRESH');
  refresh.click();
  await settle();
  assert.equal(calls, 2);
});

test('owner keeps the last feeds when a refresh fails and pauses while hidden', async () => {
  const views = [];
  let fail = false;
  let fetches = 0;
  const timers = [];
  const doc = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const owner = createAgriMarketsOwner({
    publish: (v) => views.push(v),
    fetchImpl: async () => {
      fetches += 1;
      if (fail) throw new Error('offline');
      return new Response(JSON.stringify(SUMMARY), { status: 200 });
    },
    doc,
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: () => {},
  });
  owner.start();
  await settle();
  assert.equal(owner.view.feeds.diesel.status, 'ok');
  fail = true;
  await owner.refresh();
  assert.equal(owner.view.error, 'offline');
  assert.equal(owner.view.feeds.diesel.status, 'ok');
  doc.visibilityState = 'hidden';
  const before = fetches;
  timers.at(-1)();
  await settle();
  assert.equal(fetches, before);
  owner.stop();
  assert.equal(feedState({ status: 'no_key' }), 'key');
  assert.equal(feedState(undefined), 'loading');
});
