// packages/admin/lib/proposals.mjs
//
// The proposals ledger (0.6 P2 spec §3.1, §3.2): ids, the `rev` of a set of ops, the live set of
// events, the label a proposal wears while it is open, the check of `data/proposals.yaml`, and
// `eventPermission`, the one place the table of who may write which event is written. Plain data in,
// plain data out: no I/O and no node:* import, so the server, the root validator and the client run
// the same functions.

import { isMap } from './yaml-util.mjs'
import { checkGovernance, mayPropose } from './rules.mjs'
import { parseRecord } from './ops.mjs'
import { judgedOps } from './receipts.mjs'
import { sha256Hex } from './sha256.mjs'
import { parseCaip10 } from './caip.mjs'
import { actorIdOf, standing } from './hat-readings.mjs'

/** @typedef {import('./rules.mjs').Rule} Rule */
/** @typedef {import('./rules.mjs').RoleBook} RoleBook */
/** @typedef {import('./rules.mjs').Problem} Problem */
/** @typedef {import('./ops.mjs').StageOp} StageOp */
/** @typedef {import('./hat-readings.mjs').HatObservation} HatObservation */
/** @typedef {{ id: string, at: string, by: string, kind: string, rev?: string, text?: string, vote?: string, of?: string, answered?: boolean, [key: string]: unknown }} LedgerEvent */
/** @typedef {{ id: string, title: string, author: string, classes: string[], rules: Rule[], state: string, opened: string, rev: string, ops: (StageOp & { base?: string | null })[], events: LedgerEvent[], closed?: unknown, [key: string]: unknown }} Proposal */

/** The five stored states (architecture §4.4). The open sub-states are derived on read. */
export const PROPOSAL_STATES = Object.freeze(['open', 'ratified', 'rejected', 'withdrawn', 'expired'])

/** Every kind of event the ledger holds (§3.2), the closing ones last. */
export const EVENT_KINDS = Object.freeze(['approve', 'object', 'vote', 'comment', 'retract', 'revise', 'replay', 'attach', 'system', 'withdraw', 'reject', 'expire', 'ratify'])

/** How far an event's `at` may lie from the commit that adds it (P2-R30): PT10M. One constant. */
export const CLOCK_SKEW_MS = 10 * 60e3

/** A proposal id: `p-<date>-<NNN>-<4 hex>` as minted since the final review (I5), or `p-<date>-<NNN>` as minted before it;
 *  the ledger's schema accepts both, the server mints the first only. */
const PROPOSAL_ID = /^p-(\d{4}-\d{2}-\d{2})-(\d{3})(?:-[0-9a-f]{4})?$/

/** The next proposal id for a day: the day's counter, one past the highest already used that day (so a counter is never
 *  reissued), then 4 lowercase hex of a random draw, so two clones that each open the day's first proposal before either
 *  has fetched the other's do not mint the same id (final review I5). Drawn again on a clash within the ledger, as event
 *  ids are (the counter already makes one unlikely). `random` is injectable for tests.
 *  @param {string | Date} date a `YYYY-MM-DD`, an ISO timestamp (its first ten characters), or a Date (UTC day)
 *  @param {readonly (string | { id?: unknown })[]} existing ids, or entries carrying one
 *  @param {() => number} [random]
 *  @returns {string} */
export function proposalId(date, existing, random = Math.random) {
  const day = (date instanceof Date ? date.toISOString() : String(date)).slice(0, 10)
  let highest = 0
  const taken = new Set()
  for (const item of existing) {
    const id = typeof item === 'string' ? item : String(item?.id ?? '')
    taken.add(id)
    const m = PROPOSAL_ID.exec(id)
    if (m && m[1] === day) highest = Math.max(highest, Number(m[2]))
  }
  const counter = String(highest + 1).padStart(3, '0')
  const draw = () => `p-${day}-${counter}-${Math.min(0xffff, Math.floor(random() * 0x10000)).toString(16).padStart(4, '0')}`
  let id = draw()
  for (let tries = 0; taken.has(id) && tries < 1000; tries++) id = draw()
  return id
}

/** `e-<time in base 36>-<2 hex of a random>`: unique without a counter, so two members appending at
 *  once cannot collide (§3.2). `random` is injectable for tests.
 *  @param {number | Date} at @param {() => number} [random] @returns {string} */
export function eventId(at, random = Math.random) {
  const ms = at instanceof Date ? at.getTime() : at
  const tag = Math.min(255, Math.floor(random() * 256)).toString(16).padStart(2, '0')
  return `e-${ms.toString(36)}-${tag}`
}

/** JSON with the keys sorted at every depth: what `rev` hashes, and what a private placeholder's digest is taken over
 *  (DAO-OS L5 spec §9.6). @param {unknown} value @returns {string} */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(v => canonicalJson(v === undefined ? null : v)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter(k => /** @type {Record<string, unknown>} */ (value)[k] !== undefined).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(/** @type {Record<string, unknown>} */ (value)[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** The `rev` of a set of ops: the first 12 hex of the sha-256 of their canonical JSON without `base`
 *  and `before` (P2-R7). Re-basing never changes it; editing the content always does. A private placeholder
 *  (`{ op: private, ref, class, digest }`, DAO-OS L5 spec §9.6) is covered as git holds it, so approvals bind to it.
 *  @param {readonly Record<string, unknown>[]} ops @returns {string} */
export function revOf(ops) {
  const content = ops.map(op => { const { base: _base, before: _before, ...rest } = op; return rest })
  return sha256Hex(canonicalJson(content)).slice(0, 12)
}

/** An ISO timestamp (or Date) as milliseconds; NaN when it is not a time. @param {unknown} at @returns {number} */
export function instant(at) {
  if (at instanceof Date) return at.getTime()
  return typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(at) ? Date.parse(at) : NaN
}

/**
 * What the evaluator reads (§3.2 "The live set"): the events not named by a `retract`, in order (`at`
 * as an instant, then id); an `approve` or `vote` only if it carries the proposal's current `rev`; an
 * objection of an older `rev` is kept and marked `answered`, so it no longer blocks. Comments, and the
 * `retract` events themselves, stay. Copies: the ledger's own data is never marked.
 * @param {Pick<Proposal, 'rev' | 'events'>} proposal @returns {LedgerEvent[]}
 */
export function liveEvents(proposal) {
  const events = Array.isArray(proposal.events) ? proposal.events : []
  const taken = new Set(events.filter(e => e.kind === 'retract' && typeof e.of === 'string').map(e => e.of))
  return events
    .filter(e => !taken.has(e.id))
    .filter(e => (e.kind !== 'approve' && e.kind !== 'vote') || e.rev === proposal.rev)
    .map(e => (e.kind === 'object' && e.rev !== proposal.rev ? { ...e, answered: true } : { ...e }))
    .sort((a, b) => (instant(a.at) - instant(b.at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** The method of a rule, `by: system` meaning method system as `normalise` reads it. @param {Partial<Rule>} rule */
export const methodOf = rule => rule.decide?.method ?? (rule.decide?.by === 'system' ? 'system' : undefined)

/** The lead rule's method of a proposal with several rules (§3.3): the most demanding, in the order
 *  vote, consent, system, approve, direct. Null with no rule.
 *  @param {readonly Partial<Rule>[]} rules @returns {string | null} */
export function leadMethod(rules) {
  const methods = rules.map(methodOf)
  return ['vote', 'consent', 'system', 'approve', 'direct'].find(m => methods.includes(m)) ?? null
}

/** What a proposal is called on screen: its stored state once closed, else `stale`, or the lead rule's
 *  label (`voting`, `objecting`, `approving`). Never stored (§3.3).
 *  @param {Pick<Proposal, 'state' | 'rules'>} proposal @param {{ stale?: boolean }} [reading]
 *  @returns {'stale' | 'objecting' | 'voting' | 'approving' | 'ratified' | 'rejected' | 'withdrawn' | 'expired'} */
export function derivedState(proposal, reading = {}) {
  if (proposal.state !== 'open') return /** @type {never} */ (proposal.state)
  if (reading.stale === true) return 'stale'
  const lead = leadMethod(proposal.rules ?? [])
  return lead === 'vote' ? 'voting' : lead === 'consent' ? 'objecting' : 'approving'
}

// ---------------------------------------------------------------------------
// eventPermission: §3.2's table, written once
// ---------------------------------------------------------------------------

/** The people who decide under `rule`: its role's members, persons only. @param {Partial<Rule>} rule @param {RoleBook} book @returns {string[]} */
export function decidersOf(rule, book) {
  if (methodOf(rule) === 'system' || rule.decide?.by === 'system') return []
  const role = book.roles.get(rule.decide?.by ?? '')
  return role ? role.members.filter(m => !book.agents.has(m) && !book.organizations.has(m)) : []
}

/** `the maintainer role`, `the maintainer or board role`: the roles that decide. @param {readonly Partial<Rule>[]} rules */
function rolesPhrase(rules) {
  const roles = [...new Set(rules.filter(r => methodOf(r) !== 'system' && r.decide?.by !== 'system').map(r => r.decide?.by).filter(Boolean))]
  return roles.length === 0 ? null : `the ${roles.join(' or ')} role`
}

/** @param {string} actor @param {{ known?: readonly string[] | ReadonlySet<string> }} ctx @returns {string | null} */
function notKnown(actor, ctx) {
  if (ctx.known === undefined) return null
  const known = ctx.known instanceof Set ? ctx.known : new Set(ctx.known)
  return known.has(actor) ? null : `"${actor}" is not a member of this org, so cannot write to its proposals.`
}

/**
 * Who may write to a proposal at all, the `known` that `eventPermission` is given (DAO-OS L5 spec §6.3, §7.3): every
 * member of data/members.yaml, and every actor that a standing observation of the proposal (and of the act being judged)
 * says wears a hat, as `actorIdOf` names it: a member id, or the CAIP-10 id of an address no member lists. An address
 * known only from a reading is a member of the DAO because it wears its hat (L5 spec §5.3), with no record to show.
 * @param {readonly Record<string, unknown>[]} members @param {readonly HatObservation[]} [observations] @returns {string[]}
 */
export function knownIds(members, observations = []) {
  const entries = (Array.isArray(members) ? members : []).filter(m => isMap(m) && m.id !== undefined && m.id !== null && m.id !== '')
  const ids = entries.map(m => String(m.id))
  for (const o of standing(observations).values()) if (o.wears) ids.push(actorIdOf(o.account, /** @type {Record<string, unknown>[]} */ (entries)))
  return [...new Set(ids)]
}

/** The kinds that decide (an author's own acts are the others that name a role). */
const DECIDING = ['approve', 'object', 'vote']
/** The author's acts: judged by the roles that propose under the rules. */
const AUTHORS = ['open', 'revise', 'replay', 'withdraw', 'attach']

/**
 * The hats an act of `kind` on a proposal with `rules` may be made under (DAO-OS L5 spec §7.2), in the order they are
 * asked: the hats of the roles sourced from a hat that decide it (`decide.by`) for an approval, objection or vote; of the
 * roles that propose under it (`propose`) for the author's acts (`open`, `revise`, `replay`, `withdraw`, `attach`); both,
 * deciding first, for the rest (a comment, a retract, a closing). Hats exactly (C-6). A rule decided by a system names no
 * deciding role.
 * @param {readonly Partial<Rule>[]} rules @param {RoleBook} book @param {string} kind @returns {string[]}
 */
export function actHats(rules, book, kind) {
  const decide = rules.filter(r => methodOf(r) !== 'system' && r.decide?.by !== 'system').map(r => r.decide?.by)
  const propose = rules.map(r => r.propose)
  const roles = DECIDING.includes(kind) ? decide : AUTHORS.includes(kind) ? propose : [...decide, ...propose]
  /** @type {string[]} */
  const hats = []
  for (const id of roles) {
    const hat = typeof id === 'string' ? book.roles.get(id)?.hat : undefined
    if (hat && !hats.includes(hat)) hats.push(hat)
  }
  return hats
}

/**
 * Null when `actor` may write an event of `kind` to `proposal`, else the sentence that says why not. It
 * is the one place §3.2's table is written: the machine's guards, the routes and the validator all
 * call it. `rules` is the proposal's **rule snapshot**, the whole array as the ledger stores it, never
 * one rule of it. For `approve` it is the contract of spec §3.2: allowed when the actor is a decider of
 * some rule of the snapshot, and, if the actor is the author, only when a rule that names them in `by`
 * sets `self_approve`. Whether the approval then counts, and toward which rule, is the evaluator's.
 * `known` lists the member ids (when given, an actor outside it may write nothing); `of` is the id
 * a `retract` takes back.
 * @param {string} kind
 * @param {{ actor: string, proposal: Pick<Proposal, 'author' | 'events'>, rules: readonly Partial<Rule>[], book: RoleBook,
 *   known?: readonly string[] | ReadonlySet<string>, of?: string }} ctx
 * @returns {string | null}
 */
export function eventPermission(kind, ctx) {
  const { actor, proposal, rules, book } = ctx
  if (!EVENT_KINDS.includes(kind)) return `"${kind}" is not a kind of event a proposal takes (${EVENT_KINDS.join(', ')}).`
  const isAuthor = actor === proposal.author
  const namedIn = rules.filter(r => decidersOf(r, book).includes(actor))
  const roles = rolesPhrase(rules)
  const notDecider = () => book.agents.has(actor)
    ? `"${actor}" is an agent, and an agent never decides.`
    : roles === null
      ? `"${actor}" cannot decide this proposal: it is decided by a system, not by people.`
      : `"${actor}" does not hold ${roles}, which decides this proposal.`
  const unknown = notKnown(actor, ctx)

  switch (kind) {
    case 'approve': {
      if (namedIn.length === 0) return notDecider()
      if (isAuthor && !namedIn.some(r => /** @type {{ self_approve?: boolean }} */ (r).self_approve === true)) {
        return `"${actor}" wrote this proposal and cannot approve their own proposal: an approval is a review, and no rule it was opened under lets the author approve (self_approve).`
      }
      return null
    }
    case 'object':
    case 'vote':
      return namedIn.length === 0 ? notDecider() : null
    case 'comment':
      return unknown
    case 'retract': {
      if (unknown) return unknown
      if (!ctx.of) return 'a retract names no event: say which one to take back.'
      const target = (proposal.events ?? []).find(e => e.id === ctx.of)
      if (!target) return `this proposal has no event "${ctx.of}" to take back.`
      if (target.kind === 'retract') return `"${ctx.of}" is itself a retract and cannot be taken back: write the event again.`
      return target.by === actor ? null : `only the person who wrote an event can take it back; "${ctx.of}" was written by "${target.by}".`
    }
    case 'revise':
    case 'withdraw':
      return isAuthor ? null : `only the author of a proposal can ${kind} it; this one is "${proposal.author}"'s.`
    case 'attach': {
      if (unknown) return unknown
      // An attach binds a transaction for a `system` rule (§3.11): with none in the snapshot there is nothing to bind.
      if (!rules.some(r => methodOf(r) === 'system')) return 'this proposal waits on no outside system, so there is nothing to attach: people decide it.'
      const answers = rules.map(r => mayPropose(/** @type {Rule} */ (r), actor, book))
      return answers.includes(true) ? null : String(answers[0] ?? `"${actor}" may not attach to a proposal no rule is held under.`)
    }
    case 'system':
      return actor.startsWith('system:') ? null : 'only the server writes a system event, from an outside system it read.'
    case 'replay':
      return actor.startsWith('system:') ? null : unknown
    default: { // ratify, reject, expire: a person's act (P2-R3)
      if (unknown) return unknown
      if (book.agents.has(actor)) return `"${actor}" is an agent, and an agent never decides.`
      return isAuthor || namedIn.length > 0 ? null : `only the author or one of the people who decide this proposal can ${kind} it.`
    }
  }
}

// ---------------------------------------------------------------------------
// checkProposals: data/proposals.yaml, entry by entry
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ProposalsContext what the check may know; each part left null or undefined skips the checks that need it
 * @property {Record<string, unknown>[] | null} [members] the entries of data/members.yaml
 * @property {Record<string, unknown> | null} [governance] the governance block (its roles)
 * @property {Record<string, unknown>[] | null} [systems] the entries of data/systems.yaml
 * @property {readonly string[] | null} [classes] the change classes
 * @property {(registry: string) => string} [classOf] the class of a registry's records
 */

/** What a ledger written by an address must carry (DAO-OS L5 spec §7.2): the hat it was read wearing. */
export const BY_ADDRESS = 'an event by an address carries the hat it was read wearing (`as`)'
export const OPENED_BY_ADDRESS = 'a proposal opened by an address carries the hat it was read wearing (`opened_as`)'
export const CLOSED_BY_ADDRESS = 'a closing by an address carries the hat it was read wearing (`closed.as`)'
/** The events that close a proposal: their reading is on `closed.as`. */
const CLOSING_KINDS = ['withdraw', 'reject', 'expire', 'ratify']
/** Whether `value` is a CAIP-10 id: an actor that is an address, not a member id. @param {unknown} value */
const isAddress = value => parseCaip10(value) !== null

/**
 * The problems of the ledger's entries: shapes the JSON schema cannot say (§3.1, §3.2). Errors only;
 * each carries the proposal's id and a path (`events.<id>`). It does not judge time or the rules'
 * outcome: that is `validate:governance`'s, which replays the history.
 * @param {unknown} entries @param {ProposalsContext} [ctx] @returns {Problem[]}
 */
export function checkProposals(entries, ctx = {}) {
  /** @type {Problem[]} */
  const out = []
  if (!Array.isArray(entries)) return [{ file: '', path: '', level: 'error', message: '`proposals:` is not a list of proposals' }]
  const memberIds = ctx.members ? new Set(ctx.members.filter(m => isMap(m) && m.id !== undefined && m.id !== null).map(m => String(m.id))) : null
  const systemIds = ctx.systems ? new Set(ctx.systems.filter(s => isMap(s)).map(s => String(s.id))) : null
  const seen = new Set()

  entries.forEach((entry, index) => {
    if (!isMap(entry)) { out.push({ file: '', id: `#${index + 1}`, path: '', level: 'error', message: 'this proposal is not a mapping of fields to values' }); return }
    const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : `#${index + 1}`
    /** @param {string} path @param {string} message */
    const bad = (path, message) => out.push({ file: '', id, path, level: 'error', message })

    if (seen.has(id)) bad('id', `id "${id}" is used twice; each proposal needs its own`)
    seen.add(id)

    const state = entry.state
    if (typeof state !== 'string' || !PROPOSAL_STATES.includes(state)) {
      bad('state', `state ${typeof state === 'string' ? `"${state}"` : '(none)'} is not one of ${PROPOSAL_STATES.join(', ')}`)
    } else if (state !== 'open' && !isMap(entry.closed)) bad('closed', `this proposal is ${state} but has no \`closed\` (when, by whom, which decision)`)
    else if (state === 'open' && isMap(entry.closed)) bad('closed', 'this proposal is open but carries `closed`')

    // An address acts without a member record, on the hat it was read wearing (DAO-OS L5 spec §6.3, §7.2).
    if (isAddress(entry.author)) {
      if (!isMap(entry.opened_as)) bad('opened_as', OPENED_BY_ADDRESS)
    } else if (memberIds && typeof entry.author === 'string' && !memberIds.has(entry.author)) bad('author', `author "${entry.author}" is not a member in data/members.yaml`)
    const closedBy = isMap(entry.closed) ? entry.closed : null
    if (closedBy && isAddress(closedBy.by) && !isMap(closedBy.as)) bad('closed', CLOSED_BY_ADDRESS)

    // The rules it was opened under, against the rule shape.
    if (!Array.isArray(entry.rules) || entry.rules.length === 0) bad('rules', 'this proposal holds no rules: it records the rules it was opened under')
    else if (ctx.governance) {
      const found = checkGovernance({ roles: ctx.governance.roles, rules: entry.rules }, { members: ctx.members ?? null, systems: ctx.systems ?? null, classes: ctx.classes ?? null })
      for (const p of found) if (p.level === 'error' && !p.path.startsWith('roles')) bad(p.path, p.message)
    }

    // The classes must cover the ops it is judged by: a library receipt rides along (L1-C5).
    const ops = Array.isArray(entry.ops) ? entry.ops : []
    if (ctx.classOf) {
      const classes = Array.isArray(entry.classes) ? entry.classes : []
      for (const op of judgedOps(ops.filter(op => isMap(op) && typeof op.record === 'string'))) {
        try {
          const cls = ctx.classOf(parseRecord(op.record).registry)
          if (!classes.includes(cls)) bad('classes', `op on ${op.record} is class ${cls}, which \`classes\` does not list`)
        } catch (err) { bad('ops', `op on ${op.record}: ${err instanceof Error ? err.message : String(err)}`) }
      }
      // A private placeholder (DAO-OS L5 spec §9.6) carries the class its ops are judged under: `classes` lists it too.
      for (const op of ops) {
        if (!isMap(op) || op.op !== 'private' || typeof op.class !== 'string') continue
        if (!classes.includes(op.class)) bad('classes', `the private op ${String(op.ref)} is class ${op.class}, which \`classes\` does not list`)
      }
    }

    // The events.
    const events = Array.isArray(entry.events) ? entry.events : []
    const ids = new Set(events.filter(e => isMap(e) && typeof e.id === 'string').map(e => String(e.id)))
    const used = new Set()
    events.forEach((e, at) => {
      if (!isMap(e)) { bad(`events.#${at + 1}`, `event #${at + 1} is not a mapping of fields to values`); return }
      const eid = typeof e.id === 'string' && e.id !== '' ? e.id : `#${at + 1}`
      const path = `events.${eid}`
      /** @param {string} message */
      const wrong = message => bad(path, `event ${eid}: ${message}`)
      if (used.has(eid)) bad(path, `event id "${eid}" is used twice in this proposal`)
      used.add(eid)
      const kind = e.kind
      if (typeof kind !== 'string' || !EVENT_KINDS.includes(kind)) { wrong(`kind ${JSON.stringify(kind ?? null)} is not one of ${EVENT_KINDS.join(', ')}`); return }
      if (Number.isNaN(instant(e.at))) wrong(`${JSON.stringify(e.at ?? null)} is not a time (\`at\` is an ISO 8601 timestamp)`)
      const by = typeof e.by === 'string' ? e.by : ''
      if (kind === 'system') {
        if (!by.startsWith('system:')) wrong('a system event is written by system:<id>, never by a person')
        else if (systemIds && !systemIds.has(by.slice('system:'.length))) wrong(`no system "${by.slice('system:'.length)}" in data/systems.yaml`)
      } else if (isAddress(by)) {
        // A closing's reading is the closing's (`closed.as`), when that closing is this address's; every other event
        // carries its own.
        if (!isMap(e.as) && !(CLOSING_KINDS.includes(kind) && closedBy?.by === by && isMap(closedBy?.as))) wrong(BY_ADDRESS)
      } else if (memberIds && !(kind === 'replay' && by.startsWith('system:')) && !memberIds.has(by)) wrong(`"${by}" is not a member in data/members.yaml`)
      if (['approve', 'object', 'vote'].includes(kind) && typeof e.rev !== 'string') wrong(`${kind === 'object' ? 'an objection' : kind === 'vote' ? 'a vote' : 'an approval'} names the \`rev\` it is about`)
      if (kind === 'object' && (typeof e.text !== 'string' || e.text.trim() === '')) wrong('an objection needs its text: the argument that the proposal harms the aim')
      if (kind === 'comment' && (typeof e.text !== 'string' || e.text.trim() === '')) wrong('a comment needs its text')
      if (kind === 'vote' && !['yes', 'no', 'abstain'].includes(String(e.vote))) wrong('a vote is yes, no or abstain')
      if (kind === 'retract') {
        if (typeof e.of !== 'string' || e.of === '') wrong('a retract names the event it takes back (`of`)')
        else if (!ids.has(e.of)) wrong(`retracts ${JSON.stringify(e.of)}, which is not an event of this proposal`)
      }
    })
  })
  return out
}

// ---------------------------------------------------------------------------
// mergeLedgers: Sync merges two copies of data/proposals.yaml by id (spec §3.12)
// ---------------------------------------------------------------------------

/** Whether two values hold the same data; an absent field and `undefined` are the same. @param {unknown} a @param {unknown} b */
const same = (a, b) => (a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b))

/** A value in a sentence, short. @param {unknown} v */
const show = v => { const t = JSON.stringify(v) ?? 'nothing'; return t.length > 60 ? `${t.slice(0, 57)}…` : t }

/** Events in order: their instant, then their id. @param {LedgerEvent} a @param {LedgerEvent} b */
const byOrder = (a, b) => (instant(a.at) - instant(b.at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The latest event of these kinds in a copy of the entry, or null. @param {Record<string, any>} entry @param {string[]} kinds @returns {LedgerEvent | null} */
function latestOf(entry, kinds) {
  const events = (Array.isArray(entry.events) ? entry.events : []).filter(e => kinds.includes(e.kind)).sort(byOrder)
  return events.at(-1) ?? null
}

/** -1, 0 or 1: which of two latest-events is later (a missing one is earlier than any). @param {LedgerEvent | null} a @param {LedgerEvent | null} b */
function laterOf(a, b) {
  if (a === null && b === null) return 0
  if (a === null) return -1
  if (b === null) return 1
  const d = byOrder(a, b)
  return d < 0 ? -1 : d > 0 ? 1 : 0
}

/** @typedef {{ ok: true, entry: Record<string, any> } | { ok: false, reason: string }} EntryMerge */

/** @param {string} id @param {Record<string, any> | undefined} base @param {Record<string, any>} ours @param {Record<string, any>} theirs @returns {EntryMerge} */
function mergeEntry(id, base, ours, theirs) {
  /** @param {string} why @returns {{ ok: false, reason: string }} */
  const refuse = why => ({ ok: false, reason: `proposal ${id}: ${why}` })

  // Events: unioned by id, then ordered.
  /** @type {Map<string, LedgerEvent>} */
  const events = new Map()
  for (const e of [...(ours.events ?? []), ...(theirs.events ?? [])]) {
    const seen = events.get(e.id)
    if (seen !== undefined && !same(seen, e)) return refuse(`event ${e.id} is not the same on the two sides; an event is never rewritten, so one side was edited by hand. Fix it on one side, then Sync again`)
    events.set(e.id, e)
  }

  // The closing: a final state beats open; two finals must agree.
  const [so, st] = [ours.state, theirs.state]
  /** @type {Record<string, any>} */
  let closing
  if (so === st) {
    const [co, ct] = [ours.closed, theirs.closed]
    closing = { state: so, closed: same(co, ct) ? co : (co && ct ? (instant(co.at) <= instant(ct.at) ? co : ct) : (co ?? ct)) }
  } else if (so === 'open' || so === undefined) closing = { state: st, closed: theirs.closed }
  else if (st === 'open' || st === undefined) closing = { state: so, closed: ours.closed }
  else return refuse(`closed two ways: ${so} on one side, ${st} on the other. Only one can stand; decide which with the people involved, then fix the ledger by hand`)
  // A decision was made on the content its own side held; a revision the deciding side never saw would change what the
  // decision is about (the merged `ops` and `rev` would be the revision's, and the decision record would name content that
  // was never merged). A revise both sides already hold was seen before the closing.
  const final = so === st ? null : (so === 'open' || so === undefined ? [theirs, ours, st] : (st === 'open' || st === undefined ? [ours, theirs, so] : null))
  if (final !== null) {
    const [closedSide, openSide, state] = /** @type {[Record<string, any>, Record<string, any>, string]} */ (final)
    const known = new Set((closedSide.events ?? []).map((/** @type {LedgerEvent} */ e) => e.id))
    const unseen = (openSide.events ?? []).filter((/** @type {LedgerEvent} */ e) => e.kind === 'revise' && !known.has(e.id))
    if (unseen.length > 0) {
      return refuse(`${state} on one side and revised on the other (${unseen.map((/** @type {LedgerEvent} */ e) => e.id).join(', ')}); the decision was made on the content the first side held, which the revision changes. Remove the revision from the open side by hand, or write a new proposal with it, then Sync again`)
    }
  }

  // The content: the side with the later `revise` wins ops and rev; the later revise-or-replay wins base.
  const reviseOrder = laterOf(latestOf(ours, ['revise']), latestOf(theirs, ['revise']))
  const contentOrder = laterOf(latestOf(ours, ['revise', 'replay']), latestOf(theirs, ['revise', 'replay']))
  /** @param {string} key @param {number[]} orders @returns {{ value: unknown } | null} */
  const winner = (key, orders) => {
    for (const o of orders) if (o !== 0) return { value: (o > 0 ? ours : theirs)[key] }
    return null
  }
  const decidedBy = { rev: [reviseOrder], ops: [reviseOrder, contentOrder], base: [contentOrder] }

  /** @type {Record<string, any>} */
  const merged = {}
  const keys = [...new Set([...Object.keys(ours), ...Object.keys(theirs)])]
  for (const key of keys) {
    let value
    if (key === 'events') value = [...events.values()].sort(byOrder)
    else if (key === 'state' || key === 'closed') value = closing[key]
    else {
      const [o, t, b] = [ours[key], theirs[key], base?.[key]]
      const decided = Object.hasOwn(decidedBy, key) ? winner(key, /** @type {number[]} */ (decidedBy[/** @type {'rev'} */ (key)])) : null
      if (same(o, t)) value = o
      else if (Object.hasOwn(decidedBy, key) && decided !== null) value = decided.value
      else if (base !== undefined && same(o, b)) value = t
      else if (base !== undefined && same(t, b)) value = o
      else {
        return refuse(base === undefined
          ? `both sides opened a proposal with this id and they differ in "${key}" (${show(o)} here, ${show(t)} there); one of them needs a new id. Fix it by hand on one side, then Sync again`
          : `both sides changed "${key}" to different values (${show(o)} here, ${show(t)} there); nothing in the rules decides which stands. Fix it by hand on one side, then Sync again`)
      }
    }
    if (value !== undefined) merged[key] = value
  }
  return { ok: true, entry: merged }
}

/**
 * Two copies of the ledger, merged by id (spec §3.12). Entries are unioned; an entry's events are unioned by
 * id and ordered; for a field both sides changed, the final state wins (`ratified` over `open`), the side with
 * the later `revise` event wins `ops` and `rev`, the later `revise` or `replay` wins `base`; anything else it
 * cannot decide is refused, naming the proposal. `base` is the copy both sides started from (an absent or empty
 * ledger is `[]`). The result is sorted by id, so the merge is the same whichever side is "ours", and merging it
 * with either side again changes nothing. Pure: it copies, it never touches what it was given.
 * @param {readonly Record<string, any>[] | null | undefined} base
 * @param {readonly Record<string, any>[] | null | undefined} ours
 * @param {readonly Record<string, any>[] | null | undefined} theirs
 * @returns {{ ok: true, entries: Record<string, any>[] } | { ok: false, reason: string }}
 */
export function mergeLedgers(base, ours, theirs) {
  /** @param {readonly Record<string, any>[] | null | undefined} list @returns {Map<string, Record<string, any>>} */
  const byId = list => new Map((Array.isArray(list) ? list : []).filter(e => isMap(e)).map(e => [String(e.id), structuredClone(e)]))
  const [b, o, t] = [byId(base), byId(ours), byId(theirs)]
  const ids = [...new Set([...o.keys(), ...t.keys()])].sort()
  /** @type {Record<string, any>[]} */
  const entries = []
  for (const id of ids) {
    const [mine, theirsEntry] = [o.get(id), t.get(id)]
    if (mine === undefined) { entries.push(/** @type {Record<string, any>} */ (theirsEntry)); continue }
    if (theirsEntry === undefined) { entries.push(mine); continue }
    const r = mergeEntry(id, b.get(id), mine, theirsEntry)
    if (!r.ok) return r
    entries.push(r.entry)
  }
  return { ok: true, entries }
}
