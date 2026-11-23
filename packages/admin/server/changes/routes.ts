import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { isKnown, actorTrailer, commitIdent, type Actor, type KnownActor } from '../actor.ts'
import { actorOf, knownActorOf, readerOf, requireReading, viewerOf } from '../request.ts'
import { effectiveRule, hatsActedUnder, readRuleContext, ruleHats, ruleIds } from '../governance/effective.ts'
import { ChangeStore, newChangeId } from './store.ts'
import { stage, staleOps, changeView, changeClasses, classesOf, currentOf, targetsOf, targetsOfOps, validateChange } from './stage.ts'
import { rebaseOp } from './merge.ts'
import { fileBase, heldFileErrors, isFileOp, isRecordOp, keptPageErrors, rebaseFileOp } from '../workspace/files.ts'
import { fileReader, readableTray, readableView, unreadPaths, unreadRefusal, type FileReader } from '../workspace/reads.ts'
import { commitMessage } from './records.ts'
import { applyOps, commitEmpty, Refusal, Referred, StageRefusal } from './apply.ts'
import { sealReceipts } from '../library/seal.ts'
import { withoutEchoOp } from '../visibility/gate.ts'
import {
  clearsOf, discardStaged, gitNames, isNoStore, noStore, privateClasses, privateWidens, reach, refuseHeldByMove, RESTRICTED_SUBJECT, splitOps, stagedPrivate, stagedView, stagePrivate,
  unavailable, withPrivate, type PrivateAccess, type StagedPrivateOp,
} from '../private/ops.ts'
import type { Viewer } from '../../lib/visibility.mjs'
import { refuseOthersLink } from '../visibility/widen.ts'
import { commitPolicy, readConfig } from '../visibility/config.ts'
import { refuseNarrowed } from '../private/guard.ts'
import { changePrivateTargets, privateTargetsOf } from '../private/targets.ts'
import { strictPrivateReads } from '../private/reads.ts'
import { Levels } from '../visibility/gate.ts'
import { appliedChainHeldErrors, shownChainHeld, systemsTouched, wholeChainHeldErrors } from '../deploy/private-flip.ts'
import { guardCouncilMemory } from '../workspace/memory.ts'
import { asConflict, isMove, planMoves, type PlannedMove } from '../workspace/move.ts'
import { WIDENS } from '../../lib/narrow.mjs'
import type { PrivateStore } from '../private/store.ts'
import { transition } from '../../lib/machines/run.mjs'
import { change as changeMachine, changeGuards, deriveChangeState } from '../../lib/machines/change.mjs'
import type { Change, FileOp, Op, RuleSummary, StageOp } from './types.ts'
import { labelledPageFile } from '../workspace/pages.ts'

export interface ChangeRoutesDeps {
  repo: string
  /** The repository's one write lock (app.ts): change files and git writes both run inside it. */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  /** Sent after every write to a change, so every open tab refreshes its tray. */
  notify: (msg: { type: 'changes' }) => void
  /** The one private store (L5 §10): a change's private part is staged in it and applied to it. Absent: none. */
  privateStore?: PrivateAccess
}

export type { KnownActor }
const OPS = new Set(['update', 'create', 'delete', 'replace', 'file'])
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const SHAPE = 'The body must be {"ops": [...]}, each op one of {"op": "update", "record": "<registry>:<id>", "set": {...}}, ' +
  '{"op": "create" or "replace", "record": "<registry>:<id>", "value": {...}}, {"op": "delete", "record": "<registry>:<id>"}, ' +
  'or {"op": "file", "path": "<a governed file>", "text": "<its whole text>" or null to delete it, "base": "<its blob id when read>"}'

/** The ops of POST /api/changes/ops, or a 400 that says what they must be. A file op's `base` is the blob id the editor read
 *  (GET /api/files), so a file that changed since is stale at once; with none, it is the file's blob now (`repo`). */
export function readStageOps(body: unknown, repo?: string): StageOp[] {
  if (!isObject(body) || !Array.isArray(body.ops) || body.ops.length === 0) throw new HttpError(400, `${SHAPE}.`)
  return body.ops.map((op: unknown, i: number): StageOp => {
    const bad = new HttpError(400, `${SHAPE}; op ${i} is not.`)
    if (isObject(op) && op.op === 'file') {
      if (typeof op.path !== 'string' || op.path === '' || (typeof op.text !== 'string' && op.text !== null)) throw bad
      if (op.base !== undefined && op.base !== null && (typeof op.base !== 'string' || !/^[0-9a-f]{40,64}$/.test(op.base))) throw bad
      const base = op.base !== undefined ? op.base : repo === undefined ? null : fileBase(repo, op.path)
      return { op: 'file', path: op.path, text: op.text, base }
    }
    if (!isObject(op) || typeof op.op !== 'string' || !OPS.has(op.op) || typeof op.record !== 'string' || op.record === '') throw bad
    if (op.op === 'delete') return { op: 'delete', record: op.record }
    if (op.op === 'update') { if (!isObject(op.set)) throw bad; return { op: 'update', record: op.record, set: op.set } }
    if (!isObject(op.value)) throw bad
    return { op: op.op as 'create' | 'replace', record: op.record, value: op.value }
  })
}

async function jsonBody(c: Context): Promise<unknown> {
  try { return await c.req.json() } catch { return undefined }
}

/** Apply's checks and its one commit, shared by the tray's Apply and the old write routes so that
 *  neither is a way around the other: after the file guards (409), `precheck` (the tray's stale
 *  check), then the rule for this actor (403 when it is not direct); then one commit carrying
 *  Org-Actor, Org-Change and Org-Rule, authored by the house for a signed-in actor (L5 §6.4), and, for an actor who
 *  applies under a role sourced from a hat, Org-Hat: each hat used and the block it was read at (§6.4, the recorded
 *  reading of §7.2 for a write that has no event). The caller holds the repository's write lock for the whole of it, and
 *  clears the change only after this returns.
 *
 *  With `private` (L5 §10.3), its staged ops are resolved against the store as it is then, for `viewer`, and written in one
 *  transaction around that commit, judged under their classes beside the git ops'; when the git ops change no file, or
 *  there are none, the commit is empty, "A change to a restricted collection", with the same trailers. `staged`: the ops
 *  are the change's staged ones, and go from the store's `staged` table in the same transaction. With a `store`, each git
 *  record the ops delete takes its restricted fields with it, in the same transaction (`clear-fields`). */
export async function applyAs(repo: string, actor: KnownActor, ops: StageOp[],
  opts: { change: string; message?: string; precheck?: () => void; private?: PrivatePart }): Promise<{ commit: string | null }> {
  // A git op writing a field narrowed since it was staged is told what to do (R-L5-16.10), before anything else.
  refuseNarrowed(ops, readConfig(repo), 'Not applied')
  // A wallet link is widened only by its own person (L5 §9.7), on a direct apply as on a proposal.
  refuseOthersLink(repo, ops, actor.id)
  const priv = opts.private?.ops ?? []
  const privateStore = opts.private?.store ?? null
  // What the chain holds of a deployed System, judged again on the whole as it is now (the gaps review's I-1; closes
  // PF-R232's carry): git's backstop reads git alone, and a System the store holds as deployed (its `deployment`, or the
  // whole System), or one another change made deployed since this one was staged, is judged here. A store configured but
  // not reached is the store's 503 for any change touching a System, and one failing as it answers too (the walk review's
  // G2): what it keeps is never judged as absent. With no store at all, git's backstop is the judgment.
  if (systemsTouched(ops, priv).length > 0) {
    if (!privateStore && !isNoStore(opts.private?.why)) throw unavailable(opts.private?.why)
    if (privateStore) {
      const lv = new Levels(repo, undefined, undefined, strictPrivateReads(() => privateStore))
      const held = appliedChainHeldErrors(repo, lv, ops, priv)
      // Told as the applier may read it (PF-R250): one who may not read the System's deployment hears it named nowhere.
      if (held.length > 0) throw new StageRefusal(shownChainHeld(lv, opts.private!.viewer, held))
    }
  }
  // A file op never writes a page the private store keeps (Task 20 review C1, PF-R95), before anything is written.
  const kept = keptPageErrors(repo, privateStore, ops, 'Nothing was written.')
  if (kept.length > 0) throw new StageRefusal(kept)
  // DAO-OS L6 §12 (Task 11): a private record or page moved into git, planned now against the store for this viewer; its
  // git op joins this commit, and its record leaves the store in the transaction around it.
  let planned: PlannedMove[] = []
  if (priv.some(isMove)) {
    if (!privateStore) throw unavailable(null)
    // Split by the stricter of the policy before and the one this commit leaves (Task 11 review I-4).
    try { planned = planMoves(repo, privateStore, priv, commitPolicy(repo, ops), opts.private!.viewer) } catch (err) { asConflict(err) }
  }
  const rest = priv.filter(op => !isMove(op))
  const all: StageOp[] = [...ops, ...planned.map(p => p.git)]
  const classes = [...new Set([...classesOf(all, repo), ...privateClasses(privateStore, priv)])]
  // Where each op is judged (L6 §3.2): a workspace op at its targets, never by `all`; the private part at its own targets
  // (Task 15 review I-1: a record at its collection's, a page at its tree, Council memory at the agent layer's too), read
  // from the store's ops as they stand now; a move where it lands too (R-L6-T11-4).
  const targets = [...targetsOfOps(all, repo), ...privateTargetsOf(repo, privateStore, priv)]
  const ctx = readRuleContext(repo, actor)
  // Council memory is written at once or not at all, at its collection's level (Task 15 review I-1).
  guardCouncilMemory(repo, actor, privateStore, rest)
  // A private record made readable by more people is a publication, judged by the rules as a git record's is (§9.7,
  // R-L5-16.8 as amended): applied where the rule covering it lets this actor decide alone, otherwise proposed (409 WIDENS).
  if (privateStore && priv.some(op => privateWidens(privateStore, op)) && !effectiveRule(ctx, classes, targets).direct) {
    throw new Refusal(409, { code: 'WIDENS', error: WIDENS })
  }
  const rule = ruleIds(ctx, classes, targets).map(id => `${id}/direct`).join(',')
  const hat = hatsActedUnder(ctx, classes, targets).join(', ')
  // A library receipt is committed sealed: who applied it, today, and the Org-Rule and Org-Change this commit carries.
  const sealed = sealReceipts(all, { by: actor.id, at: new Date().toISOString().slice(0, 10), decision: { rule, change: opts.change } })
  const options = {
    message: opts.message ?? (all.length > 0 ? commitMessage(all) : RESTRICTED_SUBJECT),
    trailers: { actor: actorTrailer(actor), change: opts.change, rule, ...(hat !== '' ? { hat } : {}) },
    ident: commitIdent(actor),
    precheck: () => {
      opts.precheck?.()
      const rule = effectiveRule(readRuleContext(repo, actor), classes, targets)
      if (!rule.direct) throw new Refusal(403, { reason: rule.sentence, error: rule.sentence })
    },
  }
  const clears = privateStore ? clearsOf(ops, gitNames(repo)) : []
  if (priv.length === 0 && clears.length === 0) return applyOps(repo, sealed, options)
  if (!privateStore) throw unavailable(null)
  // A change with a private part always makes its commit, so whether the store already held a value never shows.
  const git = async () => all.length > 0
    ? applyOps(repo, sealed, { ...options, ...(priv.length > 0 ? { emptySubject: RESTRICTED_SUBJECT } : {}) })
    : { commit: await commitEmpty(repo, { ...options, message: RESTRICTED_SUBJECT }) }
  return withPrivate(privateStore, [...clears, ...rest], opts.private!.viewer, actor.id, opts.change, opts.private!.staged, git, gitNames(repo), planned)
}

/** A write's private side (L5 §10.3): the store (null when it cannot be reached and the write has no private part), the
 *  staged ops, whether they are the change's staged rows, and who is writing. `why`: what `reach` said when the store is
 *  null, so a change touching a System is refused while a configured store is down (the walk review's G2); left out, the
 *  store reads as down. */
export interface PrivatePart { store: PrivateStore | null; ops: StagedPrivateOp[]; staged: boolean; viewer: Viewer; why?: unknown }

const EMPTY = 'Nothing is staged: the change holds no ops to apply.'

/** A change loaded by Revise goes back to its proposal (Update proposal) and nowhere else: neither applied past it
 *  nor proposed as a second one (spec §3.4 "Revising"). Answered 409 `REVISES` by Apply and by Propose. */
export function refuseRevising(change: Change | null): void {
  if (!change?.revises) return
  throw new Refusal(409, { code: 'REVISES', revises: change.revises,
    error: `This change revises proposal ${change.revises}: press Update proposal, or discard it first. Nothing was written.` })
}
const staleSentence = (n: number): string =>
  `Not applied: ${n === 1 ? 'one op was' : `${n} ops were`} staged against a record that has changed since. ` +
  `Nothing was written. Take theirs or keep mine on ${n === 1 ? 'it' : 'each'}, then apply again.`

/** Apply as the change machine has it. Each refusal keeps the body it had before machines
 *  (P4-R2): EMPTY from empty, STALE from stale, the rule's 403 when directRule refuses. */
function checkApply(ops: unknown[], stale: number[], rule: RuleSummary | null): void {
  const state = deriveChangeState({ ops, stale })
  const r = transition(changeMachine, changeGuards, state, { type: 'APPLY' }, { ops, stale, rule })
  if (r.ok) return
  if (state === 'empty') throw new Refusal(400, { error: EMPTY, code: 'EMPTY' })
  if (state === 'stale') throw new Refusal(409, { stale, code: 'STALE', error: staleSentence(stale.length) })
  throw new Refusal(403, { reason: r.reason, error: r.reason })
}

/** Every route that reads a change, changes it and saves it does so inside `withLock`, with no
 *  `await` between the load and the save: two tabs staging at once are two turns of the lock, and
 *  the second loads what the first saved. */
export function mountChanges(app: Hono, { repo, withLock, notify, privateStore = noStore }: ChangeRoutesDeps): void {
  const store = new ChangeStore(repo)

  /** A Refusal is its own answer (its whole body); anything else goes to the app's error handler. */
  const answer = async (fn: () => Promise<Response>): Promise<Response> => {
    try { return await fn() } catch (err) {
      if (err instanceof Refusal) return Response.json(err.body, { status: err.status })
      throw err
    }
  }
  const opIndex = (raw: string, ops: Op[]): number => {
    const n = /^\d+$/.test(raw) ? Number(raw) : -1
    if (n < 0 || n >= ops.length) throw new HttpError(404, `No op ${raw} in this change: it holds ${ops.length}, numbered from 0.`)
    return n
  }
  /** The tray as the asker may read it (0.7.1 D6, M2 and fix round 2): whether a file they may not read moved on the trunk is
   *  not said, even of their own op, in GET /api/changes and in every write's answer alike. */
  const trayView = (c: Context, actor: Actor, change: Change | null): Response => {
    const view = changeView(repo, actor, change, stagedView(privateStore, change), changePrivateTargets(repo, privateStore, change))
    // 0.7.2 round 3 (review 4), shared in 0.7.3: workspace/reads.ts `readableTray`.
    return Response.json(readableTray(view, fileReader(c, repo)))
  }
  const saveAndAnswer = (c: Context, actor: KnownActor, change: Change, ops: Op[]): Response => {
    const next: Change = { ...change, ops, updated: new Date().toISOString() }
    store.save(next)
    notify({ type: 'changes' })
    const kept = ops.length > 0 || (next.private?.length ?? 0) > 0
    return trayView(c, actor, kept ? next : null)
  }

  app.get('/api/actor', c => c.json(actorOf(c)))

  app.get('/api/changes', c => {
    const actor = readerOf(c)
    const change = isKnown(actor) ? store.load(actor.id) : null
    return trayView(c, actor, change)
  })

  app.post('/api/changes/ops', async c => {
    // A record read through the gate carries its level; written back unchanged, that `visibility` is left out (R-L5-13.4).
    const incoming = readStageOps(await jsonBody(c), repo).map(op => (isFileOp(op) ? op : withoutEchoOp(repo, op)))
    return answer(() => withLock(async () => {
      const actor = knownActorOf(c)
      const now = new Date().toISOString()
      const change = store.load(actor.id) ?? { id: newChangeId(), actor: actor.id, created: now, updated: now, ops: [] }
      // Each op split by data/visibility.yaml (L5 §10.3): a split that cannot be staged is a 422, a private part while the
      // store is down its 503, before anything is written.
      // A file op (L6 §11.2) is git's whole: data/visibility.yaml splits records, not files.
      // 0.7.2: a record op on a registry whose file the stager may not read (the `files` section) is refused before anything
      // is read for it, in the words of a path no rule governs, so the tray never holds that record (review I2).
      const unreadRecords = unreadPaths(incoming.filter(isRecordOp), fileReader(c, repo))
      if (unreadRecords.length > 0) return Response.json({ errors: unreadRefusal(unreadRecords).errors }, { status: 422 })
      const split = splitOps(repo, incoming.filter(isRecordOp), privateStore, viewerOf(c))
      // L7 gap B1 after gap A: what the chain holds of a deployed System is judged the same where the store keeps it (a
      // restricted field, a System kept private whole, its `deployment` held there while the rest is in git: the gaps
      // review's I-1): with a store, any write that touches a System, in git or in the store, is judged on the whole. A
      // store configured but not reached, or failing as it answers, is its 503 for such a write (the walk review's G2):
      // never judged as holding nothing. With no store at all, stage() judges git alone.
      if (incoming.filter(isRecordOp).some(op => op.record.startsWith('systems:'))) {
        if (!split.store && !isNoStore(split.why)) throw unavailable(split.why)
        if (split.store) {
          const lv = new Levels(repo, undefined, undefined, strictPrivateReads(privateStore))
          const held = wholeChainHeldErrors(repo, lv, change.ops, stagedPrivate(split.store, change), incoming.filter(isRecordOp))
          // Told as the stager may read it (PF-R250): one who may not read the System's deployment hears it named nowhere.
          if (held.length > 0) return Response.json({ errors: shownChainHeld(lv, viewerOf(c), held) }, { status: 422 })
        }
      }
      // R4c 5: a page's file op is labelled as every page write is: each member mention at the level its text gives the page.
      const files: FileOp[] = []
      for (const op of incoming.filter(isFileOp)) {
        const labelled = labelledPageFile(repo, op)
        if (labelled.refused) return Response.json({ errors: [labelled.refused] }, { status: 422 })
        files.push(labelled.op)
      }
      const git = [...split.git, ...files]
      // A file op's path, checked whole before it is staged (T19 review I1, PF-R83): git's half of the check is async.
      // 0.7.1 D6: and one the stager may read (server/workspace/reads.ts), refused as one no rule governs.
      const held = await heldFileErrors(repo, files, fileReader(c, repo))
      if (held.length > 0) return Response.json({ errors: held }, { status: 422 })
      // A page the private store keeps is never written back into git by a file op (Task 20 review C1, PF-R95).
      const kept = keptPageErrors(repo, reach(privateStore).store, incoming, 'Nothing was staged.')
      if (kept.length > 0) return Response.json({ errors: kept }, { status: 422 })
      // stage() throws the 409 of a registry file with YAML errors; it reaches onError unchanged.
      const { ops, errors } = git.length > 0 ? stage(repo, change.ops, git) : { ops: change.ops, errors: [] }
      if (errors.length > 0) return Response.json({ errors }, { status: 422 })
      // The private part goes to the store's staged table; the change file keeps a placeholder for each op.
      // A Council entry is never staged: written at once or refused, at its collection's level (Task 15 review I-1).
      guardCouncilMemory(repo, actor, split.store, split.private)
      // A record or page whose move an open proposal holds is not edited (L6 carries K5).
      refuseHeldByMove(split.store, split.private)
      const placeholders = split.private.length > 0 ? await stagePrivate(split.store!, change, actor.id, split.private) : change.private
      const { private: _was, ...rest } = change
      return saveAndAnswer(c, actor, { ...rest, ...(placeholders?.length ? { private: placeholders } : {}) }, ops)
    }))
  })

  // The rule the viewer's change would fall under with these ops added (the new-record form's governance line, spec
  // 2026-11-04 §3): read only, so no lock, nothing staged, written or told. The actor is still asked for, as staging
  // asks: a reader git cannot match is told why. The ops' classes are read as staging's would be (`classesOf`), and judged
  // at their targets as the tray judges them (L6 §3.2): a collection a rule raises or loosens says so here too.
  app.post('/api/changes/rule', async c => {
    const ops = readStageOps(await jsonBody(c), repo).map(op => (isFileOp(op) ? op : withoutEchoOp(repo, op)))
    return answer(async () => {
      const actor = knownActorOf(c)
      const change = store.load(actor.id)
      const classes = [...new Set([...changeClasses(change, repo), ...classesOf(ops, repo)])]
      const targets = [...targetsOf(change, repo, changePrivateTargets(repo, privateStore, change)), ...targetsOfOps(ops, repo)]
      return Response.json(effectiveRule(readRuleContext(repo, actor), classes, targets))
    })
  })

  app.delete('/api/changes/ops/:n', c => answer(() => withLock(async () => {
    const actor = knownActorOf(c)
    const change = store.load(actor.id)
    const ops = change?.ops ?? []
    const n = opIndex(c.req.param('n'), ops)
    const rest = ops.filter((_, i) => i !== n)
    // What is left must still stand on its own: a create other ops refer to cannot be taken out.
    const errors = rest.length > 0 ? validateChange(repo, rest) : []
    if (errors.length > 0) return Response.json({ errors }, { status: 422 })
    return saveAndAnswer(c, actor, change!, rest)
  })))

  app.post('/api/changes/ops/:n/rebase', async c => {
    const body = await jsonBody(c)
    const keep = isObject(body) ? body.keep : undefined
    if (keep !== 'mine' && keep !== 'theirs') throw new HttpError(400, 'The body must be {"keep": "mine"} or {"keep": "theirs"}.')
    return answer(() => withLock(async () => {
      const actor = knownActorOf(c)
      const change = store.load(actor.id)
      const ops = change?.ops ?? []
      const n = opIndex(c.req.param('n'), ops)
      const op = ops[n]!
      // 0.7.1 D6 (PR7-R94): Keep mine merges the file as it is now into the op, so it is refused on a path the asker may not
      // read (a tray that holds one from before 0.7.1), in the words of a path no rule governs; Take theirs drops it.
      if (isFileOp(op) && keep === 'mine' && !fileReader(c, repo)(op.path)) {
        return Response.json({ errors: await heldFileErrors(repo, [op], () => false) }, { status: 422 })
      }
      // 0.7.2 round 3 (review 4): Keep mine reads the record as it is now, so it is refused on a file kept from the asker.
      const unreadRecord = isRecordOp(op) && keep === 'mine' ? unreadPaths([op], fileReader(c, repo)) : []
      if (unreadRecord.length > 0) return Response.json({ errors: unreadRefusal(unreadRecord).errors }, { status: 422 })
      const rebased = isFileOp(op) ? await rebaseFileOp(repo, op, keep) : rebaseOp(op, currentOf(repo, op.record), keep)
      if (rebased === ops[n]) return trayView(c, actor, change)
      return saveAndAnswer(c, actor, change!, rebased ? ops.map((o, i) => (i === n ? rebased : o)) : ops.filter((_, i) => i !== n))
    }))
  })

  app.delete('/api/changes', c => answer(() => withLock(async () => {
    const actor = knownActorOf(c)
    await discardStaged(privateStore, store.load(actor.id))
    store.clear(actor.id)
    notify({ type: 'changes' })
    return c.body(null, 204)
  })))

  app.post('/api/changes/apply', c => answer(async () => {
    // A wallet whose hats could not be read now cannot apply under a role sourced from a hat (§5.2): refused before the lock,
    // unless the rule lets the actor apply without them.
    const asking = actorOf(c)
    const staged = asking && isKnown(asking) ? store.load(asking.id) : null
    if (asking && staged) {
      // A members-role apply needs no reading: the rule judged with none of the actor's hats (R-L5-8.8).
      const classes = changeClasses(staged, repo)
      const targets = targetsOf(staged, repo, changePrivateTargets(repo, privateStore, staged))
      requireReading(c, ruleHats(readRuleContext(repo, asking), classes, 'both', targets), () => effectiveRule(readRuleContext(repo, asking), classes, targets).direct === true)
    }
    return withLock(async () => {
      const actor = knownActorOf(c)
      const change = store.load(actor.id)
      const placeholders = change?.private ?? []
      // always throws: no ops is the empty state, and the machine refuses Apply there
      if (!change || (change.ops.length === 0 && placeholders.length === 0)) checkApply([], [], null)
      refuseRevising(change)
      // 0.7.1 D6 fix round 1 (I1): a tray holding a file op on a path the asker may not read (staged at the machine, or before
      // 0.7.1) is not applied, in the words of a path no rule governs, before anything is read for writing.
      const unread = unreadPaths(change!.ops, fileReader(c, repo))
      if (unread.length > 0) return Response.json({ errors: unreadRefusal(unread).errors }, { status: 422 })
      // The private part, read back from the store's staged table (L5 §10.3); a store that cannot be reached is its 503.
      const { store: reached, why } = reach(privateStore)
      if (placeholders.length > 0 && !reached) throw unavailable(why)
      const priv: PrivatePart = { store: reached, ops: placeholders.length > 0 ? stagedPrivate(reached!, change!) : [], staged: true, viewer: viewerOf(c), why }
      try {
        const { commit } = await applyAs(repo, actor, change!.ops, {
          change: change!.id,
          precheck: () => checkApply([...change!.ops, ...placeholders], staleOps(repo, change!.ops), effectiveRule(readRuleContext(repo, actor), changeClasses(change, repo), targetsOf(change, repo, changePrivateTargets(repo, privateStore, change)))),
          private: priv,
        })
        // Only now, with the commit made (or nothing to commit), does the change go.
        store.clear(actor.id)
        notify({ type: 'changes' })
        return Response.json({ commit: commit ?? '' })
      } catch (err) {
        // The tray answers a delete other entries name as a 422 with its record (the old DELETE keeps its 409).
        if (err instanceof Referred) return Response.json({ errors: [{ record: err.record, field: '', message: err.message }] }, { status: 422 })
        // The git part was committed and the store could not keep the private part: the change keeps only that part.
        if (err instanceof Refusal && err.body.code === 'PRIVATE_STORE' && typeof err.body.commit === 'string') {
          store.save({ ...change!, ops: [], updated: new Date().toISOString() })
          notify({ type: 'changes' })
        }
        throw err // a StageRefusal's 422 { errors }, a 503, a YAML 409: onError answers them as they are
      }
    })
  }))
}
