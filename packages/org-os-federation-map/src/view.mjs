// src/view.mjs — the house map's node view model and its words (spec §5.1).
// Pure: no DOM, no clock (callers pass `now`), no network. Task 7 renders static HTML from
// it and the <federation-map> component uses it too. Two surfaces: 'vault' (the steward's
// own build — attention allowed) and 'web' (public — never attention).
import { EDGE_WORDS } from './layout.mjs';

export const AGED_AFTER_DAYS = 7; // K-7

const DAY = 86_400_000;

// Node fields can originate from REMOTE peer manifests, so link schemes are allow-listed.
// (Moved here from element.mjs, which re-exports it unchanged.)
const SAFE_SCHEME = /^(https?:|obsidian:)/i;
export function safeUrl(u) {
  if (typeof u !== 'string') return null;
  const s = u.trim();
  if (/^[/#]/.test(s)) return s;           // same-origin relative links are safe
  return SAFE_SCHEME.test(s) ? s : null;   // otherwise only http(s)/obsidian
}

const ms = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };

export function age(iso, now) {
  if (iso == null) return null;
  const t = ms(iso), n = ms(now);
  if (t == null || n == null) return null;
  const d = Math.max(0, n - t);
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min`;
  if (d < DAY) return `${Math.floor(d / 3_600_000)} h`;
  return `${Math.floor(d / DAY)} d`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const byName = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id));

function selfId(map) { return map.self?.id ?? map.self?.name; }
function nodeById(map, id) { return (map.nodes || []).find((n) => n.id === id); }
function nameOf(map, id) { return nodeById(map, id)?.name ?? (id === selfId(map) ? map.self?.name ?? id : id); }

// How this instance relates to a node: the kind of the edge from self, else null.
function relationOf(node, map) {
  const sid = selfId(map);
  const e = (map.edges || []).find((x) => x.from === sid && x.to === node.id);
  return e ? e.kind : null;
}
function reportersOf(node, map) {
  return (map.edges || []).filter((e) => e.kind === 'frontier' && e.to === node.id)
    .map((e) => nameOf(map, e.from)).sort((a, b) => a.localeCompare(b));
}
function beyondOf(node, map) {
  return (map.edges || []).filter((e) => e.kind === 'frontier' && e.from === node.id)
    .map((e) => nameOf(map, e.to)).sort((a, b) => a.localeCompare(b));
}
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// Entries come only from map.self.counts.entries (R-13); never summed from sources.
function selfCounts(map) {
  const entries = map.self?.counts?.entries;
  return { entries: typeof entries === 'number' ? entries : null,
    sources: (map.nodes || []).filter((n) => n.kind === 'source').length };
}
function selfFacts(c) {
  const src = plural(c.sources, 'source', 'sources');
  return c.entries == null ? src : `${plural(c.entries, 'entry', 'entries')} · ${src}`;
}
const selfShort = (c) => (c.entries == null ? plural(c.sources, 'source', 'sources') : plural(c.entries, 'entry', 'entries'));

const readShort = (node) => {
  const m = node.counts?.members;
  return m != null ? plural(m, 'member', 'members') : (node.type || '');
};

function readFacts(node) {
  const bits = [];
  if (node.type) bits.push(node.type);
  const c = node.counts || {};
  if (c.members != null) bits.push(plural(c.members, 'member', 'members'));
  if (c.projects != null) bits.push(plural(c.projects, 'project', 'projects'));
  return bits.join(' · ');
}

// An address to read the node's frontier from: a repo or a local_path. A built map carries neither local_path
// nor the address itself, only its sign — buildMap attaches `frontier` exactly when there is one (P-4).
const hasAddress = (n) => Boolean(n.frontier != null || n.repo || n.local_path);
const isAged = (fr, now) => {
  const t = ms(fr?.fetched_at); const n = ms(now);
  return t != null && n != null && n - t > AGED_AFTER_DAYS * DAY;
};

// The single state of a node, before surface rules. One of:
// self | knowledge | failed | aged | never | noaddr | away | read | beyond | source | other
function stateOf(node, map, now) {
  if (node.id === selfId(map)) return 'self';
  if (node.kind === 'source') return 'source';
  if (node.kind === 'frontier') return 'beyond';
  if (node.kind !== 'instance') return 'other';
  if (relationOf(node, map) === 'knowledge') return 'knowledge';
  const fr = node.frontier;
  if (fr?.last_error) return 'failed';
  if (isAged(fr, now)) return 'aged';
  // never fetched: an address and no snapshot, cloned here or not (spec §5.1)
  if (hasAddress(node) && !fr?.fetched_at) return 'never';
  if (!node.live) return hasAddress(node) ? 'away' : 'noaddr';
  return 'read';
}

const KIND_WORD = { federation: 'peer', upstream: 'upstream', downstream: 'downstream', knowledge: 'knowledge peer' };

export function nodeView(node, map, { surface = 'vault', now } = {}) {
  const web = surface === 'web';
  let st = stateOf(node, map, now);
  if (web && (st === 'failed' || st === 'aged')) st = node.live || node.frontier?.fetched_at ? 'read' : 'away';
  // the web says neither: a peer cloned where the map was built reads as read, any other as away (as before)
  if (web && (st === 'never' || st === 'noaddr')) st = node.live ? 'read' : 'away';

  const rel = relationOf(node, map);
  const reporters = reportersOf(node, map);
  const name = node.name || node.id;
  const fr = node.frontier;
  let facts = '', factsShort = '', tone = 'mute', glyphF = null, eyebrow = null, glyph = 'inst';
  const states = [];

  switch (st) {
    case 'self': {
      const c = selfCounts(map);
      facts = selfFacts(c); factsShort = selfShort(c);
      eyebrow = 'This instance'; glyph = 'seal'; states.push('self'); break;
    }
    case 'knowledge': {
      const proto = node.card?.protocol ?? node.protocol ?? node.card;
      facts = `knowledge peer · ${proto === 'static-json' ? 'static JSON' : 'AT Proto'}`;
      factsShort = 'knowledge'; glyph = 'book'; states.push('peer-knowledge'); break;
    }
    case 'failed':
      facts = `couldn’t read · ${age(fr.fetched_at, now) ?? 'never read'}`;
      factsShort = 'couldn’t read'; tone = 'clay'; glyphF = 'alert'; states.push('failed'); break;
    case 'aged': {
      const a = age(fr.fetched_at, now);
      facts = [node.type, a].filter(Boolean).join(' · ');
      factsShort = a; glyphF = 'clock'; states.push('aged'); break;
    }
    case 'never':
      facts = 'no frontier yet'; factsShort = 'no frontier'; states.push('never'); break;
    case 'noaddr':
      facts = 'no address to read'; factsShort = 'no address'; tone = 'faint'; states.push('noaddr', 'away'); break;
    case 'away':
      facts = web ? 'not mapped' : 'not reached · no clone';
      factsShort = web ? 'not mapped' : 'not reached';
      tone = web ? 'mute' : 'faint'; states.push('away'); break;
    case 'beyond':
      facts = `one hop · via ${reporters[0] ?? 'a peer'}`; factsShort = 'one hop';
      states.push('beyond'); break;
    case 'source':
      facts = node.curates ? `source · ${node.curates}` : 'source';
      factsShort = 'source'; glyph = 'db'; states.push('source'); break;
    default: // 'read' (and kinds the map does not draw, e.g. ecosystems)
      facts = readFacts(node); factsShort = readShort(node);
  }

  const dot = !web && (st === 'failed' || st === 'never');

  const kindWord = st === 'self' ? 'this instance'
    : st === 'source' ? 'source'
    : st === 'beyond' ? null
    : (KIND_WORD[rel] ?? (st === 'other' ? node.kind : 'instance'));
  let accessibleName;
  if (st === 'beyond') {
    accessibleName = `${name}, one hop beyond, via ${list(reporters) || 'a peer'}`;
  } else {
    accessibleName = `${name}, ${kindWord}, ${facts}`;
    // the facts already name the state ("couldn’t read · 3 d", "no frontier yet"): say it once (R-20)
    if (!web && st === 'never') accessibleName += ', needs a steward';
  }

  const edges = (map.edges || []).filter((e) => e.from === node.id || e.to === node.id);
  const out = {
    federation: ['peers with', 'peers with'], upstream: ['has upstream', 'upstream of'],
    downstream: ['has downstream', 'downstream of'], knowledge: ['reads', 'read by'],
    provenance: ['feeds', 'fed by'], frontier: ['sees one hop beyond:', 'seen one hop beyond from'],
  };
  const description = edges.map((e) => {
    const asFrom = e.from === node.id;
    const other = nameOf(map, asFrom ? e.to : e.from);
    const w = out[e.kind] ?? [EDGE_WORDS[e.kind] ?? e.kind, EDGE_WORDS[e.kind] ?? e.kind];
    return `${asFrom ? w[0] : w[1]} ${other}`;
  }).join('; ');

  const links = [];
  const add = (href, label) => { const s = safeUrl(href); if (s) links.push({ href: s, label }); };
  add(node.url, 'visit ↗');
  add(node.repo, 'repository ↗');
  if (node.url && node.kind === 'instance') add(`${String(node.url).replace(/\/$/, '')}/federation.json`, 'federation.json ↗');
  if (!web) add(node.portal, 'Obsidian link ↗'); // map.json v1's `portal`: the node's vault link (PF-R120)

  return {
    id: node.id, glyph, name, display: st === 'self', eyebrow, facts, factsShort, factsTone: tone,
    factsGlyph: glyphF, states, dot, accessibleName, description, links,
  };
}

// R-18: "<n> instances" counts ring-1 instance nodes, everywhere it is said (status line, the
// map's and the list twin's accessible names).
const ringOneInstances = (map) => (map?.nodes || []).filter((n) => n.kind === 'instance' && n.ring === 1);
export function instanceCount(map) { return ringOneInstances(map).length; }

export function statusLine(map, { surface = 'vault', now } = {}) {
  const web = surface === 'web';
  const nodes = map.nodes || [];
  const inst = ringOneInstances(map);
  const sources = nodes.filter((n) => n.kind === 'source');
  const states = inst.map((n) => stateOf(n, map, now));
  const failed = web ? 0 : states.filter((s) => s === 'failed').length;
  const aged = web ? 0 : states.filter((s) => s === 'aged').length;
  const times = inst.map((n) => ms(n.frontier?.fetched_at)).filter((t) => t != null);
  const parts = [];
  if (inst.length) parts.push(plural(inst.length, 'instance', 'instances'));
  if (sources.length) parts.push(plural(sources.length, 'source', 'sources'));
  if (failed) parts.push(`${failed} couldn’t be read`);
  if (times.length) parts.push(`frontier read ${age(new Date(Math.max(...times)).toISOString(), now)} ago`);
  return { mark: failed ? 'failed' : aged ? 'aged' : 'ok', text: parts.join(' · ') };
}

export function captionSentence(node, map, { surface = 'vault', now } = {}) {
  const web = surface === 'web';
  const st = stateOf(node, map, now);
  const self = map.self?.name ?? selfId(map);
  const fr = node.frontier;
  const s = [];
  if (st === 'self') {
    const c = selfCounts(map);
    return c.entries == null ? `This instance — ${plural(c.sources, 'source', 'sources')}.`
      : `This instance — ${plural(c.entries, 'entry', 'entries')} from ${plural(c.sources, 'source', 'sources')}.`;
  }
  if (st === 'source') {
    s.push(`A source that feeds ${self}${node.ecosystem ? `, part of ${nameOf(map, node.ecosystem)}` : ''}.`);
    return s.join(' ');
  }
  if (st === 'beyond') {
    const r = reportersOf(node, map);
    return `Not ours yet — one hop beyond, reported by ${list(r) || 'a peer'}.`;
  }
  const rel = relationOf(node, map);
  const lead = { federation: `A peer ${self} federates with`, upstream: `The upstream ${self} follows`,
    downstream: `A downstream that follows ${self}`, knowledge: `A knowledge peer ${self} reads` }[rel]
    ?? `An instance linked to ${self}`;
  const readFrom = fr?.source === 'local' || (node.live && !fr?.source) ? ', read from its local clone'
    : fr?.source ? ', read from its published federation file' : '';
  const showRead = web ? (node.live || fr?.fetched_at) : (st !== 'noaddr' && st !== 'never' && st !== 'away');
  s.push(`${lead}${showRead ? readFrom : ''}.`);
  const beyond = beyondOf(node, map);
  if (beyond.length && (web || st !== 'failed' || fr?.fetched_at)) {
    const n = beyond.length;
    const many = n === 1 ? 'one of them' : `${n === 2 ? 'two' : n} of them`;
    s.push(`Its own manifest lists more peers; ${many}, ${list(beyond)}, ${n === 1 ? 'is' : 'are'} not ours yet — one hop beyond.`);
  }
  if (!web) {
    if (st === 'failed') s.push(`The last attempt couldn’t read it; the copy shown is ${age(fr.fetched_at, now) ?? 'not available'}${fr.fetched_at ? ' old' : ''}.`);
    else if (st === 'aged') s.push(`The copy shown was read ${age(fr.fetched_at, now)} ago.`);
    else if (st === 'never') s.push('No frontier has been read yet — run org-os-kms federate frontier.');
    else if (st === 'noaddr') s.push('It has no address to read.');
    else if (st === 'away') s.push('Not reached: no clone here.');
  } else if (!node.live && !fr?.fetched_at) s.push('Not mapped yet.');
  return s.join(' ');
}

export function groupsForList(map) {
  const sid = selfId(map);
  const nodes = map.nodes || [];
  const ids = (pred) => nodes.filter(pred).sort(byName).map((n) => n.id);
  const rel = (n) => (map.edges || []).find((e) => e.from === sid && e.to === n.id)?.kind;
  const groups = [
    ['Upstream', ids((n) => n.kind === 'instance' && rel(n) === 'upstream')],
    ['Peers', ids((n) => n.kind === 'instance' && (rel(n) === 'federation' || rel(n) === 'knowledge'))],
    ['Downstream', ids((n) => n.kind === 'instance' && rel(n) === 'downstream')],
    ['One hop beyond', ids((n) => n.kind === 'frontier')],
    ['Sources', ids((n) => n.kind === 'source')],
  ];
  return groups.filter(([, v]) => v.length);
}
