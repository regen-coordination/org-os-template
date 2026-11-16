// packages/admin/lib/workspace/targets.mjs
//
// Where a workspace write is judged (DAO-OS L6 spec §3.2): its targets, most specific first, each ending in `workspace`.
// A rule raises a target by naming it (`workspace:tree-<page id>`, `workspace:<collection>`, `workspace:agent`,
// `workspace:pages`, `workspace`); lib/rules.mjs `workspaceRuleFor` takes the first one named, and never `all`.
//
//   pageTargets(id, ancestors)        → a page: itself, then each ancestor up to the root, then pages, then workspace
//   recordTargets(collection)         → a record: its collection, then workspace
//   AGENT_TARGETS                     → the agent layer (memory, plans: Q72)
//   targetsOfPath(path, readPage)     → a file's targets; null for a file that is not class workspace
//   targetsOfOp(op, fileOf, readPage) → a staged op's (a record op by its registry's file; a file op by its path; a private placeholder by class)
//   pageReader(readText)              → readPage over a reader of files (the worktree, or `git show <rev>:…`)
//
// The server (server/changes/stage.ts `targetsOf`) and validate:governance both build on these.

import { posix } from 'node:path'
import { WORKSPACE, classOf, governedClassOf } from '../change-classes.mjs'
import { splitPage } from './pages.mjs'

/** @typedef {(id: string) => { parent: string | null } | null} ReadPage */

/** @param {string} id @param {readonly string[]} ancestors nearest first @returns {string[]} */
export function pageTargets(id, ancestors) {
  return [`${WORKSPACE}:tree-${id}`, ...ancestors.map(a => `${WORKSPACE}:tree-${a}`), `${WORKSPACE}:pages`, WORKSPACE]
}

/** @param {string} collection @returns {string[]} */
export function recordTargets(collection) {
  return [`${WORKSPACE}:${collection}`, WORKSPACE]
}

/** @type {readonly string[]} */
export const AGENT_TARGETS = Object.freeze([`${WORKSPACE}:agent`, WORKSPACE])

/** The agent layer's files (L6 §3.1, Q72). */
const AGENT = /^(?:memory\/|docs\/plans\/|docs\/agent-plans\/|MEMORY\.md$|HEARTBEAT\.md$)/

/**
 * A page's ancestors, nearest first, read through `readPage`: the chain of `parent`s up to the root. A parent that names no
 * page ends it (the page shows at the root, §4.2), and so does a loop.
 * @param {string} id @param {ReadPage} readPage @returns {string[]}
 */
export function ancestorsOf(id, readPage) {
  /** @type {string[]} */
  const out = []
  const seen = new Set([id])
  let parent = readPage(id)?.parent ?? null
  while (parent !== null && !seen.has(parent)) {
    const page = readPage(parent)
    if (page === null) break
    out.push(parent)
    seen.add(parent)
    parent = page.parent ?? null
  }
  return out
}

/** `./pages/x.md` and `pages/x.md` are one file. @param {string} p */
const normal = p => posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '')

/**
 * The targets of a file (L6 §3.2), or null when it is not class workspace. A page (`pages/<id>.md`, or an attachment under
 * `pages/assets/<id>/`) is judged at its tree; a registry or custom collection file at its collection; knowledge
 * (`data/kb/**`) at `knowledge`; the agent layer at `agent`; any other workspace file at `workspace` alone.
 * @param {string} path @param {ReadPage} readPage @returns {string[] | null}
 */
export function targetsOfPath(path, readPage) {
  const p = normal(path)
  if (governedClassOf(p) !== WORKSPACE) return null
  const page = /^pages\/([^/]+)\.md$/.exec(p)?.[1] ?? /^pages\/assets\/([^/]+)\//.exec(p)?.[1]
  if (page !== undefined) return pageTargets(page, ancestorsOf(page, readPage))
  if (p.startsWith('pages/')) return [`${WORKSPACE}:pages`, WORKSPACE]
  if (p.startsWith('data/kb/')) return recordTargets('knowledge')
  const custom = /^data\/collections\/([^/]+)\.ya?ml$/.exec(p)?.[1]
  if (custom !== undefined) return recordTargets(custom)
  const registry = /^data\/([^/]+)\.ya?ml$/.exec(p)?.[1]
  if (registry !== undefined) return recordTargets(registry)
  if (AGENT.test(p)) return [...AGENT_TARGETS]
  return [WORKSPACE]
}

/**
 * The targets of one staged op: a private placeholder (`{ op: 'private', class }`) at its class (a private workspace op at
 * `workspace` alone: the store's tree is not read here); a file op (`{ op: 'file', path }`) at its path's; a record op (`<registry>:<id>`) by its registry's file, `fileOf`
 * naming it; a non-workspace op is `[its class]`.
 * @param {{ op?: unknown, record?: unknown, class?: unknown }} op
 * @param {(registry: string) => string} fileOf @param {ReadPage} readPage
 * @returns {string[]}
 */
export function targetsOfOp(op, fileOf, readPage) {
  if (op.op === 'private') return [String(op.class)]
  // A file op (L6 §11.2) is judged at its own path's targets.
  if (op.op === 'file' && typeof op.path === 'string') return targetsOfPath(op.path, readPage) ?? [classOf({ path: op.path })]
  const record = String(op.record ?? '')
  const at = record.indexOf(':')
  const file = fileOf(at > 0 ? record.slice(0, at) : record)
  return targetsOfPath(file, readPage) ?? [classOf({ path: file })]
}

/** A page id as a file name may hold it: nothing that climbs out of pages/. */
const PAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/**
 * `readPage` over a reader of files: a page's `parent` from its front matter (`splitPage`), null when there is no such page.
 * Each page is read once.
 * @param {(path: string) => string | null} readText @returns {ReadPage}
 */
export function pageReader(readText) {
  /** @type {Map<string, { parent: string | null } | null>} */
  const seen = new Map()
  return id => {
    if (!PAGE_ID.test(id)) return null
    if (!seen.has(id)) {
      const text = readText(`pages/${id}.md`)
      seen.set(id, text === null ? null : { parent: splitPage(text).front.parent })
    }
    return seen.get(id) ?? null
  }
}
