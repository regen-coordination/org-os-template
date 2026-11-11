// packages/admin/lib/change-classes.mjs
//
// Which class of change a write is (architecture §4.3, F1 spec §3.7). Rules key
// on classes (F2), so the table is one file, schemas/change-classes.json at the
// framework root, read by the server now and by `validate:governance` later.
// First match wins. `treasury` and `operations` are classes of action, not of
// file: drivers and operations assign them, and no row here does. `publication`
// (L5 §9.7) is data/visibility.yaml's class; a change that widens a record's
// visibility also carries it beside its registry's class (L5 Task 16).
// `workspace` (DAO-OS L6 §3.1) is the class of pages, tasks, meetings, collections,
// imports, knowledge and the agent layer: written at once under its implied rule
// `workspace/direct` unless a rule names it or one of its splits (lib/rules.mjs).

import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { walletsOf } from './hat-readings.mjs'
import { fullLevel, narrowerOrEqual } from './visibility.mjs'
import { isMap } from './yaml-util.mjs'
import { KNOWLEDGE } from './registries.mjs'
import { pageWidens } from './workspace/pages.mjs'
import { becomesPublishable } from './workspace/publishable.mjs'
import { KNOWLEDGE_FILE, canonObjects, canonReadDiffers } from './workspace/knowledge.mjs'

/** @typedef {{ registry?: string, path?: string, class: string }} ClassRow */

const TABLE = JSON.parse(readFileSync(new URL('../../../schemas/change-classes.json', import.meta.url), 'utf8'))

/** @type {readonly string[]} */
export const CHANGE_CLASSES = Object.freeze([...TABLE.classes])

/** The workspace's class (L6 §3.1). */
export const WORKSPACE = 'workspace'

/** @type {readonly ClassRow[]} */
const MAP = Object.freeze(TABLE.map)
for (const row of MAP) {
  if (!CHANGE_CLASSES.includes(row.class)) throw new Error(`schemas/change-classes.json: "${row.class}" is not one of its classes`)
}

/** `./IDENTITY.md`, `data/../IDENTITY.md` and `IDENTITY.md` are one file. @param {string} p */
const normal = p => posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '')

/** A row's path: exact, or `<dir>/**` for everything under <dir>. @param {string} pattern @param {string} path */
const matches = (pattern, path) => (pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern)

/**
 * @param {{ registry: string } | { path: string }} target
 * @returns {string} one of CHANGE_CLASSES
 */
export function classOf(target) {
  if ('path' in target) {
    const path = normal(target.path)
    const row = MAP.find(r => typeof r.path === 'string' && matches(r.path, path))
    if (row) return row.class
    // A registry file is classed as its registry; any other file falls to the `*` row.
    const registry = /^data\/([^/]+)\.ya?ml$/.exec(path)?.[1] ?? '*'
    return classOf({ registry })
  }
  const row = MAP.find(r => r.registry === target.registry || r.registry === '*')
  if (!row) throw new Error(`schemas/change-classes.json has no row for registry "${target.registry}" and no "*" row`)
  return row.class
}

/**
 * The class of a path a rule can govern (F2 spec §3.8), or null for a file that is
 * not a record of the org: a file directly under data/ (a registry, or an instance's
 * own data file the registry list does not know, such as crm.yaml), which gets the
 * class `classOf` gives it, so the validator and the platform agree (F2-R13); and the
 * files the table's path rows name (IDENTITY.md, federation.yaml, .well-known/**, and the
 * workspace's: pages/**, data/collections/**, data/kb/**, memory/**, MEMORY.md,
 * HEARTBEAT.md, docs/plans/**, docs/agent-plans/**: L6 §3.1).
 * A script, any other note, a site page or any other nested file is null. `data/proposals.yaml` stays
 * null: the ledger is not governed like a record, it is judged by its own check in
 * validate:governance (P2-R13).
 * @param {string} path @returns {string | null}
 */
export function governedClassOf(path) {
  const p = normal(path)
  if (/^data\/[^/]+\.ya?ml$/.test(p)) return p === 'data/proposals.yaml' ? null : classOf({ path: p })
  const row = MAP.find(r => typeof r.path === 'string' && matches(r.path, p))
  return row ? row.class : null
}

/**
 * Does `op` make something readable by more people (L5 §9.7): a publication, decided under the org's rules (class
 * `publication`) and never applied as a narrowing is? It does when the record's level after it (L5 §9.3, under `config`)
 * admits someone its level before did not — an op setting `visibility: public` on a members record, a create more public
 * than its collection, a replace or update that drops a stricter `visibility` — and when it adds an address to a member's
 * `handles.wallet` (the wallet ↔ person link, kept in the private store until its own person widens it: L5 §6.3, §9.7).
 * `before` is the record as the op was staged against it (null: none, for a create). A delete widens nothing.
 * @param {{ op: string, record: string, set?: Record<string, unknown>, value?: Record<string, unknown> }} op
 * @param {Record<string, unknown> | null | undefined} before
 * @param {import('./visibility.mjs').VisibilityPolicy | null | undefined} config
 * @returns {boolean}
 */
export function widens(op, before, config) {
  if (!isMap(op) || op.op === 'delete' || typeof op.record !== 'string') return false
  const at = op.record.indexOf(':')
  if (at <= 0) return false
  const registry = op.record.slice(0, at)
  // A knowledge object is shown by the commons, whose gate is kms's (R-L6-T10-2): the house's visibility does not publish
  // it, so a knowledge op never widens; whether it publishes is the floor's (`publishes`, ruling PF-R5).
  if (registry === KNOWLEDGE.name) return false
  const was = isMap(before) ? before : null
  const after = op.op === 'update' ? { ...(was ?? {}), ...(isMap(op.set) ? op.set : {}) } : (isMap(op.value) ? op.value : {})
  // Before a create there is no record: its level would have been its collection's.
  if (!narrowerOrEqual(fullLevel(config, registry, after), fullLevel(config, registry, was ?? {}))) return true
  if (registry !== 'members') return false
  const had = new Set(walletsOf(was))
  return walletsOf(after).some(w => !had.has(w))
}

/**
 * Does `op` publish (DAO-OS L6 §13, Q69): make something readable by the public, or publishable to the commons? It does
 * when it `widens` (a record made more public, a wallet link put in git), when it makes a page public (`pageWidens`: the
 * page, or a git subpage of it, public where it was not), and when it makes a knowledge object publishable by the commons'
 * floor (lib/workspace/publishable.mjs `becomesPublishable`: maturity and public use; ruling R-L6-T10-1), and when it writes a
 * canon text kms reads differently from the house (anchors, merge keys, tags: ruling PF-R2, fail closed). Each such op is a
 * publication decision, class `publication`, whatever else its class is. One predicate for every write in the house: the
 * tray (`classesOf`, `targetsOfOps`), a file op (`fileWidens`), the commons' entry page and validate:governance.
 * `before`: a record op's record as it was staged against (null: none, for a create); a file op's text before it (null: no
 * file). `ctx.pages`: the git pages as they are, for a page's file op (its parents decide its level); absent, the page is
 * judged alone, with `before` as its text. A delete publishes nothing.
 * @param {{ op: string, record?: string, path?: string, text?: string | null, base?: string | null, set?: Record<string, unknown>, value?: Record<string, unknown> }} op
 * @param {Record<string, unknown> | string | null | undefined} before
 * @param {import('./visibility.mjs').VisibilityPolicy | null | undefined} policy
 * @param {{ pages?: { id: string, text: string }[] }} [ctx]
 * @returns {boolean}
 */
export function publishes(op, before, policy, ctx = {}) {
  if (!isMap(op)) return false
  if (op.op === 'file') {
    if (typeof op.path !== 'string') return false
    const path = normal(op.path)
    const text = typeof op.text === 'string' ? op.text : null
    const page = /^pages\/([^/]+)\.md$/.exec(path)?.[1]
    if (page !== undefined) {
      const pages = ctx.pages ?? (typeof before === 'string' ? [{ id: page, text: before }] : [])
      return pageWidens(pages, page, text, policy)
    }
    if (KNOWLEDGE_FILE.test(path)) {
      // PF-R2 (fail closed): a canon text kms reads differently from the house (anchors, merge keys, tags) cannot be judged
      // by the house's reading, so writing one is a publication decision, whatever the house reads in it.
      if (text !== null && canonReadDiffers(text) !== null) return true
      const was = canonObjects(typeof before === 'string' ? before : null) ?? new Map()
      return [...(canonObjects(text) ?? new Map())].some(([slug, object]) => becomesPublishable(was.get(slug) ?? null, object))
    }
    return false
  }
  if (op.op === 'delete' || typeof op.record !== 'string') return false
  const was = isMap(before) ? before : null
  if (widens(op, was, policy)) return true
  if (!op.record.startsWith(`${KNOWLEDGE.name}:`)) return false
  const after = op.op === 'update' ? { ...(was ?? {}), ...(isMap(op.set) ? op.set : {}) } : (isMap(op.value) ? op.value : null)
  return becomesPublishable(was, after)
}

/** The wallet addresses `op` adds to a member's `handles.wallet` (CAIP-10, as `walletsOf` reads them), and whose record it
 *  is; null when it adds none (L5 §9.7: only that person widens their own link).
 *  @param {{ op: string, record: string, set?: Record<string, unknown>, value?: Record<string, unknown> }} op
 *  @param {Record<string, unknown> | null | undefined} before
 *  @returns {{ member: string, added: string[] } | null} */
export function walletsWidened(op, before) {
  if (!isMap(op) || op.op === 'delete' || typeof op.record !== 'string' || !op.record.startsWith('members:')) return null
  const was = isMap(before) ? before : null
  const after = op.op === 'update' ? { ...(was ?? {}), ...(isMap(op.set) ? op.set : {}) } : (isMap(op.value) ? op.value : {})
  const had = new Set(walletsOf(was))
  const added = walletsOf(after).filter(w => !had.has(w))
  return added.length > 0 ? { member: op.record.slice('members:'.length), added } : null
}
