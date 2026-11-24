# Markets & Freight: USDA poultry, cold storage and trucking feeds

Fork-local addition, like the Momenta theme ([momenta-replit.md](momenta-replit.md)).
It adds one server provider and one left-rail panel; upstream files are touched
only to mount them (one provider line in `server/providers/local.js`, one
component line in `src/ui/views/LayerPanelsView.vue`, one rail icon entry).

## What it shows

| Panel section | Feed (`/api/agri/<feed>`) | Upstream | Key | Server cache | Upstream cadence |
| --- | --- | --- | --- | --- | --- |
| Poultry market news | `poultry-market` | USDA AMS Market News, MARS API `v1.2/reports` | `USDA_MARS_API_KEY` | 15 min | Daily / several a day |
| Poultry prices & hatchery | `nass-poultry` | USDA NASS Quick Stats: chickens, turkeys, eggs PRICE RECEIVED; weekly chicken (Broiler Hatchery) series | `USDA_NASS_API_KEY` | 6 h | Weekly / monthly |
| Cold storage stocks | `cold-storage` | USDA NASS Quick Stats: STOCKS for chickens, turkeys, eggs, beef, pork (Cold Storage report) | `USDA_NASS_API_KEY` | 6 h | Monthly |
| Trucking & freight | `reefer-rates` | USDA AgTransport `acar-e3r8` (Refrigerated Truck Rates and Availability) | none | 1 h | Weekly |
| | `reefer-volumes` | USDA AgTransport `rfpn-7etz` (Refrigerated Truck Volumes) | none | 1 h | Weekly |
| | `diesel` | USDA AgTransport `x88w-atzp` (EIA on-highway diesel) | none | 1 h | Weekly |
| | `freight-index` | BTS `bw6n-ddqk` (Transportation Services Index, truck tonnage) | none | 12 h | Monthly |

`GET /api/agri/summary` returns every feed at once; the panel polls it every 5
minutes while the tab is visible. Because each feed refreshes from upstream at
most once per cache TTL, page traffic never multiplies upstream calls.

Every feed answers the same envelope:

```json
{
  "feed": "cold-storage",
  "status": "ok | stale | no_key | error",
  "fetchedAt": "2026-11-24T05:00:00.000Z",
  "ttlSeconds": 21600,
  "source": { "name": "USDA NASS Cold Storage", "url": "…" },
  "keyEnv": "USDA_NASS_API_KEY",
  "error": "key_rejected",
  "data": {}
}
```

`stale` means the last refresh failed and the last good answer (kept up to 7
days) is served. A failed feed is not retried for 5 minutes. Error codes never
contain a URL, so a key in a query string cannot leak into a response or log.

## Setup on Replit

Add these in **Replit Secrets** (Tools ▸ Secrets). Restart the Repl after
changing them.

| Secret | Get it | Needed for |
| --- | --- | --- |
| `USDA_MARS_API_KEY` | [My Market News API](https://mymarketnews.ams.usda.gov/mymarketnews-api), free account | Poultry market news |
| `USDA_NASS_API_KEY` | [Quick Stats API](https://quickstats.nass.usda.gov/api), free, emailed | Poultry prices, Cold Storage |
| `USDA_MARS_POULTRY_SLUGS` | Optional. Comma list of MARS report slug ids to pin, e.g. specific egg or broiler reports | Overrides the title-based pick |
| `SOCRATA_APP_TOKEN` | Optional. [Socrata app token](https://dev.socrata.com/register) | Higher rate limit for AgTransport and BTS |

The trucking section works with no keys at all.

## Code map

| Piece | Role |
| --- | --- |
| `server/providers/agri/index.js` | Vite plugin (`agriMarketsProxy`), routes, per-feed TTLs, envelope |
| `server/providers/agri/cache.js` | Keyed TTL cache: fresh / stale fallback / retry backoff / shared in-flight |
| `server/providers/agri/upstream.js` | Timeout, byte cap, no redirects, URL-free error codes |
| `server/providers/agri/mars.js` | MARS catalogue pick and generic report-row normaliser |
| `server/providers/agri/nass.js` | Quick Stats queries and series normaliser (latest, change, year-over-year) |
| `server/providers/agri/logistics.js` | AgTransport and BTS SODA queries and normalisers |
| `src/ui/agri/agriMarketsOwner.js` | Framework-free poller that publishes the panel view |
| `src/ui/stores/agriMarkets.js` | Pinia store the panel renders from |
| `src/ui/views/panels/AgriMarketsPanel.vue` | The left-rail panel |

To add a feed: write a loader returning plain JSON, add it to `feedTable()` and
`AGRI_FEEDS` in `index.js` with a TTL and source, then render it in the panel.
Each loader is independent, so the same endpoints can feed an n8n workflow or
any other consumer (`GET /api/agri/<feed>`).

## Not included, and why

- **FMCSA (QCMobile API)** answers per-carrier lookups (by DOT number or
  name), not a market signal, and needs its own web key. It fits a carrier
  lookup feature better than this panel.
- **NASS Cold Storage text release** is not parsed: the same numbers arrive
  as structured Quick Stats rows.

## Tests

```bash
node --test server/providers/agri/agri.test.mjs
node --import=./build/registerVue.js --test src/ui/views/panels/AgriMarketsPanel.test.mjs
```
