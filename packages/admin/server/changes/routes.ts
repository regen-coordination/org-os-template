import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { isKnown, actorTrailer, commitIdent, type KnownActor } from '../actor.ts'
import { actorOf, knownActorOf, readerOf, requireReading, viewerOf } from '../request.ts'
import { effectiveRule, hatsActedUnder, readRuleContext, ruleHats, ruleIds } from '../governance/effective.ts'
import { ChangeStore, newChangeId } from './store.ts'
import { stage, staleOps, changeView, changeClasses, classesOf, currentOf, validateChange } from './stage.ts'
import { rebaseOp } from './merge.ts'
import { commitMessage } from './records.ts'
import { applyOps, commitEmpty, Refusal, Referred } from './apply.ts'
import { sealReceipts } from '../library/seal.ts'
import { withoutEchoOp } from '../visibility/gate.ts'
import {
  clearsOf, discardStaged, noStore, privateClasses, privateWidens, reach, RESTRICTED_SUBJECT, splitOps, stagedPrivate, stagedView, stagePrivate,
  unavailable, withPrivate, type PrivateAccess, type StagedPrivateOp,
} from '../private/ops.ts'
import type { Viewer } from '../../lib/visibility.mjs'
import { refuseOthersLink } from '../visibility/widen.ts'
import { readConfig } from '../visibility/config.ts'
import { refuseNarrowed } from '../private/guard.ts'
import { WIDENS } from '../../lib/narrow.mjs'
import type { PrivateStore } from '../private/store.ts'
import { transition } from '../../lib/machines/run.mjs'
import { change as changeMachine, changeGuards, deriveChangeState } from '../../lib/machines/change.mjs'
import type { Change, Op, RuleSummary, StageOp } from './types.ts'

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
const OPS = new Set(['update', 'create', 'delete', 'replace'])
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const SHAPE = 'The body must be {"ops": [...]}, each op one of {"op": "update", "record": "<registry>:<id>", "set": {...}}, ' +
  '{"op": "create" or "replace", "record": "<registry>:<id>", "value": {...}}, or {"op": "delete", "record": "<registry>:<id>"}'

/** The ops of POST /api/changes/ops, or a 400 that says what they must be. */
export function readStageOps(body: unknown): StageOp[] {
  if (!isObject(body) || !Array.isArray(body.ops) || body.ops.length === 0) throw new HttpError(400, `${SHAPE}.`)
  return body.ops.map((op: unknown, i: number): StageOp => {
    const bad = new HttpError(400, `${SHAPE}; op ${i} is not.`)
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
  const classes = [...new Set([...classesOf(ops, repo), ...privateClasses(privateStore, priv)])]
  const ctx = readRuleContext(repo, actor)
  // A private record made readable by more people is a publication, judged by the rules as a git record's is (§9.7,
  // R-L5-16.8 as amended): applied where the rule covering it lets this actor decide alone, otherwise proposed (409 WIDENS).
  if (privateStore && priv.some(op => privateWidens(privateStore, op)) && !effectiveRule(ctx, classes).direct) {
    throw new Refusal(409, { code: 'WIDENS', error: WIDENS })
  }
  const rule = ruleIds(ctx, classes).map(id => `${id}/direct`).join(',')
  const hat = hatsActedUnder(ctx, classes).join(', ')
  // A library receipt is committed sealed: who applied it, today, and the Org-Rule and Org-Change this commit carries.
  const sealed = sealReceipts(ops, { by: actor.id, at: new Date().toISOString().slice(0, 10), decision: { rule, change: opts.change } })
  const options = {
    message: opts.message ?? (ops.length > 0 ? commitMessage(ops) : RESTRICTED_SUBJECT),
    trailers: { actor: actorTrailer(actor), change: opts.change, rule, ...(hat !== '' ? { hat } : {}) },
    ident: commitIdent(actor),
    precheck: () => {
      opts.precheck?.()
      const rule = effectiveRule(readRuleContext(repo, actor), classes)
      if (!rule.direct) throw new Refusal(403, { reason: rule.sentence, error: rule.sentence })
    },
  }
  const clears = privateStore ? clearsOf(ops) : []
  if (priv.length === 0 && clears.length === 0) return applyOps(repo, sealed, options)
  if (!privateStore) throw unavailable(null)
  // A change with a private part always makes its commit, so whether the store already held a value never shows.
  const git = async () => ops.length > 0
    ? applyOps(repo, sealed, { ...options, ...(priv.length > 0 ? { emptySubject: RESTRICTED_SUBJECT } : {}) })
    : { commit: await commitEmpty(repo, { ...options, message: RESTRICTED_SUBJECT }) }
  return withPrivate(privateStore, [...clears, ...priv], opts.private!.viewer, actor.id, opts.change, opts.private!.staged, git)
}

/** A write's private side (L5 §10.3): the store (null when it cannot be reached and the write has no private part), the
 *  staged ops, whether they are the change's staged rows, and who is writing. */
export interface PrivatePart { store: PrivateStore | null; ops: StagedPrivateOp[]; staged: boolean; viewer: Viewer }

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
  const saveAndAnswer = (actor: KnownActor, change: Change, ops: Op[]): Response => {
    const next: Change = { ...change, ops, updated: new Date().toISOString() }
    store.save(next)
    notify({ type: 'changes' })
    const kept = ops.length > 0 || (next.private?.length ?? 0) > 0
    return Response.json(changeView(repo, actor, kept ? next : null, stagedView(privateStore, kept ? next : null)))
  }

  app.get('/api/actor', c => c.json(actorOf(c)))

  app.get('/api/changes', c => {
    const actor = readerOf(c)
    const change = isKnown(actor) ? store.load(actor.id) : null
    return c.json(changeView(repo, actor, change, stagedView(privateStore, change)))
  })

  app.post('/api/changes/ops', async c => {
    // A record read through the gate carries its level; written back unchanged, that `visibility` is left out (R-L5-13.4).
    const incoming = readStageOps(await jsonBody(c)).map(op => withoutEchoOp(repo, op))
    return answer(() => withLock(async () => {
      const actor = knownActorOf(c)
      const now = new Date().toISOString()
      const change = store.load(actor.id) ?? { id: newChangeId(), actor: actor.id, created: now, updated: now, ops: [] }
      // Each op split by data/visibility.yaml (L5 §10.3): a split that cannot be staged is a 422, a private part while the
      // store is down its 503, before anything is written.
      const split = splitOps(repo, incoming, privateStore, viewerOf(c))
      // stage() throws the 409 of a registry file with YAML errors; it reaches onError unchanged.
      const { ops, errors } = split.git.length > 0 ? stage(repo, change.ops, split.git) : { ops: change.ops, errors: [] }
      if (errors.length > 0) return Response.json({ errors }, { status: 422 })
      // The private part goes to the store's staged table; the change file keeps a placeholder for each op.
      const placeholders = split.private.length > 0 ? await stagePrivate(split.store!, change, actor.id, split.private) : change.private
      const { private: _was, ...rest } = change
      return saveAndAnswer(actor, { ...rest, ...(placeholders?.length ? { private: placeholders } : {}) }, ops)
    }))
  })

  // The rule the viewer's change would fall under with these ops added (the new-record form's governance line, spec
  // 2026-11-04 §3): read only, so no lock, nothing staged, written or told. The actor is still asked for, as staging
  // asks: a reader git cannot match is told why. The ops' classes are read as staging's would be (`classesOf`).
  app.post('/api/changes/rule', async c => {
    const ops = readStageOps(await jsonBody(c)).map(op => withoutEchoOp(repo, op))
    return answer(async () => {
      const actor = knownActorOf(c)
      const classes = [...new Set([...changeClasses(store.load(actor.id), repo), ...classesOf(ops, repo)])]
      return Response.json(effectiveRule(readRuleContext(repo, actor), classes))
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
    return saveAndAnswer(actor, change!, rest)
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
      const rebased = rebaseOp(ops[n]!, currentOf(repo, ops[n]!.record), keep)
      if (rebased === ops[n]) return Response.json(changeView(repo, actor, change, stagedView(privateStore, change)))
      return saveAndAnswer(actor, change!, rebased ? ops.map((o, i) => (i === n ? rebased : o)) : ops.filter((_, i) => i !== n))
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
      requireReading(c, ruleHats(readRuleContext(repo, asking), classes), () => effectiveRule(readRuleContext(repo, asking), classes).direct === true)
    }
    return withLock(async () => {
      const actor = knownActorOf(c)
      const change = store.load(actor.id)
      const placeholders = change?.private ?? []
      // always throws: no ops is the empty state, and the machine refuses Apply there
      if (!change || (change.ops.length === 0 && placeholders.length === 0)) checkApply([], [], null)
      refuseRevising(change)
      // The private part, read back from the store's staged table (L5 §10.3); a store that cannot be reached is its 503.
      const { store: reached, why } = reach(privateStore)
      if (placeholders.length > 0 && !reached) throw unavailable(why)
      const priv: PrivatePart = { store: reached, ops: placeholders.length > 0 ? stagedPrivate(reached!, change!) : [], staged: true, viewer: viewerOf(c) }
      try {
        const { commit } = await applyAs(repo, actor, change!.ops, {
          change: change!.id,
          precheck: () => checkApply([...change!.ops, ...placeholders], staleOps(repo, change!.ops), effectiveRule(readRuleContext(repo, actor), changeClasses(change, repo))),
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
