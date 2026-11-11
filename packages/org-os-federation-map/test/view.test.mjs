// test/view.test.mjs — node states and the map's words (spec §5.1), both surfaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGED_AFTER_DAYS, age, nodeView, statusLine, captionSentence, groupsForList, safeUrl,
} from '../src/view.mjs';
import { safeUrl as elementSafeUrl } from '../src/element.mjs';

const MAP = JSON.parse(readFileSync(new URL('./fixtures/house-map.json', import.meta.url), 'utf8'));
const NOW = '2026-10-29T12:00:00Z';
const node = (id) => MAP.nodes.find((n) => n.id === id);
const V = (id, surface = 'vault') => nodeView(node(id), MAP, { surface, now: NOW });
const SELF_NODE = { ...MAP.self, kind: 'instance' };

test('age is compact and null-safe', () => {
  assert.equal(age('2026-10-29T11:56:00Z', NOW), '4 min');
  assert.equal(age('2026-10-29T10:00:00Z', NOW), '2 h');
  assert.equal(age('2026-10-26T12:00:00Z', NOW), '3 d');
  assert.equal(age(null, NOW), null);
  assert.equal(AGED_AFTER_DAYS, 7);
});

test('self: the only display node, eyebrow and counts', () => {
  const v = nodeView(SELF_NODE, MAP, { surface: 'vault', now: NOW });
  assert.equal(v.display, true);
  assert.equal(v.eyebrow, 'This instance');
  assert.equal(v.facts, '142 entries · 3 sources');
  assert.equal(v.factsShort, '142 entries');
  assert.deepEqual(v.states, ['self']);
  const others = MAP.nodes.filter((n) => nodeView(n, MAP, { surface: 'vault', now: NOW }).display);
  assert.equal(others.length, 0);
});

test('read peer, knowledge peer, source', () => {
  const h = V('hillside-coop');
  assert.equal(h.facts, 'Coop · 3 members · 2 projects');
  assert.equal(h.dot, false);
  assert.equal(h.factsGlyph, null);
  const k = V('open-seed-library');
  assert.equal(k.facts, 'knowledge peer · AT Proto');
  assert.equal(k.glyph, 'book');
  assert.ok(k.states.includes('peer-knowledge'));
  const sk = nodeView({ ...node('open-seed-library'), card: { protocol: 'static-json' } }, MAP, { surface: 'vault', now: NOW });
  assert.equal(sk.facts, 'knowledge peer · static JSON');
  const s = V('field-notes-archive');
  assert.equal(s.facts, 'source · field notes');
  assert.equal(s.glyph, 'db');
  assert.equal(V('open-data-portal').facts, 'source · public datasets');
  const bare = { ...node('open-data-portal') }; delete bare.curates;
  assert.equal(nodeView(bare, MAP, { surface: 'vault', now: NOW }).facts, 'source');
});

test('vault: aged, failed, never, no address, one hop', () => {
  const aged = V('youth-circle');
  assert.equal(aged.factsGlyph, 'clock');
  assert.equal(aged.facts, 'LocalNode · 12 d');
  assert.ok(aged.states.includes('aged'));
  assert.equal(aged.dot, false);
  const failed = V('watershed-network');
  assert.equal(failed.facts, 'couldn’t read · 3 d');
  assert.equal(failed.factsGlyph, 'alert');
  assert.equal(failed.factsTone, 'clay');
  assert.equal(failed.dot, true);
  const never = V('market-garden');
  assert.equal(never.facts, 'no frontier yet');
  assert.equal(never.dot, true);
  assert.ok(never.states.includes('never'));
  const noaddr = V('lowland-guild');
  assert.equal(noaddr.facts, 'no address to read');
  assert.equal(noaddr.factsTone, 'faint');
  assert.equal(noaddr.dot, false);
  const hop = V('Valley Commons');
  assert.equal(hop.facts, 'one hop · via Hillside Coop');
  assert.ok(hop.states.includes('beyond'));
  const unread = nodeView({ ...node('watershed-network'), frontier: { fetched_at: null, last_error: 'x' } }, MAP, { surface: 'vault', now: NOW });
  assert.equal(unread.facts, 'couldn’t read · never read');
});

test('vault: a peer not reached (frontier read, no clone) is faint with no dot', () => {
  const n = { ...node('lowland-guild'), repo: 'example/lowland', frontier: { fetched_at: '2026-10-29T10:00:00Z', last_error: null } };
  const v = nodeView(n, MAP, { surface: 'vault', now: NOW });
  assert.equal(v.facts, 'not reached · no clone');
  assert.equal(v.factsTone, 'faint');
  assert.equal(v.dot, false);
});

// Never fetched = a ring-1 instance with an address (repo or local_path; on a built map, a frontier
// object) and no snapshot, whether or not it is cloned here (spec §5.1, Task 5). buildMap never copies
// local_path onto a node, so the frontier object is the address it carries (P-4).
test('vault: a cloned peer with no frontier snapshot is never fetched — dot, "no frontier yet"', () => {
  const cloned = { id: 'orchard-guild', kind: 'instance', name: 'Orchard Guild', type: 'Coop', ring: 1, live: true,
    repo: null, counts: { members: 4 }, frontier: { fetched_at: null, source: null, last_attempt_at: null, last_error: null } };
  const map = { self: MAP.self, nodes: [cloned], edges: [{ from: MAP.self.id, to: 'orchard-guild', kind: 'federation' }] };
  const v = nodeView(cloned, map, { surface: 'vault', now: NOW });
  assert.equal(v.facts, 'no frontier yet');
  assert.equal(v.dot, true);
  assert.ok(v.states.includes('never'));
  // the web surface is unchanged: a cloned peer reads as read, with its facts
  const w = nodeView(cloned, map, { surface: 'web', now: NOW });
  assert.equal(w.facts, 'Coop · 4 members');
  assert.equal(w.dot, false);
  assert.ok(!w.states.includes('never'));
});

test('vault: a local_path-only peer not cloned here is never fetched, not "no address to read"', () => {
  const notCloned = { id: 'reed-circle', kind: 'instance', name: 'Reed Circle', type: 'LocalNode', ring: 1, live: false,
    repo: null, counts: {}, frontier: { fetched_at: null, source: null, last_attempt_at: null, last_error: null } };
  const map = { self: MAP.self, nodes: [notCloned], edges: [{ from: MAP.self.id, to: 'reed-circle', kind: 'downstream' }] };
  const v = nodeView(notCloned, map, { surface: 'vault', now: NOW });
  assert.equal(v.facts, 'no frontier yet');
  assert.equal(v.dot, true);
  assert.ok(!v.states.includes('noaddr'));
  assert.equal(nodeView(notCloned, map, { surface: 'web', now: NOW }).facts, 'not mapped');
  // with no frontier object, no repo and no local_path there is no address
  const bare = { ...notCloned }; delete bare.frontier;
  assert.equal(nodeView(bare, { ...map, nodes: [bare] }, { surface: 'vault', now: NOW }).facts, 'no address to read');
});

test('web: never attention, never says couldn’t / not reached / no frontier', () => {
  for (const n of MAP.nodes) {
    const v = nodeView(n, MAP, { surface: 'web', now: NOW });
    assert.equal(v.dot, false, n.id);
    assert.notEqual(v.factsTone, 'clay', n.id);
    assert.equal(v.factsGlyph, null, n.id);
    for (const st of ['failed', 'never', 'noaddr', 'aged']) assert.ok(!v.states.includes(st), `${n.id} ${st}`);
    for (const bad of [/couldn/i, /not reached/i, /no frontier/i, /no address/i]) {
      assert.doesNotMatch(v.facts + v.accessibleName + v.description, bad, n.id);
      assert.doesNotMatch(captionSentence(n, MAP, { surface: 'web', now: NOW }), bad, n.id);
    }
    assert.ok(!v.links.some((l) => l.href.startsWith('obsidian:')), n.id);
  }
  assert.equal(V('lowland-guild', 'web').facts, 'not mapped');
  assert.equal(V('watershed-network', 'web').facts, 'Network');
  assert.equal(V('youth-circle', 'web').facts, 'LocalNode · 2 members');
});

test('vault links: vault only, and only through safeUrl', () => {
  const n = { ...node('field-notes-archive'), portal: 'obsidian://open?vault=x', url: 'javascript:alert(1)', repo: 'https://example.org/r' };
  const vault = nodeView(n, MAP, { surface: 'vault', now: NOW }).links;
  assert.deepEqual(vault.map((l) => l.label), ['repository ↗', 'Obsidian link ↗']);
  const web = nodeView(n, MAP, { surface: 'web', now: NOW }).links;
  assert.deepEqual(web.map((l) => l.label), ['repository ↗']);
});

test('accessible names and descriptions', () => {
  assert.equal(V('hillside-coop').accessibleName, 'Hillside Coop, peer, Coop · 3 members · 2 projects');
  assert.equal(V('watershed-network').accessibleName, 'Watershed Network, upstream, couldn’t read · 3 d');
  assert.equal(V('market-garden').accessibleName, 'Market Garden, downstream, no frontier yet, needs a steward');
  assert.equal(V('Valley Commons').accessibleName, 'Valley Commons, one hop beyond, via Hillside Coop');
  assert.equal(V('field-notes-archive').accessibleName, 'Field notes archive, source, source · field notes');
  assert.match(V('hillside-coop').description, /peers with Riverbend Commons/);
  assert.match(V('hillside-coop').description, /Valley Commons/);
});

test('status line', () => {
  assert.deepEqual(statusLine(MAP, { surface: 'vault', now: NOW }),
    { mark: 'failed', text: '6 instances · 3 sources · 1 couldn’t be read · frontier read 2 h ago' });
  assert.deepEqual(statusLine(MAP, { surface: 'web', now: NOW }),
    { mark: 'ok', text: '6 instances · 3 sources · frontier read 2 h ago' });
});

test('caption sentences', () => {
  const c = captionSentence(node('hillside-coop'), MAP, { surface: 'vault', now: NOW });
  assert.match(c, /^A peer Riverbend Commons federates with, read from its local clone\./);
  assert.ok(c.includes('one of them, Valley Commons, is not ours yet — one hop beyond.'));
  assert.match(captionSentence(node('market-garden'), MAP, { surface: 'vault', now: NOW }), /org-os-kms federate frontier/);
  assert.match(captionSentence(node('watershed-network'), MAP, { surface: 'vault', now: NOW }), /couldn’t read it; the copy shown is 3 d old/);
  assert.match(captionSentence(node('Valley Commons'), MAP, { surface: 'vault', now: NOW }), /reported by Hillside Coop/);
});

test('words: no exclamation marks, never torch/embers', () => {
  for (const surface of ['vault', 'web']) {
    const all = [...MAP.nodes, SELF_NODE].flatMap((n) => {
      const v = nodeView(n, MAP, { surface, now: NOW });
      return [v.facts, v.factsShort, v.accessibleName, v.description, captionSentence(n, MAP, { surface, now: NOW })];
    }).join('\n');
    assert.doesNotMatch(all, /!|torch|\bembers?\b/i);
  }
});

test('safeUrl drops javascript: and is the one element.mjs re-exports', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://ok.dev'), 'https://ok.dev');
  assert.equal(elementSafeUrl, safeUrl);
});

test('groupsForList order and empties', () => {
  assert.deepEqual(groupsForList(MAP), [
    ['Upstream', ['watershed-network']],
    ['Peers', ['hillside-coop', 'lowland-guild', 'open-seed-library']],
    ['Downstream', ['market-garden', 'youth-circle']],
    ['One hop beyond', ['Delta Alliance', 'Pantry Network', 'Valley Commons']],
    ['Sources', ['field-notes-archive', 'open-data-portal', 'seed-registry']],
  ]);
  assert.deepEqual(groupsForList({ self: MAP.self, nodes: [], edges: [] }), []);
});

test('self without counts.entries: sources only (R-13), never a sum of source counts', () => {
  const m = { ...MAP, self: { ...MAP.self } }; delete m.self.counts;
  const v = nodeView(SELF_NODE, m, { surface: 'vault', now: NOW });
  assert.equal(v.facts, '3 sources');
  assert.equal(v.factsShort, '3 sources');
  assert.equal(captionSentence(SELF_NODE, m, { surface: 'vault', now: NOW }), 'This instance — 3 sources.');
  assert.equal(captionSentence(SELF_NODE, MAP, { surface: 'vault', now: NOW }), 'This instance — 142 entries from 3 sources.');
  // differing source counts do not change the entries
  const m2 = { ...MAP, nodes: MAP.nodes.map((n, i) => (n.kind === 'source' ? { ...n, counts: { objects: 7 + i } } : n)) };
  assert.equal(nodeView(SELF_NODE, m2, { surface: 'vault', now: NOW }).facts, '142 entries · 3 sources');
});

test('factsShort for every state, both surfaces (R-15)', () => {
  const short = (id, surface) => V(id, surface).factsShort;
  const vault = {
    'hillside-coop': '3 members', 'youth-circle': '12 d', 'watershed-network': 'couldn’t read',
    'market-garden': 'no frontier', 'lowland-guild': 'no address', 'open-seed-library': 'knowledge',
    'Valley Commons': 'one hop', 'field-notes-archive': 'source', 'open-data-portal': 'source',
  };
  for (const [id, w] of Object.entries(vault)) assert.equal(short(id, 'vault'), w, `vault ${id}`);
  const web = {
    'hillside-coop': '3 members', 'youth-circle': '2 members', 'watershed-network': 'Network',
    'market-garden': 'not mapped', 'lowland-guild': 'not mapped', 'open-seed-library': 'knowledge',
    'Valley Commons': 'one hop', 'field-notes-archive': 'source',
  };
  for (const [id, w] of Object.entries(web)) assert.equal(short(id, 'web'), w, `web ${id}`);
  const away = { ...node('lowland-guild'), repo: 'example/l', frontier: { fetched_at: '2026-10-29T10:00:00Z', last_error: null } };
  assert.equal(nodeView(away, MAP, { surface: 'vault', now: NOW }).factsShort, 'not reached');
  assert.equal(nodeView(away, MAP, { surface: 'web', now: NOW }).factsShort, 'not mapped');
});
