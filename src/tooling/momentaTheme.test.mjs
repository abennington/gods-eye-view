import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MOMENTA_RGB_MAP,
  isMomentaTheme,
  momentaPostcssPlugin,
  momentaThemePlugin,
  remapCss,
  remapJsColors,
} from '../../build/momentaTheme.js';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('isMomentaTheme accepts only the momenta value', () => {
  assert.equal(isMomentaTheme('momenta'), true);
  assert.equal(isMomentaTheme(' Momenta '), true);
  assert.equal(isMomentaTheme(''), false);
  assert.equal(isMomentaTheme(undefined), false);
  assert.equal(isMomentaTheme('default'), false);
});

test('remapCss swaps the cyan accent for mint in every rgb form, keeping alpha', () => {
  assert.equal(remapCss('rgba(0, 212, 255, 0.4)'), 'rgba(56, 243, 180, 0.4)');
  assert.equal(remapCss('rgba(0,212,255,.4)'), 'rgba(56, 243, 180,.4)');
  assert.equal(remapCss('rgb(0 212 255 / 28%)'), 'rgb(56 243 180 / 28%)');
  assert.equal(remapCss('rgb(0, 212, 255)'), 'rgb(56, 243, 180)');
  assert.equal(remapCss('#00D4FF'), '#38f3b4');
});

test('remapCss leaves colors outside the palette map untouched', () => {
  const css =
    'color: rgba(255, 159, 67, 0.5); background: #ff0000; border: rgba(0, 0, 0, 0.3)';
  assert.equal(remapCss(css), css);
});

test('remapCss rewrites a gradient with several mapped stops', () => {
  assert.equal(
    remapCss(
      'linear-gradient(90deg, rgb(0 212 255 / 28%), rgba(0, 212, 255, 0.18) 58%, transparent)',
    ),
    'linear-gradient(90deg, rgb(56 243 180 / 28%), rgba(56, 243, 180, 0.18) 58%, transparent)',
  );
});

test('every mapped source color is unique and no target is itself a source', () => {
  const sources = MOMENTA_RGB_MAP.map(([from]) => from);
  assert.equal(new Set(sources).size, sources.length);
  for (const [, to] of MOMENTA_RGB_MAP) assert.ok(!sources.includes(to), to);
});

test('remapJsColors touches only quoted hex literals in the map', () => {
  assert.equal(
    remapJsColors("export const TRAIL_COLOR = '#00d4ff';"),
    "export const TRAIL_COLOR = '#38f3b4';",
  );
  assert.equal(remapJsColors('const x = "#123456";'), 'const x = "#123456";');
  assert.equal(
    remapJsColors('// #00d4ff in a comment'),
    '// #00d4ff in a comment',
  );
});

test('the PostCSS pass skips dependency stylesheets', () => {
  const plugin = momentaPostcssPlugin(ROOT);
  const own = {
    value: 'rgba(0, 212, 255, 1)',
    source: { input: { file: path.join(ROOT, 'src/ui/styles/x.css') } },
  };
  const dep = {
    value: 'rgba(0, 212, 255, 1)',
    source: { input: { file: path.join(ROOT, 'node_modules/cesium/x.css') } },
  };
  plugin.Declaration(own);
  plugin.Declaration(dep);
  assert.equal(own.value, 'rgba(56, 243, 180, 1)');
  assert.equal(dep.value, 'rgba(0, 212, 255, 1)');
});

test('the plugin is off unless enabled, and appends the theme layer to style.css', () => {
  assert.equal(
    momentaThemePlugin({ enabled: false, root: ROOT }).apply(),
    false,
  );
  const plugin = momentaThemePlugin({ enabled: true, root: ROOT });
  assert.equal(plugin.apply(), true);
  const out = plugin.transform(
    '@import "./a.css";',
    path.join(ROOT, 'style.css'),
  );
  assert.match(
    out.code,
    /@import '\.\/src\/ui\/styles\/theme-momenta\.css';\s*$/,
  );
  assert.match(
    plugin.transformIndexHtml('<meta name="theme-color" content="#0a0a0f" />'),
    /content="#00211f"/,
  );
});

test('the theme layer uses no source color the remap would rewrite', () => {
  const css = readFileSync(
    path.join(ROOT, 'src/ui/styles/theme-momenta.css'),
    'utf8',
  );
  assert.equal(remapCss(css), css);
});

test('the hue rule rotates unnamed cyan and blue-black, and spares emerald, warm and gray', () => {
  // Unnamed sky accent -> a mint-hued color.
  const [r, g, b] = remapCss('rgba(98, 181, 255, 1)').match(/\d+/g).map(Number);
  assert.ok(g > r && g > b, `expected mint-dominant, got ${r},${g},${b}`);
  // Navy-black surface -> emerald-hued dark.
  const dark = remapCss('rgba(7, 25, 35, 0.9)');
  const [dr, dg, db] = dark.match(/\d+/g).map(Number);
  assert.ok(Math.abs(dg - db) <= 2 && dr < dg, dark);
  assert.match(dark, /, 0\.9\)$/);
  // Brand emerald scale, warm status colors and neutrals are left alone.
  for (const css of [
    '#0f5f5e',
    '#064c4c',
    'rgba(255, 159, 67, 1)',
    'rgba(128, 128, 128, 1)',
  ]) {
    assert.equal(remapCss(css), css);
  }
});
