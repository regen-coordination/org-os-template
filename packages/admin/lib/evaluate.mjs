// packages/admin/lib/evaluate.mjs
//
// The rule evaluator (0.6 P2 spec §3.6): what a rule says about a proposal's events at a moment. Pure:
// no I/O, no node:* import, and it never reads the clock (`now` is the only one there is), so the
// server, the validator and the client run the same function and speak with one voice. Every sentence
// the page, the tray, the machine's guard and the validator show is built here.

import { METHODS, parseDuration, DEFAULT_EXPIRY_MS } from './rules.mjs'
import { liveEvents, decidersOf, methodOf, instant } from './proposals.mjs'

/** @typedef {import('./rules.mjs').Rule} Rule */
/** @typedef {import('./rules.mjs').RoleBook} RoleBook */
/** @typedef {import('./proposals.mjs').Proposal} Proposal */
/**
 * @typedef {object} Evaluation
 * @property {'pending' | 'met' | 'failed' | 'expired'} state
 * @property {string} missing the sentence shown: what is still needed, or why it cannot be
 * @property {{ for?: string[], against?: string[], abstain?: string[], objecting?: string[], needed?: number }} tally
 * @property {string | null} closesAt ISO: when a window or the expiry ends the evaluation by itself
 * @property {'unmeetable'} [blocked] set when the rule can never be met as written
 */

/** @param {number} n @param {string} unit */
const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`
/** @param {string} word */
const withArticle = word => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`
/** @param {number} ms */
const iso = ms => new Date(ms).toISOString()
/** @param {unknown[]} list */
const unique = list => [...new Set(list)]

/** The time left, in at most two units: "2 days 3 hours", "30 minutes", "less than a minute". @param {number} ms */
export function inWords(ms) {
  const minutes = Math.floor(ms / 6e4)
  if (minutes < 1) return 'less than a minute'
  const parts = [[Math.floor(minutes / 1440), 'day'], [Math.floor((minutes % 1440) / 60), 'hour'], [minutes % 60, 'minute']]
    .filter(([n]) => /** @type {number} */ (n) > 0)
  return parts.slice(0, 2).map(([n, unit]) => plural(/** @type {number} */ (n), /** @type {string} */ (unit))).join(' ')
}

/** @param {unknown} now @returns {number} */
function clock(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now.getTime()
  if (typeof now === 'number' && Number.isFinite(now)) return now
  throw new Error('evaluate needs `now`, the moment to judge at: it never reads the clock itself.')
}

/** @param {string} by @param {string[]} objectors */
const held = (by, objectors) =>
  `held open by an objection from ${withArticle(by)}${objectors.length > 1 ? ` (${objectors.length} of them)` : ''}: answer it with a revision, or ask them to withdraw it`

/**
 * The moments a rule judges a proposal by (§3.6), at `now`: *since* is the later of `opened` and the latest
 * `revise`; the *expiry* is `since` plus the rule's `expires`, else the proposal's `ttl`, else P30D; `events` are
 * the live events written by `now` and before the expiry (an event after `now` is not yet written, one at or
 * after the expiry neither rescues nor blocks). The server uses it too, to refuse an event the evaluator would
 * ignore.
 * @param {{ rule: Rule, proposal: Pick<Proposal, 'opened' | 'rev' | 'events'> & { ttl?: string }, now: Date | number }} input
 */
export function timingOf({ rule, proposal, now }) {
  const nowMs = clock(now)
  const live = liveEvents(proposal)
  const since = Math.max(instant(proposal.opened), ...live.filter(e => e.kind === 'revise' && instant(e.at) <= nowMs).map(e => instant(e.at)))
  const ttl = parseDuration(rule.expires) ?? parseDuration(proposal.ttl) ?? DEFAULT_EXPIRY_MS
  const expiry = since + ttl
  const events = live.filter(e => instant(e.at) <= nowMs && instant(e.at) < expiry)
  return { nowMs, since, ttl, expiry, events }
}

/**
 * What one rule says about a proposal at `now`.
 *
 * Terms (§3.6): *deciders* are the members `book` resolves for `decide.by`, persons only; *since* is the
 * later of `opened` and the latest `revise`; the live events are `liveEvents`'. An event at or after the
 * proposal's expiry instant (`since` plus the rule's `expires`, else the proposal's `ttl`, else P30D) does
 * not count, and an event after `now` is not yet written: so a decision reached in time stays reached.
 *
 * @param {{ rule: Rule, proposal: Pick<Proposal, 'author' | 'opened' | 'rev' | 'events'> & { ttl?: string }, book: RoleBook, now: Date | number }} input
 * @returns {Evaluation}
 */
export function evaluate({ rule, proposal, book, now }) {
  const method = methodOf(rule)
  if (method === undefined) throw new Error(`rule "${rule.id}" names no method: write decide.method as one of ${METHODS.join(', ')}.`)
  if (!METHODS.includes(/** @type {never} */ (method))) throw new Error(`rule "${rule.id}": method "${method}" is not one of ${METHODS.join(', ')}.`)

  const { nowMs, since, expiry, ttl, events } = timingOf({ rule, proposal, now })
  const by = rule.decide.by ?? 'decider'
  const deciders = decidersOf(rule, book)
  const author = proposal.author

  /** @type {Omit<Evaluation, 'closesAt'> & { closes: number | null }} */
  let result
  if (method === 'direct' || method === 'approve') {
    const count = method === 'direct' ? 1 : (rule.decide.count ?? 1)
    const selfOk = rule.self_approve === true
    const eligible = deciders.filter(m => selfOk || m !== author)
    const approvers = unique(events.filter(e => e.kind === 'approve' && eligible.includes(e.by)).map(e => e.by))
    const objectors = unique(events.filter(e => e.kind === 'object' && !e.answered && deciders.includes(e.by)).map(e => e.by))
    const tally = { for: approvers, objecting: objectors, needed: count }
    const other = selfOk ? '' : ' other than the author'
    if (eligible.length < count) {
      result = { state: 'pending', blocked: 'unmeetable', tally, closes: expiry,
        missing: `cannot be met: only ${plural(eligible.length, by)}${other}, and the rule asks for ${count}. Withdraw it, or change the rule` }
    } else if (objectors.length > 0) {
      result = { state: 'pending', tally, closes: expiry, missing: held(by, objectors) }
    } else if (approvers.length >= count) {
      result = { state: 'met', tally, closes: null, missing: '' }
    } else {
      result = { state: 'pending', tally, closes: expiry, missing: `needs ${plural(count - approvers.length, 'more approval')} from ${withArticle(by)}${other}` }
    }
  } else if (method === 'consent') {
    const window = parseDuration(rule.decide.window)
    if (window === null) throw new Error(`rule "${rule.id}": method consent needs decide.window, an ISO 8601 duration such as P7D.`)
    const end = since + window
    const objectors = unique(events.filter(e => e.kind === 'object' && !e.answered && deciders.includes(e.by)).map(e => e.by))
    const tally = { objecting: objectors }
    if (objectors.length > 0) result = { state: 'pending', tally, closes: expiry, missing: held(by, objectors) }
    else if (end >= expiry) {
      // The window cannot close before the proposal expires: met only after the expiry would let an expired proposal be decided.
      result = { state: 'pending', blocked: 'unmeetable', tally, closes: expiry,
        missing: `cannot be met: the objection window (${inWords(window)}) ends after the proposal expires (in ${inWords(Math.max(expiry - nowMs, 0))}). Withdraw it, or change the rule` }
    } else if (nowMs >= end) result = { state: 'met', tally, closes: null, missing: '' }
    else result = { state: 'pending', tally, closes: end, missing: `the objection window closes in ${inWords(end - nowMs)}` }
  } else if (method === 'vote') {
    result = voteResult({ rule, events, deciders, since, nowMs, expiry })
  } else {
    result = systemResult({ rule, events, expiry, rev: proposal.rev })
  }

  const { closes, ...rest } = result
  if (rest.state !== 'pending') return { ...rest, closesAt: null }
  if (nowMs >= expiry) {
    return { state: 'expired', tally: rest.tally, closesAt: null,
      missing: `nobody decided it within ${inWords(ttl)}, so it expired` }
  }
  return { ...rest, closesAt: iso(Math.min(closes ?? expiry, expiry)) }
}

/**
 * The ballots that count and the moment the vote closes: the earlier of the window's `end` and the ballot
 * that completed the electorate (every decider holds one). A ballot at or after `end`, or written after the
 * electorate was complete, is not counted; the latest ballot of a member wins.
 * @param {{ ballots: import('./proposals.mjs').LedgerEvent[], deciders: string[], end: number }} input
 * @returns {{ latest: Map<string, string>, closedAt: number }}
 */
function ballotsOf({ ballots, deciders, end }) {
  /** @type {Map<string, string>} */
  const latest = new Map()
  let closedAt = end
  for (const b of ballots.filter(e => deciders.includes(e.by))) {
    const at = instant(b.at)
    if (at >= closedAt) continue
    latest.set(b.by, String(b.vote))
    if (deciders.length > 0 && deciders.every(d => latest.has(d))) closedAt = at // the electorate is complete: later ballots do not count
  }
  return { latest, closedAt }
}

/**
 * Whether the ballots of a `vote` rule are closed at `now`: a vote written now would not be counted. The
 * server refuses to write one (§3.2).
 * @param {{ rule: Rule, proposal: Pick<Proposal, 'opened' | 'rev' | 'events'> & { ttl?: string }, book: RoleBook, now: Date | number }} input
 * @returns {boolean}
 */
export function ballotsClosed({ rule, proposal, book, now }) {
  const { nowMs, since, events } = timingOf({ rule, proposal, now })
  const window = parseDuration(rule.decide.window)
  if (window === null) return false
  const { closedAt } = ballotsOf({ ballots: events.filter(e => e.kind === 'vote'), deciders: decidersOf(rule, book), end: since + window })
  return nowMs >= closedAt
}

/**
 * A vote (§3.6): a ballot counts if it carries the current rev (the live set), its writer decides, it was
 * written before the window's end, and before every decider held a ballot; the latest ballot of a member
 * wins. The vote is *closed* at the earlier of the window's end and the ballot that completed the
 * electorate; until then it is pending, even when the count already settles it.
 * @param {{ rule: Rule, events: import('./proposals.mjs').LedgerEvent[], deciders: string[], since: number, nowMs: number, expiry: number }} input
 */
function voteResult({ rule, events, deciders, since, nowMs, expiry }) {
  const window = parseDuration(rule.decide.window)
  if (window === null) throw new Error(`rule "${rule.id}": method vote needs decide.window, an ISO 8601 duration such as P3D.`)
  const quorum = rule.decide.quorum ?? 1
  const threshold = rule.decide.threshold ?? 0.5
  const end = since + window
  const ballots = events.filter(e => e.kind === 'vote')
  for (const b of ballots) {
    if (!['yes', 'no', 'abstain'].includes(String(b.vote))) throw new Error(`a vote of "${b.vote}" by ${b.by} is not yes, no or abstain.`)
  }
  const { latest, closedAt } = ballotsOf({ ballots, deciders, end })
  const names = value => [...latest].filter(([, v]) => v === value).map(([m]) => m)
  const tally = { for: names('yes'), against: names('no'), abstain: names('abstain'), needed: quorum }
  const [yes, no] = [tally.for.length, tally.against.length]
  const cast = latest.size
  if (closedAt >= expiry && nowMs >= expiry) {
    // The vote would close only after the proposal expired: it expires first (the caller turns pending into expired).
    return { state: /** @type {const} */ ('pending'), tally, closes: expiry,
      missing: `the proposal expired before the vote could close (${cast} of ${deciders.length} had voted)` }
  }
  if (nowMs < closedAt) {
    if (closedAt >= expiry) {
      return { state: /** @type {const} */ ('pending'), tally, closes: expiry,
        missing: `the proposal expires in ${inWords(expiry - nowMs)}, before the vote's window ends; it is decided only if all ${deciders.length} deciders vote first (${cast} have, quorum is ${quorum})` }
    }
    return { state: /** @type {const} */ ('pending'), tally, closes: end,
      missing: `voting closes in ${inWords(end - nowMs)}; ${cast} of ${deciders.length} have voted, quorum is ${quorum}` }
  }
  if (cast < quorum) {
    return { state: /** @type {const} */ ('expired'), tally, closes: null, missing: `the vote closed without a quorum: ${cast} of the ${quorum} needed voted` }
  }
  const share = yes + no === 0 ? 0 : yes / (yes + no)
  if (share >= threshold) return { state: /** @type {const} */ ('met'), tally, closes: null, missing: '' }
  return { state: /** @type {const} */ ('failed'), tally, closes: null,
    missing: yes + no === 0 ? 'nobody voted for or against' : `${yes} of ${yes + no} votes for or against were yes, and the rule asks for ${Math.round(threshold * 100)}%` }
}

/**
 * A rule decided by an outside system (§3.11): the latest `system` event of the current `rev` is the reading, and the
 * latest attach of the current `rev` the transaction, as the server's `currentAttach` reads it (final review D156): an
 * old rev's executed transaction does not meet a revised proposal. The evaluator reads events, never the network.
 * @param {{ rule: Rule, events: import('./proposals.mjs').LedgerEvent[], expiry: number, rev: string }} input
 */
function systemResult({ rule, events, expiry, rev }) {
  const system = rule.decide.system ?? 'named nowhere'
  const current = events.filter(e => e.rev === rev)
  const reading = current.filter(e => e.kind === 'system').at(-1)
  const attached = current.filter(e => e.kind === 'attach').at(-1)
  const tally = {}
  /** @param {Evaluation['state']} state @param {string} missing */
  const out = (state, missing) => ({ state, tally, closes: state === 'pending' ? expiry : null, missing })
  const refOf = e => (e && typeof e.ref === 'object' && e.ref !== null ? /** @type {{ id?: string }} */ (e.ref).id : undefined)
  if (reading?.outcome === 'executed') return out(/** @type {const} */ ('met'), '')
  if (reading?.outcome === 'failed') return out(/** @type {const} */ ('failed'), `the transaction failed in ${system}`)
  if (reading?.outcome === 'mismatch') return out(/** @type {const} */ ('pending'), 'this transaction is not the one the proposal prepared')
  if (reading?.outcome === 'pending') {
    const id = refOf(reading) ?? refOf(attached) ?? '(unnamed)'
    const sigs = typeof reading.confirmations === 'number' && typeof reading.required === 'number'
      ? `${id}: ${reading.confirmations} of ${reading.required} signatures` : `${id} is attached and not executed yet`
    return out(/** @type {const} */ ('pending'), `transaction ${sigs}`)
  }
  return out(/** @type {const} */ ('pending'), attached
    ? `waiting for the system ${system}: transaction ${refOf(attached) ?? '(unnamed)'} is attached and not executed yet`
    : `waiting for the system ${system}: no transaction attached yet`)
}

/**
 * Every rule of the proposal's snapshot (§3.7, P2-R1): met when all are met; failed if any failed
 * (before expired); expired if any expired. `missing` names the rule that holds when there are several.
 * @param {{ proposal: Pick<Proposal, 'author' | 'opened' | 'rev' | 'events' | 'rules'> & { ttl?: string }, book: RoleBook, now: Date | number }} input
 * @returns {{ state: Evaluation['state'], missing: string, parts: { rule: Rule, evaluation: Evaluation }[], closesAt: string | null, blocked?: 'unmeetable' }}
 */
export function evaluateAll({ proposal, book, now }) {
  const rules = Array.isArray(proposal.rules) ? proposal.rules : []
  if (rules.length === 0) throw new Error('this proposal holds no rules, so nothing can decide it.')
  const parts = rules.map(rule => ({ rule, evaluation: evaluate({ rule, proposal, book, now }) }))
  const states = parts.map(p => p.evaluation.state)
  const state = states.includes('failed') ? 'failed' : states.includes('expired') ? 'expired' : states.every(s => s === 'met') ? 'met' : 'pending'
  const holding = parts.filter(p => p.evaluation.state !== 'met')
  const missing = state === 'met' ? ''
    : holding.map(p => (parts.length > 1 ? `rule "${p.rule.id}": ${p.evaluation.missing}` : p.evaluation.missing)).join('; ')
  const closes = state === 'pending' ? parts.map(p => p.evaluation.closesAt).filter(c => c !== null).sort()[0] ?? null : null
  const blocked = parts.some(p => p.evaluation.blocked === 'unmeetable') && state === 'pending' ? /** @type {const} */ ('unmeetable') : undefined
  return { state, missing, parts, closesAt: closes, ...(blocked ? { blocked } : {}) }
}
