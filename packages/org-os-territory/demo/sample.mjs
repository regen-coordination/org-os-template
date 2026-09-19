// demo/sample.mjs — the ILLUSTRATIVE Catalunya sample the demo runs the real code over. Names are examples, codes are
// placeholders (only one_earth:PA20 is real), overlap shares are INVENTED, and there is no geometry. Nothing here is a claim.
export const SAMPLE_NOTE = 'Illustrative sample: unit names are examples, codes are placeholders (only one_earth:PA20 is a real code), overlap shares are invented, and there is no geometry — the diagram is schematic, not a map.';

const layerOf = (id) => id.split(':')[0];
const levelOf = (id) => id.split(':')[1];
const u = (id, title, part_of, extra = {}) => ({ title, type: 'territorial-unit', unit_id: id, layer: layerOf(id), level: levelOf(id), ...(part_of ? { part_of } : {}), ...extra });

export const UNITS = [
  u('administrative:pais:catalunya', 'Catalunya'),
  u('administrative:vegueria:catalunya-central', 'Vegueria de la Catalunya Central', 'administrative:pais:catalunya'),
  u('administrative:comarca:osona', 'Osona', 'administrative:vegueria:catalunya-central'),
  u('administrative:comarca:bages', 'Bages', 'administrative:vegueria:catalunya-central'),
  u('administrative:municipi:vic', 'Vic', 'administrative:comarca:osona'),
  u('administrative:municipi:taradell', 'Taradell', 'administrative:comarca:osona'),
  u('administrative:municipi:manresa', 'Manresa', 'administrative:comarca:bages'),
  u('landscape:catalogue-area:comarques-centrals', 'Landscape catalogue: Comarques Centrals (example)'),
  u('landscape:unit:plana-de-vic', 'Plana de Vic (example unit)', 'landscape:catalogue-area:comarques-centrals', { codes: ['observatori:EXAMPLE-01'] }),
  u('landscape:unit:pla-de-bages', 'Pla de Bages (example unit)', 'landscape:catalogue-area:comarques-centrals', { codes: ['observatori:EXAMPLE-02'] }),
  // PA20 code and title per One Earth (oneearth.org/bioregions/balearic-sea-west-mediterranean-mixed-forests-pa20), recorded in lf-work-os data/ideas.yaml; web-verified 2026-09-18.
  u('ecological:bioregion:pa20', 'Balearic Sea & West Mediterranean Mixed Forests', null, { codes: ['one_earth:PA20'] }),
  u('hydrological:basin:example-basin', 'Example river basin (illustrative)'),
];

export const RESOURCES = [
  { title: 'Regenerative agriculture pilot (example)', type: 'resource', unit_refs: ['administrative:municipi:vic', 'landscape:unit:plana-de-vic'] },
  { title: 'Community orchard (example)', type: 'resource', unit_refs: ['administrative:municipi:manresa'] },
  { title: 'Basin monitoring (example)', type: 'resource', unit_refs: ['hydrological:basin:example-basin'] },
  { title: 'Catalonia-wide funding scan (example)', type: 'resource', unit_refs: ['administrative:pais:catalunya'] },
  { title: 'Orphan note (example)', type: 'resource', unit_refs: ['custom:site:ghost'] },
];

export const PROVIDERS = [
  { slug: 'icgc', title: 'Institut Cartogràfic i Geològic de Catalunya', steward: 'Generalitat de Catalunya' },
  { slug: 'observatori-del-paisatge', title: 'Observatori del Paisatge de Catalunya', steward: 'Observatori del Paisatge' },
  { slug: 'one-earth', title: 'One Earth', steward: 'One Earth' },
  { slug: 'aca', title: "Agència Catalana de l'Aigua", steward: 'Generalitat de Catalunya' },
  { slug: 'participa-gencat', title: 'participa.gencat.cat (Decidim)', steward: 'Generalitat de Catalunya' },
];

const stream = (title, source_system, access, format, licence, trust, cadence, layer_refs, relevant_for, unit_refs = []) =>
  ({ title, type: 'data-stream', source_system, access, format, licence, trust, cadence, layer_refs, relevant_for, unit_refs });
export const STREAMS = [
  stream('Administrative divisions (GeoJSON)', 'icgc', 'download', 'geojson', 'CC-BY-4.0', 'official', 'yearly', ['administrative'], ['governance', 'participation'], ['administrative:pais:catalunya']),
  stream('Landscape units (shapefile)', 'observatori-del-paisatge', 'download', 'shp', 'unverified', 'official', 'static', ['landscape'], ['restoration', 'governance']),
  stream('Bioregions framework (shapefile)', 'one-earth', 'download', 'shp', 'CC-BY-NC-4.0', 'verified-community', 'static', ['ecological'], ['restoration'], ['ecological:bioregion:pa20']),
  stream('Water layers (WFS)', 'aca', 'wfs', 'gml', 'unverified', 'official', 'daily', ['hydrological'], ['watershed']),
  stream('Participation processes (GraphQL)', 'participa-gencat', 'graphql', 'json', 'n/a', 'official', 'daily', ['administrative'], ['participation'], ['administrative:pais:catalunya']),
];

const T0 = '2026-09-19T00:00:00Z';
const METHOD = 'ILLUSTRATIVE — invented shares, no geometry';
const P = { a: 'landscape:unit:plana-de-vic', b: 'administrative:comarca:osona', share_a: 0.93, share_b: 0.42 };
export const OVERLAPS_VALID = { version: 1, generated: T0, method: METHOD, overlaps: [
  P,
  { a: 'landscape:unit:plana-de-vic', b: 'administrative:municipi:vic', share_a: 0.3, share_b: 0.85 },
  { a: 'landscape:unit:pla-de-bages', b: 'administrative:comarca:bages', share_a: 0.88, share_b: 0.51 },
  { a: 'landscape:unit:plana-de-vic', b: 'ecological:bioregion:pa20', share_a: 1, share_b: 0.01 },
  { a: 'hydrological:basin:example-basin', b: 'administrative:comarca:osona', share_a: 0.6, share_b: 0.4 },
] };
const doc = (overlaps) => ({ version: 1, generated: T0, method: METHOD, overlaps });
export const OVERLAP_FAULTS = [
  { id: 'same-layer', title: 'Two units on the same layer', doc: doc([{ a: 'administrative:comarca:osona', b: 'administrative:comarca:bages', share_a: 0.1, share_b: 0.1 }]), expect: /same layer \(administrative\)/ },
  { id: 'unknown-unit', title: 'A unit that does not exist', doc: doc([{ ...P, b: 'administrative:comarca:ghost' }]), expect: /unknown unit_id: administrative:comarca:ghost/ },
  { id: 'share-zero', title: 'A share of 0', doc: doc([{ ...P, share_a: 0 }]), expect: /share_a must be a number in \(0, 1\]/ },
  { id: 'share-over-one', title: 'A share above 1', doc: doc([{ ...P, share_b: 1.2 }]), expect: /share_b must be a number in \(0, 1\]/ },
  { id: 'duplicate-pair', title: 'The same pair twice, in either order', doc: doc([P, { a: P.b, b: P.a, share_a: 0.42, share_b: 0.93 }]), expect: /duplicate pair/ },
  { id: 'no-method', title: 'No method recorded', doc: { version: 1, generated: T0, method: '', overlaps: [P] }, expect: /method is required/ },
];

// Data written into the publish scenarios' temp instances (data/kb/<schema>.yaml). One publishable unit carrying a private note,
// one publishable stream and one not-public-yet stream, so the publication floor is visible.
export const INSTANCE_DATA = {
  resource: { a: { title: 'A resource placed in a unit', type: 'resource', public_use: 'ok-with-caveat', unit_refs: ['landscape:unit:plana-de-vic'] } },
  'territorial-unit': { 'plana-de-vic': { ...UNITS.find((x) => x.unit_id === 'landscape:unit:plana-de-vic'), public_use: 'ok-with-caveat', notes: 'private editorial note' } },
  'data-stream': {
    'landscape-units': { ...STREAMS[1], public_use: 'ok-with-caveat' },
    'draft-stream': { title: 'Draft stream (not public yet)', type: 'data-stream', source_system: 'aca', access: 'manual', public_use: 'not-public-yet' },
  },
};
