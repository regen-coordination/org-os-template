// packages/org-os-needs-offers/src/shared-map.mjs — object -> record in the SHARED lexicon (example.commons.*, a placeholder).
// kms plan Task 6. Only keys the lexicon declares can leave; visibility, contact_route, intro_wanted and every other
// canon field are dropped by construction, because the record is built from the lexicon's property list, not from the object.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lexicon = (type) => JSON.parse(readFileSync(join(root, 'lexicons', `example.commons.${type}.json`), 'utf8'));

// The survey's wording -> the lexicon's value. A value with no row has no home (null): the item stays canon-only.
const SURVEY_TO_LEXICON = {
  'Tools and tech': 'tools-and-tech', 'Funding and finance': 'funding-and-finance', 'Governance and legal': 'governance-and-legal',
  'Knowledge and research': 'knowledge-and-research', 'Communications and media': 'communications-and-media',
  'Events and gathering': 'events-and-gathering', 'Land and place': 'land-and-place', 'Education and learning': 'education-and-learning',
  'People and skills': 'people-and-skills',
};

export function translateSurveyCategory(value) {
  return Object.hasOwn(SURVEY_TO_LEXICON, value) ? SURVEY_TO_LEXICON[value] : null;
}

/** → a record, or null when the object has no home in the lexicon (its category does not translate): it stays canon-only. */
export function toSharedRecord(object) {
  const doc = lexicon(object.type);
  const category = translateSurveyCategory(object.category);
  if (category === null) return null;
  const record = { $type: doc.id };
  for (const key of Object.keys(doc.defs.main.record.properties)) {
    const v = key === 'category' ? category : object[key];
    if (v !== undefined && v !== null) record[key] = v;
  }
  return record;
}
