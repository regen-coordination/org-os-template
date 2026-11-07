// packages/admin/lib/visibility.mjs
//
// Visibility in git (DAO-OS L8 spec §3, L5 spec §9.1-9.3): is this record, or this field, public?
// Pure: no node:* and no npm import (only ./hats.mjs, itself pure), so the server, the root scripts and the
// builders can all read it. L5 extends this module (hat and role levels, after L8's functions); L8's names are
// the seam and do not change.
import { adminOf, hatRef, inTree, parseHatRef, parseTreeRef } from './hats.mjs'

/** @typedef {string} Level 'public' | 'members' | `hat:${string}` | `role:${string}` */
/** @typedef {{ default: 'public'|'members', fields: Record<string, Level> }} CollectionPolicy */
/** @typedef {{ collections: Record<string, CollectionPolicy>, defaults: Record<string, Level> }} VisibilityPolicy */

export const DEFAULT_LEVEL = 'members'

/** Never public, whatever the policy says (rules 3 and 9): contact data and the wallet-to-person link.
 *  @type {Readonly<Record<string, readonly string[]>>} */
export const NEVER_PUBLIC = Object.freeze({ members: Object.freeze(['email', 'handles']) })

const TOKEN = /^(public|members|hat:.+|role:[a-z][a-z0-9_-]*)$/

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)

/** @param {unknown} v @returns {v is Level} */
const isToken = v => typeof v === 'string' && TOKEN.test(v)

/** 0 public, 1 members, 2 a hat or role token.  @param {string} l */
const rank = l => (l === 'public' ? 0 : l === 'members' ? 1 : 2)

/** The stricter of two readable levels. Two hat/role tokens are not ordered here: the first wins.
 *  @param {Level} a @param {Level} b @returns {Level} */
const stricter = (a, b) => (rank(b) > rank(a) ? b : a)

/**
 * data/visibility.yaml's parsed document -> the policy, and a problem per entry it could not read
 * (that entry reads as members). Accepts the document with or without its `visibility` top key.
 * @param {unknown} doc
 * @returns {{ policy: VisibilityPolicy, problems: string[] }}
 */
export function readPolicy(doc) {
  /** @type {VisibilityPolicy} */
  const policy = { collections: {}, defaults: {} }
  /** @type {string[]} */
  const problems = []
  const top = isObj(doc) && isObj(doc.visibility) ? doc.visibility : doc
  if (!isObj(top)) return { policy, problems }

  const cols = top.collections
  if (isObj(cols)) {
    for (const [name, raw] of Object.entries(cols)) {
      /** @type {CollectionPolicy} */
      const entry = { default: 'members', fields: {} }
      policy.collections[name] = entry
      if (!isObj(raw)) { problems.push(`visibility.collections.${name}: not a mapping; read as members`); continue }
      const hasDefault = raw.default !== undefined
      const hasLevel = raw.level !== undefined
      if (hasDefault && hasLevel && raw.default !== raw.level) {
        problems.push(`visibility.collections.${name}: default and level differ; read as members`)
      } else if (hasDefault || hasLevel) {
        const v = hasDefault ? raw.default : raw.level
        if (v === 'public' || v === 'members') entry.default = v
        else problems.push(`visibility.collections.${name}: default ${JSON.stringify(v)} is not public or members; read as members`)
      }
      if (raw.fields !== undefined && raw.fields !== null) {
        if (!isObj(raw.fields)) problems.push(`visibility.collections.${name}.fields: not a mapping; ignored`)
        else {
          for (const [field, level] of Object.entries(raw.fields)) {
            if (isToken(level)) entry.fields[field] = level
            else {
              entry.fields[field] = 'members'
              problems.push(`visibility.collections.${name}.fields.${field}: ${JSON.stringify(level)} is not a level; read as members`)
            }
          }
        }
      }
    }
  } else if (cols !== undefined && cols !== null) {
    problems.push('visibility.collections: not a mapping; every collection reads as members')
  }

  const defs = top.defaults
  if (isObj(defs)) {
    for (const [key, level] of Object.entries(defs)) {
      if (isToken(level)) policy.defaults[key] = level
      else {
        policy.defaults[key] = 'members'
        problems.push(`visibility.defaults.${key}: ${JSON.stringify(level)} is not a level; read as members`)
      }
    }
  } else if (defs !== undefined && defs !== null) {
    problems.push('visibility.defaults: not a mapping; ignored')
  }
  return { policy, problems }
}

/** The problem with a record's own `visibility` value, or null. Git holds only public and members.
 *  @param {unknown} record @returns {string | null} */
export function recordVisibilityProblem(record) {
  if (!isObj(record) || record.visibility === undefined || record.visibility === null) return null
  const v = record.visibility
  if (v === 'public' || v === 'members') return null
  return `visibility ${JSON.stringify(v)} is not public or members in git; read as not public`
}

/** @param {VisibilityPolicy | null | undefined} policy @param {string} collection @param {unknown} record @returns {Level} */
function recordLevel(policy, collection, record) {
  if (isObj(record) && (record.visibility === 'public' || record.visibility === 'members')) return record.visibility
  if (isObj(record) && record.visibility !== undefined && record.visibility !== null) return 'members'
  const d = policy?.collections?.[collection]?.default
  return d === 'public' || d === 'members' ? d : DEFAULT_LEVEL
}

/**
 * A record's level (L5 spec §9.3): its own `visibility` when 'public' or 'members', else its collection's
 * `default`, else 'members'. With `field`: the stricter of that and the collection's field level;
 * NEVER_PUBLIC fields are never 'public'. A value it cannot read is 'members'.
 * @param {VisibilityPolicy | null | undefined} policy
 * @param {string} collection registry name
 * @param {unknown} record
 * @param {string} [field]
 * @returns {Level}
 */
export function effectiveLevel(policy, collection, record, field) {
  const base = recordLevel(policy, collection, record)
  if (field === undefined) return base
  const raw = policy?.collections?.[collection]?.fields?.[field]
  let level = base
  if (raw !== undefined) level = isToken(raw) ? stricter(base, raw) : 'members'
  if (level === 'public' && NEVER_PUBLIC[collection]?.includes(field)) return 'members'
  return level
}

/** @returns {boolean} */
export function isPublic(policy, collection, record, field) {
  return effectiveLevel(policy, collection, record, field) === 'public'
}

/**
 * null when the record is not public; else a copy with only its public fields, without its `visibility` key.
 * @param {VisibilityPolicy | null | undefined} policy @param {string} collection @param {unknown} record
 * @returns {Record<string, unknown> | null}
 */
export function publicView(policy, collection, record) {
  if (!isObj(record) || !isPublic(policy, collection, record)) return null
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(record)) {
    if (k === 'visibility') continue
    if (isPublic(policy, collection, record, k)) out[k] = v
  }
  return out
}

// ---- L5 (spec §9): hat and role levels, admission, order, the policy check ----
// L8's functions above answer for git, where a level is a token and only public and members exist. Below, a level
// is parsed (ParsedLevel), so a hat ref is read once through parseHatRef and compared in one spelling.

/** @typedef {{ level: 'public' } | { level: 'members' } | { level: 'hat', hat: string } | { level: 'role', role: string }} ParsedLevel */
/** Who is reading (§9.4): the public, or a member with the hats they wear (hat refs) and their governance roles.
 *  @typedef {{ kind: 'public' } | { kind: 'member', id: string, hats: string[], roles: string[] }} Viewer */
/** @typedef {{ level: 'error' | 'warn', path: string, message: string }} VisibilityProblem */

const ROLE_ID = /^[a-z][a-z0-9_-]*$/

/** @type {ParsedLevel} */
const PUBLIC = Object.freeze({ level: 'public' })
/** @type {ParsedLevel} */
const MEMBERS = Object.freeze({ level: 'members' })

/** A hat ref in its one spelling (lowercase id), or null. @param {unknown} ref @returns {string | null} */
function canonHat(ref) {
  const p = parseHatRef(ref)
  return p ? hatRef(p.chain, p.hatId) : null
}

/**
 * One token -> its level: 'public', 'members', 'hat:<hat ref>' (read by parseHatRef), 'role:<role id>'.
 * Anything else, a malformed hat ref or role id included, is null.
 * @param {unknown} token @returns {ParsedLevel | null}
 */
export function parseLevel(token) {
  if (token === 'public') return PUBLIC
  if (token === 'members') return MEMBERS
  if (typeof token !== 'string') return null
  if (token.startsWith('hat:')) {
    const hat = canonHat(token.slice(4))
    return hat ? { level: 'hat', hat } : null
  }
  if (token.startsWith('role:')) {
    const role = token.slice(5)
    return ROLE_ID.test(role) ? { level: 'role', role } : null
  }
  return null
}

/**
 * A token as a level that fails closed: parseLevel's answer, else, for a token that says `hat:` or `role:` but
 * does not parse (a typo'd ref or id), a level that admits nobody: `{ level: 'hat', hat: <the raw rest> }` (no
 * hat ref, so nobody wears it or a hat above it) or `{ level: 'role', role: <the raw rest> }` (no role id, so
 * nobody holds it). gitAllows refuses both. Anything else is null (the caller reads it as members, as L8 does).
 * @param {unknown} token @returns {ParsedLevel | null}
 */
function readLevel(token) {
  const l = parseLevel(token)
  if (l || typeof token !== 'string') return l
  const m = STRICT_LOOKING.exec(token)
  if (!m) return null
  return m[1].toLowerCase() === 'hat' ? { level: 'hat', hat: m[2] } : { level: 'role', role: m[2] }
}

/** A token meant as a hat or role, however mistyped: `hat:`/`role:` in any case, spaces around it allowed. */
const STRICT_LOOKING = /^\s*(hat|role)\s*:([\s\S]*)$/i

/**
 * readPolicy, with what it rewrites to members put back when it was meant as a hat or role. L8's readPolicy reads a
 * field or default token outside its pattern (`role:Ops`, `role:ops `, a bare `hat:`) as 'members'; that is right
 * for git (L8's effectiveLevel and isPublic still answer members for it), but for L5 it would let every member read
 * a value the policy meant to restrict. This returns readPolicy's answer with those raw tokens in their place, so
 * fullLevel, restrictedFields and contactLevel read them as levels that admit nobody (readLevel). The problems are
 * readPolicy's. L5 code that judges reads (Tasks 13, 14) reads the policy through this, not readPolicy.
 * @param {unknown} doc
 * @returns {{ policy: VisibilityPolicy, problems: string[] }}
 */
export function readFullPolicy(doc) {
  const read = readPolicy(doc)
  const top = isObj(doc) && isObj(doc.visibility) ? doc.visibility : doc
  if (!isObj(top)) return read
  const meant = (/** @type {unknown} */ t) => typeof t === 'string' && !isToken(t) && STRICT_LOOKING.test(t)
  if (isObj(top.collections)) {
    for (const [name, raw] of Object.entries(top.collections)) {
      if (!isObj(raw) || !isObj(raw.fields)) continue
      const fields = read.policy.collections[name]?.fields
      if (!fields) continue
      for (const [field, token] of Object.entries(raw.fields)) if (meant(token)) fields[field] = /** @type {string} */ (token)
    }
  }
  if (isObj(top.defaults)) {
    for (const [key, token] of Object.entries(top.defaults)) if (meant(token)) read.policy.defaults[key] = /** @type {string} */ (token)
  }
  return read
}

/** @param {ParsedLevel} l @returns {string} the token parseLevel reads back */
export function formatLevel(l) {
  if (l.level === 'hat') return `hat:${l.hat}`
  if (l.level === 'role') return `role:${l.role}`
  return l.level
}

/**
 * The hats above one (§5.3): the adminOf chain up to the top hat, nearest first, as hat refs on the same chain.
 * Computed from ids alone. Not a hat ref: [].
 * @param {string} ref @returns {string[]}
 */
export function hatsAbove(ref) {
  const p = parseHatRef(ref)
  if (!p) return []
  /** @type {string[]} */
  const out = []
  for (let id = adminOf(p.hatId); id !== null; id = adminOf(id)) out.push(hatRef(p.chain, id))
  return out
}

/** Does this viewer wear the hat, or a hat above it? @param {string} ref @param {readonly string[]} worn */
function wearsOrAbove(ref, worn) {
  const hat = canonHat(ref)
  if (!hat) return false
  const wornSet = new Set(worn.map(canonHat).filter(h => h !== null))
  return wornSet.has(hat) || hatsAbove(hat).some(h => wornSet.has(h))
}

/**
 * May this viewer read a thing at this level (§9.1, §9.4)? public: anyone; members: any member; hat: a wearer of
 * the hat or of a hat above it; role: a member holding the role.
 * @param {ParsedLevel} l @param {Viewer} v @returns {boolean}
 */
export function admits(l, v) {
  if (l.level === 'public') return true
  if (v.kind !== 'member') return false
  if (l.level === 'members') return true
  if (l.level === 'hat') return wearsOrAbove(l.hat, v.hats)
  return ROLE_ID.test(l.role) && v.roles.includes(l.role)
}

/**
 * Is everyone `inner` admits also admitted by `outer` (§9.1; the client's `readersWithin`)? Moving a thing from
 * outer to inner then lets nobody new read it. public ⊂ members ⊂ any hat or role, read as "looser than";
 * hat:Council is within hat:Ops when Council is above Ops. A role and a hat, or two roles, are not ordered here.
 * @param {ParsedLevel} inner @param {ParsedLevel} outer @returns {boolean}
 */
export function narrowerOrEqual(inner, outer) {
  if (outer.level === 'public') return true
  if (outer.level === 'members') return inner.level !== 'public'
  if (outer.level === 'role') return inner.level === 'role' && inner.role === outer.role && ROLE_ID.test(outer.role)
  if (inner.level !== 'hat') return false
  const a = canonHat(inner.hat)
  const b = canonHat(outer.hat)
  return a !== null && b !== null && (a === b || hatsAbove(b).includes(a))
}

/** May a thing at this level be held in git (rule 4)? Only public and members. @param {ParsedLevel} l */
export function gitAllows(l) {
  return l.level === 'public' || l.level === 'members'
}

/** A field's level against its record's (§9.3): the record's only when it is strictly narrower; else the field's,
 *  also when neither is within the other (the gate admits a viewer to the record first, so both hold).
 *  @param {ParsedLevel} record @param {ParsedLevel} field */
const stricterLevel = (record, field) => (narrowerOrEqual(record, field) && !narrowerOrEqual(field, record) ? record : field)

/**
 * A record's or field's full level (§9.3), hat and role included: L8's `effectiveLevel` with the record's own
 * `visibility` read as any level (a private-store record's hat or role), not only public or members. On every
 * git level it answers what `effectiveLevel` answers. A `hat:`/`role:` token that does not parse admits nobody
 * (readLevel); any other value it cannot read is members.
 * @param {VisibilityPolicy | null | undefined} policy @param {string} collection @param {unknown} record @param {string} [field]
 * @returns {ParsedLevel}
 */
export function fullLevel(policy, collection, record, field) {
  const d = policy?.collections?.[collection]?.default
  /** @type {ParsedLevel} */
  const base = isObj(record) && record.visibility !== undefined && record.visibility !== null
    ? readLevel(record.visibility) ?? MEMBERS
    : (d === 'public' ? PUBLIC : MEMBERS) // a collection in git is public or members (DEFAULT_LEVEL)
  if (field === undefined) return base
  const raw = policy?.collections?.[collection]?.fields?.[field]
  let level = raw === undefined ? base : stricterLevel(base, readLevel(raw) ?? MEMBERS)
  if (level.level === 'public' && NEVER_PUBLIC[collection]?.includes(field)) level = MEMBERS
  return level
}

/** A registry's fields declared stricter than members, with their levels; a malformed `hat:`/`role:` field is
 *  listed at a level that admits nobody (readLevel). @param {VisibilityPolicy | null | undefined} policy @param {string} registry
 *  @returns {Record<string, ParsedLevel>} */
export function restrictedFields(policy, registry) {
  /** @type {Record<string, ParsedLevel>} */
  const out = {}
  for (const [field, token] of Object.entries(policy?.collections?.[registry]?.fields ?? {})) {
    const l = readLevel(token)
    if (l && !gitAllows(l)) out[field] = l
  }
  return out
}

/** The level contact details are kept at (`visibility.defaults.contact`): a hat or role (a malformed one admits
 *  nobody, readLevel), else null.
 *  @param {VisibilityPolicy | null | undefined} policy @returns {ParsedLevel | null} */
export function contactLevel(policy) {
  const l = readLevel(policy?.defaults?.contact)
  return l && !gitAllows(l) ? l : null
}

/** Contact details (L3-C4, rule 3) and a person's wallet link (§9.7, rule 9), per registry: each is kept at
 *  `defaults.contact` unless data/visibility.yaml gives the field a level of its own (R-L5-14.4, R-L5-18.7).
 *  @type {Readonly<Record<string, readonly string[]>>} */
export const CONTACT_FIELDS = Object.freeze({ members: Object.freeze(['email', 'wallet']) })

/** The field of a member's record that holds their wallet link (§10.2: `members/<id>/wallet`). */
export const WALLET_LINK = Object.freeze({ registry: 'members', field: 'wallet' })

/**
 * The level a member's wallet link is kept at by default (§9.7: "*hat: Ops* by default"; R-L5-18.7): `defaults.contact`,
 * when data/visibility.yaml declares no level for `members.wallet`; null when it declares one (restrictedFields then
 * reads it) or names no contact level. Git may hold no new link at that level; one it already holds stays until the
 * field is narrowed, as for e-mail (R-L5-14.4).
 * @param {VisibilityPolicy | null | undefined} policy @param {string} registry @returns {ParsedLevel | null}
 */
export function defaultLinkLevel(policy, registry) {
  if (registry !== WALLET_LINK.registry) return null
  if (Object.hasOwn(policy?.collections?.[WALLET_LINK.registry]?.fields ?? {}, WALLET_LINK.field)) return null
  return contactLevel(policy)
}

export const COLLECTION_IN_GIT = 'a collection in git is public or members; keep a private collection in the private store'
const NOT_A_LEVEL = 'public, members, hat:<hat ref> or role:<role id>'
const NO_TREE = 'no membership tree is named, so a hat level admits nobody; use role:<role id>'

/**
 * data/visibility.yaml's parsed document (with or without its `visibility` top key) checked against the org:
 * its registries, its governance role ids, and its membership tree ref (`eip155:<chain>:<tree id>`, or null).
 * First, every problem L8's readPolicy reports, as an error (its words, split at the first ": " into path and
 * message). Then L5's own checks on the raw document. Errors: a collection level stricter than members
 * (COLLECTION_IN_GIT); a `hat:` token L8 reads but that is no hat ref; a role that does not exist; a hat outside the
 * membership tree; `defaults.contact` that is not a hat or role. Warnings: a collection that is no registry; a hat
 * level with no membership tree.
 * @param {unknown} doc
 * @param {{ registries: readonly string[], roles: readonly string[], tree: string | null }} ctx
 * @returns {VisibilityProblem[]}
 */
export function checkVisibilityPolicy(doc, ctx) {
  /** @type {VisibilityProblem[]} */
  const out = readPolicy(doc).problems.map(p => {
    const at = p.indexOf(': ')
    return at < 0 ? { level: 'error', path: 'visibility', message: p } : { level: 'error', path: p.slice(0, at), message: p.slice(at + 2) }
  })
  const err = (/** @type {string} */ path, /** @type {string} */ message) => out.push({ level: 'error', path, message })
  const warn = (/** @type {string} */ path, /** @type {string} */ message) => out.push({ level: 'warn', path, message })
  const tree = parseTreeRef(ctx.tree)

  /** A hat or role level's own checks. @param {string} path @param {ParsedLevel} l */
  const checkStrict = (path, l) => {
    if (l.level === 'role' && !ctx.roles.includes(l.role)) err(path, `no role is called ${l.role}`)
    if (l.level === 'hat') {
      const p = parseHatRef(l.hat)
      if (!tree) warn(path, NO_TREE)
      else if (!p || p.chain !== tree.chain || !inTree(p.hatId, tree.treeId)) err(path, `${l.hat} is not a hat of the membership tree ${ctx.tree}`)
    }
  }
  /** A token L8 reads as a level (L8 reports the others): L5 parses it. @param {string} path @param {unknown} token */
  const checkToken = (path, token) => {
    if (!isToken(token)) return
    const l = parseLevel(token)
    if (!l) err(path, `${JSON.stringify(token)} is not a level: ${NOT_A_LEVEL}`)
    else checkStrict(path, l)
  }

  const top = isObj(doc) && isObj(doc.visibility) ? doc.visibility : doc
  if (!isObj(top)) return out

  const cols = top.collections
  if (isObj(cols)) {
    for (const [name, raw] of Object.entries(cols)) {
      const at = `visibility.collections.${name}`
      if (!ctx.registries.includes(name)) warn(at, `no registry is called ${name}`)
      if (!isObj(raw)) continue
      for (const key of /** @type {const} */ (['default', 'level'])) {
        const v = raw[key]
        if (v === 'private' || (typeof v === 'string' && STRICT_LOOKING.test(v))) err(`${at}.${key}`, COLLECTION_IN_GIT)
      }
      if (isObj(raw.fields)) for (const [field, token] of Object.entries(raw.fields)) checkToken(`${at}.fields.${field}`, token)
    }
  }

  const defs = top.defaults
  if (isObj(defs)) {
    for (const [key, token] of Object.entries(defs)) {
      const path = `visibility.defaults.${key}`
      if (key !== 'contact') { checkToken(path, token); continue }
      const l = parseLevel(token)
      if (!l || gitAllows(l)) err(path, 'defaults.contact must be a hat or a role level: hat:<hat ref> or role:<role id>')
      else checkStrict(path, l)
    }
  }
  return out
}
