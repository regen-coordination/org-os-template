/**
 * visibility-declaration.mjs — the `declare-visibility` stage's pure half (DAO-OS L8, Q55, Ruling R31).
 *
 * L8 makes `members` the default level for every collection, so an instance with no `data/visibility.yaml` would
 * publish far less on its first regeneration than 0.6 did. The stage writes the declaration that keeps today's
 * publication, as its own commit, for the org to confirm, edit or revert.
 *
 * R31: it declares only what the instance's `.well-known/` shows it publishes today. Each 0.6 output file maps to
 * the collections it was built from; a collection is declared only when its 0.6 file is there and the instance has
 * the registry. No 0.6 output, no declaration.
 *
 * L8-C18: the L8 generator writes members.json, proposals.json and contracts.json too, even empty. Its dao.json carries
 * the generator's mark (packages/admin/lib/standards/dao.mjs), and an instance whose dao.json carries it gets no
 * declaration: its files show what L8 publishes under the default, not what 0.6 published.
 */

import { GENERATOR_MARK_KEY, hasGeneratorMark } from '../../admin/lib/standards/dao.mjs';

/** The mark's key, and the generator's own check for it: the doctor reads the mark the builder writes, never a copy. */
export { GENERATOR_MARK_KEY, hasGeneratorMark };

/**
 * Whether a `.well-known/dao.json` text was written by the L8 generator (it carries the mark). Unreadable or absent
 * text is not L8 output.
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function isGeneratedByL8(text) {
  if (typeof text !== 'string') return false;
  try {
    return hasGeneratorMark(JSON.parse(text));
  } catch {
    return false;
  }
}

/**
 * Each 0.6 output file under `.well-known/` -> the registries it was built from, in the order they are declared.
 * `proposals.json` was built from governance's decision rows only: never governance.md's prose and rules.
 */
export const OUTPUT_COLLECTIONS = [
  ['members.json', ['members']],
  ['proposals.json', ['governance']],
  ['contracts.json', ['systems']],
  ['meetings.json', ['meetings']],
  ['projects.json', ['projects']],
  ['finances.json', ['finances']],
  ['ideas.json', ['ideas']],
  ['knowledge.json', ['knowledge-manifest', 'sources']],
];

/** The 0.6 output files the stage looks for. `dao.json` is not one: stage 6c renders it in every clone. It is read only
 * for the generator's mark (L8-C18). */
export const OUTPUT_FILES = OUTPUT_COLLECTIONS.map(([file]) => file);

/** Every registry a declaration can name, in order. */
export const DECLARED_COLLECTIONS = OUTPUT_COLLECTIONS.flatMap(([, names]) => names);

/** Registry names the stage reads, with their files (members is among them: its fields are listed). */
export const DECLARATION_REGISTRIES = DECLARED_COLLECTIONS;

/** Registries whose records may also be Markdown files, `content/<name>/*.md`. */
export const MARKDOWN_REGISTRIES = ['meetings', 'projects'];

export const visibilityFileFor = (name) => `data/${name}.yaml`;
export const VISIBILITY_FILE = 'data/visibility.yaml';

export const VISIBILITY_COMMIT_SUBJECT = 'chore(visibility): declare what this instance already publishes';

/** A member's keys that 0.6's members.json carried (or that only select): kept public. Every other key is `members`. */
const NOT_PUBLISHED_KEYS = new Set(['id', 'kind', 'status']);

/** Governance's fields 0.6 never published (it published the decision rows, as proposals.json). */
const GOVERNANCE_WITHHELD = ['description', 'rules'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The member records of a parsed members.yaml: a `members` list, or a map keyed by id. */
function memberRecords(parsed) {
  if (!isObj(parsed)) return [];
  const m = parsed.members;
  if (Array.isArray(m)) return m.filter(isObj);
  if (isObj(m)) return Object.values(m).filter(isObj);
  return [];
}

/** YAML keys that need no quoting; anything else is emitted as a JSON string (valid YAML). */
const key = (k) => (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) ? k : JSON.stringify(k));

/** A collection public by default, its listed fields `members`. @param {string} name @param {string[]} fields */
function entry(name, fields) {
  if (fields.length === 0) return [`    ${key(name)}: { default: public }`];
  return [`    ${key(name)}:`, '      default: public', '      fields:', ...fields.map((f) => `        ${key(f)}: members`)];
}

/**
 * What declaration would this instance get.
 *
 * @param {object} p
 * @param {boolean} p.hasVisibilityFile  `data/visibility.yaml` already exists: the stage does nothing
 * @param {boolean} [p.hasVisibilityHistory]  `data/visibility.yaml` has git history (declared before, perhaps
 *   reverted): the stage does nothing, so a revert stays reverted
 * @param {Iterable<string>} p.published  the names of the files under `.well-known/` (only OUTPUT_FILES are read)
 * @param {Record<string, unknown>} p.registries  parsed registry files by registry name; a registry the instance does
 *   not have is absent here (or undefined). Meetings and projects held as `content/<name>/*.md` count as present.
 * @returns {string|null} the YAML text, leading comment included; null when there is nothing to declare
 */
export function declareVisibility({ hasVisibilityFile, hasVisibilityHistory = false, published, registries }) {
  if (hasVisibilityFile || hasVisibilityHistory) return null;
  const shown = new Set(published ?? []);
  const has = (name) => registries?.[name] !== undefined && registries[name] !== null;

  const lines = [];
  for (const [file, names] of OUTPUT_COLLECTIONS) {
    if (!shown.has(file)) continue;
    for (const name of names) {
      if (!has(name)) continue;
      if (name === 'members') {
        const seen = new Set();
        for (const r of memberRecords(registries.members)) for (const k of Object.keys(r)) seen.add(k);
        lines.push(...entry('members', [...seen].filter((k) => !NOT_PUBLISHED_KEYS.has(k)).sort()));
      } else if (name === 'governance') {
        lines.push(...entry('governance', GOVERNANCE_WITHHELD));
      } else {
        lines.push(...entry(name, []));
      }
    }
  }
  if (lines.length === 0) return null;

  return [
    '# Written by `doctor sync` (@org-os/instance-doctor) to keep publishing what this instance\'s .well-known/ showed',
    '# it published before DAO-OS L8, whose default is `members`. This file is the org\'s to change: set a collection to',
    '# `members` to stop publishing it. The doctor never writes this file again once it has any history.',
    '# A member record\'s fields listed below stay `members`: only the record ids were public, and email and handles',
    '# never are. Governance\'s description and rules stay `members`: 0.6 published its decision rows only.',
    'visibility:',
    '  collections:',
    ...lines,
    '',
  ].join('\n');
}
