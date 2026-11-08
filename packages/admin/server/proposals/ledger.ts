// packages/admin/server/proposals/ledger.ts
//
// The ledger on disk (0.6 P2 spec §3.1, §3.2): `data/proposals.yaml`, written only from here. Every write is
// one commit on the trunk that touches this one file, with the trailers of spec §3.13, and is refused in words
// before anything is written unless: the trunk is a name the platform can build refs from and the repository is
// on it (P2-R17); `proposals.yaml` has no uncommitted change and is not hidden from git (the same 409 as Apply);
// the server's clock is not behind the ledger (P2-R30); the event is one the evaluator would count; and the text
// that would be written is a ledger that passes the schema and `checkProposals`, and adds nothing stricter than members
// (L5 spec §10.5, `assertGitSafe`: an op on private data is held only as a placeholder).
//
// Edits are text splices that keep every other byte and comment (`createdText`, `updatedText`, and, for an
// event, one flow-style line appended to the entry's `events`), each checked by the exact-write verification
// before it is written. Callers hold the repository's write lock.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument, isSeq, type YAMLMap, type YAMLSeq } from 'yaml'
import { Refusal, guardFiles } from '../changes/apply.ts'
import { HttpError } from '../errors.ts'
import { registryDef, resolveTopKey } from '../registries.ts'
import { readRegistry, createdText, updatedText, collectionSeq, findEntity, entriesFromText } from '../registry.ts'
import { whyNot } from '../verify.ts'
import { spliceAppendFlow, flowText } from '../splice.ts'
import { commitDataPaths, restageDataPaths, repoStatus, validBranchName, type GitIdent } from '../git.ts'
import { readRuleContext } from '../governance/effective.ts'
import { assertGitSafe } from '../private/guard.ts'
import { readConfig } from '../visibility/config.ts'
import { validateEntry } from '../../lib/data-validate.mjs'
import { yamlDocuments } from '../../lib/governance-read.mjs'
import { CHANGE_CLASSES, classOf } from '../../lib/change-classes.mjs'
import { resolveRoles, validTrunkName, type RoleBook } from '../../lib/rules.mjs'
import { observationsOf, type HatAct, type HatObservation } from '../../lib/hat-readings.mjs'
import { checkProposals, eventId, instant, CLOCK_SKEW_MS, PROPOSAL_STATES, methodOf, decidersOf, type Proposal, type LedgerEvent } from '../../lib/proposals.mjs'
import { timingOf, ballotsClosed, inWords } from '../../lib/evaluate.mjs'
import type { TrailerValues } from '../../lib/trailers.mjs'

const REL = 'data/proposals.yaml'
const NAME = 'proposals'

export interface LedgerRead {
  /** The proposals the file holds, as data. Empty when the file is absent, empty, or cannot be read. */
  entries: Proposal[]
  /** Why the file cannot be read (several YAML documents, invalid YAML, a top level that is not what a ledger is). */
  problems: string[]
  exists: boolean
}

/** Who writes, and the trailers of the commit. `actor` is a member id (the resolved actor, never the request's word).
 *  `ident` authors and commits it (L5 spec §6.4: `commitIdent(actor)`, the house for a signed-in actor). */
export interface LedgerWho { actor: string; rule: string; change?: string; decision?: string; ident?: GitIdent }

export interface LedgerOptions {
  /** The clock; tests inject one. Default: `new Date()`. */
  now?: () => Date
  /** The branch the server started on: the trunk when `governance.trunk` says none (P2-R17). */
  startBranch?: string
  /** How the file is written. Tests pass one that fails. */
  write?: (path: string, text: string) => void
  /** Hosted mode (L5 spec §3): "Sync first" does not apply, the platform holds the trunk (`guardFetched`). */
  hosted?: boolean
  /** The reading the act is judged on (L5 spec §7.2), for an act under a role sourced from a hat or by a CAIP-10 actor
   *  (request.ts `hatActOf`, read before the lock). Written beside the act: an event's `as`, a closing's `closed.as`; Propose
   *  writes it as the entry's `opened_as`. Absent for every other act, whose ledger is 0.6's. */
  as?: HatAct
}

/** What a caller says about an event; the server adds `id`, `at` and `by` (§3.2: never from the request). */
export type EventDraft = { kind: string } & Record<string, unknown>

// ── reading ───────────────────────────────────────────────────────────────────────────────────────

/** The ledger as the file holds it now. Never throws for a file that is wrong: that is a problem, in words. */
export function readLedger(repo: string): LedgerRead {
  const path = join(repo, REL)
  if (!existsSync(path)) return { entries: [], problems: [], exists: false }
  return readLedgerText(readFileSync(path, 'utf8'))
}

function readLedgerText(text: string): LedgerRead {
  const docs = yamlDocuments(text)
  const problem = (message: string): LedgerRead => ({ entries: [], problems: [`${REL} ${message}`], exists: true })
  if (docs.length > 1) {
    return problem(`holds ${docs.length} YAML documents, separated by \`---\`, where the ledger is one: merge them into one by hand, then try again.`)
  }
  const [one] = docs
  if (!one) return { entries: [], problems: [], exists: true }
  if (one.error !== undefined) return problem(`is not valid YAML: ${one.error}`)
  const top = one.value
  if (top === null || top === undefined) return { entries: [], problems: [], exists: true }
  if (typeof top !== 'object' || Array.isArray(top)) return problem('is not a mapping of keys to values at its top level')
  const key = resolveTopKey(k => Object.hasOwn(top, k), registryDef(NAME))
  const block = (top as Record<string, unknown>)[key]
  if (block === null || block === undefined) return { entries: [], problems: [], exists: true }
  if (!Array.isArray(block)) return problem(`\`${key}:\` is not a list of proposals`)
  return { entries: block as Proposal[], problems: [], exists: true }
}

// ── the trunk (P2-R17) ────────────────────────────────────────────────────────────────────────────

/** The trunk: `governance.trunk` when the file writes one, else the branch the server started on, else the
 *  branch the repository is on now. Not checked here: `guardTrunk` checks it. */
export async function resolveTrunk(repo: string, startBranch?: string): Promise<string> {
  const written = readRuleContext(repo, { unknown: '' }).governance?.trunk
  if (typeof written === 'string' && written !== '') return written
  return startBranch ?? (await repoStatus(repo)).branch
}

const refuse = (status: 403 | 409, code: string, error: string): Refusal => new Refusal(status, { code, error })

/** The trunk is a name the platform can build refs from, git accepts it, and the repository is on it. */
export async function guardTrunk(repo: string, startBranch?: string): Promise<void> {
  const trunk = await resolveTrunk(repo, startBranch)
  const ok = validTrunkName(trunk)
  if (ok !== true) {
    throw refuse(409, 'TRUNK', `Not written: "${trunk}" cannot be the trunk: ${ok} Name another in data/governance.yaml (governance.trunk), or switch to a branch with an ordinary name.`)
  }
  if (!(await validBranchName(repo, trunk))) {
    throw refuse(409, 'TRUNK', `Not written: git does not accept "${trunk}" as a branch name, so it cannot be the trunk. Name another in data/governance.yaml (governance.trunk).`)
  }
  const { branch } = await repoStatus(repo)
  if (branch !== trunk) {
    throw refuse(409, 'OFF_TRUNK', `Not written: this repository is on the branch "${branch}", and decisions are recorded on the trunk, "${trunk}". Switch to ${trunk}, then try again.`)
  }
}

// ── the role book a proposal is judged by (L5 spec §7.3) ──────────────────────────────────────────

/** A proposal's role book from data already read: the roles of `governance`, members as data/members.yaml lists them, and
 *  roles sourced from a hat held by whoever the proposal's own observations (`observationsOf`) and `extra` say wears it.
 *  No network: what was read is what the ledger recorded. */
export function bookOf(governance: Record<string, unknown> | null, members: Record<string, unknown>[], proposal: Partial<Proposal> | null, extra: readonly HatObservation[] = []): RoleBook {
  return resolveRoles(governance, members, [...observationsOf(proposal), ...extra])
}

/** The role book proposal `proposal` is judged by now (L5 spec §7.3): data/governance.yaml's roles and data/members.yaml's
 *  members, the proposal's own observations, and `extra` (for an act judged now, the actor's fresh reading:
 *  `actObservations`, `readingObservations`). Every site that judges a proposal builds its book here. */
export function bookFor(repo: string, proposal: Partial<Proposal> | null, extra: readonly HatObservation[] = []): RoleBook {
  const ctx = readRuleContext(repo, { unknown: '' })
  return bookOf(ctx.governance, ctx.members ?? [], proposal, extra)
}

/** What an act being judged now adds to its proposal's observations (§7.3): its own reading and, from a complete wearer
 *  list, who of those the proposal observed does not wear the hat. None for an act under no hat. */
export function actObservations(proposal: Partial<Proposal> | null, act: HatAct | undefined): HatObservation[] {
  if (!act) return []
  return observationsOf({ ...(proposal ?? {}), events: [...(proposal?.events ?? []), { as: act }] })
}

// ── what the evaluator would ignore (spec §3.2) ───────────────────────────────────────────────────

/** A sentence when `kind` written now by `actor` would not be counted, else null. Permission is the machine's
 *  guards' business; this is only about time. A comment is still written after the expiry: it is how a person is heard. */
function ignoredBecause(kind: string, entry: Proposal, actor: string, book: RoleBook, now: Date): string | null {
  if (!['approve', 'object', 'vote'].includes(kind)) return null
  const rules = entry.rules.filter(r => decidersOf(r, book).includes(actor))
  if (rules.length === 0) return null
  const timing = rules.map(rule => timingOf({ rule, proposal: entry, now }))
  if (timing.every(t => t.nowMs >= t.expiry)) {
    const ran = new Date(Math.max(...timing.map(t => t.expiry))).toISOString().replace(/\.\d{3}Z$/, 'Z')
    return `This proposal's time ran out on ${ran}, so an event written now would be ignored. Close it as expired, or revise it to start the clock again.`
  }
  if (kind === 'vote') {
    const voting = rules.filter(r => methodOf(r) === 'vote')
    if (voting.length > 0 && voting.every(rule => ballotsClosed({ rule, proposal: entry, book, now }))) {
      return 'Voting on this proposal has closed, so a vote written now would not be counted.'
    }
  }
  return null
}

/** Refuses when the server's clock is behind the newest event of the ledger by more than CLOCK_SKEW. */
export function guardClock(entries: Proposal[], now: Date): void {
  const newest = Math.max(-Infinity, ...entries.flatMap(e => (e.events ?? []).map(ev => instant(ev.at))).filter(n => !Number.isNaN(n)))
  if (newest !== -Infinity && now.getTime() < newest - CLOCK_SKEW_MS) {
    throw refuse(409, 'CLOCK', `Not written: this server's clock is ${inWords(newest - now.getTime())} behind the newest event in the ledger. Fix the clock and try again, so that no decision can be back-dated.`)
  }
}

// ── text ──────────────────────────────────────────────────────────────────────────────────────────

const seconds = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** The text with `event` added to the end of proposal `id`'s `events`: one flow-style line, every other byte as it was. */
function appendedEventText(src: string, id: string, event: LedgerEvent): string {
  const doc = parseDocument(src)
  const entries = collectionSeq(doc, NAME)
  const { index, item } = findEntity(entries, id)
  const events = item.get('events', true)
  const current = item.toJS(doc) as Record<string, unknown>
  const entity = { ...current, events: [...(Array.isArray(current.events) ? current.events : []), event] }
  /** @type {string | null} */
  let text: string | null = null
  if (isSeq(events) && !events.flow && events.items.length > 0) text = spliceAppendFlow(src, events as YAMLSeq, event)
  else if (isSeq(events) && events.flow && events.items.length === 0 && events.range) text = replacedEmptyEvents(src, item, events.range, event)
  if (text === null) return updatedText(src, NAME, id, entity) // a layout the splice does not know: the reviewed whole-key update
  const crlf = src.includes('\r\n') && !/(^|[^\r])\n/.test(src)
  if (crlf) text = text.replace(/\r?\n/g, '\r\n')
  const wrong = whyNot(src, text, NAME, { kind: 'update', index, entity })
  if (wrong) {
    throw new HttpError(409, `Not saved: writing this event to ${REL} would also have changed something that was not asked for (${wrong.what}). Nothing was written. Make this edit in the file by hand.`)
  }
  return text
}

/** `events: []` turned into a block list of one flow-style line: only that key's lines change. */
function replacedEmptyEvents(src: string, item: YAMLMap, range: [number, number, number], event: LedgerEvent): string | null {
  const pair = item.items.find(p => String((p.key as { value?: unknown })?.value ?? p.key) === 'events')
  const keyRange = (pair?.key as { range?: [number, number, number] } | undefined)?.range
  if (!keyRange) return null
  const lineStart = src.lastIndexOf('\n', keyRange[0] - 1) + 1
  const before = src.slice(lineStart, keyRange[0])
  if (before.trim() !== '') return null // another key shares the line
  const eol = src.indexOf('\n', range[1])
  const rest = src.slice(range[1], eol < 0 ? src.length : eol).trim()
  const head = src.slice(0, range[0]).replace(/[ \t]+$/, '')
  const comment = rest.startsWith('#') ? ` ${rest}` : rest === '' ? '' : null
  if (comment === null) return null
  return `${head}${comment}\n${' '.repeat(before.length + 2)}- ${flowText(event)}${eol < 0 ? '' : src.slice(eol)}`
}

/** The ledger text with proposal `id` closed in it: `fields` set (a closing's `state` and `closed`) and `event` appended,
 *  every other byte kept, through the same splices and exact-write checks as a write. Pure text: ratify computes it from
 *  the tree-to-be before anything is written (spec §3.8 step 3). */
export function closedLedgerText(src: string, id: string, fields: Record<string, unknown>, event: LedgerEvent): string {
  const entry = entriesFromText(src, NAME).find(e => String(e.id) === id)
  if (!entry) throw new HttpError(404, `The ledger has no proposal ${id}.`)
  for (const key of Object.keys(fields)) {
    if (!CHANGEABLE.includes(key)) throw new HttpError(400, `\`${key}\` is not a field a write may change on a proposal (they are ${CHANGEABLE.join(', ')}).`)
  }
  return appendedEventText(updatedText(src, NAME, id, { ...entry, ...fields }), id, event)
}

// ── the one write ─────────────────────────────────────────────────────────────────────────────────

/** The fields an update may change. `id`, `author`, `opened`, `rules` (the snapshot) and `events` are not among them. */
const CHANGEABLE = ['state', 'closed', 'base', 'branch', 'ops', 'rev', 'touched', 'title', 'rationale', 'statement', 'classes']
const FINAL_STATES = PROPOSAL_STATES.filter(s => s !== 'open')

/** Problems of the proposal `id` in `text`, as a 422 with its fields; or nothing. */
function refuseIfInvalid(repo: string, text: string, id: string): void {
  const entries = entriesFromText(text, NAME) as unknown as Proposal[]
  const mine = entries.find(e => String(e.id) === id)
  const errors: { field: string; message: string }[] = []
  // The cross-checks speak in words ("an objection needs its text"); the schema's own sentences come after them.
  const ctx = readRuleContext(repo, { unknown: '' })
  const systems = existsSync(join(repo, 'data', 'systems.yaml')) ? (readRegistry(repo, 'systems').entries ?? null) : []
  for (const p of checkProposals(entries, {
    members: ctx.members ?? null, governance: ctx.governance, systems, classes: CHANGE_CLASSES, classOf: registry => classOf({ registry }),
  })) if (p.id === id) errors.push({ field: p.path, message: p.message })
  if (mine) {
    for (const p of validateEntry(NAME, mine)) if (p.level === 'error') errors.push({ field: p.path, message: p.message })
  }
  if (errors.length > 0) {
    throw Object.assign(new HttpError(422, `Not written: the ledger would not hold a valid proposal ${id}. Nothing was written.`), { errors })
  }
}

const listed = (what: string, err: unknown) => `${what} (${(err instanceof Error ? err.message : String(err)).trim().split('\n')[0]})`

/** Write `text` over the ledger and commit it; on any failure put the bytes back, and the index with them. */
async function commitLedger(repo: string, before: Buffer | null, text: string, message: string, trailers: TrailerValues, write?: LedgerOptions['write'], ident?: GitIdent): Promise<string> {
  const path = join(repo, REL)
  let step: 'write' | 'commit' = 'write'
  try {
    ;(write ?? ((p: string, t: string) => writeFileSync(p, t)))(path, text)
    step = 'commit'
    return await commitDataPaths(repo, [REL], message, trailers, { ident })
  } catch (err) {
    let lost = false
    try { if (before) writeFileSync(path, before); else rmSync(path, { force: true }) } catch { lost = true }
    let staged = ''
    await restageDataPaths(repo, [REL]).catch(() => { staged = ' The git index may still hold the refused change: run `git status` in the repository.' })
    const why = step === 'commit' ? `git refused the commit to ${REL}` : `${REL} could not be written`
    throw new HttpError(503,
      `Not saved: ${listed(why, err)}. ${lost ? `${REL} could not be put back: \`git diff HEAD -- ${REL}\` shows what it holds now.` : `Nothing was changed in ${REL}.`} ` +
      `If another git command was running in this repository, try again; if a commit hook refused it, the reason above is the hook's.${staged}`)
  }
}

/** Everything every write checks, in order, then the text `make` builds from the file as it is, validated, written, committed. */
async function write(repo: string, id: string, who: LedgerWho, opts: LedgerOptions, subject: string,
  make: (src: string, now: Date, entries: Proposal[]) => string): Promise<{ commit: string; text: string }> {
  const now = (opts.now ?? (() => new Date()))()
  await guardTrunk(repo, opts.startBranch)
  await guardFiles(repo, [REL])
  const read = readLedger(repo)
  if (read.problems.length > 0) throw refuse(409, 'LEDGER', `Not written: ${read.problems[0]}`)
  guardClock(read.entries, now)
  const path = join(repo, REL)
  const before = existsSync(path) ? readFileSync(path) : null
  const text = make(before ? before.toString('utf8') : `${registryDef(NAME).topKey}: []\n`, now, read.entries)
  refuseIfInvalid(repo, text, id)
  // Nothing stricter than members enters git (L5 spec §10.5): a ledger op on private data is a placeholder, or nothing. Only
  // what this write adds is refused; a legacy op already in the ledger is Task 16's to narrow (R-L5-15.10).
  assertGitSafe(repo, [{ path: REL, text }], readConfig(repo), before ? [{ path: REL, text: before.toString('utf8') }] : [])
  const commit = await commitLedger(repo, before, text, subject, { actor: who.actor, change: who.change, rule: who.rule, proposal: id, decision: who.decision }, opts.write, who.ident)
  return { commit, text }
}

/** The event to write: the caller's content with the server's `id`, `at` and `by`, and the reading it was judged on
 *  (`as`, L5 spec §7.2) when there is one. A caller's own `id`, `at`, `by` or `as` is dropped. */
function eventFor(draft: EventDraft, who: LedgerWho, now: Date, taken: ReadonlySet<string>, as?: HatAct): LedgerEvent {
  const { id: _id, at: _at, by: _by, as: _as, ...content } = draft
  // Two events written in the same millisecond (a test's fixed clock) must not share an id: draw again.
  let id = eventId(now)
  for (let tries = 0; taken.has(id) && tries < 1000; tries++) id = eventId(now)
  return { id, at: seconds(now), by: who.actor, ...content, ...(as ? { as } : {}) } as LedgerEvent
}

/** Open a proposal: the entry, appended to the ledger (the file is created with its top key at the first one). */
export async function createEntry(repo: string, entry: Record<string, unknown>, who: LedgerWho, opts: LedgerOptions = {}): Promise<{ commit: string }> {
  const id = String(entry.id)
  const { commit } = await write(repo, id, who, opts, `proposals: open ${id} — ${String(entry.title ?? '')}`.trimEnd(),
    src => createdText(src, NAME, entry))
  return { commit }
}

/** Add one event to a proposal: one line, one commit. */
export async function appendEvent(repo: string, id: string, draft: EventDraft, who: LedgerWho, opts: LedgerOptions = {}): Promise<{ commit: string; event: LedgerEvent }> {
  return updateEntry(repo, id, { event: draft }, who, opts)
}

/** Change fields of a proposal (a replay's `base`, a revise's `ops` and `rev`, a closing's `state` and `closed`) and
 *  add the event that says why, in one commit. The act's reading (`opts.as`) goes on the event, or, for a closing, on
 *  `closed.as` (L5 spec §7.2); the event is judged with it (§7.3). */
export async function updateEntry(repo: string, id: string, change: { fields?: Record<string, unknown>; event: EventDraft }, who: LedgerWho, opts: LedgerOptions = {}): Promise<{ commit: string; event: LedgerEvent }> {
  const closing = change.fields?.closed !== null && typeof change.fields?.closed === 'object'
  const fields = closing && opts.as ? { ...change.fields, closed: { ...(change.fields!.closed as Record<string, unknown>), as: opts.as } } : change.fields ?? {}
  for (const key of Object.keys(fields)) {
    if (!CHANGEABLE.includes(key)) throw new HttpError(400, `\`${key}\` is not a field a write may change on a proposal (they are ${CHANGEABLE.join(', ')}).`)
  }
  let written: LedgerEvent | undefined
  const { commit } = await write(repo, id, who, opts, `proposals: ${change.event.kind} ${id}`, (src, now, entries) => {
    const entry = entries.find(e => String(e.id) === id)
    if (!entry) throw new HttpError(404, `The ledger has no proposal ${id}.`)
    const book = bookFor(repo, entry, actObservations(entry, opts.as))
    const ignored = ignoredBecause(change.event.kind, entry, who.actor, book, now)
    if (ignored) throw refuse(409, 'IGNORED', `Not written: ${ignored}`)
    written = eventFor(change.event, who, now, new Set((entry.events ?? []).map(e => e.id)), closing ? undefined : opts.as)
    const moved = Object.keys(fields).length > 0 ? updatedText(src, NAME, id, { ...(entry as unknown as Record<string, unknown>), ...fields }) : src
    return appendedEventText(moved, id, written)
  })
  return { commit, event: written as LedgerEvent }
}

/** Close a proposal: the final `state`, `closed`, and the closing event, in one commit (spec §3.8). */
export async function setState(repo: string, id: string,
  closing: { state: string; closed: { at: string; by: string; decision?: string | null; as?: HatAct }; event: EventDraft }, who: LedgerWho, opts: LedgerOptions = {}): Promise<{ commit: string; event: LedgerEvent }> {
  if (!FINAL_STATES.includes(closing.state) || closing.closed === null || typeof closing.closed !== 'object') {
    throw new HttpError(400, `A closing sets \`state\` to one of ${FINAL_STATES.join(', ')} and \`closed\` to when, by whom and which decision.`)
  }
  return updateEntry(repo, id, { fields: { state: closing.state, closed: closing.closed }, event: closing.event }, who, opts)
}

