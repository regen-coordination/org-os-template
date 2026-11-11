// packages/admin/server/workspace/imports.ts
//
// The import pipeline's server half (DAO-OS L6 spec §9.1–§9.3, §9.6; Task 12). `planImport` reads the instance
// (`readImportState`) and hands it to the pure plan (lib/imports/plan.mjs); `applyImport` performs a plan: one workspace
// commit (`import: <source> <date>`, `Org-Rule: workspace/direct`, `Org-Change: imp_<hex>`, the git actor) through the
// change engine's `applyOps` (its guards, its checks, `assertGitSafe` under the stricter of the two policies, one commit or
// nothing), the receipt in data/imports.yaml, and the private part in one store transaction around that commit (L5's
// order: transaction → commit → transaction commit, `aroundGit`). A plan with a private part refuses with the store's
// sentence before any commit while the store cannot be reached. The command is scripts/import.ts (`npm run import`).

import { readFileSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { actorTrailer, commitIdent, type KnownActor } from '../actor.ts'
import { effectiveRule, hatsActedUnder, readRuleContext, ruleIds } from '../governance/effective.ts'
import { applyOps, Refusal } from '../changes/apply.ts'
import { baseOf } from '../changes/canonical.ts'
import { classesOf, currentEntries, targetsOfOps } from '../changes/stage.ts'
import type { FileOp } from '../changes/types.ts'
import { registriesOf } from '../registries.ts'
import { readConfig } from '../visibility/config.ts'
import { aroundGit, STORE_FAILED, unavailable } from '../private/ops.ts'
import { StoreUnavailable, type PrivateStore } from '../private/store.ts'
import { NO_STORE } from '../private/ops.ts'
import { blobId, fileBase, fileText, gitPages } from './files.ts'
import { classOf } from '../../lib/change-classes.mjs'
import { registryFileOf } from '../../lib/registries.mjs'
import { ancestorsOf, pageTargets, recordTargets } from '../../lib/workspace/targets.mjs'
import { treeReader } from '../private/targets.ts'
import { memberLabels } from '../session/names.ts'
import { HttpError } from '../errors.ts'
import { planImport as plan, withReceipt, type ImportMap, type ImportPlan, type ImportState, type PrivateWrite } from '../../lib/imports/plan.mjs'
import type { ImportBundle } from '../../lib/imports/bundle.mjs'

export {
  NOT_PUBLIC, NOT_A_LEVEL, INTO_NOT_WORKSPACE, INTO_STRICTER, INTO_PRIVATE, LEVEL_MOVED, NOT_A_TYPE, KEPT, AUTHORS, NO_CONTACT,
  STRICTER_RELATION, RESTRICTED, PRIVATE_IN_TEXT, NAMES_PRIVATE, STRICT_ITEM, PAGE_LEVEL_MOVED, LOOSER_THAN_CONTAINER, PARENT_LEVEL_TAKEN,
} from '../../lib/imports/plan.mjs'
export type { ImportMap, ImportPlan, ImportReport, ImportReceipt } from '../../lib/imports/plan.mjs'

/** An import under a raised workspace rule: it is not staged for approval (a ruling of Task 12, R-L6-T12-5). */
export const IMPORT_RAISED = (sentence: string): string =>
  `${sentence.replace(/\.?$/, '.')} An import is one direct workspace write and is not staged for approval. Nothing was written.`

const VISIBILITY_FILE = 'data/visibility.yaml'

/** What the plan knows of the instance at `repo` (lib/imports/plan.mjs `ImportState`): the policy, the members, the
 *  registries and their classes, the store's collections and records (null when it cannot be read: a plan that needs it
 *  says so), the git pages, and how to read a file. */
export function readImportState(repo: string, store: PrivateStore | null): ImportState {
  let members: string[] = []
  try { members = currentEntries(repo, 'members').map(e => String(e.id)) } catch { /* no members file */ }
  const registries = registriesOf(repo).filter(d => d.filesGlob === undefined).map(d => {
    const file = registryFileOf(d)
    return { name: d.name, class: String(classOf({ path: file })), file, topKey: d.topKey, ...(d.ledger ? { ledger: true } : {}), ...(d.custom ? { custom: true } : {}) }
  })
  let storeCollections: ImportState['storeCollections'] = null
  if (store) { try { storeCollections = store.collections() } catch { storeCollections = null } }
  const read = <T>(fn: () => T, none: T): T => { if (!store || storeCollections === null) return none; try { return fn() } catch { return none } }
  return {
    policy: readConfig(repo),
    members,
    registries,
    storeCollections,
    storeRecords: collection => read(() => store!.records(collection), []),
    storeFields: (registry, record) => read(() => store!.fields(registry, record), []),
    gitPages: gitPages(repo),
    text: path => fileText(repo, path),
    blobOf: text => blobId(text),
    revOf: body => baseOf(body) ?? '',
    sizeOf: abs => statSync(abs).size,
    fileBlob: rel => fileBase(repo, rel),
    blobOfFile: abs => blobId(readFileSync(abs)),
    now: new Date().toISOString(),
    by: '',
    random: () => randomBytes(6).toString('hex'),
    // T2f 1, R4c 1 (Rule 4): a member mention in an imported page is labelled as the loosest reader of the page's level may
    // read the name, else the id; R4c 3: with the members file unreadable, a page that mentions one refuses the import (503).
    memberLabel: level => memberLabels(repo, level),
    registryProps: name => {
      // A registry's own fields, from its schema (packages/admin/schemas/<name>.schema.json): each with the JSON types it takes.
      const file = new URL(`../../schemas/${name}.schema.json`, import.meta.url)
      try {
        const props = (JSON.parse(readFileSync(file, 'utf8')) as { properties?: Record<string, { type?: string | string[] }> }).properties ?? {}
        return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, [v.type ?? []].flat()]))
      } catch { return null }
    },
  }
}

/**
 * The plan of importing `bundle` into the instance at `repo` with `map` (§9.1): its writes, its report and its receipt.
 * Nothing is written. A map it cannot follow is refused 422 in its words (NOT_PUBLIC for a level public).
 */
export function planImport(bundle: ImportBundle, map: ImportMap, repo: string, store: PrivateStore | null): ImportPlan {
  try { return plan(bundle, map ?? {}, readImportState(repo, store)) } catch (err) {
    // R4c 3: an unavailable answer (a members file that cannot be read) is the 503 it is, not a map the plan cannot follow.
    if (err instanceof HttpError && err.status === 503) throw err
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') throw new Refusal(422, { code, error: (err as Error).message })
    throw err
  }
}

/**
 * The targets of an import's private part (Task 12 review I4), as the hand routes judge them: a collection's definition
 * at `workspace:collections` (collections.ts `mayWritePrivate`), a record at its collection's, a field row at its
 * registry's, a private page at its tree (pages.ts `targetsIn`: itself, its ancestors as this import and the store leave
 * them, `workspace:pages`).
 */
function privateTargets(repo: string, priv: readonly PrivateWrite[], git: readonly { path: string, text: string | null }[], store: PrivateStore | null): string[][] {
  const texts = new Map(git.map(op => [op.path, op.text]))
  const written = new Map<string, string | null>()
  for (const p of priv) {
    if (p.op === 'put-record' && p.record.collection === 'pages') written.set(p.record.id, typeof p.record.body.parent === 'string' && p.record.body.parent !== '' ? p.record.body.parent : null)
  }
  // The tree as the hand routes read it (server/private/targets.ts), with this import's files and pages in it.
  const readPage = treeReader(repo, store, written, (rel: string) => (texts.has(rel) ? texts.get(rel) ?? null : fileText(repo, rel)))
  return priv.map(p => {
    if (p.op === 'put-collection') return recordTargets('collections')
    if (p.op === 'put-field') return recordTargets(p.field.registry)
    if (p.record.collection === 'pages') return pageTargets(p.record.id, ancestorsOf(p.record.id, readPage))
    return recordTargets(p.record.collection)
  })
}

/**
 * Performs `plan` as `actor` (§9.2): one workspace commit with the receipt, and the private part in one store transaction
 * around it. Answers the commit, or null when the plan writes nothing (a second run of the same export). Refused before
 * anything is written: 503 with the store's sentence when the plan has a private part and the store cannot be reached;
 * 403 when the instance's rules do not let this actor write the import's workspace targets at once, its private part's
 * included (judged as the hand routes judge them). The caller holds the
 * repository (no server runs for it: the command checks).
 */
export async function applyImport(repo: string, planned: ImportPlan, actor: KnownActor, store: PrivateStore | null): Promise<{ commit: string | null }> {
  const { git, private: priv, assets } = planned.writes
  if (git.length === 0 && priv.length === 0 && assets.length === 0) return { commit: null }
  if ((priv.length > 0 || planned.needsStore) && !store) throw unavailable(new StoreUnavailable(NO_STORE))
  const receipt = { ...planned.receipt, by: actor.id, at: new Date().toISOString() }
  const ops: FileOp[] = [
    ...git.map(op => ({ op: 'file' as const, path: op.path, text: op.text, base: fileBase(repo, op.path) })),
    { op: 'file', path: 'data/imports.yaml', text: withReceipt(fileText(repo, 'data/imports.yaml'), receipt), base: fileBase(repo, 'data/imports.yaml') },
  ]
  // Judged as the collection routes judge a definition (ruling P-6): data/visibility.yaml rides along only to narrow.
  const judged = ops.filter(op => op.path !== VISIBILITY_FILE)
  const classes = classesOf(judged, repo)
  const targets = targetsOfOps(judged, repo)
  const ctx = readRuleContext(repo, actor)
  const rule = effectiveRule(ctx, classes, targets)
  if (!rule.direct) throw new Refusal(403, { code: 'RAISED', reason: rule.sentence, error: IMPORT_RAISED(rule.sentence) })
  // The private part is judged at its own targets, apart from the commit's (its rules never named in its trailers, I4).
  const privTargets = privateTargets(repo, priv, ops, store)
  const mayPrivate = (now: ReturnType<typeof readRuleContext>) => {
    if (privTargets.length === 0) return
    const r = effectiveRule(now, ['workspace'], privTargets)
    if (!r.direct) throw new Refusal(403, { code: 'RAISED', reason: r.sentence, error: IMPORT_RAISED(r.sentence) })
  }
  mayPrivate(ctx)
  const hat = hatsActedUnder(ctx, classes, targets).join(', ')
  const files = assets.map(a => ({ path: a.path, bytes: readFileSync(a.from) }))
  const commit = () => applyOps(repo, ops, {
    message: planned.subject,
    trailers: { actor: actorTrailer(actor), change: receipt.id, rule: ruleIds(ctx, classes, targets).map(id => `${id}/direct`).join(','), ...(hat !== '' ? { hat } : {}) },
    ident: commitIdent(actor),
    assets: files,
    precheck: () => {
      const live = readRuleContext(repo, actor)
      const now = effectiveRule(live, classes, targets)
      if (!now.direct) throw new Refusal(403, { code: 'RAISED', reason: now.sentence, error: IMPORT_RAISED(now.sentence) })
      mayPrivate(live)
    },
  })
  if (priv.length === 0) return commit()
  const live = store as PrivateStore
  return aroundGit(live, {
    before: w => {
      try {
        for (const p of priv) {
          if (p.op === 'put-collection') w.putCollection(p.collection, actor.id)
          else if (p.op === 'put-record') w.putRecord(p.record, actor.id, receipt.id)
          else w.putField(p.field, actor.id, receipt.id)
        }
      } catch (err) { throw unavailable(err, live) }
    },
    git: commit,
    late: out => {
      throw new Refusal(503, { code: 'PRIVATE_STORE', commit: out.commit,
        error: `Commit ${out.commit} was made, but the private store could not keep its part, so nothing private was written. ${STORE_FAILED}` })
    },
  })
}
