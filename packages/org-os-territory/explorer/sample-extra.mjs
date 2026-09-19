// explorer/sample-extra.mjs — what the explorer's "who sees what" story needs on top of demo/sample.mjs (imported, never edited).
// ILLUSTRATIVE like the sample itself: the draft stream and the private note are invented so the publication floor has something to hold back.
import { UNITS, RESOURCES, STREAMS } from '../demo/sample.mjs';

export const EXTRA_NOTE = 'Also illustrative: every sample object is marked shareable, except one invented draft data stream; one unit carries an invented private note.';
export const DRAFT_STREAM = { title: 'Draft stream (example, not public yet)', type: 'data-stream', source_system: 'aca', access: 'manual', public_use: 'not-public-yet' };
export const PRIVATE_NOTE_UNIT = 'landscape:unit:plana-de-vic';
export const PRIVATE_FIELD = 'notes';
export const PRIVATE_VALUE = 'private editorial note (example)';

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** How a record is recognised on both sides of a publish: a unit by unit_id, anything else by title. */
export const idOf = (o) => o.unit_id || o.title;
const shareable = (o) => ({ ...o, public_use: 'ok-with-caveat' });
const entries = (list) => Object.fromEntries(list.map((o) => [slug(idOf(o)), shareable(o)]));

export const EXPLORER_INSTANCE_DATA = {
  resource: entries(RESOURCES),
  'territorial-unit': Object.fromEntries(UNITS.map((u) => [slug(u.unit_id), u.unit_id === PRIVATE_NOTE_UNIT ? { ...shareable(u), [PRIVATE_FIELD]: PRIVATE_VALUE } : shareable(u)])),
  'data-stream': { ...entries(STREAMS), [slug(DRAFT_STREAM.title)]: DRAFT_STREAM },
};
