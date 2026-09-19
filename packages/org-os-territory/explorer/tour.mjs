// explorer/tour.mjs — the guided tour as data. Each step dispatches ordinary actions into the same state the visitor drives, so the tour
// can never show something free exploration cannot reach. `target` is the data-key of the element the step points at.
export const STEPS = [
  { title: 'A place is an object', text: 'Every box is a place this territory knows about. This one is a landscape unit. Click any place to see what it holds.', target: 'unit:landscape:unit:plana-de-vic',
    actions: [{ type: 'select', id: 'landscape:unit:plana-de-vic' }] },
  { title: 'Places nest', text: 'Catalunya contains a vegueria, which contains comarques, which contain municipalities. With "include places inside it" on, Catalunya holds everything placed anywhere beneath it. Turn it off to see only what is placed on Catalunya itself.', target: 'inside',
    actions: [{ type: 'select', id: 'administrative:pais:catalunya' }, { type: 'set-inside', value: true }] },
  { title: 'Places overlap across layers', text: 'A landscape unit is not inside a comarca — it overlaps one. The marked places on the other rows are the ones Plana de Vic overlaps. The shares are invented for this example.', target: 'overlaps',
    actions: [{ type: 'select', id: 'landscape:unit:plana-de-vic' }] },
  { title: 'Data has a home', text: 'For each place: which data sources exist, who looks after them, how far they can be trusted, and under what licence. "unverified" means nobody has checked yet.', target: 'streams',
    actions: [{ type: 'select', id: 'administrative:comarca:osona' }] },
  { title: 'You choose what others see', text: 'You are now looking as a peer organisation that also has the territory pack, while you share only your places. Greyed-out items did not reach them. Try "A peer without it", or share nothing.', target: 'bar',
    actions: [{ type: 'share', value: 'units' }, { type: 'view', value: 'peer-pack' }] },
  { title: 'All of this is one pack', text: 'Places and data streams are not built into org-os. They come from one opt-in extension pack. Explore freely from here.', target: 'drawer-pack',
    actions: [{ type: 'view', value: 'you' }, { type: 'drawer', value: 'pack' }] },
];
