// packages/admin/lib/hat-readings.mjs
//
// Hat readings recorded in the ledger (DAO-OS L5 spec §7.2, §7.3). Each act under a hat-sourced role, or by a CAIP-10
// actor, writes the reading it was judged by (`as`), and a ratify writes fresh readings of every counted actor
// (`closed.checked`). This module turns a proposal into observations of who wore which hat at which block, and says
// which observation stands for each hat and account. lib/rules.mjs `resolveRoles` builds a role book from them, so
// the server, validate:governance and the client judge a proposal by what it recorded, with no network.
//
// Hats are compared exactly (spec C-6): nothing here walks up to the hats above.
// Pure: imports only ./caip.mjs, ./hats.mjs and ./yaml-util.mjs.

import { parseCaip10 } from './caip.mjs'
import { hatRef, parseHatRef } from './hats.mjs'
import { isMap } from './yaml-util.mjs'

/** @typedef {{ hat: string, account: string, wears: boolean, block: number, at: string }} HatObservation */
/**
 * What an act records beside it (spec §7.2), `opened_as`, an event's `as` and `closed.as`.
 * @typedef {{ hat: string, account: string, block: number, readAt: string, wearers?: string[], complete?: boolean }} HatAct
 */

/** A hat ref in one form (lowercase hat id), or null. @param {unknown} value @returns {string | null} */
function normalHat(value) {
  const p = parseHatRef(value)
  return p ? hatRef(p.chain, p.hatId) : null
}

/** A CAIP-10 id in one form (EIP-55 address), or null. A bare address has no chain, so it is not one. @param {unknown} value @returns {string | null} */
function normalAccount(value) {
  const p = parseCaip10(value)
  return p ? `${p.chain}:${p.address}` : null
}

/** @param {unknown} block @returns {block is number} */
const isBlock = block => typeof block === 'number' && Number.isSafeInteger(block) && block >= 0

/**
 * The wallets a member lists in `handles.wallet` (one CAIP-10 id or a list), in one form, each once. An entry that is
 * not a CAIP-10 id is left out: it could never match an account read on chain.
 * @param {Record<string, unknown> | null | undefined} entry @returns {string[]}
 */
export function walletsOf(entry) {
  const handles = isMap(entry?.handles) ? entry.handles : {}
  const list = Array.isArray(handles.wallet) ? handles.wallet : [handles.wallet]
  return [...new Set(list.map(normalAccount).filter(v => v !== null))]
}

/**
 * @param {unknown} raw
 * @returns {{ hat: string, account: string, block: number, at: string, wearers: string[], complete: boolean } | null}
 */
function readAct(raw) {
  if (!isMap(raw)) return null
  const hat = normalHat(raw.hat)
  const account = normalAccount(raw.account)
  if (hat === null || account === null || !isBlock(raw.block) || typeof raw.readAt !== 'string' || raw.readAt === '') return null
  const listed = Array.isArray(raw.wearers) ? raw.wearers : []
  const wearers = listed.map(normalAccount).filter(v => v !== null)
  // A list holding an entry that is no account was not read whole: it cannot say who does not wear the hat.
  const complete = raw.complete === true && Array.isArray(raw.wearers) && wearers.length === listed.length
  return { hat, account, block: raw.block, at: raw.readAt, wearers: [...new Set(wearers)], complete }
}

/** A `closed.checked` row: `{ account, hat, wears, block, readAt }`. @param {unknown} raw @returns {HatObservation | null} */
function readChecked(raw) {
  if (!isMap(raw)) return null
  const hat = normalHat(raw.hat)
  const account = normalAccount(raw.account)
  if (hat === null || account === null || typeof raw.wears !== 'boolean' || !isBlock(raw.block) || typeof raw.readAt !== 'string' || raw.readAt === '') return null
  return { hat, account, wears: raw.wears, block: raw.block, at: raw.readAt }
}

/**
 * The observations a proposal recorded (spec §7.3), in ledger order: `opened_as`, each event's `as`, `closed.as`,
 * then `closed.checked`.
 * - each `as` says its account wears its hat, and so does every account its `wearers` list holds;
 * - an `as` whose list is `complete: true` also says that every other account observed in the proposal does not
 *   wear that hat. An incomplete list (L2-C4) says nothing about who is missing from it (Review Focus 5);
 * - each `closed.checked` row says its own `wears`.
 * An `as` or a row that cannot be read (no hat ref, no CAIP-10 account, no block, no read time) is left out;
 * validate:governance is what reports it.
 * @param {unknown} proposal @returns {HatObservation[]}
 */
export function observationsOf(proposal) {
  if (!isMap(proposal)) return []
  const raws = [proposal.opened_as]
  for (const e of Array.isArray(proposal.events) ? proposal.events : []) if (isMap(e)) raws.push(e.as)
  const closed = isMap(proposal.closed) ? proposal.closed : null
  if (closed) raws.push(closed.as)
  const acts = raws.map(readAct).filter(a => a !== null)
  const checked = (closed && Array.isArray(closed.checked) ? closed.checked : []).map(readChecked).filter(r => r !== null)

  const observed = new Set([...acts.flatMap(a => [a.account, ...a.wearers]), ...checked.map(r => r.account)])
  /** @type {HatObservation[]} */
  const out = []
  for (const a of acts) {
    const seen = { hat: a.hat, block: a.block, at: a.at }
    out.push({ ...seen, account: a.account, wears: true })
    for (const account of a.wearers) if (account !== a.account) out.push({ ...seen, account, wears: true })
    if (a.complete) {
      const wearing = new Set([a.account, ...a.wearers])
      for (const account of observed) if (!wearing.has(account)) out.push({ ...seen, account, wears: false })
    }
  }
  return [...out, ...checked]
}

/** @param {string} at */
const timeOf = at => { const t = Date.parse(at); return Number.isNaN(t) ? -Infinity : t }

/**
 * The observation that stands for each hat and account, keyed `<hat>|<account>`: the highest block, then the
 * latest read time; on a full tie, the one that comes later in the list.
 * @param {readonly HatObservation[]} observations @returns {Map<string, HatObservation>}
 */
export function standing(observations) {
  /** @type {Map<string, HatObservation>} */
  const out = new Map()
  for (const o of observations) {
    const key = `${o.hat}|${o.account}`
    const held = out.get(key)
    if (!held || o.block > held.block || (o.block === held.block && timeOf(o.at) >= timeOf(held.at))) out.set(key, o)
  }
  return out
}

/**
 * The actor id an account acts as (spec §6.3): the member id when exactly one member lists the account in
 * `handles.wallet`, otherwise the CAIP-10 id itself (a wallet on another chain is another account). Who of two
 * members acts is a question for people, never a guess. Something that is no CAIP-10 id comes back as written.
 * @param {string} account @param {Record<string, unknown>[]} members @returns {string}
 */
export function actorIdOf(account, members) {
  const id = normalAccount(account)
  if (id === null) return String(account)
  const entries = Array.isArray(members) ? members : []
  const ids = new Set(entries
    .filter(m => isMap(m) && m.id !== undefined && m.id !== null && m.id !== '' && walletsOf(m).includes(id))
    .map(m => String(m.id)))
  return ids.size === 1 ? [...ids][0] : id
}
