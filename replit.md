# Running on Replit

This checkout keeps the existing Vue, Cesium, and Vite standalone architecture.
Vite serves the development app. Publishing uses an Express production server
for the compiled frontend and the same provider API middleware.

## Start

- Use the **Run** button / **Start application** workflow.
- The workflow runs `npm run dev` on `0.0.0.0:5000`, with the Replit domains added
  to the existing explicit host allowlist.
- Node.js 24 is required (currently 24.22.3); do not switch to the imported
  Node 20 runtime.
- To restore dependencies, run `npm ci`. Puppeteer's browser download is
  disabled by the existing `PUPPETEER_SKIP_DOWNLOAD=1` setting.
- Run `npm run doctor` for setup diagnostics and `npm run build` to check
  the browser build. A static build alone does not include the provider APIs.

## Publish

- Keep the Reserved VM target: the provider APIs maintain caches and live feeds.
- Build command: `npm ci && npm run build`.
- Run command: `npm start` (Node runs `server/standalone/production.js`).
- The server binds to `HOST` (default `0.0.0.0`) and `PORT` (default `5000`).
  It adds `REPLIT_DOMAINS` to the explicit host allowlist.
- Publishing blocks `npm run dev` as an insecure development configuration.
  Do not work around that check by renaming the Vite command or using
  `vite preview`. The production server serves only `dist` and does not expose
  source files, development compilation, or HMR.
- Provider HTTP adapters are shared through their existing preview hooks;
  development-only hooks, the credential writer, and local MCP stay disabled.
  Configure production credentials through Replit Secrets.
- `node --test server/standalone/production.test.mjs` covers static serving,
  API routing, CSP, host refusal, source isolation, and provider teardown.

## Preview security

Only when running the development server with `REPLIT_DEV_DOMAIN` present,
the standalone configuration allows framing by Replit's editor origins.
Other CSP directives, API response protection, and host checks remain enabled.
Non-Replit and production builds retain the upstream framing policy.

## Optional services

No API keys are needed for the keyless globe, satellite imagery, and public
feeds. Voice, AISStream vessels, FIRMS fires, Google Maps/photorealistic 3D,
and other premium providers require their own credentials and may have costs.
Use Replit Secrets for credentials; never commit them. See `.env.example`
and the upstream README for supported provider variable names.
The provider-settings key writer is intentionally restricted to local peers;
do not relax it to make remote key entry work.

## Dependency compatibility

The imported Vite pin was blocked by the package security firewall. Vite and
its Vue plugin were updated together to supported versions. Happy DOM and
its global registrator were also updated to address high-severity test-tool
advisories. These changed dependencies are pinned exactly.
The audit found no runtime vulnerabilities; five moderate findings remain
in the existing Vue test-utils dependency chain.
