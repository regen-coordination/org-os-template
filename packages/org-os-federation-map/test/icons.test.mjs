// test/icons.test.mjs — the map's glyphs have one source (R-6): MAP_ICONS and its sprite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAP_ICONS, mapSprite } from '../src/icons.mjs';
import { ICONS_USED } from '../src/static.mjs';

const ids = (svg) => [...svg.matchAll(/<symbol id="i-([a-z-]+)"/g)].map((m) => m[1]);

test('every ICONS_USED name has path data, and nothing else is carried', () => {
  assert.deepEqual(Object.keys(MAP_ICONS).sort(), [...ICONS_USED].sort());
  for (const n of ICONS_USED) {
    assert.equal(typeof MAP_ICONS[n], 'string', n);
    assert.match(MAP_ICONS[n], /^<(path|circle|rect|ellipse)\b/, n);
    assert.doesNotMatch(MAP_ICONS[n], /<symbol|<svg|script|on\w+=/i, n);
  }
});

test('the sprite holds exactly the names asked', () => {
  const all = mapSprite();
  assert.match(all, /^<svg width="0" height="0" aria-hidden="true"><defs><symbol id="i-/);
  assert.match(all, /<\/symbol><\/defs><\/svg>$/);
  assert.deepEqual(ids(all).sort(), [...ICONS_USED].sort());
  assert.match(all, /<symbol id="i-inst" viewBox="0 0 24 24"><rect /);
  assert.deepEqual(ids(mapSprite(['db', 'book'])), ['db', 'book']);
  assert.deepEqual(ids(mapSprite(['db', 'nope', 'db'])), ['db']);
  assert.equal(mapSprite([]), '<svg width="0" height="0" aria-hidden="true"><defs></defs></svg>');
});

test('the file carries the Lucide licence notice', () => {
  const src = readFileSync(new URL('../src/icons.mjs', import.meta.url), 'utf8');
  assert.match(src, /Lucide/);
  assert.match(src, /ISC/);
  assert.match(src, /Permission to use, copy, modify, and\/or distribute this software/);
});
