# Running on Replit

This checkout keeps the existing Vue, Cesium, and Vite standalone architecture.
Vite serves both the browser app and its existing provider API middleware.

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
