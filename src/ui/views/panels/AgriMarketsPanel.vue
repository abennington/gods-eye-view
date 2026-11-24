<script setup>
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted } from 'vue';
import { formatDate, formatNumber, msg, t } from '../../../i18n/index.js';
import UiBadge from '../../kit/UiBadge.vue';
import UiButton from '../../kit/UiButton.vue';
import RailPanel from '../../rail/RailPanel.vue';
import { feedState } from '../../agri/agriMarketsOwner.js';
import { installAgriMarkets } from '../../agri/installAgriMarkets.js';
import { useAgriMarketsStore } from '../../stores/agriMarkets.js';

// Markets & Freight (fork-local, docs/agri-feeds.md): USDA poultry market
// news, NASS poultry and Cold Storage series, and public trucking signals,
// as /api/agri/summary serves them. The panel renders what the owner
// publishes; Refresh returns to it through the store.
const store = useAgriMarketsStore();
const { view } = storeToRefs(store);
let uninstall = null;
onMounted(() => {
  uninstall = installAgriMarkets(store);
});
onUnmounted(() => uninstall?.());

const STATE_LABELS = {
  loading: msg('LOADING'),
  live: msg('LIVE'),
  stale: msg('STALE'),
  key: msg('KEY NEEDED'),
  error: msg('UNAVAILABLE'),
};
const feeds = computed(() => view.value?.feeds ?? {});
const feed = (name) => feeds.value[name];
const state = (name) => (view.value?.checkedAt ? feedState(feed(name)) : 'loading');
const label = (name) => t(STATE_LABELS[state(name)]);
const data = (name) => feed(name)?.data ?? null;

const num = (value, digits = 2) =>
  value === null || value === undefined
    ? '--'
    : formatNumber(value, { maximumFractionDigits: digits });
const compact = (value) =>
  value === null || value === undefined
    ? '--'
    : formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 });
const signed = (value, digits = 1, suffix = '%') =>
  value === null || value === undefined
    ? ''
    : `${value > 0 ? '+' : ''}${formatNumber(value, { maximumFractionDigits: digits })}${suffix}`;
const usd = (value, digits = 2) =>
  value === null || value === undefined
    ? '--'
    : formatNumber(value, { style: 'currency', currency: 'USD', maximumFractionDigits: digits });
const day = (iso) =>
  iso ? formatDate(new Date(iso), { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '--';
const trend = (value) => (value > 0 ? 'up' : value < 0 ? 'down' : 'flat');

const marsReports = computed(() => data('poultry-market')?.reports ?? []);
const nassPoultry = computed(() => data('nass-poultry')?.series ?? []);
const coldStorage = computed(() => data('cold-storage')?.series ?? []);
const diesel = computed(() => data('diesel'));
const rates = computed(() => data('reefer-rates'));
const volumes = computed(() => data('reefer-volumes'));
const tsi = computed(() => data('freight-index')?.latest ?? null);
const checked = computed(() =>
  view.value?.checkedAt
    ? formatDate(new Date(view.value.checkedAt), { hour: 'numeric', minute: '2-digit' })
    : null,
);
</script>

<template>
  <RailPanel id="agri-markets-panel" start-collapsed :title="t('MARKETS & FREIGHT')" :hint="t('USDA poultry, cold storage and trucking signals')" scroll>
    <div class="agri-panel" data-rail-scroller>
      <div class="agri-toolbar">
        <span class="agri-checked" role="status" aria-live="polite">
          <template v-if="view?.loading">{{ t('Refreshing…') }}</template>
          <template v-else-if="view?.error">{{ t('Refresh failed; showing last data') }}</template>
          <template v-else-if="checked">{{ t('Checked {time}', { time: checked }) }}</template>
        </span>
        <UiButton type="button" class="gev-action-button scene-btn" :disabled="Boolean(view?.loading)" @click="store.act('refresh')">{{ t('REFRESH') }}</UiButton>
      </div>

      <!-- Poultry: AMS Market News (MARS) -->
      <section class="agri-section" aria-labelledby="agri-poultry-h">
        <header class="agri-section-head">
          <h3 id="agri-poultry-h">{{ t('Poultry market news') }}</h3>
          <UiBadge :data-agri-state="state('poultry-market')">{{ label('poultry-market') }}</UiBadge>
        </header>
        <p v-if="state('poultry-market') === 'key'" class="agri-hint">{{ t('Add {key} in Replit Secrets.', { key: feed('poultry-market').keyEnv }) }}</p>
        <p v-else-if="state('poultry-market') === 'error'" class="agri-hint">{{ t('{source} did not answer ({error}).', { source: 'USDA AMS', error: feed('poultry-market').error }) }}</p>
        <ul v-else class="agri-list">
          <li v-for="report in marsReports" :key="report.slug" class="agri-report">
            <a :href="report.url" target="_blank" rel="noopener noreferrer" class="agri-report-title" :title="report.title">{{ report.title }}</a>
            <span class="agri-meta">{{ day(report.reportDate || report.published) }}</span>
            <ul class="agri-quotes">
              <li v-for="(item, i) in report.items.slice(0, 3)" :key="i">
                <span class="agri-quote-label" :title="item.label">{{ item.label }}</span>
                <span class="agri-value">{{ num(item.value, 3) }}<small v-if="item.unit">&nbsp;{{ item.unit }}</small></span>
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <!-- Poultry: NASS Quick Stats -->
      <section class="agri-section" aria-labelledby="agri-nass-h">
        <header class="agri-section-head">
          <h3 id="agri-nass-h">{{ t('Poultry prices & hatchery') }}</h3>
          <UiBadge :data-agri-state="state('nass-poultry')">{{ label('nass-poultry') }}</UiBadge>
        </header>
        <p v-if="state('nass-poultry') === 'key'" class="agri-hint">{{ t('Add {key} in Replit Secrets.', { key: feed('nass-poultry').keyEnv }) }}</p>
        <p v-else-if="state('nass-poultry') === 'error'" class="agri-hint">{{ t('{source} did not answer ({error}).', { source: 'USDA NASS', error: feed('nass-poultry').error }) }}</p>
        <ul v-else class="agri-list">
          <li v-for="s in nassPoultry" :key="s.name" class="agri-row">
            <span class="agri-quote-label" :title="s.name">{{ s.name }}<small class="agri-meta"> {{ s.period }}</small></span>
            <span class="agri-value">{{ compact(s.value) }}<small v-if="s.unit">&nbsp;{{ s.unit }}</small> <small :data-trend="trend(s.changePct)">{{ signed(s.changePct) }}</small></span>
          </li>
        </ul>
      </section>

      <!-- Cold Storage -->
      <section class="agri-section" aria-labelledby="agri-cold-h">
        <header class="agri-section-head">
          <h3 id="agri-cold-h">{{ t('Cold storage stocks') }}</h3>
          <UiBadge :data-agri-state="state('cold-storage')">{{ label('cold-storage') }}</UiBadge>
        </header>
        <p v-if="state('cold-storage') === 'key'" class="agri-hint">{{ t('Add {key} in Replit Secrets.', { key: feed('cold-storage').keyEnv }) }}</p>
        <p v-else-if="state('cold-storage') === 'error'" class="agri-hint">{{ t('{source} did not answer ({error}).', { source: 'USDA NASS', error: feed('cold-storage').error }) }}</p>
        <ul v-else class="agri-list">
          <li v-for="s in coldStorage" :key="s.name" class="agri-row">
            <span class="agri-quote-label" :title="s.name">{{ s.name }}<small class="agri-meta"> {{ s.period }}</small></span>
            <span class="agri-value">{{ compact(s.value) }}<small v-if="s.unit">&nbsp;{{ s.unit }}</small> <small :data-trend="trend(s.yoyPct)" :title="t('Change from a year earlier')">{{ signed(s.yoyPct) }}</small></span>
          </li>
        </ul>
      </section>

      <!-- Trucking & freight (keyless) -->
      <section class="agri-section" aria-labelledby="agri-freight-h">
        <header class="agri-section-head">
          <h3 id="agri-freight-h">{{ t('Trucking & freight') }}</h3>
          <UiBadge :data-agri-state="state('reefer-rates')">{{ label('reefer-rates') }}</UiBadge>
        </header>
        <dl class="agri-stats">
          <div v-if="diesel?.us">
            <dt>{{ t('US diesel, week of {date}', { date: day(diesel.reportDate) }) }}</dt>
            <dd>{{ t('{price}/gal', { price: usd(diesel.us.price, 3) }) }} <small :data-trend="trend(diesel.us.change)">{{ signed(diesel.us.change, 3, '') }}</small></dd>
          </div>
          <div v-if="volumes">
            <dt>{{ t('Reefer truck loads, week of {date}', { date: day(volumes.reportDate) }) }}</dt>
            <dd>{{ t('{count}k units', { count: num((volumes.total ?? 0) * 10, 0) }) }}</dd>
          </div>
          <div v-if="tsi">
            <dt>{{ t('Freight TSI, {month}', { month: tsi.month }) }}</dt>
            <dd>{{ num(tsi.freightTsi, 1) }} <small :data-trend="trend(tsi.freightTsiChangePct)">{{ signed(tsi.freightTsiChangePct) }}</small> · {{ t('truck tonnage {value}', { value: num(tsi.truckTonnage, 1) }) }}</dd>
          </div>
        </dl>
        <template v-if="rates?.regions?.length">
          <h4 class="agri-sub">{{ t('Reefer rates by shipping region, {date}', { date: day(rates.reportDate) }) }}</h4>
          <ul class="agri-list">
            <li v-for="r in rates.regions.slice(0, 8)" :key="r.region" class="agri-row">
              <span class="agri-quote-label">{{ r.region }}</span>
              <span class="agri-value">{{ t('{rate}/mi', { rate: usd(r.avgRatePerMile) }) }} <small :title="t('Truck availability, 1 surplus to 5 shortage')">{{ t('avail {value}', { value: num(r.availability, 1) }) }}</small></span>
            </li>
          </ul>
        </template>
        <p v-else-if="state('reefer-rates') === 'error'" class="agri-hint">{{ t('{source} did not answer ({error}).', { source: 'USDA AgTransport', error: feed('reefer-rates').error }) }}</p>
      </section>

      <p class="agri-credit">{{ t('Sources: USDA AMS Market News, USDA NASS Quick Stats, USDA AgTransport, BTS. Public domain.') }}</p>
    </div>
  </RailPanel>
</template>

<style scoped>
.agri-panel { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; min-width: 0; padding: 4px 2px 8px; font: 11px/1.4 var(--font-mono); color: var(--text-primary); }
.agri-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.agri-checked, .agri-meta, .agri-credit { color: var(--text-secondary, inherit); opacity: 0.8; }
.agri-section { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 4px; padding-top: 6px; border-top: 1px solid var(--glass-border, rgb(255 255 255 / 12%)); }
.agri-section-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.agri-section-head h3, .agri-sub { margin: 0; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
.agri-sub { opacity: 0.8; margin-top: 4px; }
.agri-list, .agri-quotes { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; min-width: 0; }
.agri-quotes { padding-left: 8px; }
.agri-row, .agri-quotes li { display: flex; justify-content: space-between; gap: 8px; }
.agri-quote-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agri-value { flex: 0 0 auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
.agri-report { min-width: 0; }
.agri-report-title { display: inline-block; max-width: 72%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; color: inherit; font-weight: 600; text-decoration: none; }
.agri-report-title:hover { text-decoration: underline; }
.agri-report .agri-meta { margin-left: 6px; }
.agri-hint { margin: 0; opacity: 0.85; }
.agri-stats { margin: 0; display: grid; gap: 4px; }
.agri-stats div { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: 8px; min-width: 0; }
.agri-stats dt { min-width: 0; }
.agri-stats dt { opacity: 0.8; }
.agri-stats dd { margin: 0 0 0 auto; white-space: nowrap; }
[data-trend='up'] { color: var(--accent-success, #5fd38d); }
[data-trend='down'] { color: var(--accent-danger, #ff6b6b); }
.agri-credit { margin: 0; font-size: 10px; }
</style>

<style>
/* Rail placement, mirroring #utilities-panel (scenes.css, layers.css,
   controls.css, recording.css, responsive.css, mobile-shell.css), kept here
   so the fork-local panel touches no upstream stylesheet. */
#agri-markets-panel {
  --panel-expanded-width: var(--side-panel-min-expanded-width, 295px);
  width: var(--panel-expanded-width);
}
#left-panel-stack > #agri-markets-panel {
  position: relative;
  inset: auto;
  z-index: auto;
  max-height: none;
  flex: 0 0 auto;
  min-height: 0;
  order: 3;
  pointer-events: auto;
}
#left-panel-stack > #agri-markets-panel:not(.collapsed) {
  box-sizing: border-box;
  flex: 0 1 var(--left-panel-allocated-height, auto);
  height: var(--left-panel-allocated-height, auto);
  max-height: var(--left-panel-allocated-height, 100%);
}
#left-panel-stack.layout-tail > #agri-markets-panel:not(.collapsed) {
  flex: 0 0 var(--left-panel-allocated-height);
  height: var(--left-panel-allocated-height);
  max-height: var(--left-panel-allocated-height);
}
#left-panel-stack > #agri-markets-panel:not(.collapsed) .agri-markets-panel-inner {
  height: 100%;
  max-height: 100%;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
#agri-markets-panel .agri-markets-panel-inner {
  position: relative;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--panel-radius);
  padding: 14px 16px 12px;
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 1px 0 rgba(255, 255, 255, 0.06) inset;
  max-height: min(
    620px,
    calc(100vh - var(--left-stack-top) - var(--left-stack-gap) - 36px)
  );
  display: flex;
  flex-direction: column;
  min-height: 0;
}
#agri-markets-panel.collapsed { width: var(--left-collapsed-width); }
#agri-markets-panel.collapsed .agri-panel { display: none !important; }
#agri-markets-panel.collapsed .agri-markets-panel-inner { padding-bottom: 10px; }
#agri-markets-panel.collapsed .panel-header { margin-bottom: 2px; }
#agri-markets-panel .panel-glow {
  position: absolute;
  inset: -20px;
  background: radial-gradient(ellipse at center, var(--accent-dim) 0%, transparent 60%);
  pointer-events: none;
}
body.ui-clean-view #agri-markets-panel,
body.recording-mode #agri-markets-panel,
body.cockpit-mode #left-panel-stack > #agri-markets-panel {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
body.mobile-shell[data-mobile-sheet='layers'] #left-panel-stack > #agri-markets-panel {
  position: relative;
  inset: auto;
  display: block;
  width: 100%;
  max-width: none;
  margin: 0;
  transform: none;
}
@media (max-width: 720px) {
  #left-panel-stack > #agri-markets-panel,
  #left-panel-stack > #agri-markets-panel.collapsed {
    position: relative;
    inset: auto;
    width: 100%;
  }
}
</style>
