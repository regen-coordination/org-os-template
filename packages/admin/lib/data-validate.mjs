// packages/admin/lib/data-validate.mjs
//
// Every data/*.yaml against the admin schemas (F1 spec §3.5). One module for
// the server's writes (server/schema.ts delegates its schema half here) and for
// `npm run validate:data`, so the two cannot disagree.
//
// Levels: an `error` is a file or entry that is not what its schema says. A
// `warn` is something people should look at that breaks nothing today: a
// reference to an id this instance does not hold, an entry with no id or with
// an id an earlier entry already uses, a System kind no driver knows, the
// deprecated `infrastructure` block. Warnings never fail a run.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { isMap } from './yaml-util.mjs'
import { REGISTRIES, REGISTRY_OF_KIND, resolveTopKey } from './registries.mjs'
import { BASE_FIELDS, validateBoard } from './board-query.mjs'
import { readGovernance, yamlDocuments } from './governance-read.mjs'
import { checkGovernance } from './rules.mjs'
import { checkProposals } from './proposals.mjs'
import { CHANGE_CLASSES, classOf } from './change-classes.mjs'
import { RECEIPTS, checkReceipts } from './receipts.mjs'
import { checkVisibilityPolicy, defaultLinkLevel, formatLevel, readFullPolicy, restrictedFields, WALLET_LINK } from './visibility.mjs'
import { membershipTree } from './rules.mjs'
import { parseCaip10 } from './caip.mjs'

/** @typedef {{ file: string, id?: string, path: string, message: string, level: 'error'|'warn' }} Problem */
/** @typedef {{ registry: string, field: string, target: string, array?: boolean }} Ref */

const SCHEMA_DIR = new URL('../schemas/', import.meta.url)
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

/**
 * A registry's JSON Schema, or the generic one for a registry without its own.
 * @param {string} name
 * @returns {Record<string, any> & { $id: string }}
 */
export function loadSchema(name) {
  const own = new URL(`${name}.schema.json`, SCHEMA_DIR)
  return JSON.parse(readFileSync(existsSync(own) ? own : new URL('_generic.schema.json', SCHEMA_DIR), 'utf8'))
}

/**
 * The fields a board source may name for a kind, as the FULL list: every record's (BASE_FIELDS) and its
 * registry schema's. Callers use it as is and never prepend BASE_FIELDS. Null for a kind no registry
 * backs (a module, a seat): its fields are then not checked.
 * @param {string} kind @returns {string[] | null}
 */
export function boardFieldsOf(kind) {
  const registry = REGISTRY_OF_KIND[kind]
  if (!registry) return null
  const s = loadSchema(registry)
  return [...new Set([...BASE_FIELDS, ...Object.keys(s.properties ?? {}), ...(s['x-order'] ?? [])])]
}

/** @type {Map<string, import('ajv').ValidateFunction>} */
const compiled = new Map()

/** Compiled once per registry name; by `$id`, since several names can share the generic schema. */
function validator(name) {
  let fn = compiled.get(name)
  if (!fn) {
    const schema = loadSchema(name)
    fn = ajv.getSchema(schema.$id) ?? ajv.compile(schema)
    compiled.set(name, fn)
  }
  return fn
}

/** Cross-references from docs/DATA-MODEL.md. `ideas.source` (a file path) is
 *  deliberately unchecked — it references a knowledge file, not a registry id.
 *  @type {Ref[]} */
export const REFS = [
  { registry: 'projects', field: 'lead', target: 'members' },
  { registry: 'projects', field: 'contributors', target: 'members', array: true },
  { registry: 'projects', field: 'related_ideas', target: 'ideas', array: true },
  { registry: 'projects', field: 'funding_source', target: 'funding-opportunities' },
  { registry: 'meetings', field: 'participants', target: 'members', array: true },
  { registry: 'events', field: 'related_project', target: 'projects' },
]

/** The sentence a broken reference is reported in, by the server and the script alike.
 *  @param {string} target @param {string} id @returns {string} */
export function refMessage(target, id) {
  const noun = target.replace(/-opportunities$/, '').replace(/s$/, '')
  return `no ${noun} with id "${id}" in ${target}`
}

/**
 * The reference half of a write: the fields of `entry` (an entry of `registry`)
 * that name an id the target registry does not hold. The one place this check
 * lives; the server's writes call it, and `validateRepo` reports the same
 * sentence as a warning. `idsOf(target)` answers the ids the target holds, or
 * null when the registry is absent or unreadable (the check is then skipped).
 * @param {string} registry
 * @param {Record<string, any>} entry
 * @param {(target: string) => Set<string> | null} idsOf
 * @returns {{ field: string, message: string }[]}
 */
export function referenceErrors(registry, entry, idsOf) {
  /** @type {{ field: string, message: string }[]} */
  const errors = []
  for (const ref of REFS.filter(r => r.registry === registry)) {
    const value = entry[ref.field]
    if (value === null || value === undefined) continue
    const ids = idsOf(ref.target)
    if (!ids) continue
    const check = v => {
      if (typeof v === 'string' && !ids.has(v)) errors.push({ field: ref.field, message: refMessage(ref.target, v) })
    }
    if (ref.array && Array.isArray(value)) value.forEach(check)
    else check(value)
  }
  return errors
}

/**
 * The entries that name `id` of registry `name` in a reference field: what
 * would be left pointing at nothing if it were deleted. `entriesOf(registry)`
 * answers a registry's entries, or null when it is absent or unreadable.
 * @param {string} name
 * @param {string} id
 * @param {(registry: string) => Record<string, any>[] | null} entriesOf
 * @returns {{ registry: string, id: string, field: string }[]}
 */
export function referrersOf(name, id, entriesOf) {
  const found = []
  for (const ref of REFS.filter(r => r.target === name)) {
    const entries = entriesOf(ref.registry)
    if (!entries) continue
    for (const entry of entries) {
      const value = entry[ref.field]
      if (value === id || (ref.array && Array.isArray(value) && value.includes(id))) {
        found.push({ registry: ref.registry, id: String(entry.id), field: ref.field })
      }
    }
  }
  return found
}

/**
 * An entry's id as the platform addresses it, or null when it carries none:
 * absent, null and "" are all no id, and an entry that is not a mapping has none.
 * @param {unknown} entry @returns {string | null}
 */
function idOf(entry) {
  if (!isMap(entry)) return null
  const id = entry.id
  return id === undefined || id === null || id === '' ? null : String(id)
}

/**
 * Which entries of a list registry the platform can address by id: the one
 * rule for the server's id lookups and validateRepo's checks alike.
 * @param {unknown[]} entries
 * @returns {{ ids: Set<string>, noId: number[], shared: Map<string, number> }}
 *   ids: every id some entry carries. noId: the zero-based positions of the
 *   entries that carry none (absent, null, "", or not a mapping). shared: each
 *   id more than one entry carries, with how many do (always 2 or more).
 */
export function addressability(entries) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  /** @type {number[]} */
  const noId = []
  entries.forEach((entry, index) => {
    const id = idOf(entry)
    if (id === null) noId.push(index)
    else counts.set(id, (counts.get(id) ?? 0) + 1)
  })
  return { ids: new Set(counts.keys()), noId, shared: new Map([...counts].filter(([, n]) => n > 1)) }
}

/** A field the way the admin's forms name it: `tags.2`, or the missing property's name. */
const fieldOf = e => e.instancePath.replace(/^\//, '').replace(/\//g, '.') || String(e.params?.missingProperty ?? '')

/** Checks a JSON Schema cannot state: they warn, they never refuse. */
function warnings(registry, entry) {
  /** @type {{ path: string, message: string, level: 'warn' }[]} */
  const out = []
  if (registry === 'systems' && typeof entry.kind === 'string') {
    const known = /** @type {any} */ (validator('systems').schema).properties.kind.examples
    if (!known.includes(entry.kind)) {
      out.push({ path: 'kind', level: 'warn',
        message: `kind "${entry.kind}" is not one the framework knows (${known.join(', ')}); it is kept, and no driver reads it` })
    }
  }
  if (registry === 'members' && isMap(entry.handles) && entry.handles.wallet !== undefined && entry.handles.wallet !== null) {
    // lib/hat-readings.mjs `walletsOf` leaves out what is no CAIP-10 id (DAO-OS L5, R-L5-3.1): say so, never silently.
    const listed = Array.isArray(entry.handles.wallet) ? entry.handles.wallet : [entry.handles.wallet]
    listed.forEach((w, i) => {
      if (parseCaip10(w) !== null) return
      const path = Array.isArray(entry.handles.wallet) ? `handles.wallet.${i}` : 'handles.wallet'
      out.push({ path, level: 'warn', message: typeof w === 'string' && /^0x[0-9a-fA-F]{40}$/.test(w)
        ? 'a bare address has no chain, so no reading is ever matched to it: write it as a CAIP-10 id, eip155:<chain id>:0x…'
        : 'is not a CAIP-10 id (eip155:<chain id>:0x…), so no reading is ever matched to it' })
    })
  }
  if (registry === 'governance' && isMap(entry.infrastructure)) {
    const set = Object.entries(entry.infrastructure).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k]) => k)
    if (set.length > 0) {
      out.push({ path: 'infrastructure', level: 'warn',
        message: `infrastructure is deprecated in 0.6: move ${set.join(', ')} to data/systems.yaml ` +
          '(the 0.6 migration copies them there; delete them here once it has)' })
    }
  }
  return out
}

/**
 * One entry (or one document block) against its registry's schema.
 * `file` is left empty; validateRepo fills it in.
 * @param {string} registry
 * @param {unknown} entry
 * @returns {Problem[]}
 */
export function validateEntry(registry, entry) {
  const fn = validator(registry)
  const own = idOf(entry)
  const id = own === null ? {} : { id: own }
  /** @type {Problem[]} */
  const problems = []
  if (!fn(entry)) {
    for (const e of fn.errors ?? []) {
      if (e.keyword === 'if') continue // the `then` errors beside it say what is wrong
      problems.push({ file: '', ...id, path: fieldOf(e), message: e.message ?? 'invalid', level: 'error' })
    }
  }
  if (registry === 'systems' && isMap(entry) && entry.chains !== undefined && entry.chains !== null && entry.kind !== 'safe') {
    problems.push({ file: '', ...id, path: 'chains', message: 'chains is read for a Safe only', level: 'error' })
  }
  if (registry === 'boards' && isMap(entry)) {
    for (const message of validateBoard(entry, { fieldsOf: boardFieldsOf })) {
      problems.push({ file: '', ...id, path: 'blocks', message: own === null ? message : `board "${own}": ${message}`, level: 'error' })
    }
  }
  if (isMap(entry)) problems.push(...warnings(registry, entry).map(w => ({ file: '', ...id, ...w })))
  return problems
}

/**
 * The top-level mapping of a registry file, or undefined (with the reason in `problems`).
 * @param {string} text @param {string} file @param {Problem[]} problems
 * @returns {Record<string, any> | undefined}
 */
function readTop(text, file, problems) {
  const docs = yamlDocuments(text)
  if (docs.length > 1) {
    problems.push({ file, path: '', level: 'error',
      message: `holds ${docs.length} YAML documents, separated by \`---\`, where a registry is one: merge them into one by hand` })
    return undefined
  }
  const [one] = docs
  if (!one) return {}
  if (one.error !== undefined) { problems.push({ file, path: '', level: 'error', message: `is not valid YAML: ${one.error}` }); return undefined }
  if (!isMap(one.value)) { problems.push({ file, path: '', level: 'error', message: 'is not a mapping of keys to values at its top level' }); return undefined }
  return one.value
}

/** What every rule-4 sentence below ends with: validate:governance picks these problems out by it (`isGitSafetyProblem`). */
const PRIVATE_STORE = 'the private store'
const PLACEHOLDER = `an op on private data is held in git only as a placeholder (op: private), its value in ${PRIVATE_STORE}`
/** A level meant as a hat or a role, however written (lib/visibility.mjs reads it so: it admits nobody when it does not parse). */
const STRICT = /^\s*(hat|role)\s*:/i
/** A record's own `visibility` that git may not hold: a hat or role level (house spec §11 rule 4). @param {unknown} v */
const tooStrict = v => typeof v === 'string' && STRICT.test(v)
/** A value that is there: a field written as null holds nothing. @param {unknown} v */
const held = v => v !== undefined && v !== null

/**
 * Whether a problem is one of rule 4's (nothing stricter than members in git), so validate:governance reports it too
 * (L5 spec §10.5). @param {Problem} p @returns {boolean}
 */
export function isGitSafetyProblem(p) {
  return p.level === 'error' && p.message.endsWith(PRIVATE_STORE)
}

/**
 * Rule 4 in git (L5 spec §10.5), and data/visibility.yaml against the org (`checkVisibilityPolicy`): no record whose own
 * `visibility` is a hat or role level; no value of a field the policy restricts, nor a member's wallet link kept at
 * `defaults.contact` (R-L5-18.7: a snapshot cannot tell a link git held before from a new one, so each is reported until
 * the field is narrowed); no op of a proposal, open or closed, that writes any of these. A restricted value is never
 * repeated: the field is named.
 * @param {Map<string, Record<string, any>[]>} loaded @param {Record<string, any> | null} visibilityDoc
 * @param {Record<string, any> | null} governance @param {Record<string, any>[] | null} systems
 * @returns {Problem[]}
 */
function gitHoldsNothingPrivate(loaded, visibilityDoc, governance, systems) {
  /** @type {Problem[]} */
  const out = []
  const { policy } = readFullPolicy(visibilityDoc ?? {})
  const link = defaultLinkLevel(policy, WALLET_LINK.registry)
  const linkKept = link ? `a wallet link, kept at ${formatLevel(link)} by data/visibility.yaml's defaults.contact (narrow members.wallet to move it)` : ''
  if (visibilityDoc !== null) {
    const roles = isMap(governance?.roles) ? Object.keys(governance.roles) : []
    const tree = membershipTree(governance, systems)?.tree ?? null
    for (const p of checkVisibilityPolicy(visibilityDoc, { registries: REGISTRIES.map(r => r.name), roles, tree })) {
      out.push({ file: 'data/visibility.yaml', path: p.path, message: p.message, level: p.level })
    }
  }
  for (const [name, entries] of loaded) {
    if (name === 'proposals') continue
    const restricted = restrictedFields(policy, name)
    for (const entry of entries) {
      const own = idOf(entry)
      const id = own === null ? {} : { id: own }
      if (tooStrict(entry.visibility)) {
        out.push({ file: `data/${name}.yaml`, ...id, path: 'visibility', level: 'error',
          message: `this record's visibility is ${String(entry.visibility).trim()}, stricter than members: it belongs in ${PRIVATE_STORE}` })
      }
      for (const [field, level] of Object.entries(restricted)) {
        if (!held(entry[field])) continue
        out.push({ file: `data/${name}.yaml`, ...id, path: field, level: 'error',
          message: `the field ${field} is restricted to ${formatLevel(level)} by data/visibility.yaml, so its value is stricter than members: it belongs in ${PRIVATE_STORE}` })
      }
      if (link && name === WALLET_LINK.registry && held(entry[WALLET_LINK.field])) {
        out.push({ file: `data/${name}.yaml`, ...id, path: WALLET_LINK.field, level: 'error',
          message: `the field ${WALLET_LINK.field} holds ${linkKept}: it belongs in ${PRIVATE_STORE}` })
      }
    }
  }
  for (const p of loaded.get('proposals') ?? []) {
    if (!isMap(p)) continue
    // Open or closed, an error (§10.5 binds; controller ruling, Task 10 fix round 1): narrowing replaces such ops with
    // placeholders (Task 16), in the proposal's ops and in the ops its revise events recorded (final review MF-2).
    const level = 'error'
    const tail = PLACEHOLDER
    const pid = idOf(p) === null ? {} : { id: idOf(p) }
    /** @type {{ ops: unknown[], path: string, of: string }[]} */
    const lists = Array.isArray(p.ops) ? [{ ops: p.ops, path: 'ops', of: '' }] : []
    if (Array.isArray(p.events)) {
      p.events.forEach((e, k) => {
        if (isMap(e) && e.kind === 'revise' && Array.isArray(e.ops)) lists.push({ ops: e.ops, path: `events.${k}.ops`, of: ` of revise event ${e.id ?? `#${k + 1}`}` })
      })
    }
    for (const list of lists) {
      list.ops.forEach((op, i) => {
        if (!isMap(op) || op.op === 'private' || typeof op.record !== 'string') return
        const registry = op.record.slice(0, Math.max(0, op.record.indexOf(':')))
        const written = isMap(op.set) ? op.set : isMap(op.value) ? op.value : {}
        const at = { file: 'data/proposals.yaml', ...pid, path: `${list.path}.${i}`, level }
        const name = `op ${i + 1}${list.of} on ${op.record}`
        if (tooStrict(written.visibility)) {
          out.push({ ...at, message: `${name} makes the record ${String(written.visibility).trim()}, stricter than members: ${tail}` })
        }
        for (const [field, l] of Object.entries(restrictedFields(policy, registry))) {
          if (held(written[field])) out.push({ ...at, message: `${name} writes ${field}, which data/visibility.yaml restricts to ${formatLevel(l)}: ${tail}` })
        }
        if (link && registry === WALLET_LINK.registry && held(written[WALLET_LINK.field])) {
          out.push({ ...at, message: `${name} writes ${WALLET_LINK.field}, ${linkKept}: ${tail}` })
        }
      })
    }
  }
  return out
}

/**
 * Every registry file under `root/data/` the registry list knows. Files it does
 * not know (crm.yaml, hermes-cron.yaml...) are an instance's own and are not read.
 * @param {string} root
 * @returns {Problem[]}
 */
export function validateRepo(root) {
  /** @type {Problem[]} */
  const problems = []
  /** @type {Map<string, Record<string, any>[]>} */
  const loaded = new Map()
  /** @type {Record<string, any> | null} */
  let governanceBlock = null
  /** data/visibility.yaml's document, when it could be read. @type {Record<string, any> | null} */
  let visibilityDoc = null
  for (const def of REGISTRIES) {
    const file = `data/${def.name}.yaml`
    const full = join(root, file)
    if (!existsSync(full)) {
      if (def.name === 'governance') {
        problems.push({ file, path: '', level: 'warn', message: 'no governance file; running as solo-maintainer' })
      }
      continue
    }
    const text = readFileSync(full, 'utf8')

    if (def.name === 'governance') {
      const read = readGovernance(text)
      const level = read.shape === 'multi-document' || read.shape === 'unparseable' ? 'error' : 'warn'
      for (const message of read.problems) problems.push({ file, path: '', message, level })
      if (read.governance) {
        problems.push(...validateEntry('governance', read.governance).map(p => ({ ...p, file })))
        governanceBlock = read.governance
      }
      continue
    }

    const top = readTop(text, file, problems)
    if (top === undefined) continue
    const key = resolveTopKey(k => Object.hasOwn(top, k), def)
    const block = top[key]

    if (def.kind === 'document') {
      if (def.name === 'visibility') visibilityDoc = top
      if (isMap(block)) problems.push(...validateEntry(def.name, block).map(p => ({ ...p, file })))
      else if (block !== undefined && block !== null) {
        problems.push({ file, path: key, level: 'error', message: `\`${key}:\` is not a mapping of keys to values` })
      }
      continue
    }

    if (block === undefined || block === null) { loaded.set(def.name, []); continue }
    if (!Array.isArray(block)) {
      problems.push({ file, path: key, level: 'error', message: `\`${key}:\` is not a list of entries` })
      continue
    }
    const { noId, shared } = addressability(block)
    const noIdAt = new Set(noId)
    const seen = new Set()
    /** @type {Record<string, any>[]} */
    const entries = []
    block.forEach((entry, index) => {
      const where = `#${index + 1}`
      if (!isMap(entry)) {
        problems.push({ file, id: where, path: '', level: 'error', message: 'this entry is not a mapping of fields to values' })
        return
      }
      const id = idOf(entry)
      const hasId = !noIdAt.has(index)
      if (!hasId) {
        problems.push({ file, id: where, path: 'id', level: 'warn',
          message: 'this entry has no id, so the admin and the board cannot address it: give it one' })
      } else if (seen.has(id)) {
        problems.push({ file, id: String(id), path: 'id', level: 'warn',
          message: `id \`${id}\` appears ${shared.get(String(id))} times in ${file}; the platform will not edit entries with this id` })
      } else seen.add(id)
      // An entry with no id is checked for everything else under its position.
      problems.push(...validateEntry(def.name, hasId ? entry : { ...entry, id: where }).map(p => ({ ...p, file })))
      entries.push(entry)
    })
    loaded.set(def.name, entries)
  }

  // Roles and rules need the members and the systems, whatever order the registries load in.
  // A registry file that exists but could not be read is "not known" (null): its checks are skipped, not failed.
  if (governanceBlock) {
    const known = name => loaded.get(name) ?? (existsSync(join(root, 'data', `${name}.yaml`)) ? null : [])
    // `live`: this is the org's own governance document, so the L5 §7.6 check runs (ruling P8; proposals' frozen rules do not).
    problems.push(...checkGovernance(governanceBlock, { members: known('members'), systems: known('systems'), classes: CHANGE_CLASSES, live: true })
      .map(p => ({ ...p, file: 'data/governance.yaml' })))
  }

  // The ledger of proposals: the shapes the schema cannot say (who may write which event, the rule snapshot).
  const ledger = loaded.get('proposals')
  if (ledger && ledger.length > 0) {
    const known = name => loaded.get(name) ?? (existsSync(join(root, 'data', `${name}.yaml`)) ? null : [])
    problems.push(...checkProposals(ledger, {
      members: known('members'), governance: governanceBlock, systems: known('systems'), classes: CHANGE_CLASSES,
      classOf: registry => classOf({ registry }),
    }).map(p => ({ ...p, file: 'data/proposals.yaml' })))
  }

  // Nothing stricter than members in git (DAO-OS L5 spec §10.5, house spec §11 rule 4), and the policy read against the org.
  problems.push(...gitHoldsNothingPrivate(loaded, visibilityDoc, governanceBlock,
    loaded.get('systems') ?? null))

  // The library's receipts: every field the seal fills is filled (a hand edit is not sealed).
  const receipts = loaded.get(RECEIPTS)
  if (receipts) {
    problems.push(...checkReceipts(receipts).map(p => ({ file: `data/${RECEIPTS}.yaml`, ...p, level: /** @type {const} */ ('error') })))
  }

  // References, through the one check the server's writes use.
  /** @type {Map<string, Set<string>>} */
  const idSets = new Map()
  const idsOf = target => {
    const entries = loaded.get(target)
    if (!entries) return null // an absent registry is not checked, as on the server
    let ids = idSets.get(target)
    if (!ids) {
      ids = addressability(entries).ids
      idSets.set(target, ids)
    }
    return ids
  }
  for (const [name, entries] of loaded) {
    for (const entry of entries) {
      for (const { field, message } of referenceErrors(name, entry, idsOf)) {
        const id = idOf(entry)
        problems.push({ file: `data/${name}.yaml`, ...(id === null ? {} : { id }), path: field, message, level: 'warn' })
      }
    }
  }
  return problems
}
