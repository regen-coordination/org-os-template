// packages/admin/lib/governance-read.mjs
//
// governance.yaml, read the way instances actually write it (F1 spec §3.3):
// the canonical `governance:` wrapper; a flat file with top-level `model` or
// `decisions`; `decision_model` for `model`.
// Read leniently, never rewritten. A file that is missing, or states no
// `model`, is read as solo-maintainer and says so. A file holding several YAML documents
// is not read at all: its documents hold meeting notes and
// templates that only the instance's people can place, so nothing here
// guesses which one is the governance record.

import { parseAllDocuments } from 'yaml'
import { isMap } from './yaml-util.mjs'

/** @typedef {'wrapped'|'unwrapped'|'decision_model'|'multi-document'|'missing'|'unparseable'} GovernanceShape */
/**
 * @typedef {object} GovernanceRead
 * @property {Record<string, unknown> | null} governance the block as read, or null when the file is not read
 * @property {GovernanceShape} shape
 * @property {string[]} problems
 * @property {boolean} modelImplied true when `governance.model` is the default (DEFAULT_MODEL), not stated in the file
 */
/** @typedef {Omit<GovernanceRead, 'modelImplied'>} BlockRead */
/** @typedef {{ value?: unknown, error?: string }} YamlDocument */


/**
 * The documents of a YAML text that hold something. A `---` that opens the
 * file, or one that ends it with nothing after, starts no document of its own.
 * A document the YAML library cannot read is kept, with its first fault.
 * @param {string} text
 * @returns {YamlDocument[]}
 */
export function yamlDocuments(text) {
  /** @type {YamlDocument[]} */
  const out = []
  for (const doc of parseAllDocuments(text)) {
    const [fault] = doc.errors
    if (fault) { out.push({ error: (fault.message.split('\n')[0] ?? '').trim() }); continue }
    let value
    try { value = doc.toJS() } catch (err) { out.push({ error: err instanceof Error ? err.message : String(err) }); continue }
    if (value !== null && value !== undefined) out.push({ value })
  }
  return out
}

/** The model a governance file that states none is read as (0.6). */
export const DEFAULT_MODEL = 'solo-maintainer'
/** The problem a read whose model was defaulted carries (a warning in validate:data). */
export const NO_MODEL = 'no governance model declared; running as solo-maintainer'

/**
 * A read whose block states no `model` (or an empty one) is read as
 * solo-maintainer, and says so. Nothing is written back.
 * @param {BlockRead} read
 * @returns {GovernanceRead}
 */
function withDefaultModel(read) {
  const block = read.governance ?? {}
  if (typeof block.model === 'string' && block.model.trim() !== '') return { ...read, modelImplied: false }
  return { governance: { ...block, model: DEFAULT_MODEL }, shape: read.shape, problems: [...read.problems, NO_MODEL], modelImplied: true }
}

/**
 * A file that is not read: no block, so no default model either.
 * @param {GovernanceShape} shape @param {string} problem
 * @returns {GovernanceRead}
 */
const notRead = (shape, problem) => ({ governance: null, shape, problems: [problem], modelImplied: false })

/** Top-level keys a flat file is read by; a flat file without any of them is not read. */
const FLAT_KEYS = ['model', 'decisions']

/** @param {Record<string, unknown>} block @returns {Record<string, unknown>} */
function fromDecisionModel(block) {
  const { decision_model: model, ...rest } = block
  // `decision_model: ""` states no model; it is not read as one.
  return typeof model === 'string' && model.trim() !== '' ? { model: model.trim(), ...rest } : rest
}

/**
 * @param {string | null} text the file's text, or null when the file is absent
 * @returns {GovernanceRead}
 */
export function readGovernance(text) {
  if (text === null || text === undefined) return withDefaultModel({ governance: null, shape: 'missing', problems: [] })
  const docs = yamlDocuments(String(text))
  if (docs.length > 1) {
    return notRead('multi-document', `holds ${docs.length} YAML documents, separated by \`---\`, where a registry is one. ` +
      'Merge them into one document under `governance:` by hand: only the people who wrote them know where each part belongs. ' +
      'Nothing in the file is read until then.')
  }
  const [one] = docs
  if (!one) return withDefaultModel({ governance: null, shape: 'missing', problems: [] })
  if (one.error !== undefined) return notRead('unparseable', `is not valid YAML: ${one.error}`)
  const top = one.value
  if (!isMap(top)) return notRead('unparseable', 'is not a mapping of keys to values at its top level')

  if (Object.hasOwn(top, 'governance')) {
    const block = top.governance ?? {}
    if (!isMap(block)) return notRead('unparseable', 'has a `governance:` that is not a mapping of keys to values')
    const problems = ['model', 'decision_model', 'decisions'].filter(key => Object.hasOwn(top, key))
      .map(key => `has \`${key}\` beside \`governance:\`; only the \`governance:\` block is read`)
    if (Object.hasOwn(block, 'decision_model') && !Object.hasOwn(block, 'model')) {
      return withDefaultModel({ governance: fromDecisionModel(block), shape: 'decision_model', problems })
    }
    return withDefaultModel({ governance: block, shape: 'wrapped', problems })
  }

  const { schema_version: _version, ...rest } = top
  if (Object.hasOwn(rest, 'decision_model') && !Object.hasOwn(rest, 'model')) {
    return withDefaultModel({ governance: fromDecisionModel(rest), shape: 'decision_model', problems: [] })
  }
  if (FLAT_KEYS.some(key => Object.hasOwn(rest, key))) return withDefaultModel({ governance: rest, shape: 'unwrapped', problems: [] })
  // Keys such as elections, roles or infrastructure, with nothing that marks the
  // file as governance: still read as missing, but they are named, not dropped unseen.
  const unread = Object.keys(rest)
  const problems = unread.length === 0 ? [] : [
    `has ${unread.map(key => `\`${key}\``).join(', ')} at its top level, and no \`governance:\`, \`model\` or \`decisions\`: ` +
      'none of them is read. Put them under `governance:`.',
  ]
  return withDefaultModel({ governance: null, shape: 'missing', problems })
}
