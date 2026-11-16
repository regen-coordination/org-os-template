// Fixture for the page model: an invented commons, "Example DAO Commons". Invented entries and roles only.
export const NOW = '2026-10-29T12:00:00Z';
const OWN = 'did:plc:exampledao';
const PEER = 'did:plc:hillsidepeer';
export const PEER_URI = `at://${PEER}/org.hillside.resource/seedsaving1`;
const day = (n) => new Date(Date.parse(NOW) - n * 86400000).toISOString();

const item = (schema, slug, object) => ({ schema, ref: `data/kb/${schema}.yaml#${slug}`, object: { type: schema, id: `id-${slug}`, ...object } });

export const living = item('encyclopedia-entry', 'living-mulch', {
  title: 'Living mulch', page_type: 'concept', maturity: 'reviewed', public_use: 'reviewed-for-guidance',
  summary: 'A cover crop kept growing between rows to hold soil and feed the next planting.',
  known_tensions: ['Competes with young seedlings for water.', 'Needs a mowing rhythm the crew can keep.'],
  audience: 'Field crews', steward: 'Field steward', currentness: 'Checked this season', updated: '2026-10-20',
  notes: 'PRIVATE: ask about the neighbour’s field', source_lineage: 'seed-library',
  related_concepts: ['cover-cropping', 'staff-handbook', 'no-such-note'],
  related_resources: [PEER_URI],
});
export const cover = item('concept-lineage', 'cover-cropping', {
  title: 'Cover cropping', maturity: 'field-informed', public_use: 'ok-with-caveat',
  short_description: 'Planting something to protect the ground rather than to harvest.',
  toolkit_usage: 'Used as a default in the spring planting checklist.', updated: '2026-09-02',
  related_concepts: ['living-mulch'],
});
export const grazing = item('encyclopedia-entry', 'rotational-grazing', {
  title: 'Rotational grazing', page_type: 'guide', maturity: 'reviewed', public_use: 'reviewed-for-explanation',
  summary: 'Moving animals between paddocks so each one rests.', known_tensions: 'Fencing costs fall on the first year.',
  updated: '2026-08-14',
});
export const sisters = item('option-entry', 'three-sisters-guild', {
  title: 'Three sisters guild', maturity: 'deprecated', public_use: 'ok-with-caveat', superseded_by: 'cover-cropping',
  use_cases: 'Small beds with a trellis.', not_for: 'Wide rows.', updated: '2026-03-01',
});
export const card = item('source-system', 'seed-library', {
  title: 'Example DAO Seed Library', maturity: 'reviewed', public_use: 'reviewed-for-guidance',
  what_it_curates: 'Seed records and field notes.', how_to_credit: 'Credit the Example DAO Seed Library, CC BY.', updated: '2026-07-01',
});
export const peerEntry = item('resource', 'seed-saving', {
  title: 'Seed saving for small farms', id: 'id-peer-seed-saving', maturity: 'source-linked', public_use: 'source-linked-unreviewed',
  sourceUri: PEER_URI, viaUri: PEER_URI, url: 'https://hillside.example/resources/seed-saving', updated: '2026-10-01',
});
export const handbook = item('encyclopedia-entry', 'staff-handbook', {
  title: 'Staff handbook', page_type: 'guide', maturity: 'reviewed', public_use: 'internal-only',
  summary: 'How the crew works week to week.', related_concepts: ['living-mulch'], updated: '2026-10-10',
});
export const swapNotes = item('claim-evidence', 'seed-swap-notes', {
  title: 'Seed swap notes', maturity: 'raw', public_use: 'not-public-yet', ai_assisted: true,
  claim: 'Swaps raise local variety.', evidence: 'Counted at the autumn swap.', updated: '2026-10-25',
});

export const items = [living, cover, grazing, sisters, card, peerEntry];
export const allItems = [...items, handbook, swapNotes];

const rec = (it) => [it.object.id, { slug: it.ref.split('#')[1], atUri: `at://${OWN}/org.exampledao.${it.schema}/${it.object.id}`, cid: `cid-${it.object.id}` }];
export const manifest = { version: 1, objects: Object.fromEntries(allItems.filter((i) => i !== peerEntry).map(rec)) };

export const config = {
  instance: 'Example DAO Commons',
  atproto: { did: OWN, nsid_authority: 'org.exampledao' },
  connectors: [{ name: 'atproto', config: { peers: [PEER] } }],
  peers: {}, render: {}, publish: {}, packs: [],
};
export const knowledge = { did: OWN, description: 'Field notes and practice from the Example DAO growers.', sources: [{ title: 'Example DAO Seed Library' }] };
export const reads = { atproto: { ok_at: day(3), attempt_at: day(3), error: null } };
export const readsFailed = { atproto: { ok_at: day(9), attempt_at: day(0), error: 'timeout' } };
