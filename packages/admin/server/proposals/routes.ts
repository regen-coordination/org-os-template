// packages/admin/server/proposals/routes.ts
//
// The proposal routes (0.6 P2 spec §3.15), every write inside the repository's write lock. This is where a route for a
// proposal is added: one `app.<verb>` below, its work in a function of its own module. Today: GET /api/proposals and
// GET /api/proposals/:id (view.ts: the page visit may build a missing branch and record a system reading, each inside the
// lock), POST /api/proposals, POST /api/proposals/:id/events (an `attach` among them), POST /api/proposals/:id/revise and
// POST /api/proposals/:id/replay and POST /api/proposals/:id/load (the page's Revise: the ops into the author's tray; all
// three in revise.ts), POST /api/proposals/:id/ratify, POST /api/proposals/:id/close, POST
// /api/proposals/:id/check, whose network read is made before the lock is taken, and POST /api/proposals/:id/prepare
// (prepare.ts: 0.6's Safe transaction, or a typed action of any system), which reads and writes nothing, so takes no
// lock; and GET /api/systems/:id/actions, the actions a system's driver prepares.

import type { Context, Hono } from 'hono'
import type { SystemReader } from '../systems/reader.ts'
import { HttpError } from '../errors.ts'
import { Refusal } from '../changes/apply.ts'
import { ChangeStore } from '../changes/store.ts'
import { readStageOps, refuseRevising } from '../changes/routes.ts'
import { changeClasses, changeView } from '../changes/stage.ts'
import type { Change, Op } from '../changes/types.ts'
import { actorOf, hatActOf, knownActorOf, readerOf, viewerOf, wearerReadOf, type WithoutReading } from '../request.ts'
import { isKnown, walletOf } from '../actor.ts'
import { readRuleContext } from '../governance/effective.ts'
import { bookFor, bookOf, readLedger } from './ledger.ts'
import { actHats, eventPermission, knownIds } from '../../lib/proposals.mjs'
import { effectiveRules, mayPropose, rulesForClasses, type Rule } from '../../lib/rules.mjs'
import { observationsOf, type HatAct } from '../../lib/hat-readings.mjs'
import { propose, type ProposeDeps, type ProposeInput } from './propose.ts'
import { writeEvent, readOutcome, recordOutcome, EVENT_KINDS_HERE, type EventInput, type EventKindHere, type OutcomeSource } from './events.ts'
import { ratify, readDeciders, type RatifyDeps } from './ratify.ts'
import { close, CLOSE_OUTCOMES, type CloseDeps, type CloseOutcome } from './close.ts'
import { detailView, listViews, viewById, type DetailDeps, type ProposalView } from './view.ts'
import { revise, replay, loadForRevision, CHOICES, type Choice } from './revise.ts'
import { prepare, prepareAction, readPrepareBody, type ActionSource, type PrepareSource } from './prepare.ts'
import { readRegistryOrEmpty } from '../registry.ts'
import { DRIVERS } from '../systems/drivers.ts'
import { currentOf } from '../changes/stage.ts'
import { gateProposals, gateRecord, Levels, MEMBERS, PUBLIC_NO_DIFF, proposalLevel, recordRef, withoutEchoOp } from '../visibility/gate.ts'
import { admits, formatLevel } from '../../lib/visibility.mjs'
import { gitOpsOf } from '../../lib/ops.mjs'
import { readConfig } from '../visibility/config.ts'
import { noStore, reach, stagedPrivate, stagedView, unavailable, type PrivateAccess } from '../private/ops.ts'
import { closingDropsPending, placeholdersOf, shownTo } from '../private/proposals.ts'
import type { ProposedPrivate } from './propose.ts'

export interface ProposalRoutesDeps extends ProposeDeps, Pick<RatifyDeps, 'ratifyGit'>, Pick<CloseDeps, 'closeGit'> {
  repo: string
  /** The repository's one write lock (app.ts). */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  /** Sent after a write that changes what a tray shows. */
  notify?: (msg: { type: 'changes' }) => void
  /** Reads outside outcomes for POST …/check and a page visit, and prepares for POST …/prepare: the server's SystemReader.
   *  Absent: a check or a visit reads nothing and says so; prepare answers 502. */
  systems?: OutcomeSource & Partial<PrepareSource> & Partial<ActionSource> & Partial<Pick<SystemReader, 'actionsOf'>>
  /** The one private store (L5 §10): a proposal's private part waits in it until it is decided, and is shown from it to
   *  those admitted. Absent: none (a proposal with a private part cannot be opened, ratified, or shown in full). */
  privateStore?: PrivateAccess
  /** Writes are off (Lane 3 Task 11, C1): a page visit builds no branch and records no reading. The write routes
   *  themselves are refused before they run (hosted/instance-writes.ts). */
  readOnly?: boolean
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const SHAPE = 'The body must be {"title": "...", "rationale": "...", "statement"?: {"title", "decision", "why", "scope"?}}'

async function jsonBody(c: Context): Promise<unknown> {
  try { return await c.req.json() } catch { return undefined }
}

/** The body of POST /api/proposals, or a 400 that says what it must be. What the ledger's schema checks (a title that is
 *  empty, a statement missing its `why`) is left to it: a 422 with the field. */
export function readProposeInput(body: unknown): ProposeInput {
  if (!isObject(body) || typeof body.title !== 'string') throw new HttpError(400, `${SHAPE}; "title" is missing.`)
  if (body.rationale !== undefined && typeof body.rationale !== 'string') throw new HttpError(400, `${SHAPE}; "rationale" is not text.`)
  if (body.statement !== undefined && !isObject(body.statement)) throw new HttpError(400, `${SHAPE}; "statement" is not an object.`)
  return {
    title: body.title,
    ...(body.rationale !== undefined ? { rationale: body.rationale as string } : {}),
    ...(body.statement !== undefined ? { statement: body.statement as Record<string, unknown> } : {}),
  }
}

const EVENT_SHAPE = `The body must be {"kind": "${EVENT_KINDS_HERE.join('" | "')}", "text"?, "vote"?, "of"?, "ref"?}`

/** The body of POST /api/proposals/:id/events, or a 400 that says what it must be. Who wrote it is never in it: a `by`
 *  (or `id`, or `at`) is not read. What the ledger's schema checks (an objection's text, a vote's value) is its 422. */
export function readEventInput(body: unknown): EventInput {
  if (!isObject(body) || typeof body.kind !== 'string') throw new HttpError(400, `${EVENT_SHAPE}; "kind" is missing.`)
  if (!(EVENT_KINDS_HERE as readonly string[]).includes(body.kind)) {
    throw new HttpError(400, `"${body.kind}" is not an event this route writes. ${EVENT_SHAPE}.`)
  }
  for (const key of ['text', 'vote', 'of'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') throw new HttpError(400, `${EVENT_SHAPE}; "${key}" is not text.`)
  }
  if (body.kind === 'attach' && !isObject(body.ref)) throw new HttpError(400, `${EVENT_SHAPE}; an attach needs "ref", the object prepare gives.`)
  return {
    kind: body.kind as EventKindHere,
    ...(body.text !== undefined ? { text: body.text as string } : {}),
    ...(body.vote !== undefined ? { vote: body.vote as string } : {}),
    ...(body.of !== undefined ? { of: body.of as string } : {}),
    ...(body.kind === 'attach' ? { ref: body.ref } : {}),
  }
}

const REVISE_SHAPE = 'The body must be {"ops": [...]}, the ops as the tray holds them, each with the "base" it was staged against (null for a create)'

/** The body of POST /api/proposals/:id/revise: the ops, each with its `base`, or a 400 that says what it must be. An empty
 *  list is read as such: a revision whose git part is empty may still carry the revising tray's private part (L5 §9.6,
 *  R-L5-15.2), and `revise` itself refuses one that holds nothing (400 `EMPTY`). */
export function readReviseOps(body: unknown): Op[] {
  if (isObject(body) && Array.isArray(body.ops) && body.ops.length === 0) return []
  const ops = readStageOps(body)
  const raw = (body as { ops: unknown[] }).ops
  return ops.map((op, i) => {
    const r = raw[i] as Record<string, unknown>
    if (!Object.hasOwn(r, 'base') || (r.base !== null && typeof r.base !== 'string')) throw new HttpError(400, `${REVISE_SHAPE}; op ${i} has no "base".`)
    return { ...op, base: r.base as string | null, before: null } as Op
  })
}

const REPLAY_SHAPE = `The body must be {} or {"choose": "${CHOICES.join('" | "')}"}`

/** The body of POST /api/proposals/:id/replay, or a 400. An empty body is a replay without a choice. */
export function readChoice(body: unknown): Choice | undefined {
  if (body === undefined) return undefined
  if (!isObject(body)) throw new HttpError(400, `${REPLAY_SHAPE}.`)
  if (body.choose === undefined) return undefined
  if (!(CHOICES as readonly unknown[]).includes(body.choose)) throw new HttpError(400, `"${String(body.choose)}" is not a choice here. ${REPLAY_SHAPE}.`)
  return body.choose as Choice
}

const CLOSE_SHAPE = `The body must be {"outcome": "${CLOSE_OUTCOMES.join('" | "')}"}`

/** The body of POST /api/proposals/:id/close, or a 400 that says what it must be. */
export function readCloseOutcome(body: unknown): CloseOutcome {
  if (!isObject(body) || typeof body.outcome !== 'string') throw new HttpError(400, `${CLOSE_SHAPE}; "outcome" is missing.`)
  if (!(CLOSE_OUTCOMES as readonly string[]).includes(body.outcome)) throw new HttpError(400, `"${body.outcome}" is not a way to close a proposal here. ${CLOSE_SHAPE}.`)
  return body.outcome as CloseOutcome
}

export function mountProposals(app: Hono, { repo, withLock, notify, systems, privateStore = noStore, ...deps }: ProposalRoutesDeps): void {
  const changes = new ChangeStore(repo)
  const clock = () => (deps.now ?? (() => new Date()))()
  /** When a page visit last read each attach (view.ts): at most once per the reader's window. */
  const visits: DetailDeps['visits'] = new Map()
  /** The last build each proposal's page visit tried that failed (view.ts): not tried again at the same rev and trunk tip. */
  const failedBuilds: DetailDeps['failedBuilds'] = new Map()
  /** Every proposal route answers the proposal as the actor sees it now (a ProposalView: `branchState` is the build
   *  state, `branch` the ledger's name for the branch), with what the write said beside it. */
  const answerView = async (c: Context, id: string, extra: Record<string, unknown>, status = 200): Promise<Response> => {
    const view: ProposalView = shownTo(await viewById(repo, id, readerOf(c), clock()), viewerOf(c), privateStore, readConfig(repo))
    return Response.json({ ...view, ...extra }, { status })
  }
  /** A change's private part as Propose or Update proposal carries it (L5 §9.6): its staged ops read back from the store,
   *  and who proposes them. None when it has none; a store that cannot be reached is its 503, before anything is written. */
  const privateOf = (c: Context, change: Change | null): ProposedPrivate | undefined => {
    if (!change?.private?.length) return undefined
    const { store, why } = reach(privateStore)
    if (!store) throw unavailable(why)
    return { store, ops: stagedPrivate(store, change), viewer: viewerOf(c) }
  }
  /** The private part of an Update proposal from the tray revising proposal `id`: the tray's, which replaces the proposal's;
   *  an empty one when the tray holds none and the proposal does (it is taken out). */
  const revisingPart = (c: Context, id: string, tray: Change): ProposedPrivate | undefined => {
    const part = privateOf(c, tray)
    if (part) return part
    const entry = readLedger(repo).entries.find(e => String(e.id) === id)
    if (placeholdersOf(entry?.ops as unknown[] | undefined).length === 0) return undefined
    const { store, why } = reach(privateStore)
    if (!store) throw unavailable(why)
    return { store, ops: [], viewer: viewerOf(c) }
  }

  /** A Refusal is its own answer (its whole body); anything else goes to the app's error handler. */
  const answer = async (fn: () => Promise<Response>): Promise<Response> => {
    try { return await fn() } catch (err) {
      if (err instanceof Refusal) return Response.json(err.body, { status: err.status })
      throw err
    }
  }

  /** The reading an act of `kind` under `rules` is judged on and records (L5 spec §7.2): request.ts `hatActOf`, read now
   *  and before the write lock is taken, so a tree that cannot be read, or a hat no longer worn, refuses the act with
   *  nothing written — unless the act is `permitted` without the actor's reading (a git member whose wallet could not be
   *  read, commenting or approving under a role written with members: R-L5-8.8). Undefined for an act under no hat
   *  (0.6's ledger). */
  const actUnder = async (c: Context, rules: readonly Partial<Rule>[], kind: string, permitted: WithoutReading): Promise<HatAct | undefined> =>
    (await hatActOf(c, actHats(rules, bookFor(repo, null), kind), permitted)) ?? undefined
  /** The same for an act on proposal `id`; none when the ledger has no such proposal (the act's own 404 answers it).
   *  Without a reading, the act is judged as `eventPermission` judges it by the book of the proposal's own observations,
   *  less every one of the actor's own account: an earlier reading never stands in for the one that failed (§5.2). */
  const actOn = async (c: Context, id: string, kind: string, of?: string): Promise<HatAct | undefined> => {
    const entry = readLedger(repo).entries.find(e => String(e.id) === id)
    if (!entry) return undefined
    const permitted = () => {
      const asking = actorOf(c)
      if (!asking || !isKnown(asking)) return false
      const ctx = readRuleContext(repo, asking)
      const members = ctx.members ?? []
      const account = walletOf(asking)?.account
      const others = observationsOf(entry).filter(o => o.account !== account)
      return eventPermission(kind, {
        actor: asking.id, proposal: entry, rules: entry.rules ?? [], book: bookOf(ctx.governance, members, null, others),
        known: knownIds(members, observationsOf(entry)), ...(of !== undefined ? { of } : {}),
      }) === null
    }
    return actUnder(c, entry.rules ?? [], kind, permitted)
  }
  /** The same for opening a proposal from the asker's staged change: the rules its classes are decided by. Without a
   *  reading, the asker may open it when every rule's proposing role holds them by data/members.yaml. */
  const actOpening = async (c: Context): Promise<HatAct | undefined> => {
    const asking = actorOf(c)
    const staged = asking && isKnown(asking) ? changes.load(asking.id) : null
    const governance = asking ? readRuleContext(repo, asking).governance : null
    if (!asking || !isKnown(asking) || !staged || (staged.ops.length === 0 && !staged.private?.length) || governance === null) return undefined
    // Its private part's classes too (L5 §10.3): their rules decide it as the git part's do.
    const rules = rulesForClasses(effectiveRules(governance).rules, changeClasses(staged, repo)).flatMap(r => (r.rule ? [r.rule] : []))
    const book = bookFor(repo, null)
    return actUnder(c, rules, 'open', () => rules.every(rule => mayPropose(rule, asking.id, book) === true))
  }

  // Reads are gated (L5 spec §9.5): the public is given public proposals only, each as its public record; a proposal is
  // judged before its page is built, so nothing is built, read or recorded for one the asker may not see, and nothing at
  // all for the public (a visit's build and system read are members').
  // A proposal on private data is then shown in full only to a viewer admitted to all of it (rule 8, private/proposals.ts).
  app.get('/api/proposals', c => answer(async () => {
    const viewer = viewerOf(c)
    return Response.json(gateProposals(viewer, await listViews(repo, readerOf(c), clock()), new Levels(repo)).map(v => shownTo(v, viewer, privateStore, readConfig(repo))))
  }))
  app.get('/api/proposals/:id', c => answer(async () => {
    const id = c.req.param('id')
    const viewer = viewerOf(c)
    const levels = new Levels(repo)
    const level = proposalLevel(levels, id)
    if (level !== null && !admits(level, viewer)) throw new HttpError(404, `The ledger has no proposal ${id}.`)
    if (viewer.kind === 'public') {
      const [view] = gateProposals(viewer, [await viewById(repo, id, readerOf(c), clock())], levels)
      const entry = readLedger(repo).entries.find(e => String(e.id) === id)
      const current = gitOpsOf(entry?.ops ?? []).map(op => {
        const { registry } = recordRef(op.record)
        const record = currentOf(repo, String(op.record))
        return record === null ? null : gateRecord(viewer, registry, record, levels.config)
      })
      return Response.json({ ...view, diff: null, note: PUBLIC_NO_DIFF, current })
    }
    const { build, startBranch } = deps
    const detail = await detailView(repo, id, readerOf(c), { withLock, now: clock(), build, startBranch, systems, visits, failedBuilds, hosted: deps.hosted, readOnly: deps.readOnly })
    return Response.json({ ...shownTo(detail, viewer, privateStore, readConfig(repo)), visibility: formatLevel(level ?? MEMBERS) })
  }))
  app.post('/api/proposals/:id/revise', async c => {
    const ops = readReviseOps(await jsonBody(c))
    return answer(async () => {
      const as = await actOn(c, c.req.param('id'), 'revise')
      return withLock(async () => {
        const actor = knownActorOf(c)
        const { ratifyGit: _r, closeGit: _c, ...rest } = deps
        const id = c.req.param('id')
        // Update proposal sends the tray's git ops; the tray revising this proposal carries its private part, which replaces
        // the proposal's. With no tray revising it, the proposal keeps its own (R-L5-15.4).
        const held = changes.load(actor.id)
        const revising = held?.revises === id ? held : null
        const priv = revising ? revisingPart(c, id, revising) : undefined
        // A record read through the gate carries its level; that echo is not written into the ledger (R-L5-13.4).
        const { commit, note } = await revise(repo, actor, id, ops.map(op => withoutEchoOp(repo, op)), { ...rest, as }, priv)
        notify?.({ type: 'changes' })
        return answerView(c, id, { commit, ...(note ? { note } : {}) })
      })
    })
  })
  app.post('/api/proposals/:id/load', async c => {
    await jsonBody(c) // read and ignored: what is loaded is the ledger's, never the request's
    return answer(() => withLock(async () => {
      const actor = knownActorOf(c)
      // A proposal's private part goes into the tray with its git ops, for an author admitted to it (R-L5-15.4).
      const change = await loadForRevision(repo, actor, c.req.param('id'), changes, { now: deps.now }, { access: privateStore, viewer: viewerOf(c) })
      notify?.({ type: 'changes' })
      // The tray's own answer: the change as GET /api/changes gives it, marked revises.
      return Response.json(changeView(repo, actor, change, stagedView(privateStore, change)))
    }))
  })
  app.post('/api/proposals/:id/replay', async c => {
    const choose = readChoice(await jsonBody(c))
    return answer(async () => {
      const as = await actOn(c, c.req.param('id'), 'replay')
      return withLock(async () => {
        const actor = knownActorOf(c)
        const { ratifyGit: _r, closeGit: _c, build: _b, ...rest } = deps
        const id = c.req.param('id')
        const { commit } = await replay(repo, actor, id, choose, { ...rest, as })
        if (commit) notify?.({ type: 'changes' })
        return answerView(c, id, { commit })
      })
    })
  })
  app.post('/api/proposals/:id/prepare', async c => {
    const body = readPrepareBody(await jsonBody(c))
    return answer(async () => {
      knownActorOf(c)
      const id = c.req.param('id')
      // Reads of outside systems and nothing else: no lock, no write.
      if (body.kind === 'action') {
        return Response.json(await prepareAction(repo, id, body.action, systems?.prepareAction ? { prepareAction: systems.prepareAction.bind(systems) } : undefined))
      }
      return Response.json(await prepare(repo, id, body.tx, systems?.prepare ? { prepare: systems.prepare.bind(systems) } : undefined, body.chain))
    })
  })
  /** The actions a system's driver prepares, for the proposal page's form: [] for a driver with none; 404 for an id not in
   *  data/systems.yaml. Reads the file and nothing else. */
  app.get('/api/systems/:id/actions', c => answer(async () => {
    const id = c.req.param('id')
    const system = (readRegistryOrEmpty(repo, 'systems').entries ?? []).find(s => isObject(s) && String(s.id) === id)
    if (!system) throw new HttpError(404, `data/systems.yaml has no system "${id}".`)
    const actions = systems?.actionsOf
      ? systems.actionsOf(system)
      : DRIVERS.find(d => d.name === (typeof system.driver === 'string' ? system.driver : 'link'))?.actions ?? []
    return Response.json({ actions })
  }))
  app.post('/api/proposals', async c => {
    const input = readProposeInput(await jsonBody(c))
    return answer(async () => {
      const as = await actOpening(c)
      return withLock(async () => {
        const actor = knownActorOf(c)
        const change = changes.load(actor.id)
        // A change holding only a private part is a proposal too (L5 §9.6): its placeholders are its ops in the ledger.
        if (!change || (change.ops.length === 0 && !change.private?.length)) {
          throw new Refusal(400, { code: 'EMPTY', error: 'Nothing is staged: the change holds no ops to propose.' })
        }
        refuseRevising(change)
        const result = await propose(repo, actor, change, input, { ...deps, as }, privateOf(c, change))
        // Only now, with the proposal committed, does the change go: its ops live in the ledger.
        changes.clear(actor.id)
        notify?.({ type: 'changes' })
        return answerView(c, String(result.proposal.id), { commit: result.commit, ...(result.note ? { note: result.note } : {}) }, 201)
      })
    })
  })
  app.post('/api/proposals/:id/events', async c => {
    const input = readEventInput(await jsonBody(c))
    return answer(async () => {
      // A system event is the server's: no one's reading is asked for it (the machine refuses it).
      const as = input.kind === 'system' ? undefined : await actOn(c, c.req.param('id'), input.kind, input.of)
      return withLock(async () => {
        const actor = knownActorOf(c)
        // A withdraw closes the proposal: it goes through the closing path and its preflight, as POST .../close does.
        if (input.kind === 'withdraw') {
          const { ratifyGit: _r, build: _b, ...rest } = deps
          // A closing drops the proposal's private part (§10.2: pending is an open proposal's).
          const { commit } = await closingDropsPending(privateStore, c.req.param('id'), () => close(repo, actor, c.req.param('id'), 'withdrawn', { ...rest, as }, input.text))
          notify?.({ type: 'changes' })
          return answerView(c, c.req.param('id'), { commit })
        }
        const { commit } = await writeEvent(repo, actor, c.req.param('id'), input, { ...deps, as })
        notify?.({ type: 'changes' })
        return answerView(c, c.req.param('id'), { commit })
      })
    })
  })
  app.post('/api/proposals/:id/ratify', async c => {
    await jsonBody(c) // read and ignored: the client's word on whether the rule is met counts for nothing (spec §3.8)
    return answer(async () => {
      const as = await actOn(c, c.req.param('id'), 'ratify')
      // Every counted actor's hats are read again before the lock (L5 spec §7.4, Q1).
      const checked = await readDeciders(repo, knownActorOf(c), c.req.param('id'), { read: wearerReadOf(c), now: clock(), as })
      return withLock(async () => {
        const actor = knownActorOf(c)
        const { ratifyGit, build: _build, ...rest } = deps
        const { commit, decision } = await ratify(repo, actor, c.req.param('id'), { ...rest, ratifyGit, as, checked, privateStore })
        notify?.({ type: 'changes' })
        return answerView(c, c.req.param('id'), { commit, decision })
      })
    })
  })
  app.post('/api/proposals/:id/check', async c => {
    await jsonBody(c) // read and ignored: what the system says is read from the system, never from the request
    return answer(async () => {
      const actor = knownActorOf(c)
      const id = c.req.param('id')
      const { ratifyGit: _r, build: _b, ...rest } = deps
      // The read goes to the network and may take seconds: it is made before the write lock, and nothing is written by it.
      const read = await readOutcome(repo, actor, id, systems, (rest.now ?? (() => new Date()))())
      const result = await withLock(() => recordOutcome(repo, actor, id, read, rest))
      if (result.appended) notify?.({ type: 'changes' })
      const { commit, reading, appended, attention } = result
      return answerView(c, id, { commit, reading, appended, ...(attention ? { attention } : {}) })
    })
  })
  app.post('/api/proposals/:id/close', async c => {
    const outcome = readCloseOutcome(await jsonBody(c))
    return answer(async () => {
      const as = await actOn(c, c.req.param('id'), outcome === 'withdrawn' ? 'withdraw' : outcome === 'rejected' ? 'reject' : 'expire')
      return withLock(async () => {
        const actor = knownActorOf(c)
        const { ratifyGit: _ratifyGit, build: _build, ...rest } = deps
        const { commit, decision } = await closingDropsPending(privateStore, c.req.param('id'), () => close(repo, actor, c.req.param('id'), outcome, { ...rest, as }))
        notify?.({ type: 'changes' })
        return answerView(c, c.req.param('id'), { commit, decision })
      })
    })
  })
}
