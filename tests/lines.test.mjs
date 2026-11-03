import test from 'node:test';
import assert from 'node:assert/strict';
// the renderer modules expect a browser: a minimal stand-in for what they read at load time
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
const { LINES } = await import('../src/renderer/js/lines.js');
const { createRequire } = await import('node:module');
const { TRAY, LANGS } = createRequire(import.meta.url)('../src/main/labels.js');
const { duration } = await import('../src/renderer/js/util.js');

// the shape of every language, as a list of key paths (arrays count as leaves)
function shape(value, prefix = '') {
  // plural forms are an array ([one, other]) or, for Russian, an object by plural category: either way one leaf
  if (Array.isArray(value) || typeof value !== 'object' || value === null || /^units\.\w+$/.test(prefix)) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => shape(v, prefix ? `${prefix}.${k}` : k));
}

test('every language has exactly the keys of English', () => {
  const reference = shape(LINES.en).sort();
  for (const lang of Object.keys(LINES)) {
    assert.deepEqual(shape(LINES[lang]).sort(), reference, lang);
  }
});

test('Italian: no empty lines, and the placeholders of English survive', () => {
  const walk = (a, b, trail) => {
    if (Array.isArray(a)) {
      assert.ok(Array.isArray(b) && b.length >= 1, trail);
      const slots = (list) => new Set(list.join(' ').match(/\{\w+\}/g) || []);
      if (typeof a[0] === 'string' && !trail.startsWith('units')) {
        for (const slot of slots(a)) assert.ok(slots(b).has(slot) || a.length > b.length, `${trail} lost ${slot}`);
      }
    } else if (typeof a === 'object') {
      for (const k of Object.keys(a)) walk(a[k], b[k], `${trail}.${k}`);
    } else {
      assert.ok(typeof b === 'string' && b.trim().length > 0, trail);
      for (const slot of a.match(/\{\w+\}/g) || []) assert.ok(b.includes(slot), `${trail} lost ${slot}`);
    }
  };
  walk(LINES.en, LINES.it, 'it');
});

test('Italian keeps her voice', () => {
  const all = JSON.stringify(LINES.it);
  for (const word of ['choom', 'preem', 'nova', 'flatline', 'Capricorn']) assert.ok(all.includes(word), word);
  assert.equal(LINES.it.crashed.some((l) => /Claude/.test(l)), false); // she answers for herself now
});

test('the tray menu speaks Italian too, and every language has the same entries', () => {
  assert.ok(LANGS.includes('it'));
  const keys = (o) => Object.keys(o).filter((k) => k !== 'ask').sort();
  for (const lang of LANGS) assert.deepEqual(keys(TRAY[lang]), keys(TRAY.en), lang);
  assert.equal(TRAY.it.online(47823), 'Capri — in ascolto su 47823');
});

test('durations read well in Italian', () => {
  assert.equal(duration(43_000, 'it'), '43 s');
  assert.equal(duration(134_000, 'it'), '2 min 14');
});
