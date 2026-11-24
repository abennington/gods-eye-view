/**
 * Momenta Technologies theme, applied at serve/build time.
 *
 * Why a transform instead of editing the stylesheets: this checkout is a fork
 * of a fast-moving upstream, and the UI's colors are ~900 literals spread over
 * 70+ stylesheets (some pinned by tests). Rewriting them in place would
 * conflict on every upstream pull. This plugin leaves the source untouched and
 * remaps the palette as Vite serves it, so the theme is one env var:
 *
 *   GEV_THEME=momenta npm run dev
 *
 * Palette source: the Momenta Technologies design system (tokens/colors.css).
 *   Emerald #00393A (primary canvas) · Mint #38F3B4 (accent) · cool neutrals.
 */

import path from 'node:path';

export const MOMENTA_THEME = 'momenta';

/**
 * Upstream RGB triplet -> Momenta RGB triplet. Grouped by role so a future
 * upstream color can be slotted into the right family.
 * @type {ReadonlyArray<[string, string]>}
 */
export const MOMENTA_RGB_MAP = Object.freeze([
  // Signal cyan family -> mint scale
  ['0,212,255', '56,243,180'], // accent -> mint-400
  ['54,220,255', '111,246,200'], // bright accent -> mint-300
  ['48,194,224', '32,217,151'], // deep accent -> mint-500
  ['65,220,231', '56,243,180'],
  ['34,230,230', '32,217,151'],
  ['0,220,255', '56,243,180'],
  ['150,236,220', '164,249,219'], // mint-200
  // Muted teal-blue family -> emerald scale
  ['100,200,220', '75,165,160'], // emerald-400
  ['123,189,211', '124,193,189'], // emerald-300
  ['190,230,230', '174,220,217'], // emerald-200
  ['190,221,230', '174,220,217'],
  ['199,225,231', '174,220,217'],
  ['225,244,248', '215,238,237'], // emerald-100
  ['206,232,239', '215,238,237'],
  // Cool neutrals -> Momenta neutrals (faint green cast)
  ['199,214,222', '188,200,197'], // neutral-300
  ['225,236,242', '234,239,238'], // neutral-100
  ['236,244,248', '234,239,238'],
  ['232,234,237', '234,239,238'],
  ['244,251,255', '245,248,247'], // neutral-50
  // Dark canvases -> emerald darks
  ['0,7,12', '0,26,25'],
  ['10,10,15', '0,26,25'],
  ['12,12,20', '0,33,31'], // emerald-950
  ['18,18,28', '0,57,58'], // emerald-900
]);

/** Upstream hex -> Momenta hex (lowercase, 6 digits). */
export const MOMENTA_HEX_MAP = Object.freeze({
  '#00d4ff': '#38f3b4',
  '#00dcff': '#38f3b4',
  '#36dcff': '#6ff6c8',
  '#22e6e6': '#20d997',
  '#f4fbff': '#f5f8f7',
  '#0a0a0f': '#00211f',
  '#12121c': '#00393a',
});

const RGB_LOOKUP = new Map(MOMENTA_RGB_MAP);

/** Mint hue (#38F3B4) and emerald hue (#00393A), in degrees. */
const MINT_HUE = 160;
const EMERALD_HUE = 181;

function rgbToHsl(r, g, b) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

/**
 * Palette rule for colors the explicit map does not name. Saturated cyan and
 * sky blues (hue 185-215) rotate onto the mint hue; blue-black surfaces (dark,
 * hue 185-235) rotate onto the emerald hue. Lightness, saturation and alpha
 * are kept, so contrast relationships in the upstream design survive. Anything
 * else (neutrals, warm status colors, emerald itself) is returned as is.
 * @param {number} r @param {number} g @param {number} b
 * @returns {[number, number, number]|null} New RGB, or null when unchanged.
 */
export function momentaHueRule(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.25) return null;
  if (l < 0.2 && h >= 185 && h <= 235) return hslToRgb(EMERALD_HUE, s, l);
  if (l >= 0.2 && h >= 185 && h <= 215) return hslToRgb(MINT_HUE, s, l);
  return null;
}

function mapTriplet(r, g, b) {
  const named = RGB_LOOKUP.get(`${r},${g},${b}`);
  if (named) return named.split(',');
  const ruled = momentaHueRule(Number(r), Number(g), Number(b));
  return ruled ? ruled.map(String) : null;
}

function mapHex(hex) {
  const named = MOMENTA_HEX_MAP[hex.toLowerCase()];
  if (named) return named;
  const [r, g, b] = [1, 3, 5].map((i) =>
    Number.parseInt(hex.slice(i, i + 2), 16),
  );
  const ruled = momentaHueRule(r, g, b);
  return ruled
    ? `#${ruled.map((v) => v.toString(16).padStart(2, '0')).join('')}`
    : hex;
}

/**
 * Remap every palette color in a stylesheet. Matches `rgb(a)(R, G, B` with
 * any comma spacing and the space-separated `rgb(R G B` form; the alpha and
 * the rest of the expression are kept as written.
 * @param {string} css
 * @returns {string}
 */
export function remapCss(css) {
  return String(css)
    .replace(
      /\b(rgba?)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(\s*[,)])/g,
      (match, fn, r, g, b, tail) => {
        const next = mapTriplet(r, g, b);
        return next ? `${fn}(${next.join(', ')}${tail}` : match;
      },
    )
    .replace(
      /\b(rgba?)\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s*[/)])/g,
      (match, fn, r, g, b, tail) => {
        const next = mapTriplet(r, g, b);
        return next ? `${fn}(${next.join(' ')}${tail}` : match;
      },
    )
    .replace(/#[0-9a-f]{6}\b/gi, mapHex);
}

/**
 * Remap quoted hex color literals in a JS module (globe trail and selection
 * colors). Only exact quoted strings are touched, never identifiers or
 * comments.
 * @param {string} code
 * @returns {string}
 */
export function remapJsColors(code) {
  return String(code).replace(
    /(['"])(#[0-9a-fA-F]{6})\1/g,
    (match, quote, hex) => {
      const next = MOMENTA_HEX_MAP[hex.toLowerCase()];
      return next ? `${quote}${next}${quote}` : match;
    },
  );
}

/**
 * Whether the theme is on. Accepts the env value as given.
 * @param {string|undefined|null} value
 */
export function isMomentaTheme(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === MOMENTA_THEME
  );
}

/**
 * PostCSS pass. Runs after `@import` inlining, so it reaches every stylesheet
 * style.css pulls in and every Vue <style> block. node_modules is left alone.
 * @param {string} root
 */
export function momentaPostcssPlugin(root) {
  const nodeModules = `${path.sep}node_modules${path.sep}`;
  return {
    postcssPlugin: 'gev-momenta-theme',
    Declaration(decl) {
      const file = decl.source?.input?.file ?? '';
      if (file && (!file.startsWith(root) || file.includes(nodeModules)))
        return;
      const next = remapCss(decl.value);
      if (next !== decl.value) decl.value = next;
    },
  };
}

/**
 * Vite plugin. A no-op unless `enabled`.
 * @param {{enabled: boolean, root: string}} options
 */
export function momentaThemePlugin({ enabled, root }) {
  const base = path.resolve(root);
  const srcDir = path.join(base, 'src') + path.sep;
  const entryCss = path.join(base, 'style.css');
  return {
    name: 'gev-momenta-theme',
    enforce: 'pre',
    apply: () => enabled,
    config() {
      return { css: { postcss: { plugins: [momentaPostcssPlugin(base)] } } };
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (file === entryCss) {
        // Appended last so the theme layer's tokens win over foundation.css.
        return {
          code: `${code}\n@import './src/ui/styles/theme-momenta.css';\n`,
          map: null,
        };
      }
      if (
        /\.(m?js|vue)$/.test(file) &&
        file.startsWith(srcDir) &&
        !file.includes('.test.')
      ) {
        const next = remapJsColors(code);
        return next === code ? null : { code: next, map: null };
      }
      return null;
    },
    transformIndexHtml(html) {
      return html.replace(
        /<meta name="theme-color" content="[^"]*"\s*\/?>/,
        '<meta name="theme-color" content="#00211f" />',
      );
    },
  };
}
