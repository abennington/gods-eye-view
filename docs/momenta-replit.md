# Momenta theme + Replit hosting

Fork-local additions. Upstream files are left untouched apart from one plugin
line in `server/standalone/vite.config.js`, so pulls from upstream stay clean.

## Momenta Technologies theme

```bash
GEV_THEME=momenta npm run dev
```

| Piece                               | Role                                                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build/momentaTheme.js`             | Vite plugin. A PostCSS pass remaps the upstream cyan/navy palette to Momenta emerald + mint as stylesheets are served (exact brand values from a table, then a hue rule for the long tail). Also remaps globe trail/selection hex colors in `src/**/*.js`. |
| `src/ui/styles/theme-momenta.css`   | Theme layer appended after every upstream sheet: tokens, sharp radii (6px/4px), Momenta motion, mint focus ring, Gilroy headings.                                                                                                                          |
| `public/fonts/momenta/`             | Drop-in slot for the licensed Gilroy / FT Calhern files (git-ignored).                                                                                                                                                                                     |
| `src/tooling/momentaTheme.test.mjs` | Unit tests for the remap and plugin wiring.                                                                                                                                                                                                                |

Unset `GEV_THEME` to get the upstream look back. No source stylesheet changes.

## Replit

`.replit` runs the Vite server (which is the whole app, API proxies included)
on port 5000 and trusts `REPLIT_DEV_DOMAIN` / `REPLIT_DOMAINS` via
`GEV_ALLOWED_HOSTS`. Deploy as a **Reserved VM**.

Keys go in **Replit Secrets** (same names as `.env.example`). The in-app
POWER UP panel refuses proxied requests by design and cannot save keys there.

A public deployment brokers your keys to anyone with the URL. Before adding
cost-bearing keys (OpenAI, Google Maps), set provider-side quotas and billing
caps, restrict the Google key by HTTP referrer, or use Replit's private
deployment option.
