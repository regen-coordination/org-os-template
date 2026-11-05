// packages/admin/lib/claim.mjs
//
// W2a, the bootstrap claim (wizards spec §5.4a): the git address becomes a member's handle, for
// the one state in which nobody has written a rule about who members are. Everything that decides
// is here, once, and pure: `claimRefusal(state)` is the single question the plan route, the
// confirm route and `scripts/claim-handle.mjs` all ask. The loader that reads a state from a
// repository sits at the bottom; every other function takes the state it is given.
//
// Why a file of its own and not `effectiveRule`: that function refuses an unknown actor on its
// first line, before it reads any rule, so for the one actor this serves it can never answer
// "solo". `rulesAreImpliedSolo` reads the rule inputs directly and never asks who the actor is.
//
// DAO-OS L5 (spec §8.1, F-L3-1): the owner's claim. An org whose rules leave nobody able to propose a change to its
// members is *locked out* (`lockedOut`); then, and only then, whoever runs a command on the machine that holds the
// repository (`scripts/claim-handle.mjs --owner`) may add one handle to one person, committed under
// `Org-Rule: bootstrap/owner-claim`. The HTTP routes never make it: their refusal names the command instead.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual, promisify } from 'node:util'
import Ajv from 'ajv'
import { LineCounter, isMap as isYamlMap, isScalar, isSeq, parseDocument } from 'yaml'
import { readGovernance, yamlDocuments } from './governance-read.mjs'
import { gitEmails, memberKind } from './members.mjs'
import { isMap } from './yaml-util.mjs'
import { effectiveRules, membershipTree, nobodyCanPropose, resolveRoles, ruleFor } from './rules.mjs'
import { walletsOf } from './hat-readings.mjs'
import { parseCaip10 } from './caip.mjs'
import { parseTreeRef } from './hats.mjs'

/** The trailer value that names this write (`Org-Rule: bootstrap/claim`). A named rule outside
 *  governance.yaml: validate:governance must not read it as a missing Org-Proposal. */
export const CLAIM_RULE = 'bootstrap/claim'

export const MEMBERS_FILE = 'data/members.yaml'
export const GOVERNANCE_FILE = 'data/governance.yaml'
export const SYSTEMS_FILE = 'data/systems.yaml'

/** The trailer value of the owner's claim (L5 spec §8.1): validate:governance accepts it only at a locked-out parent. */
export const OWNER_CLAIM_RULE = 'bootstrap/owner-claim'
/** Its `Org-Actor`: whoever runs a command on the machine that holds the repository. */
export const OWNER_ACTOR = 'owner'
/** The command, as the locked-out refusal and the migration print it. */
export const OWNER_CLAIM_COMMAND = 'node scripts/claim-handle.mjs --repo <instance> --owner --member <id> (--git <email> | --wallet <CAIP-10>)'
/** The owner's claim, asked of an org that is not locked out (L5 plan, Task 11). */
export const NOT_LOCKED_OUT = 'This organisation is not locked out: someone can propose. Ask them.'

/**
 * @typedef {object} ClaimState  everything the gate judges, read once by the caller
 * @property {string | null} address                 `git config user.email` of the repository, null when unset
 * @property {string | null} membersText             data/members.yaml, null when the file is absent
 * @property {string | null} governanceText          data/governance.yaml, null when the file is absent
 * @property {string[] | null} authors               lowercased author addresses in the history of HEAD; null when git could not list them
 * @property {string[]} dirty                        paths among data/members.yaml that git reports changed, untracked or hidden
 * @property {{ member: string } | { create: string } | { member: string, wallet: string }} [target]  who is claimed (and,
 *           for the owner's claim of a wallet, which CAIP-10 account); absent while only the organisation is judged
 * @property {string | null} [systemsText]           data/systems.yaml, null or absent when the file is: the membership tree
 *           `canAct` judges a wallet by (L5 spec §5.1)
 * @property {true} [owner]                          the owner's claim (L5 spec §8.1): `address` is then the git address
 *           the owner names (--git), not necessarily git's user.email
 * @property {string} [membersReadError]             why the file exists but could not be read from disk
 * @property {string} [governanceReadError]          the same for data/governance.yaml
 */

// ── the rules ────────────────────────────────────────────────────────────────

/** @param {unknown} v */
const nonEmpty = v => (Array.isArray(v) ? v.length > 0 : isMap(v) ? Object.keys(v).length > 0 : v !== null && v !== undefined && v !== '')

/**
 * Which of four things is true of the rules in force, from the file's text:
 *  `solo`        no governance file, an empty one, or a `solo-maintainer` (or unstated) model with no `rules`;
 *  `written`     a `rules` key holds anything (a list of only malformed entries counts: refusing wins);
 *  `model`       a model that is not solo-maintainer, with no rules: there is no implied default to rely on;
 *  `unreadable`  the file is present and cannot be read, so what it says is not known. The safe side.
 * @param {ClaimState} state
 * @returns {'solo' | 'written' | 'model' | 'unreadable'}
 */
export function rulesGate(state) {
  if (state.governanceReadError !== undefined) return 'unreadable'
  const text = state.governanceText
  if (text === null || text === undefined) return 'solo'
  const docs = yamlDocuments(text)
  if (docs.length === 0) return 'solo'
  const read = readGovernance(text)
  const top = docs[0]?.value
  const topRules = isMap(top) && Object.hasOwn(top, 'rules') && nonEmpty(top.rules)
  // Not read at all (invalid YAML, several documents, not a mapping): what it says is not known.
  if (read.governance === null) return 'unreadable'
  // Keys the app does not read, among them `rules`: they may hold rules, so they are not "none written".
  if (read.shape === 'missing' && topRules) return 'unreadable'
  const g = read.governance
  if (nonEmpty(g.rules) || topRules) return 'written'
  if (read.modelImplied) return 'solo'
  return String(g.model).trim() === 'solo-maintainer' ? 'solo' : 'model'
}

/** Whether the person at the machine already decides everything alone: the one state in which a
 *  claim lets them do what they could do by hand. False when governance.yaml cannot be read.
 *  @param {ClaimState} state */
export const rulesAreImpliedSolo = state => rulesGate(state) === 'solo'

/** @param {ClaimState} state @returns {string} */
function governanceSentence(state) {
  const gate = rulesGate(state)
  if (gate === 'written') {
    const why = lockedOutWhy(state)
    if (why !== null) {
      return `This organisation has rules for who its members are, and nobody can propose a change to them: ${why}. ` +
        `Its owner can add a handle on the machine that holds the repository: ${OWNER_CLAIM_COMMAND}`
    }
    return 'This organisation has rules for who its members are. Ask a maintainer to add your address, or propose it.'
  }
  if (gate === 'model') {
    const model = String(readGovernance(state.governanceText ?? '').governance?.model ?? '').trim()
    return `This organisation is not decided by one maintainer (its model is ${model}), so a claim is not the way to add a member. Ask a maintainer to add your address, or propose it.`
  }
  // readGovernance's problems finish the sentence "data/governance.yaml …"; a read error from the disk stands alone.
  const why = state.governanceReadError !== undefined
    ? state.governanceReadError
    : `it ${(readGovernance(state.governanceText ?? '').problems[0] ?? 'holds something this app does not read').replace(/\.$/, '')}`
  return `${GOVERNANCE_FILE} cannot be read: ${why}. So the rules in force are not known; correct the file, or add your address to ${MEMBERS_FILE} yourself.`
}

// ── locked out (L5 spec §8.1) ────────────────────────────────────────────────

/** data/systems.yaml's entries, or null when the file is absent or cannot be read: then no tree is known.
 *  @param {string | null | undefined} text @returns {Record<string, unknown>[] | null} */
function readSystems(text) {
  if (text === null || text === undefined) return null
  const doc = parseDocument(text)
  if (doc.errors.length > 0) return null
  const list = /** @type {any} */ (doc.toJS() ?? {})?.systems
  return Array.isArray(list) ? list.filter(isMap) : null
}

/**
 * Why nobody can propose a change to the members, or null when someone can.
 * Judged from the rules as the app reads them: the rule covering class `members` (`ruleFor`), and its `propose` role
 * with §7.6's predicate (`nobodyCanPropose`, wallets judged by the membership tree when data/systems.yaml names one).
 * @param {ClaimState} state @returns {string | null}
 */
function lockedOutWhy(state) {
  const governance = readGovernance(state.governanceText ?? '').governance ?? {}
  const { rules, implied } = effectiveRules(governance)
  // Rules the gate counts as written but the app does not read (malformed entries, or `rules` beside the block) cover nothing.
  const rule = ruleFor(implied ? [] : rules, 'members')
  if (rule === null) return 'no rule covers the class members'
  const read = readMembers(state.membersText ?? null)
  const members = 'error' in read ? [] : read.entries
  const book = resolveRoles(governance, members)
  if (typeof rule.propose !== 'string' || !book.roles.has(rule.propose)) return `rule ${rule.id} names no role that is defined to propose under it`
  if (nobodyCanPropose(rule, book, members, governance, readSystems(state.systemsText)) === null) return null
  return `the ${rule.propose} role, which proposes them, holds no person with a git or wallet handle`
}

/**
 * Locked out (L5 spec §8.1): the rule covering class `members` is missing, or its `propose` role holds nobody who can
 * act (§7.6's predicate). Rules are written, or a model that is not solo names none (ruling R-L5-11.1: then no rule
 * covers members either, and the platform cannot change them). With no rules and a solo model, or a governance file
 * that cannot be read, it is not: the 0.6 claim, or the file by hand, is the way.
 * @param {ClaimState} state @returns {boolean}
 */
export function lockedOut(state) {
  const gate = rulesGate(state)
  return (gate === 'written' || gate === 'model') && lockedOutWhy(state) !== null
}

// ── the members file ─────────────────────────────────────────────────────────

/** The member entries of the file's text, or why they cannot be read.
 *  @param {string | null} text @returns {{ entries: Record<string, unknown>[] } | { error: string }} */
function readMembers(text) {
  if (text === null) return { error: `${MEMBERS_FILE} does not exist.` }
  const doc = parseDocument(text)
  const[fault] = doc.errors
  if (fault) return { error: `${MEMBERS_FILE} cannot be read (${(fault.message.split('\n')[0] ?? '').trim()}). Correct it by hand first.` }
  const top = doc.toJS() ?? {}
  if (!isMap(top)) return { error: `${MEMBERS_FILE} cannot be read (its top level is not a mapping of keys to values). Correct it by hand first.` }
  const list = top.members ?? []
  if (!Array.isArray(list)) return { error: `${MEMBERS_FILE} cannot be read (\`members\` is not a list). Correct it by hand first.` }
  return { entries: list.filter(isMap) }
}

/** "Ana Costa" is `ana-costa`: lowercase letters, digits and hyphens, accents dropped. Ids are
 *  opaque after this and the platform never parses one.
 *  @param {string} name */
export const slugOf = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** An address the plan can write as a plain YAML value, so that what is shown is what is written. */
const WRITABLE_ADDRESS = /^[^\s@:#'"\\,[\]{}&*!|>%`]+@[^\s@:#'"\\,[\]{}&*!|>%`]+$/

const NAME_MAX = 100

/**
 * Why this claim must not be made, or null. The one function: the plan asks it, the confirm asks it
 * again on freshly read files, and the script asks it of the file it is about to edit.
 * @param {ClaimState} state
 * @returns {string | null}
 */
export function claimRefusal(state) {
  if (state.owner === true) return ownerRefusal(state)
  const address = state.address?.trim().toLowerCase() ?? ''
  if (address === '') return 'Git has no user.email set here, so there is no address to claim. Set one (git config user.email <you>) and try again.'
  if (state.membersReadError !== undefined) return `${MEMBERS_FILE} cannot be read (${state.membersReadError}). Correct it by hand first.`
  const members = readMembers(state.membersText)
  if ('error' in members) return members.error

  const holders = members.entries.filter(m => gitEmails(m).includes(address))
  if (holders.length === 1) return `You are already \`${String(holders[0].id)}\`: ${address} is in ${MEMBERS_FILE}.`
  if (holders.length > 1) {
    return `Two members hold ${address} (${holders.map(m => `\`${String(m.id)}\``).join(' and ')}), so git cannot say which of them you are. ` +
      `Take the address off one of them in ${MEMBERS_FILE} by hand.`
  }
  if (rulesGate(state) !== 'solo') return governanceSentence(state)

  const target = state.target
  if (target && 'member' in target) {
    const member = members.entries.find(m => String(m.id) === target.member)
    if (!member) return `There is no member \`${target.member}\` in ${MEMBERS_FILE}.`
    const kind = memberKind(member)
    if (kind !== 'person') return `\`${target.member}\` is not a person (it is ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}), and only a person can be claimed.`
    if (gitEmails(member).length > 0) {
      return `\`${target.member}\` already has a git address. Another address is added through the change loop, by someone it can name, not by a claim.`
    }
  } else if (target) {
    const name = target.create.trim()
    if (name === '') return 'Write a name for the new member.'
    if (/[\r\n\u0000-\u001f]/.test(name)) return 'A name must be one line.'
    if (name.length > NAME_MAX) return `A name is at most ${NAME_MAX} characters.`
    const id = slugOf(name)
    if (id === '') return 'A name needs letters or digits to make an id from.'
    if (members.entries.some(m => memberKind(m) === 'person')) {
      return `${MEMBERS_FILE} already has people, so a new member is added by one of them, not claimed. Choose a member who is already listed.`
    }
    if (members.entries.some(m => String(m.id) === id)) return `A member with the id \`${id}\` already exists.`
  }

  if (!WRITABLE_ADDRESS.test(address)) return `${address} cannot be written into ${MEMBERS_FILE} as it is; add it yourself.`
  if (state.dirty.length > 0) {
    return `${MEMBERS_FILE} has changes that are not committed (or git has been told to ignore it), and the claim would commit them with its line. Commit or discard them first.`
  }
  if (state.authors === null) {
    return `Git could not list the commits here, so it cannot be checked that ${address} has authored one. Add it to ${MEMBERS_FILE} yourself.`
  }
  if (!state.authors.includes(address)) {
    return `Git has never seen ${state.address.trim()} author a commit here; add it to ${MEMBERS_FILE} yourself, or commit once and try again.`
  }
  return null
}

/** The canonical form of the wallet an owner's claim names (CAIP-10, EIP-55), or null when it is no CAIP-10 account.
 *  @param {string} value */
const canonicalWallet = value => {
  const p = parseCaip10(value.trim())
  return p ? `${p.chain}:${p.address}` : null
}

/**
 * The owner's claim (L5 spec §8.1): refused unless the org is locked out; then every other 0.6 check, on the handle the
 * owner names (a git address in `state.address`, or `target.wallet`) and the listed member it goes to.
 * @param {ClaimState} state @returns {string | null}
 */
function ownerRefusal(state) {
  if (state.membersReadError !== undefined) return `${MEMBERS_FILE} cannot be read (${state.membersReadError}). Correct it by hand first.`
  const members = readMembers(state.membersText)
  if ('error' in members) return members.error
  if (rulesGate(state) === 'unreadable') return governanceSentence(state)
  if (!lockedOut(state)) return NOT_LOCKED_OUT

  const target = state.target
  if (!target || !('member' in target)) return `The owner's claim adds a handle to a member ${MEMBERS_FILE} already lists: name one with --member <id>.`
  const member = members.entries.find(m => String(m.id) === target.member)
  if (!member) return `There is no member \`${target.member}\` in ${MEMBERS_FILE}.`
  const kind = memberKind(member)
  if (kind !== 'person') return `\`${target.member}\` is not a person (it is ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}), and only a person can be claimed.`

  const wallet = 'wallet' in target ? target.wallet : null
  if (wallet !== null) {
    const account = canonicalWallet(wallet)
    if (account === null) return `${wallet.trim()} is not a CAIP-10 account (eip155:<chain id>:0x followed by 40 hex digits).`
    const chain = /** @type {{ chain: string }} */ (parseCaip10(account)).chain
    const tree = membershipTree(readGovernance(state.governanceText ?? '').governance, readSystems(state.systemsText))
    const treeChain = tree ? parseTreeRef(tree.tree)?.chain ?? null : null
    if (tree && treeChain !== null && chain !== treeChain) {
      return `${account} is on ${chain}, and the membership tree ${tree.tree} is on ${treeChain}: it could not be used to sign in here. Name the account on ${treeChain}.`
    }
    const holders = members.entries.filter(m => walletsOf(m).includes(account))
    if (holders.length > 0) return `${account} is already in ${MEMBERS_FILE}, under ${holders.map(m => `\`${String(m.id)}\``).join(' and ')}.`
    const handles = isMap(member.handles) ? member.handles : {}
    if (handles.wallet !== undefined && handles.wallet !== null) {
      return `\`${target.member}\` already has a wallet. Another is added through the change loop, by someone it can name, not by a claim.`
    }
  } else {
    const address = state.address?.trim().toLowerCase() ?? ''
    if (address === '') return 'Name the git address to add, with --git <email>.'
    const holders = members.entries.filter(m => gitEmails(m).includes(address))
    if (holders.length > 0) return `${address} is already ${holders.map(m => `\`${String(m.id)}\``).join(' and ')}'s, in ${MEMBERS_FILE}.`
    if (gitEmails(member).length > 0) {
      return `\`${target.member}\` already has a git address. Another address is added through the change loop, by someone it can name, not by a claim.`
    }
    if (!WRITABLE_ADDRESS.test(address)) return `${address} cannot be written into ${MEMBERS_FILE} as it is; add it yourself.`
  }
  if (state.dirty.length > 0) {
    return `${MEMBERS_FILE} has changes that are not committed (or git has been told to ignore it), and the claim would commit them with its line. Commit or discard them first.`
  }
  if (wallet === null) {
    const address = /** @type {string} */ (state.address).trim()
    if (state.authors === null) return `Git could not list the commits here, so it cannot be checked that ${address} has authored one. Add it to ${MEMBERS_FILE} yourself.`
    if (!state.authors.includes(address.toLowerCase())) return `Git has never seen ${address} author a commit here; commit once with it and try again.`
  }
  return null
}

/** Who can be claimed here: the persons who hold no git address, and whether a first member may be
 *  created (no person is a member yet). For the page that asks "which member are you?".
 *  @param {ClaimState} state
 *  @returns {{ candidates: { id: string, name: string }[], canCreate: boolean }} */
export function claimCandidates(state) {
  const members = readMembers(state.membersText)
  if ('error' in members) return { candidates: [], canCreate: false }
  const people = members.entries.filter(m => memberKind(m) === 'person')
  const label = (/** @type {Record<string, unknown>} */ m) => (typeof m.name === 'string' && m.name.trim() !== '' ? m.name : String(m.id))
  return {
    candidates: people.filter(m => gitEmails(m).length === 0).map(m => ({ id: String(m.id), name: label(m) })),
    canCreate: people.length === 0,
  }
}

// ── the edit ─────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Plan
 * @property {string | null} refusal  why not, in words; null when the plan stands
 * @property {string | null} id       the member's id (for a new member, the slug, shown before it is confirmed)
 * @property {string | null} name
 * @property {string} address         the address as git reports it
 * @property {string[]} lines         exactly the lines that will be added
 * @property {string | null} text     the file as it will read after
 * @property {boolean} created
 */

const yamlString = s => JSON.stringify(s) // a JSON string is a YAML double-quoted scalar

/** Index of the line holding the last non-blank character before `end`. */
const lastLineBefore = (src, end) => src.slice(0, end).trimEnd().split('\n').length - 1

/** @param {ClaimState} state @returns {Plan} */
export function planClaim(state) {
  const address = state.address?.trim() ?? ''
  const none = (/** @type {string} */ refusal) => ({ refusal, id: null, name: null, address, lines: [], text: null, created: false })
  const refused = claimRefusal(state)
  if (refused) return none(refused)
  const target = /** @type {NonNullable<ClaimState['target']>} */ (state.target)
  if (!target) return none('Choose who you are first.')
  const text = state.membersText ?? ''
  const wallet = 'wallet' in target ? canonicalWallet(target.wallet) : null
  if ('wallet' in target && wallet !== null) {
    const edit = addHandle(text, target.member, wallet, 'wallet')
    if ('manual' in edit) {
      return { ...none(`The way \`${target.member}\` is written in ${MEMBERS_FILE} (${edit.manual}) is one the claim will not edit, so you can add this yourself:\n${edit.lines.join('\n')}`), address: wallet }
    }
    return { refusal: null, id: edit.id, name: edit.name, address: wallet, lines: edit.lines, text: edit.text, created: false }
  }
  const edit = 'member' in target ? addHandle(text, target.member, address) : addMember(text, target.create.trim(), address)
  if ('manual' in edit) {
    return none(`The way ${'member' in target ? `\`${target.member}\`` : 'the file'} is written in ${MEMBERS_FILE} (${edit.manual}) is one the claim will not edit, so you can add this yourself:\n${edit.lines.join('\n')}`)
  }
  return { refusal: null, id: edit.id, name: edit.name, address, lines: edit.lines, text: edit.text, created: 'create' in target }
}

/** @param {string} text @param {string} id @param {string} address @param {'git' | 'wallet'} [key] */
function addHandle(text, id, address, key = 'git') {
  const doc = parseDocument(text, { lineCounter: new LineCounter() })
  const seq = doc.get('members')
  const item = isSeq(seq) ? seq.items.find(i => isYamlMap(i) && String(i.get('id')) === id) : undefined
  const lines2 = ['    handles:', `      ${key}: ${address}`]
  if (!isYamlMap(item) || !item.range) return { manual: 'it could not be found', lines: lines2 }
  if (item.flow) return { manual: 'a flow-style map', lines: lines2 }
  const keyCol = colOf(text, /** @type {any} */ (item.items[0]?.key)?.range?.[0])
  if (keyCol < 0) return { manual: 'an unusual layout', lines: lines2 }
  const src = text.split('\n')
  const handles = item.items.find(p => isScalar(p.key) && p.key.value === 'handles')
  const at = (/** @type {number} */ line, /** @type {string[]} */ add) => {
    const out = [...src]; out.splice(line + 1, 0, ...add); return out.join('\n')
  }
  if (handles) {
    const value = /** @type {any} */ (handles.value)
    const keyLine = lineOf(text, /** @type {any} */ (handles.key).range[0])
    const indent = ' '.repeat(keyCol + 2)
    const own = [`${indent}${key}: ${address}`]
    // `handles:` with nothing after it: the line goes under the key.
    const empty = value === null || (isScalar(value) && value.value === null && (!value.range || text.slice(value.range[0], value.range[1]).trim() === ''))
    if (empty) return { id, name: null, lines: own, text: at(keyLine, own) }
    if (!isYamlMap(value) || value.flow || value.items.length === 0) return { manual: 'handles is not an ordinary block map', lines: lines2 }
    if (value.items.some(p => isScalar(p.key) && p.key.value === key)) return { manual: `handles already has an empty ${key}`, lines: lines2 }
    const childCol = colOf(text, /** @type {any} */ (value.items[0].key).range[0])
    const line = ' '.repeat(childCol) + `${key}: ${address}`
    return { id, name: null, lines: [line], text: at(lastLineBefore(text, value.range[1]), [line]) }
  }
  const lines = [`${' '.repeat(keyCol)}handles:`, `${' '.repeat(keyCol + 2)}${key}: ${address}`]
  return { id, name: null, lines, text: at(lastLineBefore(text, item.range[1]), lines) }
}

/** @param {string} text @param {string} name @param {string} address */
function addMember(text, name, address) {
  const id = slugOf(name)
  const block = (/** @type {string} */ indent, /** @type {string} */ gap) => {
    const pad = ' '.repeat(indent.length + 1 + gap.length)
    return[`${indent}-${gap}id: ${id}`, `${pad}name: ${yamlString(name)}`, `${pad}handles:`, `${pad}  git: ${address}`]
  }
  if (text.trim() === '') {
    const lines = block('  ', ' ')
    return { id, name, lines, text: `schema_version: "2.0"\nmembers:\n${lines.join('\n')}\n` }
  }
  const doc = parseDocument(text)
  const src = text.split('\n')
  const pair = isYamlMap(doc.contents) ? doc.contents.items.find(p => isScalar(p.key) && p.key.value === 'members') : undefined
  if (!pair) {
    const lines = block('  ', ' ')
    return { id, name, lines, text: `${text.replace(/\s*$/, '')}\nmembers:\n${lines.join('\n')}\n` }
  }
  const seq = /** @type {any} */ (pair.value)
  const keyLine = lineOf(text, /** @type {any} */ (pair.key).range[0])
  if (seq === null || (isScalar(seq) && seq.value === null)) {
    const lines = block('  ', ' ')
    src.splice(keyLine + 1, 0, ...lines)
    return { id, name, lines, text: src.join('\n') }
  }
  if (isSeq(seq) && seq.items.length === 0 && seq.flow) {
    const lines = block('  ', ' ')
    src[keyLine] = src[keyLine].replace(/\s*\[\s*\]/, '')
    src.splice(keyLine + 1, 0, ...lines)
    return { id, name, lines, text: src.join('\n') }
  }
  if (isSeq(seq) && !seq.flow && seq.items.length > 0) {
    const first = /** @type {any} */ (seq.items[0]).range[0]
    const m = /^(\s*)-(\s+)/.exec(src[lineOf(text, first)] ?? '')
    if (!m) return { manual: 'an unusual layout', lines: block('  ', ' ') }
    const lines = block(m[1], m[2])
    src.splice(lastLineBefore(text, seq.range[1]) + 1, 0, ...lines)
    return { id, name, lines, text: src.join('\n') }
  }
  return { manual: 'members is not an ordinary block list', lines: block('  ', ' ') }
}

const lineOf = (/** @type {string} */ text, /** @type {number} */ offset) => text.slice(0, offset).split('\n').length - 1
const colOf = (/** @type {string} */ text, /** @type {number | undefined} */ offset) =>
  offset === undefined ? -1 : offset - (text.lastIndexOf('\n', offset - 1) + 1)

// ── checking the result ──────────────────────────────────────────────────────

/** @type {import('ajv').ValidateFunction | undefined} */
let validateMember
function memberSchema() {
  if (!validateMember) {
    const schema = JSON.parse(readFileSync(new URL('../schemas/members.schema.json', import.meta.url), 'utf8'))
    validateMember = new Ajv.default({ allErrors: true, strict: false, validateFormats: false }).compile(schema)
  }
  return validateMember
}

/**
 * The file as written, against the file as it was and the claim that was reviewed: it is YAML, the
 * address now names the claimed member and no one else, every entry fits the registry's schema, and
 * nothing but the one address (or the one new member) differs. A string is why not; null is fine.
 * @param {string} before @param {string} after @param {ClaimState} state
 * @returns {string | null}
 */
export function verifyClaim(before, after, state) {
  const parsed = parseDocument(after)
  if (parsed.errors.length > 0) return `The result is not valid YAML (${(parsed.errors[0].message.split('\n')[0] ?? '').trim()}).`
  const was = readMembers(before)
  const now = readMembers(after)
  if ('error' in was) return was.error
  if ('error' in now) return now.error
  const target = state.target
  if (!target) return 'There is no claim to check.'
  const wallet = 'wallet' in target ? canonicalWallet(target.wallet) : null
  if ('wallet' in target && wallet === null) return `${target.wallet} is not a CAIP-10 account.`
  const address = wallet ?? (state.address ?? '').trim().toLowerCase()
  const holders = now.entries.filter(m => (wallet !== null ? walletsOf(m) : gitEmails(m)).includes(address))
  const named = 'member' in target ? target.member : slugOf(target.create)
  if (holders.length !== 1 || String(holders[0].id) !== named) {
    return `The result does not name \`${named}\` as the only holder of ${address}.`
  }
  const bad = now.entries.map(e => (memberSchema()(e) ? null : (memberSchema().errors ?? []).map(x => `${x.instancePath || 'entry'} ${x.message}`).join(', '))).find(Boolean)
  if (bad) return `A member no longer fits the members schema (${bad}).`
  const expected = was.entries.map(e => structuredClone(e))
  if ('member' in target) {
    const mine = expected.find(e => String(e.id) === target.member)
    if (mine) mine.handles = { ...(isMap(mine.handles) ? mine.handles : {}), ...(wallet !== null ? { wallet } : { git: (state.address ?? '').trim() }) }
  } else {
    expected.push({ id: named, name: target.create.trim(), handles: { git: (state.address ?? '').trim() } })
  }
  if (!isDeepStrictEqual(JSON.parse(JSON.stringify(expected)), JSON.parse(JSON.stringify(now.entries)))) {
    return 'The file would change in some way other than the one line reviewed.'
  }
  return null
}

// ── the owner's claim, as validate:governance judges it ─────────────────────

/** A member's handles as the platform reads them: its git addresses and its CAIP-10 wallets, each once.
 *  @param {Record<string, unknown>} entry */
const handlesOf = entry => [...gitEmails(entry).map(h => `git ${h}`), ...walletsOf(entry).map(h => `wallet ${h}`)]

/** An entry without the handles a claim may add (`handles.git`, `handles.email`, `handles.wallet`, a top-level `email`).
 *  @param {Record<string, unknown>} entry */
function withoutHandles(entry) {
  const { handles, email: _email, ...rest } = entry
  const h = isMap(handles) ? { ...handles } : handles
  if (isMap(h)) { delete h.git; delete h.email; delete h.wallet }
  return JSON.parse(JSON.stringify({ ...rest, handles: isMap(h) && Object.keys(h).length === 0 ? undefined : h }))
}

/**
 * The change an owner's claim may make (L5 spec §8.1, point 2), from data/members.yaml as it was and as it is: the same
 * members in the same order, one person gaining exactly one handle no one else holds, and nothing else. Null when it
 * is that; else why not, as a clause ("it adds 2 handles, …").
 * @param {string | null} before @param {string | null} after @returns {string | null}
 */
export function oneHandleAdded(before, after) {
  const was = readMembers(before)
  const now = readMembers(after)
  if ('error' in was) return was.error
  if ('error' in now) return now.error
  const ids = (/** @type {Record<string, unknown>[]} */ list) => list.map(m => String(m.id)).join('\n')
  if (ids(was.entries) !== ids(now.entries)) return "it adds or removes a member (or moves one), where the owner's claim adds one handle"
  const plain = (/** @type {unknown} */ v) => JSON.parse(JSON.stringify(v))
  const changed = now.entries.map((_, i) => i).filter(i => !isDeepStrictEqual(plain(was.entries[i]), plain(now.entries[i])))
  if (changed.length === 0) return 'it adds no handle'
  if (changed.length > 1) return `it changes ${changed.length} members, where the owner's claim adds one handle to one person`
  const [b, a] = [was.entries[changed[0]], now.entries[changed[0]]]
  const id = String(a.id)
  if (memberKind(a) !== 'person') return `\`${id}\` is not a person, and only a person can be claimed`
  if (!isDeepStrictEqual(withoutHandles(b), withoutHandles(a))) return `it changes more of \`${id}\` than its handles`
  const had = handlesOf(b)
  const has = handlesOf(a)
  if (had.some(h => !has.includes(h))) return `it takes a handle off \`${id}\`, where the owner's claim only adds one`
  const added = has.filter(h => !had.includes(h))
  if (added.length !== 1) return added.length === 0 ? 'it adds no handle' : `it adds ${added.length} handles, where the owner's claim adds exactly one`
  const others = now.entries.filter((m, i) => i !== changed[0] && handlesOf(m).includes(added[0]))
  if (others.length > 0) return `the handle it adds to \`${id}\` is already held by ${others.map(m => `\`${String(m.id)}\``).join(' and ')}`
  return null
}

// ── reading a state, and noticing a change ──────────────────────────────────

const execFileP = promisify(execFile)

/** @typedef {(args: string[]) => Promise<string>} Git  runs git in the repository and answers its output; rejects when git fails */
/** @param {string} repo @returns {Git} */
export const gitIn = repo => async args => (await execFileP('git', ['-C', repo, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout

/** @param {string} repo @param {string} rel @returns {{ text: string | null } | { error: string }} */
function readIfPresent(repo, rel) {
  const path = join(repo, rel)
  if (!existsSync(path)) return { text: null }
  try { return { text: readFileSync(path, 'utf8') } } catch (err) { return { error: err instanceof Error ? err.message : String(err) } }
}

/**
 * The state of a repository, read from its files and from git. Every caller reads it the same way,
 * at the moment it decides.
 * @param {string} repo
 * @param {ClaimState['target']} [target]
 * @param {Git} [git]
 * @returns {Promise<ClaimState>}
 */
export async function readClaimState(repo, target, git = gitIn(repo)) {
  const members = readIfPresent(repo, MEMBERS_FILE)
  const governance = readIfPresent(repo, GOVERNANCE_FILE)
  const systems = readIfPresent(repo, SYSTEMS_FILE)
  const address = await git(['config', 'user.email']).then(s => s.trim() || null, () => null)
  const authors = await git(['log', '--format=%ae', 'HEAD']).then(
    out => [...new Set(out.split('\n').map(l => l.trim().toLowerCase()).filter(Boolean))], () => null)
  const status = await git(['status', '--porcelain', '--untracked-files=all', '--', MEMBERS_FILE]).catch(() => 'unknown')
  const listed = await git(['ls-files', '-v', '--', MEMBERS_FILE]).catch(() => '')
  const hidden = listed.split('\n').some(l => l.length > 2 && (l[0] === 'S' || l[0] !== l[0].toUpperCase()))
  const dirty = status.trim() !== '' || hidden ? [MEMBERS_FILE] : []
  /** @type {ClaimState} */
  const state = {
    address, membersText: 'text' in members ? members.text : null, governanceText: 'text' in governance ? governance.text : null,
    authors, dirty, systemsText: 'text' in systems ? systems.text : null, ...(target ? { target } : {}),
  }
  if ('error' in members) state.membersReadError = members.error
  if ('error' in governance) state.governanceReadError = governance.error
  return state
}

/** What a plan was made from. Anything that differs at confirm is named, in words.
 *  @param {ClaimState} state */
export function fingerprint(state) {
  const sha = (/** @type {string | null} */ t) => (t === null ? 'absent' : createHash('sha1').update(t).digest('hex'))
  return { address: (state.address ?? '').trim().toLowerCase(), members: sha(state.membersText), governance: sha(state.governanceText) }
}

/** What changed between the state a plan was made from and the one read now, as short phrases.
 *  @param {ReturnType<typeof fingerprint>} then @param {ReturnType<typeof fingerprint>} now @returns {string[]} */
export function changedSince(then, now) {
  const out = []
  if (then.address !== now.address) out.push('your git email')
  if (then.members !== now.members) out.push(`${MEMBERS_FILE}`)
  if (then.governance !== now.governance) out.push(`${GOVERNANCE_FILE}`)
  return out
}
