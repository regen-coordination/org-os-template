// packages/admin/server/workspace/records.ts
//
// Batched record writes (DAO-OS L6 spec §6 "Records", §16 `POST /api/workspace/records`): the records a member edits inline
// in a view (tasks, meetings, a custom collection's) are batched per actor and collection, as an editing session batches a
// page's saves, and flushed after RECORD_IDLE_MS without a write, so a burst of inline edits is one commit (`Org-Rule:
// workspace/direct`, `Org-Change: <the batch's ses_ id>`; subject `<collection>: <title>` for one record, `<collection>: <n>
// records` for several). Each write is folded into the batch with the change engine's own `stage` (one op per record, its
// first base kept, every op validated as the batch leaves it), and the batch is kept in the admin state directory
// (`<state>/batches/`), so a crash leaves it for the next start (`reconcile`).
//
// A batch whose ops went stale before the flush (the record changed since), or whose collection's rule no longer lets the
// actor write alone, goes into the actor's change instead: 0.6's stale path (the tray's Keep mine / Take theirs), nothing
// lost. A write under a raised collection stages at once (`{ save: 'staged' }`). A record that is not a workspace record is
// refused in words. A part kept in the private store (a private collection's record, a restricted field; controller ruling
// R-8a) is never held in a file: direct, it is written to the store at once (no commit) while its git part is batched;
// raised, it is staged through L5's staging beside the git part.

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { actorTrailer, commitIdent, type KnownActor } from '../actor.ts'
import { knownActorOf, viewerOf } from '../request.ts'
import { effectiveRule, hatsActedUnder, readRuleContext, ruleIds } from '../governance/effective.ts'
import { applyOps, Referred, Refusal, StageRefusal } from '../changes/apply.ts'
import { mergeOp } from '../changes/merge.ts'
import { parseRecord, StageError } from '../changes/records.ts'
import { readStageOps } from '../changes/routes.ts'
import { classesOf, currentOf, stage, staleOps, targetsOfOps } from '../changes/stage.ts'
import { ChangeStore, newChangeId } from '../changes/store.ts'
import type { Op, RecordError, RecordOp, RecordStaged, StageOp } from '../changes/types.ts'
import { registriesOf } from '../registries.ts'
import { fileSafe, stateDir } from '../state.ts'
import { applyPrivate, clearsOf, gitNames, isMove, noStore, privateClasses, reach, refuseHeldByMove, resolvePrivate, splitOps, stagePrivate, unavailable, withPrivate, type PrivateAccess } from '../private/ops.ts'
import { withoutEchoOp } from '../visibility/gate.ts'
import { readConfig } from '../visibility/config.ts'
import { refuseNarrowed } from '../private/guard.ts'
import { privateTargetsOf } from '../private/targets.ts'
import { guardCouncilMemory } from './memory.ts'
import type { Viewer } from '../../lib/visibility.mjs'
import { isFileOp } from './files.ts'
import { fileReader, unreadPaths, unreadRefusal } from './reads.ts'
import { newSessionId, ownLock, type Schedule } from './sessions.ts'

/** A batch is flushed after this long without a write (§6). */
export const RECORD_IDLE_MS = 10000

export const NOT_WORKSPACE = (record: string, cls: string): string =>
  `Not saved: ${record} is class ${cls}, not a workspace record: stage it in the change tray instead. Nothing was written.`
const RECORDS_ONLY = 'Not saved: this route takes record ops only; a file is edited whole from its page or the source editor. Nothing was written.'

export interface RecordDeps {
  idleMs?: number
  now?: () => Date
  schedule?: Schedule
  /** The repository's one write lock (app.ts); absent, one of this object's own. */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>
  /** Sent after a write that lands in a change (staged, or a stale batch), so every open tab refreshes its tray. */
  notify?: (msg: { type: 'changes' }) => void
  privateStore?: PrivateAccess
}

/** One actor's batch of one collection. `ops` are staged ops (record ops with their bases). */
interface Batch { id: string; who: KnownActor; collection: string; ops: Op[]; cancel: (() => void) | null }
interface BatchFile { id: string; who: KnownActor; collection: string; ops: Op[] }

const realSchedule: Schedule = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return () => clearTimeout(t) }
const logged = (what: string) => (err: unknown) => console.error(`org-os admin: ${what}: ${err instanceof Error ? err.message : String(err)}`)
const stripped = (op: RecordStaged): RecordOp => {
  const { base: _base, before: _before, ...rest } = op
  return rest as RecordOp
}

export class RecordBatches {
  private readonly idleMs: number
  private readonly now: () => Date
  private readonly schedule: Schedule
  private readonly withLock: <T>(fn: () => Promise<T>) => Promise<T>
  private readonly notify: (msg: { type: 'changes' }) => void
  private readonly access: PrivateAccess
  private readonly batches = new Map<string, Batch>()
  private readonly inflight = new Set<Promise<unknown>>()

  constructor(private readonly repo: string, deps: RecordDeps = {}) {
    this.idleMs = deps.idleMs ?? RECORD_IDLE_MS
    this.now = deps.now ?? (() => new Date())
    this.schedule = deps.schedule ?? realSchedule
    this.withLock = deps.withLock ?? ownLock()
    this.notify = deps.notify ?? (() => {})
    this.access = deps.privateStore ?? noStore
  }

  /** Workspace record ops, as `actor` (judged with `viewer` for a private part, §3.2): batched where the rule lets them
   *  write alone, staged where it is raised. */
  async write(actor: KnownActor, ops: StageOp[], viewer: Viewer = { kind: 'member', id: actor.id, hats: [], roles: [] }): Promise<{ save: 'direct' | 'staged' }> {
    if (ops.length === 0) throw new HttpError(400, 'The body must be {"ops": [...]}, at least one record op.')
    if (ops.some(isFileOp)) throw new HttpError(400, RECORDS_ONLY)
    const records = ops as RecordOp[]
    // Controller ruling R-8a: a part kept in the store (a private collection's record, a restricted field) is split off.
    // Direct, the git part is batched like any other and the store part written to the store at once (no commit);
    // raised, both are staged in the actor's change, the store part through L5's staging (`stagePrivate`).
    const split = splitOps(this.repo, records, this.access, viewer)
    this.refuseNotWorkspace(split.git)
    const store = split.store
    const priv = split.private
    // Council memory is written at once or not at all, at its collection's level (Task 15 review I-1).
    guardCouncilMemory(this.repo, actor, store, priv)
    const privClasses = privateClasses(store, priv)
    const ctx = readRuleContext(this.repo, actor)
    // The private part judged at its own targets (a record at its collection's, a page at its tree), as imports judge it.
    const rule = effectiveRule(ctx, [...new Set([...classesOf(split.git, this.repo), ...privClasses])],
      [...targetsOfOps(split.git, this.repo), ...privateTargetsOf(this.repo, store, priv)])
    // DAO-OS L6 §12: a private record moved into git is never batched: it goes to the tray, to be applied or proposed there.
    const moving = priv.some(isMove)
    if (!rule.direct || moving) {
      if (!rule.direct && !rule.proposable) throw new Refusal(403, { reason: rule.sentence, error: rule.sentence })
      return this.withLock(async () => {
        const changes = new ChangeStore(this.repo)
        const at = this.now().toISOString()
        const change = changes.load(actor.id) ?? { id: newChangeId(), actor: actor.id, created: at, updated: at, ops: [] }
        const out = split.git.length > 0 ? stage(this.repo, change.ops, split.git) : { ops: change.ops, errors: [] }
        if (out.errors.length > 0) throw new StageRefusal(out.errors)
        refuseHeldByMove(store, priv) // L6 carries K5
        const placeholders = priv.length > 0 ? await stagePrivate(store!, change, actor.id, priv) : change.private
        const { private: _was, ...rest } = change
        changes.save({ ...rest, ...(placeholders?.length ? { private: placeholders } : {}), ops: out.ops, updated: at })
        this.notify({ type: 'changes' })
        return { save: 'staged' as const }
      })
    }
    return this.withLock(async () => {
      // Every collection's batch folded first, then the store part written, then the batches kept: a refusal of either
      // leaves every batch as it was.
      const folded: [Batch, Op[]][] = []
      for (const collection of new Set(split.git.map(op => this.collectionOf(op)))) {
        const key = this.keyOf(actor.id, collection)
        const batch = this.batches.get(key) ?? { id: newSessionId(), who: actor, collection, ops: [], cancel: null }
        const out = stage(this.repo, batch.ops, split.git.filter(op => this.collectionOf(op) === collection))
        if (out.errors.length > 0) throw new StageRefusal(out.errors)
        folded.push([batch, out.ops])
      }
      if (priv.length > 0) {
        const s = store!
        refuseHeldByMove(s, priv) // L6 carries K5
        const resolved = resolvePrivate(s, priv, viewer, gitNames(this.repo))
        await s.within(async w => { applyPrivate(w, resolved, actor.id, folded[0]?.[0].id ?? newSessionId(), s) })
      }
      for (const [batch, ops] of folded) {
        batch.ops = ops
        const key = this.keyOf(actor.id, batch.collection)
        this.batches.set(key, batch)
        this.persist(key, batch)
        batch.cancel?.()
        batch.cancel = this.schedule(() => this.track(this.withLock(() => this.flushKey(key))), this.idleMs)
      }
      return { save: 'direct' as const }
    })
  }

  /** On stop: every batch flushed now. A failure is logged; a batch whose commit could not be made is kept in its file,
   *  for the next start's `reconcile`. */
  async flushAll(): Promise<void> {
    await this.settled()
    await this.withLock(async () => {
      for (const key of [...this.batches.keys()]) {
        try { await this.flushKey(key) } catch (err) { logged('a batch of record writes could not be flushed at stop')(err) }
      }
    })
  }

  /** At start: the batches a crash left in the state directory, flushed; answers their ids. */
  async reconcile(): Promise<string[]> {
    const dir = this.dir()
    const done: string[] = []
    if (!existsSync(dir)) return done
    for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const path = join(dir, file)
      let saved: BatchFile
      try { saved = JSON.parse(readFileSync(path, 'utf8')) as BatchFile } catch {
        try { renameSync(path, `${path}.unreadable-${Date.now()}`) } catch { /* gone already */ }
        continue
      }
      const key = this.keyOf(saved.who.id, saved.collection)
      if (this.batches.has(key)) continue
      this.batches.set(key, { ...saved, cancel: null })
      try {
        await this.withLock(() => this.flushKey(key))
        done.push(saved.id)
      } catch (err) { logged(`the batch ${saved.id} could not be flushed at start`)(err) }
    }
    return done
  }

  dispose(): void {
    for (const b of this.batches.values()) b.cancel?.()
    this.batches.clear()
  }

  async settled(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight])
  }

  // ── inside ──────────────────────────────────────────────────────────────────────────────────────

  private track(p: Promise<unknown>): void {
    const q: Promise<unknown> = p.catch(logged('a batch of record writes could not be flushed')).finally(() => this.inflight.delete(q))
    this.inflight.add(q)
  }

  private collectionOf(op: RecordOp): string { return parseRecord(op.record, registriesOf(this.repo)).registry }
  private keyOf(actor: string, collection: string): string { return `${actor}\u0000${collection}` }
  private dir(): string { return join(stateDir(this.repo), 'batches') }
  private file(key: string): string { return join(this.dir(), `${fileSafe(key)}.json`) }

  private refuseNotWorkspace(ops: RecordOp[]): void {
    const errors: RecordError[] = []
    for (const op of ops) {
      let cls: string[]
      // A record naming no collection, or a private one the viewer may not read (rule 7: the same words), is staging's 422.
      try { cls = classesOf([op], this.repo).filter(c => c !== 'publication') } catch (err) {
        if (!(err instanceof StageError)) throw err
        errors.push({ record: op.record, field: err.field, message: err.message })
        continue
      }
      const other = cls.find(c => c !== 'workspace')
      if (other !== undefined) errors.push({ record: op.record, field: '', message: NOT_WORKSPACE(op.record, other) })
    }
    if (errors.length > 0) throw new StageRefusal(errors)
  }

  private persist(key: string, batch: Batch): void {
    mkdirSync(this.dir(), { recursive: true })
    const file = this.file(key)
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    const saved: BatchFile = { id: batch.id, who: batch.who, collection: batch.collection, ops: batch.ops }
    writeFileSync(tmp, JSON.stringify(saved))
    renameSync(tmp, file)
  }

  /** One batch's flush (the caller holds the write lock): one commit where nothing in it went stale and the rule still lets
   *  its actor write alone (a git record it deletes takes its restricted fields with it, in the store, around the commit).
   *  Stale, or raised, or refused for what it holds (it would not validate, a record it deletes is named): into the actor's
   *  change (0.6's stale path), nothing lost. A commit that could not be made now (a file not committed, git busy, the
   *  store down): the batch is kept as it is, in memory and in its file, tried again after RECORD_IDLE_MS, and the failure
   *  thrown in its own words; a later write folds into it. The batch goes only once it is committed or in the tray. */
  private async flushKey(key: string): Promise<void> {
    const batch = this.batches.get(key)
    if (!batch) return
    batch.cancel?.()
    batch.cancel = null
    const drop = () => { if (this.batches.get(key) === batch) this.batches.delete(key); rmSync(this.file(key), { force: true }) }
    if (batch.ops.length === 0) { drop(); return }
    const ops = batch.ops as RecordStaged[]
    const plain = ops as StageOp[]
    const classes = classesOf(plain, this.repo)
    const targets = targetsOfOps(plain, this.repo)
    const ctx = readRuleContext(this.repo, batch.who)
    // Rule 4: a field narrowed since it was written never reaches git; the op goes to the tray, whose Apply says what to do
    // (R-L5-16.10), as a stale or raised batch does.
    const narrowed = (() => { try { refuseNarrowed(plain, readConfig(this.repo), 'Not applied'); return false } catch { return true } })()
    if (narrowed || staleOps(this.repo, batch.ops).length > 0 || !effectiveRule(ctx, classes, targets).direct) {
      this.intoTray(batch.who, ops); drop(); return
    }
    const hat = hatsActedUnder(ctx, classes, targets).join(', ')
    const names = gitNames(this.repo)
    const clears = clearsOf(plain, names)
    const commit = () => applyOps(this.repo, plain, {
      message: this.subjectOf(batch.collection, ops),
      trailers: { actor: actorTrailer(batch.who), change: batch.id, rule: ruleIds(ctx, classes, targets).map(id => `${id}/direct`).join(','), ...(hat !== '' ? { hat } : {}) },
      ident: commitIdent(batch.who),
      precheck: () => {
        if (staleOps(this.repo, batch.ops).length > 0) throw new Refusal(409, { code: 'STALE', error: 'A record changed since it was written.' })
        refuseNarrowed(plain, readConfig(this.repo), 'Not applied')
        const now = effectiveRule(readRuleContext(this.repo, batch.who), classes, targets)
        if (!now.direct) throw new Refusal(403, { reason: now.sentence, error: now.sentence })
      },
    })
    try {
      if (clears.length === 0) await commit()
      else {
        const { store, why } = reach(this.access)
        if (!store) throw unavailable(why)
        await withPrivate(store, clears, { kind: 'member', id: batch.who.id, hats: [], roles: [] }, batch.who.id, batch.id, false, commit, names)
      }
    } catch (err) {
      const content = err instanceof StageRefusal || err instanceof Referred || (err instanceof Refusal && (err.status === 403 || err.body.code === 'STALE' || err.body.code === 'NARROWED'))
      if (content) {
        logged(`the batch ${batch.id} could not be committed, so it is in ${batch.who.id}'s change`)(err)
        this.intoTray(batch.who, ops); drop(); return
      }
      batch.cancel = this.schedule(() => this.track(this.withLock(() => this.flushKey(key))), this.idleMs)
      throw err
    }
    drop()
  }

  /** The batch's ops into the actor's change, with the bases they were written against, so a stale one shows stale. An op
   *  on a record the change already holds is folded into it (the change's own base kept). */
  private intoTray(who: KnownActor, ops: RecordStaged[]): void {
    const changes = new ChangeStore(this.repo)
    const at = this.now().toISOString()
    const change = changes.load(who.id) ?? { id: newChangeId(), actor: who.id, created: at, updated: at, ops: [] }
    const defs = registriesOf(this.repo)
    let next: Op[] = change.ops
    for (const op of ops) {
      const held = next.some(o => !isFileOp(o) && o.record === op.record)
      if (!held) { next = [...next, op]; continue }
      let current: Record<string, unknown> | null = null
      try { current = currentOf(this.repo, op.record) } catch { /* a record git does not hold now */ }
      try { next = mergeOp(next, stripped(op), current, defs) } catch (err) { logged(`${op.record} could not be folded into ${who.id}'s change`)(err) }
    }
    changes.save({ ...change, ops: next, updated: at })
    this.notify({ type: 'changes' })
  }

  /** `<collection>: <title>` for one record, `<collection>: <n> records` for several (§3.4). */
  private subjectOf(collection: string, ops: RecordStaged[]): string {
    if (ops.length !== 1) return `${collection}: ${ops.length} records`
    const op = ops[0]!
    const value = op.op === 'create' || op.op === 'replace' ? op.value : op.op === 'update' ? { ...(op.before ?? {}), ...op.set } : (op.before ?? {})
    const title = value.title ?? value.name ?? parseRecord(op.record, registriesOf(this.repo)).id
    return `${collection}: ${String(title)}`
  }
}

export function mountRecords(app: Hono, repo: string, batches: RecordBatches): void {
  app.post('/api/workspace/records', async c => {
    let raw: unknown
    try { raw = await c.req.json() } catch { raw = undefined }
    // A record read through the gate carries its level; written back unchanged, that `visibility` is left out (R-L5-13.4).
    const ops = readStageOps(raw, repo).map(op => (isFileOp(op) ? op : withoutEchoOp(repo, op)))
    // 0.7.2 round 3 (review 4): a record of a file the writer may not read (the `files` section) is refused before anything
    // is read or staged for it, in the words of a path no rule governs.
    const unread = unreadPaths(ops.filter(op => !isFileOp(op)), fileReader(c, repo))
    if (unread.length > 0) throw unreadRefusal(unread)
    return c.json(await batches.write(knownActorOf(c), ops, viewerOf(c)))
  })
}
