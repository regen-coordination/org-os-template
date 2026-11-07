// packages/admin/lib/narrow.mjs
//
// Narrowing (DAO-OS L5 spec §9.7, C-14): a narrowing applies at once under the named rule `visibility/narrow`, outside
// data/governance.yaml (like the owner's claim), and what leaves git leaves it in one commit. This module holds what the
// server and the validators share about it: the rule's name and its copy; how a proposal's ops are rewritten when what
// they write leaves git (`substituteOps`, R-L5-10.7: a ledger op holding restricted data becomes a placeholder, open or
// closed); and the offline checks validate:governance runs on a commit carrying `Org-Rule: visibility/narrow`, which is
// accepted only when everything it changes narrows. Pure: no node:* import, so the client can read the copy.

import { gitOpsOf, isPlaceholder } from './ops.mjs'
import { canonicalJson, revOf } from './proposals.mjs'
import { formatLevel, fullLevel, gitAllows, narrowerOrEqual, parseLevel, readFullPolicy } from './visibility.mjs'
import { isMap } from './yaml-util.mjs'

/** The named rule a narrowing commits under (§9.7), in `Org-Rule`. */
export const NARROW_RULE = 'visibility/narrow'

/** The confirmation of a narrowing that takes something out of the repository (§9.7, C-14): asked before it is sent, and
 *  answered with it. */
export const LEAVES_GIT = "It leaves the repository from now on. Its earlier versions stay in the repository's history, which members could already read."

/** A "narrowing" that lets someone read what they could not before (§9.7, §13: 409). */
export const WIDENS = 'This makes it readable by more people, so it is proposed, not applied.'

/** The member list and its identity links stay in git (R-L5-16.9): the rules count them (§7, §8.1). */
export const ROSTER = "The member list and its identity links are what the rules count, so a member's record and members.handles stay in the repository: " +
  'narrow a contact field, such as email, instead. Nothing was written.'

/** The subject of a narrowing that changes only the private store (§10.3's words for a change git holds only the fact of). */
export const STORE_ONLY_SUBJECT = 'A change to a restricted collection'

/** The ledger events whose `rev` a narrowing carries to the rev git holds after it (R-L5-16.6): a substitution is no
 *  revision, so what was said of the proposal still counts. */
export const CARRIED_EVENTS = Object.freeze(['approve', 'vote', 'object'])

/** A wallet link widened by someone other than its own person (§9.7, Q2/Q50: 403). */
export const OWN_LINK = 'Only the person whose address it is can widen this link.'

/**
 * @typedef {Record<string, unknown>} LedgerOp
 * @typedef {{ keep: LedgerOp | null, moved: unknown[] }} Taken what stays in git of one git op (null: nothing), and
 *   the private ops that carry the rest (none: the op is left as it is)
 */

/**
 * A proposal's ops with what a narrowing takes out of git moved to private ops (§9.6, R-L5-10.7). `take` is asked of
 * each git op; one it moves something from is kept reduced (or dropped), and the private ops it gives are returned for
 * the caller to hold as placeholders after the proposal's own. The order kept: the git ops, then the placeholders the
 * proposal already held. Null when nothing moves.
 * @param {readonly LedgerOp[]} ops
 * @param {(op: LedgerOp) => Taken | null} take
 * @returns {{ git: LedgerOp[], held: LedgerOp[], moved: unknown[] } | null}
 */
export function substituteOps(ops, take) {
  /** @type {LedgerOp[]} */
  const git = []
  /** @type {unknown[]} */
  const moved = []
  for (const op of gitOpsOf(ops)) {
    const t = take(op)
    if (t === null || t.moved.length === 0) { git.push(op); continue }
    if (t.keep !== null) git.push(t.keep)
    moved.push(...t.moved)
  }
  if (moved.length === 0) return null
  return { git, held: ops.filter(isPlaceholder), moved }
}

/** `op` without `fields` in what it writes (`set` or `value`); null for an update left with nothing to set.
 *  @param {LedgerOp} op @param {readonly string[]} fields @returns {LedgerOp | null} */
export function withoutFields(op, fields) {
  const key = op.op === 'update' ? 'set' : 'value'
  const written = isMap(op[key]) ? op[key] : {}
  const rest = Object.fromEntries(Object.entries(written).filter(([k]) => !fields.includes(k)))
  if (op.op === 'update' && Object.keys(rest).length === 0) return null
  return { ...op, [key]: rest }
}

/**
 * One entry of a collection's file with `field` taken out of git (a field narrowed stricter than members). Narrowing
 * `members.email` never removes an identity (Q78): a member who has no `handles.git` gets it, set to the e-mail, in the
 * same commit, so whoever committed with that e-mail is still that member and the org cannot lock itself out. A member
 * who has one keeps it as it was. Shared by the server and validate:governance, which accepts exactly this.
 * @param {string} collection @param {string} field @param {Record<string, unknown>} entry @returns {Record<string, unknown>}
 */
export function takenOutOfGit(collection, field, entry) {
  const out = Object.fromEntries(Object.entries(entry).filter(([k]) => k !== field))
  if (collection !== 'members' || field !== 'email') return out
  const emails = (Array.isArray(entry.email) ? entry.email : [entry.email]).filter(e => typeof e === 'string' && e.trim() !== '')
  if (emails.length === 0) return out
  const handles = isMap(entry.handles) ? entry.handles : {}
  const git = (Array.isArray(handles.git) ? handles.git : [handles.git]).filter(e => typeof e === 'string' && e.trim() !== '')
  if (git.length > 0) return out
  return { ...out, handles: { ...handles, git: Array.isArray(entry.email) ? emails : emails[0] } }
}

// ── what the rules count by: never narrowed out of git ───────────────────────────────────────────────────────────

/** @typedef {{ registry: string, id: string, field: string }} Referrer */

/**
 * Where data/governance.yaml's block (`governance`) names record `id` of `registry` (R-L5-16.9, 16.12): a role's
 * `members`, the membership tree's system (`membership.tree`), and a system a rule decides by (`decide.system`). Moving
 * such a record out of git changes who the rules count, or leaves a rule that can never be met, outside the rules.
 * @param {unknown} governance @param {string} registry @param {string} id @returns {Referrer[]}
 */
export function governanceNamesOf(governance, registry, id) {
  if (!isMap(governance)) return []
  /** @type {Referrer[]} */
  const out = []
  const file = 'data/governance.yaml'
  if (registry === 'systems') {
    if (isMap(governance.membership) && governance.membership.tree === id) out.push({ registry: file, id: 'governance', field: 'membership.tree' })
    for (const rule of Array.isArray(governance.rules) ? governance.rules : []) {
      if (isMap(rule) && isMap(rule.decide) && rule.decide.system === id) out.push({ registry: file, id: String(rule.id ?? '(no id)'), field: 'decide.system' })
    }
  }
  if (registry === 'members' && isMap(governance.roles)) {
    for (const [role, def] of Object.entries(governance.roles)) {
      if (isMap(def) && Array.isArray(def.members) && def.members.map(String).includes(id)) out.push({ registry: file, id: role, field: 'roles' })
    }
  }
  return out
}

/** The referrers in words: `<registry> "<id>" (<field>)`, ten at most. @param {readonly Referrer[]} refs */
export const referrersInWords = refs =>
  `${refs.slice(0, 10).map(r => `${r.registry} "${r.id}" (${r.field})`).join(', ')}${refs.length > 10 ? ` and ${refs.length - 10} more` : ''}`

// ── the commit's subject: what it narrows, read again offline ──────────────────────────────────────────────────

/**
 * @typedef {{ kind: 'record', registry: string, id: string, level: string }
 *   | { kind: 'field', collection: string, field: string, level: string }
 *   | { kind: 'collection', collection: string, level: string }
 *   | { kind: 'store' }} NarrowTarget
 */

/** The subject a narrowing commits with: what it narrows and to what (R-L5-16.7). The server writes it; validate:governance
 *  reads it back (`parseNarrowSubject`) and accepts only the changes that narrowing makes.
 *  @param {NarrowTarget} t @returns {string} */
export function narrowSubject(t) {
  if (t.kind === 'store') return STORE_ONLY_SUBJECT
  if (t.kind === 'record') return `visibility: narrow ${t.registry}:${t.id} to ${t.level}`
  if (t.kind === 'field') return `visibility: narrow ${t.field} of ${t.collection} to ${t.level}`
  return `visibility: narrow ${t.collection} to ${t.level}`
}

/** @param {string} subject @returns {NarrowTarget | null} */
export function parseNarrowSubject(subject) {
  const s = subject.trim()
  if (s === STORE_ONLY_SUBJECT) return { kind: 'store' }
  let m = /^visibility: narrow (\S+) of ([^\s:]+) to (\S+)$/.exec(s)
  if (m) return { kind: 'field', field: m[1], collection: m[2], level: m[3] }
  m = /^visibility: narrow ([^\s:]+):(\S+) to (\S+)$/.exec(s)
  if (m) return { kind: 'record', registry: m[1], id: m[2], level: m[3] }
  m = /^visibility: narrow ([^\s:]+) to (\S+)$/.exec(s)
  if (m) return { kind: 'collection', collection: m[1], level: m[2] }
  return null
}

// ── offline: is a commit under `visibility/narrow` exactly the narrowing it says? (validate:governance) ─────────────

const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => canonicalJson(a) === canonicalJson(b)
const held = (/** @type {unknown} */ v) => v !== undefined && v !== null
const omitKey = (/** @type {Record<string, unknown>} */ v, /** @type {string} */ key) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== key))
const PLACEHOLDER_KEYS = ['class', 'digest', 'op', 'ref']
/** A placeholder as the server writes one (§9.6), of class `cls`. @param {unknown} op @param {string} cls */
const wellFormed = (op, cls) => isMap(op) && same(Object.keys(op).sort(), PLACEHOLDER_KEYS) && op.op === 'private' && op.class === cls &&
  typeof op.ref === 'string' && /^prv_[0-9a-f]{16}$/.test(op.ref) && typeof op.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(op.digest)

/**
 * @typedef {(op: Record<string, unknown>, open: boolean) => { keep: Record<string, unknown> | null } | null} Takes
 *   what a narrowing takes from one git op of a proposal (open or not): null, nothing; else what stays of it in git
 */

/**
 * Why the ops `now` are not the git ops `was` with exactly the substitution `takes` describes, or null; and how many ops
 * it takes from (0: `was` holds nothing it narrows). The git ops those it held, each one `takes` names reduced (or
 * dropped) as `takes` says and the others as they were; the placeholders it held kept in their order and one well-formed
 * new one of class `cls` after them for each op taken from. `what` names the op list in the sentences.
 * @param {readonly unknown[]} wOps @param {readonly unknown[]} pOps @param {Takes} takes @param {boolean} open
 * @param {string} cls @param {string} what @returns {{ problem: string | null, taken: number }}
 */
function opsSubstituted(wOps, pOps, takes, open, cls, what) {
  const expected = []
  let taken = 0
  for (const op of gitOpsOf(wOps)) {
    const t = isMap(op) ? takes(op, open) : null
    if (t === null) { expected.push(op); continue }
    taken++
    if (t.keep !== null) expected.push(t.keep)
  }
  if (taken === 0) return { problem: null, taken }
  const wHeld = wOps.filter(isPlaceholder)
  const pGit = gitOpsOf(pOps)
  const pHeld = pOps.filter(isPlaceholder)
  const problem = (() => {
    if (!same(pGit, expected)) return `it changes the ops of ${what} otherwise than by taking out what it narrows`
    if (!same(pOps, [...pGit, ...pHeld])) return `${what} holds a placeholder before a git op`
    if (!same(wHeld, pHeld.slice(0, wHeld.length))) return `it changes the placeholders ${what} already held`
    const added = pHeld.slice(wHeld.length)
    if (added.length !== taken || !added.every(op => wellFormed(op, cls))) {
      return `${what} holds ${added.length} new placeholders for the ${taken} op${taken === 1 ? '' : 's'} this narrowing takes from, each { op: private, ref, class: ${cls}, digest }`
    }
    return null
  })()
  return { problem, taken }
}

/**
 * Why the ledger `now` is not the ledger `was` with exactly the substitution `takes` describes, or null (R-L5-10.7,
 * R-L5-16.6, R-L5-final.2): the same proposals, each unchanged but for its ops, its rev, the rev of the approvals, votes
 * and objections it held on its old rev (carried to the new one), and the ops its `revise` events recorded; its ops
 * substituted as `opsSubstituted` says, its rev the rev of its ops; each revise event's ops substituted the same way
 * (its other keys unchanged; its rev carried to the proposal's new rev when it was the proposal's rev), so no revision
 * keeps in clear what the narrowing takes out of git (final review MF-2).
 * @param {readonly unknown[]} was @param {readonly unknown[]} now @param {Takes} takes @param {string} cls
 * @returns {string | null}
 */
export function ledgerSubstitutedProblem(was, now, takes, cls) {
  const idOf = (/** @type {unknown} */ p, /** @type {number} */ i) => (isMap(p) && p.id !== undefined && p.id !== null ? String(p.id) : `#${i + 1}`)
  const before = new Map(was.map((p, i) => [idOf(p, i), p]))
  const after = new Map(now.map((p, i) => [idOf(p, i), p]))
  if (before.size !== after.size) return 'it adds proposals to data/proposals.yaml or takes them out'
  for (const [id, p] of after) {
    const w = before.get(id)
    if (w === undefined) return `it adds proposal ${id} to data/proposals.yaml`
    if (!isMap(w) || !isMap(p)) { if (!same(w, p)) return `it changes proposal ${id}`; continue }
    for (const k of new Set([...Object.keys(w), ...Object.keys(p)])) {
      if (k !== 'ops' && k !== 'rev' && k !== 'events' && !same(w[k], p[k])) return `it changes the \`${k}\` of proposal ${id}`
    }
    const open = w.state === 'open'
    const wOps = Array.isArray(w.ops) ? w.ops : []
    const pOps = Array.isArray(p.ops) ? p.ops : []
    const own = opsSubstituted(wOps, pOps, takes, open, cls, `proposal ${id}`)
    const wEvents = Array.isArray(w.events) ? w.events : []
    const pEvents = Array.isArray(p.events) ? p.events : []
    const revisions = wEvents.filter(e => isMap(e) && e.kind === 'revise' && Array.isArray(e.ops) && opsSubstituted(e.ops, [], takes, open, cls, '').taken > 0)
    if (own.taken === 0 && revisions.length === 0) {
      if (!same(w.ops, p.ops) || !same(w.rev, p.rev) || !same(w.events, p.events)) return `it changes proposal ${id}, which holds nothing this narrowing takes out`
      continue
    }
    if (own.taken === 0) {
      if (!same(w.ops, p.ops) || !same(w.rev, p.rev)) return `it changes the ops of proposal ${id}, which hold nothing this narrowing takes out`
    } else {
      if (own.problem !== null) return own.problem
      if (p.rev !== revOf(pOps)) return `the rev of proposal ${id} is not the rev of its ops (${revOf(pOps)})`
    }
    const carriedRev = (/** @type {Record<string, unknown>} */ e) => (e.rev === w.rev ? p.rev : e.rev)
    const eventsChanged = `it changes the events of proposal ${id} otherwise than by carrying its approvals, votes and objections to its new rev`
    if (wEvents.length !== pEvents.length) return eventsChanged
    for (let i = 0; i < wEvents.length; i++) {
      const we = wEvents[i]
      const pe = pEvents[i]
      if (isMap(we) && revisions.includes(we)) {
        const eid = String(we.id ?? `#${i + 1}`)
        if (!isMap(pe)) return eventsChanged
        for (const k of new Set([...Object.keys(we), ...Object.keys(pe)])) {
          if (k !== 'ops' && k !== 'rev' && !same(we[k], pe[k])) return `it changes the \`${k}\` of revise event ${eid} of proposal ${id}`
        }
        const r = opsSubstituted(/** @type {unknown[]} */ (we.ops), Array.isArray(pe.ops) ? pe.ops : [], takes, open, cls, `revise event ${eid} of proposal ${id}`)
        if (r.problem !== null) return r.problem
        if (!same(pe.rev, carriedRev(we))) return `revise event ${eid} of proposal ${id} is about rev ${String(pe.rev)}, where ${String(carriedRev(we))} was expected`
        continue
      }
      const expected = isMap(we) && CARRIED_EVENTS.includes(String(we.kind)) && we.rev === w.rev ? { ...we, rev: p.rev } : we
      if (!same(expected, pe)) return eventsChanged
    }
  }
  return null
}

/**
 * @typedef {object} NarrowCommit
 * @property {string} subject the commit's subject
 * @property {readonly string[]} files every file it changes
 * @property {(path: string) => { was: unknown, now: unknown }} doc a changed file's parsed document at the parent and in
 *   the commit (null where it is absent)
 * @property {{ was: unknown, now: unknown }} policy data/visibility.yaml's document at the parent and in the commit
 * @property {(doc: unknown, registry: string) => Record<string, unknown>[]} records a registry document's entries
 * @property {(registry: string) => string} classOf a registry's class
 * @property {(registry: string, id: string) => Referrer[]} referred what names a record at the parent: other entries'
 *   references, and data/governance.yaml (`governanceNamesOf`)
 */

const VISIBILITY_FILE = 'data/visibility.yaml'
const LEDGER_FILE = 'data/proposals.yaml'
const RESERVED = ['id', 'visibility']

/** Is `level` (a token) narrower than or equal to `than`, and is it a level at all? @param {string} level @param {ReturnType<typeof fullLevel>} than */
const within = (level, than) => { const l = parseLevel(level); return l !== null && narrowerOrEqual(l, than) }

/**
 * Why commit `c`, carrying `Org-Rule: visibility/narrow`, is not exactly the narrowing its subject names, or null when it
 * is (R-L5-16.7). Accepted changes, and only these:
 * - a record (`<registry>:<id>`, never a member's): to `members`, that entry's own `visibility` set to members from a wider
 *   level; stricter, that entry taken out of its file, and the ledger's ops on it held as placeholders;
 * - a git collection to `members`: its level in data/visibility.yaml, and `visibility: public` taken off its entries;
 * - a field of a collection (never `members.handles`): its level in data/visibility.yaml (or the same level, when git
 *   still holds values of it); stricter than members, that field taken out of every entry of its file, and out of the
 *   ledger's ops that write it, held as placeholders;
 * - `A change to a restricted collection`: no file at all (the private store alone).
 * Where a ledger op is substituted, its proposal's approvals, votes and objections on the old rev are carried to the new
 * one (R-L5-16.6), and the ops its revise events recorded are substituted the same way (R-L5-final.2). Nothing else; no
 * file is deleted.
 * @param {NarrowCommit} c @returns {string | null}
 */
export function narrowCommitProblem(c) {
  const t = parseNarrowSubject(c.subject)
  if (t === null) return 'its subject does not say what it narrows ("visibility: narrow <record, collection or field> to <level>")'
  if (t.kind === 'store') return c.files.length === 0 ? null : `it says it changes only the private store, and it changes ${c.files.join(', ')}`
  const level = parseLevel(t.level)
  if (level === null) return `"${t.level}" is not a level`
  const strict = !gitAllows(level)
  const pa = policyOf(c.policy.was)
  const pb = policyOf(c.policy.now)
  /** @type {string[]} */
  const allowed = []
  const fileOf = (/** @type {string} */ registry) => `data/${registry}.yaml`
  const deleted = c.files.find(f => c.doc(f).now === null)
  if (deleted) return `it deletes ${deleted}`
  const ledger = (/** @type {Takes} */ takes, /** @type {string} */ registry) => {
    if (!c.files.includes(LEDGER_FILE)) return null
    allowed.push(LEDGER_FILE)
    const d = c.doc(LEDGER_FILE)
    return ledgerSubstitutedProblem(c.records(d.was, 'proposals'), c.records(d.now, 'proposals'), takes, c.classOf(registry))
  }
  let why = null

  if (t.kind === 'record') {
    const name = `${t.registry}:${t.id}`
    if (t.registry === 'members') return 'a member\'s record stays in the repository: the rules count it'
    // As the server refuses it (REFERRED): a record something names stays, judged from the parent's tree (R-L5-16.12).
    const refs = strict ? c.referred(t.registry, t.id) : []
    if (refs.length > 0) return `${name} is named by ${referrersInWords(refs)}, so it stays in the repository`
    const f = fileOf(t.registry)
    if (!c.files.includes(f)) return `it does not change ${f}, where ${name} is`
    allowed.push(f)
    if (!same(pa, pb)) return `it changes ${VISIBILITY_FILE}, which narrowing one record does not`
    const d = c.doc(f)
    const was = c.records(d.was, t.registry)
    const now = c.records(d.now, t.registry)
    const at = was.findIndex(e => e.id !== undefined && e.id !== null && String(e.id) === t.id)
    if (at < 0) return `${f} held no ${name} to narrow`
    if (!within(t.level, fullLevel(pa, t.registry, was[at]))) return `${name} was ${formatLevel(fullLevel(pa, t.registry, was[at]))}, and ${t.level} is not within it`
    const expected = strict ? was.filter((_, i) => i !== at) : was.map((e, i) => (i === at ? { ...e, visibility: t.level } : e))
    if (!same(now, expected)) return `it changes ${f} otherwise than by ${strict ? `taking ${name} out of it` : `setting the visibility of ${name} to ${t.level}`}`
    why = strict ? ledger(op => (op.record === name ? { keep: null } : null), t.registry) : null
  } else if (t.kind === 'collection') {
    if (strict) return 'a collection in the repository is public or members'
    if (c.files.includes(VISIBILITY_FILE)) allowed.push(VISIBILITY_FILE)
    const expectedPolicy = JSON.parse(JSON.stringify(pa))
    expectedPolicy.collections[t.collection] = { ...(expectedPolicy.collections[t.collection] ?? { fields: {} }), default: t.level }
    if (!within(t.level, fullLevel(pa, t.collection, null)) || !same(pb, expectedPolicy)) return `it changes ${VISIBILITY_FILE} otherwise than by narrowing ${t.collection} to ${t.level}`
    const f = fileOf(t.collection)
    if (c.files.includes(f)) {
      allowed.push(f)
      const d = c.doc(f)
      const expected = c.records(d.was, t.collection).map(e => (e.visibility === 'public' ? omitKey(e, 'visibility') : e))
      if (!same(c.records(d.now, t.collection), expected)) return `it changes ${f} otherwise than by taking \`visibility: public\` off its entries`
    }
  } else {
    if (t.collection === 'members' && t.field === 'handles') return 'members.handles stays in the repository: the rules count it'
    if (RESERVED.includes(t.field)) return `${t.field} is not a field a level is given to`
    if (c.files.includes(VISIBILITY_FILE)) allowed.push(VISIBILITY_FILE)
    const cur = fullLevel(pa, t.collection, null, t.field)
    if (!within(t.level, cur)) return `${t.field} of ${t.collection} was ${formatLevel(cur)}, and ${t.level} is not within it`
    const expectedPolicy = JSON.parse(JSON.stringify(pa))
    const entry = expectedPolicy.collections[t.collection] ?? { default: 'members', fields: {} }
    expectedPolicy.collections[t.collection] = { ...entry, fields: { ...entry.fields, [t.field]: t.level } }
    if (!same(pb, pa) && !same(pb, expectedPolicy)) return `it changes ${VISIBILITY_FILE} otherwise than by narrowing ${t.field} of ${t.collection} to ${t.level}`
    if (same(pb, pa) && !(strict && formatLevel(fullLevel(pb, t.collection, null, t.field)) === formatLevel(level))) {
      return `${VISIBILITY_FILE} does not narrow ${t.field} of ${t.collection} to ${t.level}`
    }
    if (strict) {
      const f = fileOf(t.collection)
      if (c.files.includes(f)) {
        allowed.push(f)
        const d = c.doc(f)
        const expected = c.records(d.was, t.collection).map(e => takenOutOfGit(t.collection, t.field, e))
        if (!same(c.records(d.now, t.collection), expected)) return `it changes ${f} otherwise than by taking ${t.field} out of its entries`
      }
      why = ledger((op, open) => {
        if (typeof op.record !== 'string' || !op.record.startsWith(`${t.collection}:`) || op.op === 'delete') return null
        const written = op.op === 'update' ? op.set : op.value
        if (!isMap(written) || !Object.hasOwn(written, t.field)) return null
        if (!held(written[t.field]) && !open) return null
        return { keep: withoutFields(op, [t.field]) }
      }, t.collection)
    }
  }
  if (why !== null) return why
  const outside = c.files.filter(f => !allowed.includes(f))
  return outside.length > 0 ? `it changes ${outside.join(', ')}, which narrowing ${c.subject.replace(/^visibility: narrow /, '')} does not` : null
}

/** The policy of a data/visibility.yaml document (null: none). @param {unknown} doc */
const policyOf = doc => readFullPolicy(doc ?? {}).policy
