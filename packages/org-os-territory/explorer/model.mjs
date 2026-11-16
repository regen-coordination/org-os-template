// explorer/model.mjs — the explorer's whole behaviour as pure functions: state, reduce(state, action, facts), view(state, facts),
// treeKey(items, index, key). No DOM.
// view() only SELECTS among recorded facts (queries, streamsFor, perspectives); it computes no claim of its own. Viewed as a peer, what that
// peer would not receive is absent — not drawn, not counted — and the View as band says how much they do receive (spec §5.8, ruling 5).
import { STEPS } from './tour.mjs';

export const VIEWS = ['you', 'peer-pack', 'peer-nopack'];
export const SHARES = ['nothing', 'units', 'units-streams'];
export const DRAWERS = ['pack', 'about'];
export const initialState = () => ({ selected: null, includeInside: true, view: 'you', share: 'nothing', drawer: null, tour: null, menu: false, closed: [] });

// A tour step starts from your own view with the menu and drawers shut, so a step never points at something absent (P-12).
const runStep = (state, i, facts) => STEPS[i].actions.reduce((s, a) => reduce(s, a, facts), { ...state, tour: i, view: 'you', drawer: null, menu: false });

export function reduce(state, action, facts) {
  const a = action || {};
  const q = facts.territory.query;
  switch (a.type) {
    case 'select': {
      if (!Object.hasOwn(q, a.id)) return state;
      const above = q[a.id].ancestors;
      return { ...state, selected: a.id, closed: state.closed.filter((id) => !above.includes(id)) };
    }
    case 'toggle-open':
      if (!Object.hasOwn(q, a.id) || !q[a.id].children.length) return state;
      return { ...state, closed: state.closed.includes(a.id) ? state.closed.filter((id) => id !== a.id) : [...state.closed, a.id] };
    case 'toggle-inside': return { ...state, includeInside: !state.includeInside };
    case 'set-inside': return typeof a.value === 'boolean' ? { ...state, includeInside: a.value } : state;
    case 'view': return VIEWS.includes(a.value) ? { ...state, view: a.value, menu: false } : state;
    case 'share': return SHARES.includes(a.value) ? { ...state, share: a.value } : state;
    case 'menu':
      if (a.value === 'open') return { ...state, menu: true };
      if (a.value === 'close') return { ...state, menu: false };
      if (a.value === 'toggle') return { ...state, menu: !state.menu };
      return state;
    case 'drawer': return a.value === null || DRAWERS.includes(a.value) ? { ...state, drawer: state.drawer === a.value ? null : a.value } : state;
    case 'tour':
      if (a.value === 'start') return runStep(state, 0, facts);
      if (state.tour === null) return state;
      if (a.value === 'end') return { ...state, tour: null };
      if (a.value === 'next') return state.tour + 1 < STEPS.length ? runStep(state, state.tour + 1, facts) : { ...state, tour: null };
      if (a.value === 'back') return state.tour > 0 ? runStep(state, state.tour - 1, facts) : state;
      return state;
    default: return state;
  }
}

const PEER_KEY = { 'peer-pack': 'peerWithPack', 'peer-nopack': 'peerWithout' };
const SENTENCE = {
  you: 'You are looking at your own territory. Everything is visible to you.',
  'peer-pack': 'A peer organisation that also uses the territory pack. They receive only what you chose to share.',
  'peer-nopack': 'A peer organisation without the territory pack. Their org-os doesn’t know what a place or a data stream is, so it never asks for one.',
};

export function view(state, facts) {
  const t = facts.territory;
  const got = state.view === 'you' ? null : facts.perspectives.modes[state.share][PEER_KEY[state.view]];
  const has = (kind, id) => !got || got[kind].includes(id);
  const byId = Object.fromEntries(t.units.map((u) => [u.unit_id, u]));
  const sel = state.selected && has('units', state.selected) ? state.selected : null; // P-12: a hidden place stays selected, undrawn
  const q = sel ? t.query[sel] : null;
  const held = (id) => (state.includeInside ? t.query[id].withDescendants : t.query[id].exact).filter((r) => has('resources', r));
  const kids = (id) => t.query[id].children.filter((c) => has('units', c));
  const node = (u, depth) => {
    const id = u.unit_id; const children = kids(id); const o = q && q.overlaps.find((x) => x.other === id);
    const expanded = children.length ? !state.closed.includes(id) : null;
    return {
      id, title: u.title, layer: u.layer, level: u.level, depth, count: held(id).length,
      selected: id === sel, ancestor: Boolean(q) && q.ancestors.includes(id),
      overlap: o ? { shareSelf: o.shareSelf, shareOther: o.shareOther } : null,
      expanded, children: expanded ? children.map((c) => node(byId[c], depth + 1)) : [],
    };
  };
  // a received place whose parent was not received is a root of its layer; a layer with nothing received is not drawn
  const isRoot = (u) => !u.part_of || !has('units', u.part_of);
  const layers = t.layers
    .map((layer) => ({ layer, roots: t.units.filter((u) => u.layer === layer && has('units', u.unit_id) && isRoot(u)).map((u) => node(u, 1)) }))
    .filter((l) => l.roots.length);

  let panel = null;
  if (q) {
    const u = byId[sel];
    const providers = Object.fromEntries(t.streams.providers.map((p) => [p.slug, p]));
    const streams = Object.fromEntries(t.streams.streams.map((s) => [s.title, s]));
    panel = {
      id: u.unit_id, title: u.title, layer: u.layer, level: u.level, codes: u.codes || [],
      ancestors: q.ancestors.filter((id) => has('units', id)).map((id) => ({ id, title: byId[id].title })),
      includeInside: state.includeInside, hasInside: kids(sel).length > 0,
      here: held(sel).map((title) => ({ title })),
      overlaps: q.overlaps.filter((o) => has('units', o.other)).map((o) => ({ id: o.other, title: byId[o.other].title, layer: byId[o.other].layer, shareSelf: o.shareSelf, shareOther: o.shareOther })),
      streams: facts.streamsFor[sel].filter(({ title }) => has('streams', title)).map(({ title, reason }) => {
        const s = streams[title]; const p = providers[s.source_system];
        return { title, reason, provider: p.title, steward: p.steward, access: s.access, trust: s.trust, cadence: s.cadence, licence: s.licence };
      }),
      privateNote: !got && sel === t.privateNoteUnit, // the private note never leaves: no peer view draws it
    };
  }
  const tour = state.tour === null ? null : { index: state.tour, total: STEPS.length, title: STEPS[state.tour].title, text: STEPS[state.tour].text, target: STEPS[state.tour].target, last: state.tour === STEPS.length - 1 };
  const live = panel ? `${panel.title} selected, ${panel.here.length} thing${panel.here.length === 1 ? '' : 's'} here.` : '';
  return {
    note: t.note, extraNote: t.extraNote, layers, panel,
    tray: t.unknownRefs.filter((x) => has('resources', x.resource)).map((x) => ({ ...x })),
    viewAs: { who: state.view, share: state.share, sentence: SENTENCE[state.view],
      counts: got ? { units: got.units.length, streams: got.streams.length, resources: got.resources.length } : null,
      neverLeaves: facts.perspectives.neverLeaves, resourceRefsTravel: facts.perspectives.resourceRefsTravel },
    menu: state.menu, drawer: state.drawer, pack: facts.pack, meta: facts.meta, tour, live,
  };
}

// The APG tree keys over one tree's visible items, in document order: [{ id, depth, expanded (true | false | null for a leaf), name }].
// Returns what to do — { focus: index } | { toggle: id } | { select: id } — or null when the key means nothing here.
export function treeKey(items, index, key) {
  const it = items[index];
  if (!it) return null;
  switch (key) {
    case 'ArrowDown': return index + 1 < items.length ? { focus: index + 1 } : null;
    case 'ArrowUp': return index > 0 ? { focus: index - 1 } : null;
    case 'Home': return { focus: 0 };
    case 'End': return { focus: items.length - 1 };
    case 'ArrowRight':
      if (it.expanded === false) return { toggle: it.id };
      return it.expanded === true && index + 1 < items.length ? { focus: index + 1 } : null;
    case 'ArrowLeft': {
      if (it.expanded === true) return { toggle: it.id };
      for (let i = index - 1; i >= 0; i--) if (items[i].depth === it.depth - 1) return { focus: i };
      return null;
    }
    case 'Enter': case ' ': return { select: it.id };
    default: {
      if (String(key).length !== 1 || !/\S/.test(key)) return null;
      const c = key.toLocaleLowerCase();
      for (let n = 1; n <= items.length; n++) {
        const i = (index + n) % items.length;
        if (String(items[i].name).toLocaleLowerCase().startsWith(c)) return { focus: i };
      }
      return null;
    }
  }
}
