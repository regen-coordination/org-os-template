// packages/admin/lib/rules.mjs
//
// Roles and rules (architecture §4.5, F2 spec §3): who holds a role, which rule
// governs a class of change, and who may propose or decide under it. No I/O and
// no node:* import, so the server, the root scripts and the client can all read
// it. P2 builds its proposal machine's guards and its evaluator on these names.
//
// Nothing here evaluates a proposal's events (that is P2's `evaluate`). It stops
// at "which rule applies, who may propose, who may decide".
//
// DAO-OS L5 (spec §5.1, §7.1, §7.3, §7.6): a role may be sourced from a hat of the
// membership tree. Its members are the actors the readings a proposal recorded
// say wear that hat exactly (no hats above it: C-6); with no readings it has none.

import { isMap } from './yaml-util.mjs'
import { gitEmails, memberKind } from './members.mjs'
import { hatRef, inTree, parseHatRef, parseTreeRef, treeRef } from './hats.mjs'
import { actorIdOf, standing, walletsOf } from './hat-readings.mjs'
import { parseCaip10 } from './caip.mjs'

/** @typedef {'direct'|'approve'|'consent'|'vote'|'system'} Method */
/**
 * @typedef {object} Decide
 * @property {string} [by] a role id, or `system` for method system
 * @property {string} [method]
 * @property {number} [count] approve
 * @property {string} [window] consent, vote: an ISO 8601 duration
 * @property {number} [quorum] vote
 * @property {number} [threshold] vote: the share of votes cast that must be yes
 * @property {string} [system] system: an id in data/systems.yaml
 * @property {{ choice: string }} [passes] system, on a vote: the label of the choice that must win (DAO-OS L2, ruling K2)
 */
/** @typedef {{ id: string, applies_to: readonly string[], propose?: string, decide: Readonly<Decide>, expires?: string, self_approve?: true }} Rule */
/** @typedef {{ id: string, members: string[], all: boolean, defined: boolean, hat?: string }} Role */
/** @typedef {{ roles: Map<string, Role>, problems: string[], agents: Set<string>, organizations: Set<string> }} RoleBook */

/** @type {readonly Method[]} */
export const METHODS = Object.freeze(['direct', 'approve', 'consent', 'vote', 'system'])

/** The role the solo default (and an org that defines no `maintainer`) means by "maintainer". */
export const MAINTAINER = 'maintainer'

/** Architecture §4.5: the rule an instance runs on when its model is solo and it wrote no rules. */
/** @type {readonly Rule[]} */
export const SOLO_RULES = Object.freeze([Object.freeze({
  id: 'solo',
  applies_to: Object.freeze(['all']),
  propose: MAINTAINER,
  decide: Object.freeze({ by: MAINTAINER, method: 'direct' }),
})])

/** A role or rule id: lowercase letters, digits, `-` and `_`, starting with a letter. */
export const ID_PATTERN = /^[a-z][a-z0-9_-]*$/

const DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/

/**
 * An ISO 8601 duration of weeks, days, hours and minutes, in milliseconds. Months
 * and years are not accepted (they have no fixed length). Null for anything else,
 * and for a zero-length duration, which could not be a window.
 * @param {unknown} text @returns {number | null}
 */
export function parseDuration(text) {
  if (typeof text !== 'string') return null
  const m = DURATION.exec(text)
  if (!m || text.endsWith('T')) return null
  const [w, d, h, min] = [m[1], m[2], m[3], m[4]].map(v => Number(v ?? 0))
  const ms = ((w * 7 + d) * 24 + h) * 3600e3 + min * 60e3
  return ms > 0 ? ms : null
}

/** How long a proposal lives when neither its rule's `expires` nor its own `ttl` says. */
export const DEFAULT_EXPIRY_MS = 30 * 864e5

/** @param {number} n @param {string} unit */
const count = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`

/** 7 days, 36 hours, 90 minutes: the largest unit that divides the span evenly. @param {number} ms */
function span(ms) {
  if (ms % 864e5 === 0) return { plain: count(ms / 864e5, 'day'), adjective: `${ms / 864e5}-day` }
  if (ms % 36e5 === 0) return { plain: count(ms / 36e5, 'hour'), adjective: `${ms / 36e5}-hour` }
  return { plain: count(Math.round(ms / 6e4), 'minute'), adjective: `${Math.round(ms / 6e4)}-minute` }
}

/** @param {unknown} value @returns {string[]} */
const strings = value => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).filter(v => typeof v === 'string')

/**
 * The roles of an org (F2 spec §3.1) with their members resolved against the
 * members file. `members` are the raw entries of data/members.yaml.
 * - `{ members: [...] }` keeps the ids as written (an id the file does not hold
 *   is `checkGovernance`'s to report, not dropped here).
 * - `{ all: true }` is every member of kind person.
 * - `{ hat: <hat ref> }` (DAO-OS L5 §7.3) is every actor whose standing
 *   observation (lib/hat-readings.mjs `standing`) says it wears that hat exactly,
 *   as `actorIdOf` names it: a member id through `handles.wallet`, else the
 *   CAIP-10 id. With no observations it has no members, so a caller that passes
 *   two arguments gets the book it got before L5.
 * - `maintainer`, when the roles do not define it, is every person (F2-R2).
 * `agents` is the set of ids of kind agent: an agent proposes where a role lists
 * it, and never decides. `organizations` is the set of ids of kind organization,
 * which cannot make a commit and so never decides either.
 * @param {Record<string, unknown> | null | undefined} governance
 * @param {Record<string, unknown>[]} members
 * @param {readonly import('./hat-readings.mjs').HatObservation[] | null} [observations]
 * @returns {RoleBook}
 */
export function resolveRoles(governance, members, observations = []) {
  const entries = Array.isArray(members) ? members.filter(m => isMap(m) && m.id !== undefined && m.id !== null && m.id !== '') : []
  const persons = [...new Set(entries.filter(m => memberKind(m) === 'person').map(m => String(m.id)))]
  const agents = new Set(entries.filter(m => memberKind(m) === 'agent').map(m => String(m.id)))
  const organizations = new Set(entries.filter(m => memberKind(m) === 'organization').map(m => String(m.id)))
  /** @type {Map<string, Role>} */
  const roles = new Map()
  /** @type {string[]} */
  const problems = []
  const held = standing(observations ?? [])
  const written = governance?.roles
  if (Array.isArray(written) && written.length > 0) {
    problems.push('roles is a list; write a map from a role name to { members: [...] } or { all: true }')
  } else if (isMap(written)) {
    for (const [id, def] of Object.entries(written)) {
      if (!ID_PATTERN.test(id)) { problems.push(`role "${id}" is not a role id (lowercase letters, digits, - and _, starting with a letter)`); continue }
      if (!isMap(def)) { problems.push(`role "${id}" is not a mapping; write { members: [...] } or { all: true }`); continue }
      // A role is exactly one of members, all and hat (L5 spec §7.1).
      const keys = ['members', 'all', 'hat'].filter(k => Object.hasOwn(def, k))
      if (keys.length === 3) { problems.push(`role "${id}" has members, all and hat; use one`); continue }
      if (keys.length === 2) { problems.push(`role "${id}" has both ${keys[0]} and ${keys[1]}; use one`); continue }
      if (keys.length === 0) { problems.push(`role "${id}" has neither members nor all: true`); continue }
      if (keys[0] === 'hat') {
        const ref = parseHatRef(def.hat)
        if (!ref) { problems.push(`role "${id}": hat must be a hat ref, eip155:<chain id>:0x followed by 64 hex digits`); continue }
        const hat = hatRef(ref.chain, ref.hatId)
        const wearers = [...held.values()].filter(o => o.wears && o.hat === hat).map(o => actorIdOf(o.account, entries))
        roles.set(id, { id, members: [...new Set(wearers)], all: false, defined: true, hat })
        continue
      }
      if (keys[0] === 'all') {
        if (def.all !== true) { problems.push(`role "${id}": all must be true, or left out`); continue }
        roles.set(id, { id, members: persons, all: true, defined: true })
        continue
      }
      if (!Array.isArray(def.members) || def.members.some(v => typeof v !== 'string')) {
        problems.push(`role "${id}": members must be a list of member ids`)
        continue
      }
      roles.set(id, { id, members: [...new Set(strings(def.members))], all: false, defined: true })
    }
  }
  if (!roles.has(MAINTAINER)) roles.set(MAINTAINER, { id: MAINTAINER, members: persons, all: true, defined: false })
  return { roles, problems, agents, organizations }
}

/**
 * The roles a member holds.
 * @param {Map<string, Role>} roles @param {string} memberId @returns {string[]}
 */
export function rolesOf(roles, memberId) {
  return [...roles.values()].filter(r => r.members.includes(memberId)).map(r => r.id)
}

/**
 * A written rule, normalised: lists are lists, `count` defaults to 1 for approve
 * (the only default, F2-R4, besides `by: system` meaning `method: system`), and nothing that was not written is invented. It
 * never throws: `checkGovernance` is what says a rule is wrong.
 * @param {unknown} raw @returns {Rule | null}
 */
function normalise(raw) {
  if (!isMap(raw)) return null
  const decideRaw = isMap(raw.decide) ? raw.decide : {}
  /** @type {Decide} */
  const decide = {}
  for (const key of ['by', 'method', 'count', 'window', 'quorum', 'threshold', 'system', 'passes']) {
    if (decideRaw[key] !== undefined && decideRaw[key] !== null) decide[/** @type {keyof Decide} */ (key)] = /** @type {never} */ (decideRaw[key])
  }
  if (decide.method === 'approve' && decide.count === undefined) decide.count = 1
  // Architecture §4.5 writes `decide: { by: system, system: … }` with no method: `by: system` is method system.
  if (decide.method === undefined && decide.by === 'system') decide.method = 'system'
  /** @type {Rule} */
  const rule = { id: typeof raw.id === 'string' ? raw.id : '', applies_to: strings(raw.applies_to), decide }
  if (typeof raw.propose === 'string') rule.propose = raw.propose
  // P2's two optional keys: kept as written, `self_approve` only when true, so a snapshot of a rule
  // without it equals what `ruleFor` gave.
  if (typeof raw.expires === 'string' && raw.expires !== '') rule.expires = raw.expires
  if (raw.self_approve === true) rule.self_approve = true
  return rule
}

/**
 * The rules in force (F2 spec §3.5). Written rules win. With none written, a
 * solo model (or no model) runs on SOLO_RULES, and says so with `implied`. Any
 * other model has no default: `{ rules: [], implied: false }`.
 * @param {Record<string, unknown> | null | undefined} governance
 * @returns {{ rules: readonly Rule[], implied: boolean }}
 */
export function effectiveRules(governance) {
  const written = Array.isArray(governance?.rules) ? governance.rules.map(normalise).filter(r => r !== null) : []
  if (written.length > 0) return { rules: /** @type {Rule[]} */ (written), implied: false }
  const model = typeof governance?.model === 'string' ? governance.model.trim() : ''
  if (model === '' || model === 'solo-maintainer') return { rules: SOLO_RULES, implied: true }
  return { rules: [], implied: false }
}

/**
 * The rule that governs a class or a split such as `records:funding` (F2 spec
 * §3.4), by specificity: the exact split, then the class, then `all`. Null when
 * none does: the class is uncovered, and nobody applies it directly.
 * @param {readonly Rule[]} rules @param {string} target @returns {Rule | null}
 */
export function ruleFor(rules, target) {
  const base = target.split(':')[0]
  const named = name => rules.find(r => r.applies_to.includes(name))
  return named(target) ?? named(base) ?? named('all') ?? null
}

/**
 * One rule per class a change touches.
 * @param {readonly Rule[]} rules @param {string[]} classes
 * @returns {{ class: string, rule: Rule | null }[]}
 */
export function rulesForClasses(rules, classes) {
  return classes.map(cls => ({ class: cls, rule: ruleFor(rules, cls) }))
}

const noRole = (rule, role, verb) => `rule "${rule.id}" asks the ${role} role to ${verb}, and this org defines no such role.`

/**
 * Whether `actorId` may propose under `rule`: true, or the sentence to show.
 * @param {Rule} rule @param {string} actorId @param {RoleBook} book @returns {true | string}
 */
export function mayPropose(rule, actorId, book) {
  const role = book.roles.get(rule.propose ?? '')
  if (!role) return noRole(rule, rule.propose ?? '(none named)', 'propose')
  if (!role.members.includes(actorId)) return `"${actorId}" does not hold the ${role.id} role, which rule "${rule.id}" asks of whoever proposes.`
  return true
}

/** What a method asks, as the second half of a sentence. @param {Rule} rule */
function asks(rule) {
  const d = rule.decide
  const by = d.by ?? 'nobody named'
  const window = parseDuration(d.window)
  switch (d.method) {
    case 'direct': return `the ${by} decides alone`
    case 'approve': return `needs ${count(d.count ?? 1, 'approval')} from the ${by}`
    case 'consent': return `needs the ${by}'s consent over a ${window ? span(window).adjective : 'no-length'} objection window`
    case 'vote': {
      const terms = [d.quorum === undefined ? null : `quorum ${d.quorum}`, d.threshold === undefined ? null : `at least ${Math.round(d.threshold * 100)}% yes`]
        .filter(Boolean).join(', ')
      const within = window ? `within ${span(window).plain}` : ''
      const inner = [terms, within].filter(Boolean).join(' ')
      return `needs a vote of the ${by}${inner ? ` (${inner})` : ''}`
    }
    case 'system': return `is decided by the system ${d.system ?? 'named nowhere'}${typeof d.passes?.choice === 'string' ? `, passing when "${d.passes.choice}" wins` : ''}`
    default: return 'decides by no method named'
  }
}

/**
 * Whether `actorId` may apply a change under `rule` alone, with no one else's
 * approval: true only for method `direct`, an author who holds both the propose
 * and the decide roles, and is not an agent. Otherwise the sentence to show.
 * @param {Rule} rule @param {string} actorId @param {RoleBook} book @returns {true | string}
 */
export function mayDecideAlone(rule, actorId, book) {
  if (rule.decide.method !== 'direct') return `rule "${rule.id}" ${asks(rule)}, so it cannot be applied alone.`
  const by = book.roles.get(rule.decide.by ?? '')
  if (!by) return noRole(rule, rule.decide.by ?? '(none named)', 'decide')
  if (book.agents.has(actorId)) return `"${actorId}" is an agent, and an agent never decides.`
  const proposed = mayPropose(rule, actorId, book)
  if (proposed !== true) return proposed
  if (!by.members.includes(actorId)) return `"${actorId}" does not hold the ${by.id} role, which rule "${rule.id}" asks of whoever decides.`
  return true
}

/**
 * One line for the Governance page: where a rule applies, who proposes, what
 * decides. It reads a rule that is wrong without throwing.
 * @param {Partial<Rule>} rule @returns {string}
 */
export function describeRule(rule) {
  const applies = rule.applies_to ?? []
  const where = applies.length === 1 && applies[0] === 'all' ? 'everything' : applies.length > 0 ? applies.join(', ') : 'nothing named'
  const decide = rule.decide ? asks(/** @type {Rule} */ (rule)) : 'decides by no method named'
  const expires = parseDuration(rule.expires)
  const extras = [
    rule.self_approve === true ? "the author's own approval counts" : null,
    expires ? `expires after ${span(expires).plain}` : null,
  ].filter(Boolean)
  return [`applies to ${where}`, `${rule.propose ?? 'nobody named'} proposes`, decide, ...extras].join(' · ')
}

/** Pseudo-refs git itself writes: never a trunk. */
const RESERVED_REF = /^(HEAD|AUTO_MERGE|[A-Z][A-Z_]*_HEAD)$/

/**
 * Whether `name` may be the trunk (`governance.trunk`, P2-R28): true, or the sentence that says why not.
 * The platform builds refs and refspecs from this name, so it is stricter than `git check-ref-format`:
 * git accepts `+main` and `MERGE_HEAD` as branch names, and a name that begins with `+` is a forcing
 * refspec, one that begins with `-` is an option, and a branch called `MERGE_HEAD` makes
 * `rev-parse --verify MERGE_HEAD` answer present with no merge in progress.
 * @param {unknown} name @returns {true | string}
 */
export function validTrunkName(name) {
  if (typeof name !== 'string' || name === '') return 'the name is empty: write the branch the org decides on, such as main.'
  // The proposal branches are `proposal/<id>`; a trunk with that name would be moved by building the branch (review MEDIUM-C).
  // Compared without case: on a case-insensitive file system `Proposal/x` and `proposal/x` are one ref file.
  if (/^proposals?(\/|$)/i.test(name)) return 'a branch name cannot be proposal or begin with proposal/ or proposals/: the proposal branches use those names, and the trunk is never one of them.'
  if (name.startsWith('+')) return 'a branch name cannot begin with + (git reads it as a forcing refspec).'
  if (name.startsWith('-')) return 'a branch name cannot begin with - (git would read it as an option).'
  if (name === '@') return 'a branch cannot be called @ alone.'
  if (name.includes('@{')) return 'a branch name cannot hold @{.'
  if (name.includes('..')) return 'a branch name cannot hold two dots in a row (..).'
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return 'a branch name may not hold a space, a control character, or any of ~ ^ : ? * [ and the backslash.'
  if (name.startsWith('refs/')) return 'write the short branch name (main), not a full ref name that begins with refs/.'
  if (RESERVED_REF.test(name)) return `${name} is reserved: git keeps its own state under that name.`
  if (name.startsWith('/')) return 'a branch name cannot begin with /.'
  if (name.endsWith('/')) return 'a branch name cannot end with /.'
  if (name.includes('//')) return 'a branch name cannot hold an empty part (//).'
  if (name.endsWith('.')) return 'a branch name cannot end with a dot.'
  for (const part of name.split('/')) {
    if (part.startsWith('.')) return 'no part of a branch name can begin with a dot.'
    if (part.endsWith('.lock')) return 'no part of a branch name can end in .lock.'
  }
  // Spec §3.12 (M1): the name must also match this pattern, narrower than git's own rules, so that no
  // refspec or option can be built from it.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return 'a branch name here uses letters, digits and . _ / - only, and begins with a letter or a digit.'
  return true
}

// ---------------------------------------------------------------------------
// The membership tree and who can act (DAO-OS L5 spec §5.1, §7.6)
// ---------------------------------------------------------------------------

/** The warning of L5 spec §5.1, verbatim. */
export const SEVERAL_TREES = 'several Hats trees; name the membership tree in governance.membership.tree'

/**
 * The membership tree (L5 spec §5.1): the `hats-tree` System `governance.membership.tree` names, or, when none is
 * named, the only `hats-tree` System. Null when several exist and none is named, when there is none, when the name
 * is not a `hats-tree` System, or when its chain and address do not make a tree ref.
 * @param {Record<string, unknown> | null | undefined} governance
 * @param {Record<string, unknown>[] | null | undefined} systems
 * @returns {{ id: string, tree: string } | null}
 */
export function membershipTree(governance, systems) {
  const trees = (Array.isArray(systems) ? systems : []).filter(s => isMap(s) && s.kind === 'hats-tree')
  const membership = isMap(governance?.membership) ? governance.membership : null
  const named = membership && typeof membership.tree === 'string' && membership.tree !== '' ? membership.tree : null
  const system = named !== null ? trees.find(s => String(s.id) === named) : trees.length === 1 ? trees[0] : undefined
  if (!system) return null
  try {
    return { id: String(system.id), tree: treeRef(String(system.chain), /** @type {number | string} */ (system.address)) }
  } catch {
    return null
  }
}

/**
 * Whether a member can act at all (L5 spec §7.6, §8.1): a person with a git identity (`handles.git`,
 * `handles.email` or a top-level `email`) or a wallet (`handles.wallet`, a CAIP-10 id) to sign in with.
 * An agent or an organization is never "a person who can act" here.
 * With the membership tree known (`membershipTree`), a wallet counts only on the tree's chain and only when exactly
 * one entry of the members file lists it: sign-in names that member only then (C-7). With no tree, any CAIP-10 wallet.
 * scripts/migrations/v0.5-to-v0.6-governance-rules.mjs keeps a standalone copy of this; change both together.
 * @param {string} memberId @param {Record<string, unknown>[] | null | undefined} members
 * @param {{ tree: string } | null} [tree] the membership tree, as `membershipTree` gives it
 * @returns {boolean}
 */
export function canAct(memberId, members, tree = null) {
  const all = Array.isArray(members) ? members.filter(m => isMap(m)) : []
  const chain = tree ? parseTreeRef(tree.tree)?.chain ?? null : null
  const listedOnce = (/** @type {string} */ wallet) => all.filter(m => walletsOf(m).includes(wallet)).length === 1
  const counts = (/** @type {string} */ wallet) => tree === null || (parseCaip10(wallet)?.chain === chain && listedOnce(wallet))
  return all.some(m => String(m.id) === memberId && memberKind(m) === 'person' &&
    (gitEmails(m).length > 0 || walletsOf(m).some(counts)))
}

/**
 * The §7.6 sentence when nobody can propose under `rule`, else null: its `propose` role is not sourced from a hat
 * (a hat-sourced role is reached by signing in, §8.1 point 3) and holds no person who can act (`canAct`). Null too
 * for a role the book does not hold: `checkGovernance` says that in its own words. `systems` (data/systems.yaml's
 * entries) give the membership tree `canAct` judges wallets by; null or absent, wallets are judged without one.
 * @param {Pick<Rule, 'id' | 'propose'>} rule @param {RoleBook} book
 * @param {Record<string, unknown>[] | null | undefined} members
 * @param {Record<string, unknown> | null | undefined} governance
 * @param {Record<string, unknown>[] | null} [systems]
 * @returns {string | null}
 */
export function nobodyCanPropose(rule, book, members, governance, systems = null) {
  const roleId = rule?.propose
  if (typeof roleId !== 'string') return null
  const role = book.roles.get(roleId)
  if (!role) return null
  const written = isMap(governance?.roles) ? governance.roles[roleId] : undefined
  if (role.hat !== undefined || (isMap(written) && Object.hasOwn(written, 'hat'))) return null
  const tree = systems ? membershipTree(governance, systems) : null
  if (role.members.some(id => canAct(id, members, tree))) return null
  return `rule ${rule.id}: nobody can propose under it. The ${roleId} role has no member with a git or wallet handle and is not sourced from a hat. Add a handle first (the owner's claim: §8.1).`
}

// ---------------------------------------------------------------------------
// checkGovernance: the checks of F2 spec §3.3
// ---------------------------------------------------------------------------

/** @typedef {{ file: string, id?: string, path: string, message: string, level: 'error'|'warn' }} Problem */
/**
 * `live`: the document checked is the org's own data/governance.yaml, not the rules a proposal froze when it was
 * opened. Only then does the L5 §7.6 "nobody can propose" check run (ruling P8): a frozen snapshot judged against
 * today's members would raise it on every old proposal.
 * @typedef {{ members: Record<string, unknown>[] | null, systems: Record<string, unknown>[] | null, classes: readonly string[] | null, live?: boolean }} CheckContext
 */

const RULE_KEYS = ['id', 'applies_to', 'propose', 'decide', 'description', 'expires', 'self_approve']
/** The fields each method takes under `decide`. */
const DECIDE_KEYS = {
  direct: ['by', 'method'],
  approve: ['by', 'method', 'count'],
  consent: ['by', 'method', 'window'],
  vote: ['by', 'method', 'window', 'quorum', 'threshold'],
  system: ['by', 'method', 'system'],
}
const WINDOW_HINT = 'a duration of weeks, days, hours or minutes, such as P7D or PT36H'

const whole = n => typeof n === 'number' && Number.isInteger(n) && n >= 1

/**
 * Everything wrong or doubtful about `roles` and `rules` (F2 spec §3.3), given the
 * org's members, its systems and the change classes. `members`, `systems` or
 * `classes` null means "not known": the checks that need it are skipped, never
 * guessed. Problems carry no `file`; validateRepo and validate:governance add it.
 * @param {Record<string, unknown> | null | undefined} governance
 * @param {CheckContext} ctx
 * @returns {Problem[]}
 */
export function checkGovernance(governance, ctx) {
  /** @type {Problem[]} */
  const out = []
  /** @param {'error'|'warn'} level @param {string} path @param {string} message */
  const add = (level, path, message) => out.push({ file: '', path, message, level })

  const members = ctx.members
  const book = resolveRoles(governance, members ?? [])
  for (const message of book.problems) add('error', 'roles', message)
  const known = members ? new Set(members.filter(m => isMap(m)).map(m => String(m.id))) : null
  if (known && isMap(governance?.roles)) {
    for (const [id, role] of book.roles) {
      if (!role.defined || role.all) continue
      for (const m of role.members) if (!known.has(m)) add('error', `roles.${id}`, `role "${id}" lists "${m}", who is not in data/members.yaml`)
    }
  }

  // The membership tree (L5 spec §5.1) and the roles sourced from a hat (§7.1, §7.6). The hat is checked exactly,
  // never against the hats above it (C-6). Without data/systems.yaml none of this is judged.
  const membership = governance?.membership
  const named = isMap(membership) && typeof membership.tree === 'string' && membership.tree !== ''
  if (membership !== undefined && membership !== null && !named) {
    add('error', 'membership', 'membership is { tree: <the id of a hats-tree System in data/systems.yaml> }')
  }
  const systems = ctx.systems
  if (systems) {
    if (named) {
      const system = systems.find(s => isMap(s) && String(s.id) === membership.tree)
      if (!system) add('error', 'membership.tree', `membership.tree names "${membership.tree}", and data/systems.yaml has no system by that id`)
      else if (system.kind !== 'hats-tree') add('error', 'membership.tree', `membership.tree names "${membership.tree}", which is a ${String(system.kind)} System, not a hats-tree`)
    } else if (systems.filter(s => isMap(s) && s.kind === 'hats-tree').length > 1) add('warn', 'membership', SEVERAL_TREES)
    const tree = membershipTree(governance, systems)
    const parsed = tree ? parseTreeRef(tree.tree) : null
    for (const role of book.roles.values()) {
      if (role.hat === undefined) continue
      const at = `roles.${role.id}.hat`
      const hat = /** @type {{ chain: string, hatId: string }} */ (parseHatRef(role.hat))
      if (!tree || !parsed) {
        add('error', at, `role "${role.id}" is sourced from the hat ${role.hat}, and this org has no membership tree to read it in: add a hats-tree System to data/systems.yaml, or name one in governance.membership.tree`)
      } else if (hat.chain !== parsed.chain) {
        add('error', at, `role "${role.id}": the hat ${role.hat} is on ${hat.chain}, and the membership tree ${tree.tree} is on ${parsed.chain}`)
      } else if (!inTree(hat.hatId, parsed.treeId)) {
        add('error', at, `role "${role.id}": the hat ${role.hat} is not in the membership tree ${tree.tree}`)
      }
    }
  }

  const trunk = governance?.trunk
  if (trunk !== undefined && trunk !== null) {
    const ok = validTrunkName(trunk)
    if (ok !== true) add('error', 'trunk', `trunk ${JSON.stringify(trunk)} cannot be the trunk: ${ok}`)
  }

  const raw = governance?.rules
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return out
  if (!Array.isArray(raw)) { add('error', 'rules', 'rules must be a list of rules'); return out }

  const seen = new Map()
  const systemIds = systems ? new Set(systems.filter(s => isMap(s)).map(s => String(s.id))) : null
  /** @type {Map<string, string>} class target → the rule id that covers it */
  const covers = new Map()
  const classes = ctx.classes
  const classList = classes ? classes.join(', ') : ''

  raw.forEach((entry, index) => {
    if (!isMap(entry)) { add('error', `rules.#${index + 1}`, `rule #${index + 1} is not a mapping of fields to values`); return }
    const hasId = typeof entry.id === 'string' && entry.id !== ''
    const id = hasId ? String(entry.id) : ''
    const label = hasId ? `rule "${id}"` : `rule #${index + 1}`
    const at = `rules.${hasId ? id : `#${index + 1}`}`
    /** @param {'error'|'warn'} level @param {string} sub @param {string} message */
    const rule = (level, sub, message) => add(level, sub ? `${at}.${sub}` : at, `${label}: ${message}`)

    if (!hasId) add('error', at, `rule #${index + 1} has no id`)
    else if (!ID_PATTERN.test(id)) rule('error', 'id', 'the id must be lowercase letters, digits, - and _, starting with a letter')
    else if (seen.has(id)) add('error', at, `rule id "${id}" is used twice; each rule needs its own`)
    if (hasId) seen.set(id, true)

    for (const key of Object.keys(entry)) {
      if (!RULE_KEYS.includes(key)) rule('error', key, `${key} is not a field of a rule (${RULE_KEYS.join(', ')})`)
    }

    // expires (any method) and self_approve (P2 spec §3.6)
    if (entry.expires !== undefined && parseDuration(entry.expires) === null) {
      rule('error', 'expires', `expires ${JSON.stringify(entry.expires)} is not ${WINDOW_HINT}`)
    }
    if (entry.self_approve !== undefined && typeof entry.self_approve !== 'boolean') {
      rule('error', 'self_approve', `self_approve must be true or false, not ${JSON.stringify(entry.self_approve)}`)
    }

    // applies_to
    const applies = entry.applies_to
    if (!Array.isArray(applies) || applies.length === 0) rule('error', 'applies_to', 'applies_to must list at least one class')
    else {
      for (const target of applies) {
        const [cls, ...rest] = typeof target === 'string' ? target.split(':') : ['']
        const valid = typeof target === 'string' && (target === 'all' ||
          (classes === null || classes.includes(cls)) && (rest.length === 0 || (rest.length === 1 && /^[a-z0-9_-]+$/.test(rest[0]))))
        if (!valid) {
          rule('error', 'applies_to', `applies_to ${JSON.stringify(target)} is not a change class (${classList}), a split such as records:funding, or all`)
          continue
        }
        const other = covers.get(target)
        if (other !== undefined && other !== id) {
          add('error', `${at}.applies_to`, `class "${target}" is covered by both rule "${other}" and rule "${id || `#${index + 1}`}"; give each class one rule, or split it (records:funding)`)
        } else covers.set(target, id || `#${index + 1}`)
      }
    }

    // propose
    if (typeof entry.propose !== 'string' || entry.propose === '') rule('error', 'propose', 'propose is missing; name the role that may propose')
    else if (!book.roles.has(entry.propose)) rule('error', 'propose', `propose names the role "${entry.propose}", and roles defines none by that name`)
    else {
      // L5 §7.6 (F-L3-1): on the live document only (ruling P8), and only with the members known. The sentence is the
      // spec's, so it is added whole rather than through `rule`. A role sourced from a hat has no members until a
      // reading names them, which is not "no members".
      const nobody = ctx.live === true && members ? nobodyCanPropose({ id: id || `#${index + 1}`, propose: entry.propose }, book, members, governance, systems) : null
      const proposers = /** @type {Role} */ (book.roles.get(entry.propose))
      if (nobody !== null) add('error', `${at}.propose`, nobody)
      else if (proposers.hat === undefined && proposers.members.length === 0) rule('warn', 'propose', `role "${entry.propose}" has no members, so nobody can propose it`)
    }

    // decide
    const decide = entry.decide
    if (!isMap(decide)) { rule('error', 'decide', 'decide is missing; write { by: <role>, method: <method> }'); return }
    const method = decide.method === undefined && decide.by === 'system' ? 'system' : decide.method
    if (typeof method !== 'string' || !METHODS.includes(/** @type {Method} */ (method))) {
      // A key no method takes is a typo; name it before the method, which may be the typo itself.
      const everyKey = [...new Set(Object.values(DECIDE_KEYS).flat())]
      for (const key of Object.keys(decide)) {
        if (!everyKey.includes(key) && key !== 'passes') rule('error', `decide.${key}`, `decide.${key} is not a field of decide (it takes ${everyKey.join(', ')})`)
      }
      rule('error', 'decide.method', `method ${JSON.stringify(method)} is not one of ${METHODS.join(', ')}`)
      return
    }
    for (const key of Object.keys(decide)) {
      // `passes` (ruling K2) names the choice that must win an outside vote: method system's alone, checked below.
      if (key === 'passes') {
        if (method !== 'system') rule('error', 'decide.passes', `decide.passes names the choice that must win an outside vote, so only method system takes it; this rule is decided by ${method}`)
        continue
      }
      if (!DECIDE_KEYS[method].includes(key)) {
        rule('error', `decide.${key}`, `decide.${key} is not a field of method ${method} (it takes ${DECIDE_KEYS[method].join(', ')})`)
      }
    }

    if (method === 'system') {
      if (decide.by !== undefined && decide.by !== 'system') rule('error', 'decide.by', 'method system is decided by the system itself: write decide.by: system')
      if (typeof decide.system !== 'string' || decide.system === '') {
        rule('error', 'decide.system', 'method system needs decide.system, the id of a system in data/systems.yaml')
      } else if (systemIds && !systemIds.has(decide.system)) {
        rule('error', 'decide.system', `decide.system names "${decide.system}", and data/systems.yaml has no system by that id`)
      }
      const passes = decide.passes
      if (passes !== undefined && !(isMap(passes) && Object.keys(passes).length === 1 && typeof passes.choice === 'string' && passes.choice !== '')) {
        rule('error', 'decide.passes', `decide.passes is { choice: "<the label of the choice that must win>" }, not ${JSON.stringify(passes)}`)
      }
      return
    }

    // A role decides. The roles' members are who may.
    if (decide.by === 'system') { rule('error', 'decide.by', 'decide.by is system, which only method system can use'); return }
    const by = typeof decide.by === 'string' ? book.roles.get(decide.by) : undefined
    if (!by) rule('error', 'decide.by', `decide.by names the role ${JSON.stringify(decide.by ?? null)}, and roles defines none by that name`)
    else {
      const agentsIn = by.members.filter(m => book.agents.has(m))
      for (const a of agentsIn) {
        rule('error', 'decide.by', `role "${by.id}" lists the agent "${a}", and an agent never decides; take it out of the role, or decide by another role`)
      }
      for (const o of by.members.filter(m => book.organizations.has(m))) {
        rule('error', 'decide.by', `role "${by.id}" lists the organization "${o}", and an organization cannot make commits, so it never decides; take it out of the role, or decide by another role`)
      }
      if (by.hat === undefined && by.members.length === 0) rule('error', 'decide.by', `role "${by.id}" has no members, so nobody can decide`)
    }
    const deciders = by ? by.members.filter(m => !book.agents.has(m) && !book.organizations.has(m)).length : 0

    if (method === 'approve' && decide.count !== undefined) {
      if (!whole(decide.count)) rule('error', 'decide.count', 'count must be a whole number of 1 or more')
      else if (by && deciders > 0 && decide.count > deciders) {
        rule('error', 'decide.count', `count is ${decide.count}, and role "${by.id}" has ${deciders} members, so it can never be met`)
      } else if (by && deciders > 0 && decide.count === deciders && entry.self_approve !== true) {
        // Four eyes asks for `count` approvals from deciders other than the author. When every member who may
        // propose is also a decider, the author is always one, and the rule can never be met (spec §3.6, LOW-4).
        const proposers = typeof entry.propose === 'string' ? book.roles.get(entry.propose)?.members ?? [] : []
        if (proposers.length > 0 && proposers.every(m => by.members.includes(m))) {
          rule('warn', 'decide.count', `count ${decide.count} equals the ${count(deciders, 'member')} of role "${by.id}", and everyone who may propose is one of them, so four eyes can never be met; set self_approve, lower the count, or let someone outside the role propose`)
        }
      }
    }
    if (method === 'consent' || method === 'vote') {
      if (decide.window === undefined) rule('error', 'decide.window', `method ${method} needs decide.window, such as P7D`)
      else if (parseDuration(decide.window) === null) rule('error', 'decide.window', `window ${JSON.stringify(decide.window)} is not ${WINDOW_HINT}`)
      else if (entry.expires === undefined || parseDuration(entry.expires) !== null) {
        // A window that ends at or after the expiry could only be met once the proposal had expired (review MEDIUM-B).
        const window = /** @type {number} */ (parseDuration(decide.window))
        const own = entry.expires === undefined ? null : parseDuration(entry.expires)
        if (window >= (own ?? DEFAULT_EXPIRY_MS)) {
          const against = own === null ? `the default expiry of ${span(DEFAULT_EXPIRY_MS).plain}` : `the rule's expires ${entry.expires}`
          rule('error', 'decide.window', `window ${decide.window} ends after ${against}, so the proposal would expire before the ${method === 'vote' ? 'vote' : 'objection window'} could close and the rule could never be met: shorten the window or lengthen expires`)
        }
      }
    }
    if (method === 'vote') {
      if (decide.quorum === undefined || !whole(decide.quorum)) rule('error', 'decide.quorum', 'method vote needs decide.quorum, a whole number of 1 or more')
      else if (by && deciders > 0 && decide.quorum > deciders) {
        rule('error', 'decide.quorum', `quorum is ${decide.quorum}, and role "${by.id}" has ${deciders} members, so it can never be met`)
      }
      const t = decide.threshold
      if (typeof t !== 'number' || !(t > 0 && t <= 1)) rule('error', 'decide.threshold', 'threshold must be above 0 and at most 1 (0.5 is half of the votes cast)')
    }
  })

  // Coverage and the model, over the rules as normalised.
  const { rules } = effectiveRules(governance)
  if (classes) {
    const uncovered = classes.filter(c => ruleFor(rules, c) === null)
    const governanceUncovered = uncovered.includes('governance')
    const rest = uncovered.filter(c => c !== 'governance')
    if (rest.length > 0) {
      add('warn', 'rules', `no rule covers the ${rest.length === 1 ? 'class' : 'classes'} ${rest.join(', ')}: nobody can apply a change of ${rest.length === 1 ? 'that class' : 'those classes'} directly until a rule does`)
    }
    if (governanceUncovered) add('warn', 'rules', 'no rule covers the class governance, so the rules and roles could never be changed through the platform; add one')
  }
  if (typeof governance?.model === 'string' && governance.model.trim() === 'solo-maintainer') {
    const notDirect = rules.filter(r => r.decide.method !== undefined && r.decide.method !== 'direct').map(r => r.id)
    if (notDirect.length > 0) {
      add('warn', 'model', `the model is solo-maintainer, but ${notDirect.length === 1 ? 'rule' : 'rules'} ${notDirect.map(id => `"${id}"`).join(', ')} ${notDirect.length === 1 ? 'does' : 'do'} not decide directly; the rules win, so change the model or the ${notDirect.length === 1 ? 'rule' : 'rules'}`)
    }
  }
  return out
}
