// explorer/model.mjs — the explorer's whole behaviour as pure functions: state, reduce(state, action, facts), view(state, facts). No DOM.
// view() only SELECTS among recorded facts (queries, streamsFor, perspectives); it computes no claim of its own.
import { STEPS } from './tour.mjs';

export const VIEWS = ['you', 'peer-pack', 'peer-nopack'];
export const SHARES = ['nothing', 'units', 'units-streams'];
export const DRAWERS = ['pack', 'about'];
export const initialState = () => ({ selected: null, includeInside: true, view: 'you', share: 'nothing', drawer: null, tour: null });

const runStep = (state, i, facts) => STEPS[i].actions.reduce((s, a) => reduce(s, a, facts), { ...state, tour: i });

export function reduce(state, action, facts) {
  const a = action || {};
  switch (a.type) {
    case 'select': return a.id in facts.territory.query ? { ...state, selected: a.id } : state;
    case 'toggle-inside': return { ...state, includeInside: !state.includeInside };
    case 'set-inside': return { ...state, includeInside: Boolean(a.value) };
    case 'view': return VIEWS.includes(a.value) ? { ...state, view: a.value } : state;
    case 'share': return SHARES.includes(a.value) ? { ...state, share: a.value } : state;
    case 'drawer': return a.value === null || DRAWERS.includes(a.value) ? { ...state, drawer: state.drawer === a.value ? null : a.value } : state;
    case 'tour':
      if (a.value === 'start') return runStep({ ...state, drawer: null }, 0, facts);
      if (a.value === 'end' || state.tour === null) return { ...state, tour: null };
      if (a.value === 'next') return state.tour + 1 < STEPS.length ? runStep({ ...state, drawer: null }, state.tour + 1, facts) : { ...state, tour: null };
      if (a.value === 'back') return state.tour > 0 ? runStep({ ...state, drawer: null }, state.tour - 1, facts) : state;
      return state;
    default: return state;
  }
}

const PEER_KEY = { 'peer-pack': 'peerWithPack', 'peer-nopack': 'peerWithout' };
const SENTENCE = {
  you: 'You are looking at your own territory. Everything is visible to you.',
  'peer-pack': 'A peer organisation that also uses the territory pack. They receive only what you chose to share.',
  'peer-nopack': "A peer organisation without the territory pack. Their org-os doesn't know what a place or a data stream is, so it never asks for one.",
};

export function view(state, facts) {
  const t = facts.territory;
  const received = state.view === 'you' ? null : facts.perspectives.modes[state.share][PEER_KEY[state.view]];
  const dim = (kind, id) => Boolean(received) && !received[kind].includes(id);
  const byId = Object.fromEntries(t.units.map((u) => [u.unit_id, u]));
  const q = state.selected ? t.query[state.selected] : null;
  const held = (id) => (state.includeInside ? t.query[id].withDescendants : t.query[id].exact);
  const node = (u) => ({
    id: u.unit_id, title: u.title, layer: u.layer, level: u.level, count: held(u.unit_id).length,
    selected: u.unit_id === state.selected, ancestor: Boolean(q) && q.ancestors.includes(u.unit_id),
    overlapped: Boolean(q) && q.overlaps.some((o) => o.other === u.unit_id), dimmed: dim('units', u.unit_id),
    children: t.query[u.unit_id].children.map((c) => node(byId[c])),
  });
  const layers = t.layers.map((layer) => ({ layer, roots: t.units.filter((u) => u.layer === layer && !u.part_of).map(node) }));

  let panel = null;
  if (q) {
    const u = byId[state.selected];
    const providers = Object.fromEntries(t.streams.providers.map((p) => [p.slug, p]));
    const streams = Object.fromEntries(t.streams.streams.map((s) => [s.title, s]));
    panel = {
      id: u.unit_id, title: u.title, layer: u.layer, level: u.level, codes: u.codes || [], dimmed: dim('units', u.unit_id),
      ancestors: q.ancestors.map((id) => ({ id, title: byId[id].title })),
      includeInside: state.includeInside, hasInside: q.children.length > 0,
      here: held(u.unit_id).map((title) => ({ title, dimmed: dim('resources', title) })),
      overlaps: q.overlaps.map((o) => ({ id: o.other, title: byId[o.other].title, layer: byId[o.other].layer, shareSelf: o.shareSelf, shareOther: o.shareOther, dimmed: dim('units', o.other) })),
      streams: facts.streamsFor[u.unit_id].map(({ title, reason }) => {
        const s = streams[title]; const p = providers[s.source_system];
        return { title, reason, provider: p.title, steward: p.steward, access: s.access, trust: s.trust, cadence: s.cadence, licence: s.licence, dimmed: dim('streams', title) };
      }),
      privateNote: u.unit_id === t.privateNoteUnit,
    };
  }
  const tour = state.tour === null ? null : { index: state.tour, total: STEPS.length, title: STEPS[state.tour].title, text: STEPS[state.tour].text, target: STEPS[state.tour].target, last: state.tour === STEPS.length - 1 };
  const live = [panel ? `${panel.title} selected, ${panel.here.length} thing${panel.here.length === 1 ? '' : 's'} here.` : '', state.view === 'you' ? '' : SENTENCE[state.view]].filter(Boolean).join(' ');
  return {
    note: t.note, extraNote: t.extraNote, layers, panel,
    tray: t.unknownRefs.map((x) => ({ ...x, dimmed: dim('resources', x.resource) })),
    bar: { view: state.view, share: state.share, sentence: SENTENCE[state.view], neverLeaves: facts.perspectives.neverLeaves, resourceRefsTravel: facts.perspectives.resourceRefsTravel,
      receivedCounts: received ? { units: received.units.length, streams: received.streams.length, resources: received.resources.length } : null },
    drawer: state.drawer, pack: facts.pack, meta: facts.meta, tour, live,
  };
}
