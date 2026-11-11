// The component's behaviour (spec §5.2, §8; L4 §8.5): deep link selects, `v` toggles List · Map,
// arrows move along edges.
//
// Node has no DOM, and this package takes no DOM library as a dependency. So each behaviour is tested
// twice: against MapController — the element's state, which every key and the hash go through — and,
// when Chrome is reachable through playwright-core (KMS_SHOOT_MODULES, the directory the page checker
// uses), against the real element in demo/demo.html. Without it the browser half is skipped, with
// that reason; the shoot run in the task's browser check is the real proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MapController, slackMeasure, resizeAction } from '../src/element.mjs';
import { nearestInDirection, defaultMeasure } from '../src/layout.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(readFileSync(join(here, 'fixtures', 'house-map.json'), 'utf8'));
const NOW = '2026-10-29T12:00:00Z';
const SELF = MAP.self.id;
const ctl = (o = {}) => new MapController(MAP, { surface: 'vault', now: NOW, width: 1040, ...o });

// Ids joined to `id` by a map edge; an ecosystem's edge reaches each of its sources.
function neighboursOf(id) {
  const eco = new Map();
  for (const n of MAP.nodes) if (n.kind === 'source' && n.ecosystem) eco.set(n.ecosystem, [...(eco.get(n.ecosystem) || []), n.id]);
  const ends = (x) => eco.get(x) ?? [x];
  const out = new Set();
  for (const e of MAP.edges) {
    if (ends(e.from).includes(id)) ends(e.to).forEach((x) => out.add(x));
    if (ends(e.to).includes(id)) ends(e.from).forEach((x) => out.add(x));
  }
  out.delete(id);
  return out;
}

// ── the controller ──────────────────────────────────────────────────────────

test('deep link selects: #node=<id> selects it and Tab enters there', () => {
  const c = ctl();
  assert.equal(c.selected, null, 'nothing selected before a deep link');
  assert.equal(c.active, SELF, 'Tab enters at this instance');
  assert.equal(c.fromHash('#node=hillside-coop'), 'hillside-coop');
  assert.equal(c.selected, 'hillside-coop');
  assert.equal(c.active, 'hillside-coop');
  assert.equal(c.fromHash(`#node=${encodeURIComponent('Valley Commons')}`), 'Valley Commons', 'ids are URI-decoded');
  assert.equal(c.fromHash('#node=nobody'), null, 'an unknown id selects nothing');
  assert.equal(c.selected, 'Valley Commons', 'and leaves the selection');
  assert.equal(c.fromHash('#other'), null);
});

test('deep link selects: the selection\'s path lights its edges, the rest dims', () => {
  const c = ctl();
  c.fromHash('#node=Valley Commons');
  const p = c.path('Valley Commons');
  assert.ok(p.nodes.has('hillside-coop') && p.nodes.has(SELF), 'its reporter and this instance are on the path');
  assert.ok(!p.nodes.has('youth-circle'), 'a node off the path');
  const drawn = (a, b) => c.layout.edges.findIndex((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  assert.ok(p.edges.has(drawn('hillside-coop', 'Valley Commons')));
  assert.ok(p.edges.has(drawn(SELF, 'hillside-coop')));
  assert.ok(!p.edges.has(drawn(SELF, 'youth-circle')));
});

test('v toggles List · Map; with a modifier it is left alone', () => {
  const c = ctl();
  assert.equal(c.view, 'map', 'the map shows by default');
  assert.equal(c.key('v').action, 'view');
  assert.equal(c.view, 'list');
  assert.equal(c.key('V').action, 'view');
  assert.equal(c.view, 'map');
  assert.equal(c.key('v', { meta: true }), null, '⌘V is paste');
  assert.equal(c.key('v', { ctrl: true }), null);
  assert.equal(c.view, 'map');
});

test('arrows move along edges, to the nearest node in that direction', () => {
  const c = ctl();
  const near = neighboursOf(SELF);
  let moved = 0;
  for (const [key, dir] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up'], ['ArrowDown', 'down']]) {
    c.active = SELF;
    const want = nearestInDirection(SELF, dir, c.layout);
    const r = c.key(key);
    if (!want) { assert.equal(r.action, 'none'); assert.equal(c.active, SELF); continue; }
    assert.equal(r.action, 'move');
    assert.equal(c.active, want, `${key} → ${want}`);
    assert.ok(near.has(want), `${want} shares an edge with this instance`);
    moved++;
  }
  assert.equal(moved, 4, 'this instance has a neighbour on every side');
  // two steps out and back along the same edges
  c.active = SELF;
  c.key('ArrowLeft');
  const peer = c.active;
  c.key('ArrowRight');
  assert.equal(c.active, SELF, `back from ${peer}`);
  assert.equal(c.selected, null, 'moving is not selecting (Space selects)');
});

test('arrows mirror under rtl; Space selects, Enter opens the first safe link, Esc leaves', () => {
  const ltr = ctl(), rtl = ctl({ rtl: true });
  ltr.key('ArrowLeft'); rtl.key('ArrowRight');
  assert.equal(rtl.active, ltr.active, 'right under rtl is left in the layout');
  const m = structuredClone(MAP);
  Object.assign(m.nodes.find((n) => n.id === 'hillside-coop'), { url: 'javascript:alert(1)', repo: 'https://hillside.example/repo' });
  const c = new MapController(m, { surface: 'vault', now: NOW, width: 1040 });
  c.active = 'hillside-coop';
  assert.deepEqual(c.key(' '), { action: 'select', id: 'hillside-coop' });
  assert.equal(c.selected, 'hillside-coop');
  assert.deepEqual(c.key('Enter'), { action: 'open', id: 'hillside-coop', href: 'https://hillside.example/repo' }, 'the first safe link');
  c.active = 'lowland-guild';
  assert.equal(c.key('Enter').action, 'select', 'no link: Enter selects');
  assert.equal(c.key('Escape').action, 'leave');
});

test('zoom holds to 50–200 %; ⌘0 fits', () => {
  const c = ctl();
  for (let i = 0; i < 20; i++) c.key('+', { meta: true });
  assert.equal(c.zoom, 2);
  for (let i = 0; i < 40; i++) c.key('-', { ctrl: true });
  assert.equal(c.zoom, 0.5);
  assert.equal(c.key('0', { meta: true }).action, 'fit');
  assert.equal(c.fitZoom(c.layout.width), 1);
  assert.equal(c.fitZoom(c.layout.width / 4), 0.5, 'never under 50 %');
});

test('the web surface never opens a vault-only link', () => {
  const m = structuredClone(MAP);
  m.nodes.find((n) => n.id === 'hillside-coop').portal = 'obsidian://open?vault=x&file=y';
  m.nodes.find((n) => n.id === 'hillside-coop').repo = null;
  const web = new MapController(m, { surface: 'web', now: NOW, width: 1040 });
  web.active = 'hillside-coop';
  assert.equal(web.key('Enter').action, 'select');
  const vault = new MapController(m, { surface: 'vault', now: NOW, width: 1040 });
  vault.active = 'hillside-coop';
  assert.equal(vault.key('Enter').href, 'obsidian://open?vault=x&file=y');
});

test('a label that fits by its exact width keeps its word, however generous the name measure', () => {
  const labels = (measure) => new MapController(MAP, { surface: 'vault', now: NOW, width: 1040, measure })
    .layout.edges.filter((e) => e.labelAt).map((e) => e.label).sort();
  const exact = labels(defaultMeasure);
  assert.ok(exact.includes('reads') && exact.includes('peers'), 'the gallery\'s same-layer words');
  // a canvas measure: float noise on every width; names and facts measured generously, labels not
  const noisy = (str, o) => defaultMeasure(str, o) * (1 + 1e-4);
  for (const slack of [1.01, 1.05, 1.2]) assert.deepEqual(labels(slackMeasure(noisy, slack)), exact, `slack ${slack}`);
  const m = slackMeasure(noisy, 1.2);
  assert.equal(m('reads', { font: 'mono', size: 11 }), 33, 'Mono exact (5 × 6.6), to 0.01px');
  assert.ok(m('Hillside Coop', { font: 'sans', size: 13 }) > defaultMeasure('Hillside Coop', { font: 'sans', size: 13 }) * 1.2);
  // the trap this guards: slack on the labels too drops "reads" (self ↔ the knowledge peer)
  assert.ok(!labels((str, o) => defaultMeasure(str, o) * 1.01 + 0.5).includes('reads'));
});

test('resize: a reader\'s A→B→A→B re-lays out each time; a scrollbar flicker fits instead', () => {
  const run = (steps) => {
    let painted = 0, history = [], lastPaint = -Infinity;
    return steps.map(([w, now]) => {
      const act = resizeAction({ w, painted, history, now, lastPaint });
      if (act !== 'skip') { history = [...history.slice(-2), w]; lastPaint = now; }
      if (act === 'paint') painted = w;
      return act;
    });
  };
  // a sidebar opening and closing, a phone turning: seconds apart
  assert.deepEqual(run([[1198, 0], [900, 2000], [1198, 4000], [900, 6000], [1198, 8000]]), ['paint', 'paint', 'paint', 'paint', 'paint']);
  // our own re-layout toggling a page scrollbar: within a frame or two of the last paint
  // (back at 1183 the layout is already that width's)
  assert.deepEqual(run([[1198, 0], [1183, 16], [1198, 32], [1183, 48]]), ['paint', 'paint', 'fit', 'skip']);
  // and once it settles, the next real resize re-lays out
  assert.deepEqual(run([[1198, 0], [1183, 16], [1198, 32], [1198, 600], [1183, 900]]), ['paint', 'paint', 'fit', 'paint', 'paint']);
  assert.equal(resizeAction({ w: 0, painted: 1198, history: [], now: 0 }), 'skip', 'hidden');
  assert.equal(resizeAction({ w: 1198, painted: 1198, history: [], now: 0 }), 'skip', 'unchanged');
});

// ── the real element, in Chrome ─────────────────────────────────────────────

function playwright() {
  const dir = process.env.KMS_SHOOT_MODULES;
  if (!dir) return null;
  try { return createRequire(join(resolve(dir), 'package.json'))('playwright-core'); } catch { return null; }
}
const PW = playwright();
const SKIP = !PW && 'no DOM in node: set KMS_SHOOT_MODULES to a directory with playwright-core to run these in Chrome';
const DEMO = pathToFileURL(join(here, '..', 'demo', 'demo.html')).href;

async function withPage(hash, fn) {
  const browser = await PW.chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/*', (r) => (/^(file|data):/.test(r.request().url()) ? r.continue() : r.abort()));
    await page.goto(DEMO + hash);
    await page.waitForFunction(() => document.querySelector('federation-map:not([mode])')?.shadowRoot?.querySelector('.fm .node'));
    await fn(page);
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser.close();
  }
}
const inMap = (page, fn, arg) => page.evaluate(([f, a]) => {
  const root = document.querySelector('federation-map:not([mode])').shadowRoot;
  return new Function('root', 'arg', `return (${f})(root, arg)`)(root, a);
}, [fn.toString(), arg]);

test('in Chrome: a deep link selects the node and fills the caption', { skip: SKIP }, async () => {
  await withPage('#node=hillside-coop', async (page) => {
    const r = await inMap(page, (root) => ({
      sel: [...root.querySelectorAll('.node.sel')].map((n) => n.dataset.id),
      cap: root.querySelector('.fm-cap').textContent,
      tab: [...root.querySelectorAll('.node[tabindex="0"]')].map((n) => n.dataset.id),
    }));
    assert.deepEqual(r.sel, ['hillside-coop']);
    assert.match(r.cap, /Hillside Coop/);
    assert.deepEqual(r.tab, ['hillside-coop'], 'Tab enters at the deep-link target');
  });
});

const focusSelf = async (page) => {
  for (let i = 0; i < 12; i++) {
    if ((await inMap(page, (root) => root.activeElement?.dataset.id ?? null)) === SELF) return;
    await page.keyboard.press('Tab');
  }
  assert.fail('Tab never reached this instance');
};

test('in Chrome: v toggles List · Map with focus in the map (R-28)', { skip: SKIP }, async () => {
  await withPage('', async (page) => {
    const view = () => inMap(page, (root) => root.querySelector('.fm').dataset.view);
    assert.equal(await view(), 'map');
    await focusSelf(page);
    await page.keyboard.press('v');
    assert.equal(await view(), 'list');
    assert.equal(await inMap(page, (root) => getComputedStyle(root.querySelector('.fm-twin')).display !== 'none'), true);
    await page.keyboard.press('v');
    assert.equal(await view(), 'map');
  });
});

test('in Chrome: v elsewhere on the page does nothing; on the map\'s own controls it toggles (R-28)', { skip: SKIP }, async () => {
  await withPage('', async (page) => {
    const view = () => inMap(page, (root) => root.querySelector('.fm').dataset.view);
    await page.evaluate(() => { const b = document.createElement('button'); b.id = 'other'; b.textContent = 'Other'; document.body.prepend(b); });
    await page.focus('#other');
    await page.keyboard.press('v');
    assert.equal(await view(), 'map', 'an unrelated button: no toggle');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('v');
    assert.equal(await view(), 'map', 'nothing focused: no toggle');
    await page.focus('[data-fm-view="map"]');
    await page.keyboard.press('v');
    assert.equal(await view(), 'list', 'the map\'s own List · Map control');
  });
});

test('in Chrome: connected while hidden with a deep link, the map draws when shown and the selection holds', { skip: SKIP }, async () => {
  await withPage('#node=hillside-coop', async (page) => {
    const make = (id) => page.evaluate((id) => {
      const wrap = document.createElement('div');
      wrap.hidden = true;
      wrap.id = `${id}-wrap`;
      const el = document.createElement('federation-map');
      el.id = id;
      el.setAttribute('data-surface', 'vault');
      el.append(document.querySelector('#map > script[type="application/json"]').cloneNode(true));
      wrap.append(el);
      document.querySelector('main').append(wrap);
    }, id);
    const selOf = (id) => page.evaluate((id) => [...(document.getElementById(id).shadowRoot?.querySelectorAll('.fm-box .node.sel') || [])].map((n) => n.dataset.id), id);
    await make('m2');
    await make('m3');
    await page.waitForTimeout(200);
    assert.deepEqual(await selOf('m2'), [], 'nothing drawn while hidden');
    await page.evaluate(() => { location.hash = '#node=' + encodeURIComponent('Valley Commons'); });
    await page.waitForTimeout(100);
    await page.evaluate(() => { document.getElementById('m2-wrap').hidden = false; document.getElementById('m3-wrap').hidden = false; });
    await page.waitForFunction(() => document.getElementById('m3').shadowRoot.querySelector('.fm-box .node'));
    await page.waitForTimeout(100);
    assert.deepEqual(await selOf('m3'), ['Valley Commons'], 'a hash change while hidden is kept');
    assert.deepEqual(await selOf('m2'), ['Valley Commons']);
  });
});

test('in Chrome: a reconnect wires the shadow root once (one zoom step per ctrl-wheel); one live region', { skip: SKIP }, async () => {
  await withPage('', async (page) => {
    await page.evaluate(() => { const el = document.querySelector('#map'); const at = el.nextSibling; el.remove(); at.before(el); });
    await page.waitForTimeout(300);
    const box = await page.evaluate(() => {
      const r = document.querySelector('#map').shadowRoot.querySelector('.fm-box').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 200 };
    });
    const z0 = await page.evaluate(() => document.querySelector('#map').zoom);
    await page.mouse.move(box.x, box.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    const z1 = await page.evaluate(() => document.querySelector('#map').zoom);
    assert.equal(Math.round((z1 / z0) * 100) / 100, 1.1, `one step (${z0} → ${z1})`);
    await focusSelf(page);
    await page.keyboard.press('Space');
    await page.keyboard.press('v');
    await page.keyboard.press('v');
    await page.setViewportSize({ width: 900, height: 900 });
    await page.waitForTimeout(200);
    const live = await inMap(page, (root) => [...root.querySelectorAll('[aria-live]')].map((n) => [n.className, n.textContent]));
    assert.equal(live.length, 1, 'one live region');
    assert.equal(live[0][0], 'fm-live');
    assert.equal(live[0][1], 'Showing the map', 'it outlives the redraws');
  });
});

test('in Chrome: Tab enters at this instance; arrows move along edges', { skip: SKIP }, async () => {
  await withPage('', async (page) => {
    const focused = () => inMap(page, (root) => root.activeElement?.dataset.id ?? null);
    for (let i = 0; i < 12 && (await focused()) !== SELF; i++) await page.keyboard.press('Tab');
    assert.equal(await focused(), SELF);
    const near = neighboursOf(SELF);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      await page.keyboard.press(key);
      const at = await focused();
      assert.ok(near.has(at), `${key} → ${at}, joined to this instance`);
      const back = { ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft', ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp' }[key];
      await page.keyboard.press(back);
      assert.equal(await focused(), SELF, `${back} returns`);
    }
  });
});

test('in Chrome: the shadow root\'s sprite takes no room — the map starts at the element\'s top', { skip: SKIP }, async () => {
  await withPage('', async (page) => {
    const gap = await page.evaluate(() => {
      const host = document.querySelector('federation-map:not([mode])');
      return Math.round(host.shadowRoot.querySelector('.fm').getBoundingClientRect().top - host.getBoundingClientRect().top);
    });
    assert.equal(gap, 0);
  });
});
