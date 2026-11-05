import { describe, it, expect } from 'vitest'
import { DEFAULT_LEVEL, NEVER_PUBLIC, readPolicy, effectiveLevel, isPublic, publicView, recordVisibilityProblem } from '../../lib/visibility.mjs'
import { REGISTRIES } from '../../lib/registries.mjs'
import { validateEntry } from '../../lib/data-validate.mjs'
import {
  parseLevel, formatLevel, hatsAbove, admits, narrowerOrEqual, gitAllows, fullLevel, restrictedFields, contactLevel,
  checkVisibilityPolicy, COLLECTION_IN_GIT, readFullPolicy,
} from '../../lib/visibility.mjs'
import { topHatId, childHatId, hatRef } from '../../lib/hats.mjs'

const pol = (doc: unknown) => readPolicy({ visibility: doc }).policy
const HAT = 'hat:eip155:42220:0x00000000000000000000000000000000000000a1'

describe('visibility', () => {
  it('no policy: every record is members', () => {
    const { policy, problems } = readPolicy(undefined)
    expect(problems).toEqual([])
    expect(DEFAULT_LEVEL).toBe('members')
    expect(effectiveLevel(policy, 'members', { id: 'steward-a' })).toBe('members')
    expect(isPublic(policy, 'systems', { id: 's' })).toBe(false)
  })

  it('a collection at public makes its records public', () => {
    const p = pol({ collections: { systems: { default: 'public' } } })
    expect(isPublic(p, 'systems', { id: 's' })).toBe(true)
    expect(isPublic(p, 'members', { id: 's' })).toBe(false)
  })

  it("a record's visibility: members narrows inside a public collection", () => {
    const p = pol({ collections: { systems: { default: 'public' } } })
    expect(isPublic(p, 'systems', { id: 's', visibility: 'members' })).toBe(false)
  })

  it("a record's visibility: public in a members collection is public", () => {
    expect(isPublic(pol({}), 'systems', { id: 's', visibility: 'public' })).toBe(true)
  })

  it('an unknown level reads as members and is reported', () => {
    const { policy, problems } = readPolicy({ visibility: { collections: { systems: { default: 'pub' }, members: [] } } })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('systems')
    expect(problems[1]).toContain('members')
    expect(effectiveLevel(policy, 'systems', { id: 's' })).toBe('members')
    expect(effectiveLevel(policy, 'members', { id: 'steward-a' })).toBe('members')
  })

  it('a record with a hat visibility is not public and is reported', () => {
    const p = pol({ collections: { systems: { default: 'public' } } })
    const rec = { id: 's', visibility: HAT }
    expect(isPublic(p, 'systems', rec)).toBe(false)
    expect(effectiveLevel(p, 'systems', rec)).toBe('members')
    expect(recordVisibilityProblem(rec)).toContain('not public or members')
    expect(recordVisibilityProblem({ id: 's', visibility: 'public' })).toBeNull()
    expect(recordVisibilityProblem({ id: 's' })).toBeNull()
  })

  it('a field rule makes name members inside a public member; hat: and role: fields are not public', () => {
    const p = pol({ collections: { members: { default: 'public', fields: { name: 'members', phone: HAT, notes: 'role:ops' } } } })
    const rec = { id: 'steward-a' }
    expect(effectiveLevel(p, 'members', rec, 'id')).toBe('public')
    expect(effectiveLevel(p, 'members', rec, 'name')).toBe('members')
    expect(effectiveLevel(p, 'members', rec, 'phone')).toBe(HAT)
    expect(effectiveLevel(p, 'members', rec, 'notes')).toBe('role:ops')
    expect(isPublic(p, 'members', rec, 'phone')).toBe(false)
    expect(isPublic(p, 'members', rec, 'notes')).toBe(false)
  })

  it('visibility.defaults is read and changes no git record level', () => {
    const { policy } = readPolicy({ visibility: { collections: { systems: { default: 'public' } }, defaults: { contact: HAT } } })
    expect(policy.defaults).toEqual({ contact: HAT })
    expect(effectiveLevel(policy, 'systems', { id: 's' })).toBe('public')
    expect(effectiveLevel(policy, 'members', { id: 's' })).toBe('members')
  })

  it('a field rule looser than its record changes nothing', () => {
    const p = pol({ collections: { members: { default: 'members', fields: { name: 'public' } } } })
    expect(effectiveLevel(p, 'members', { id: 'a' }, 'name')).toBe('members')
    const q = pol({ collections: { members: { default: 'public' } } })
    expect(effectiveLevel(q, 'members', { id: 'a', visibility: 'members' }, 'name')).toBe('members')
  })

  it('email and handles are never public, even when the policy lists them public', () => {
    expect(NEVER_PUBLIC.members).toEqual(['email', 'handles'])
    const p = pol({ collections: { members: { default: 'public', fields: { email: 'public', handles: 'public' } } } })
    const rec = { id: 'steward-a', name: 'Steward A', email: 'a@example.org', handles: ['x'] }
    expect(isPublic(p, 'members', rec, 'email')).toBe(false)
    expect(isPublic(p, 'members', rec, 'handles')).toBe(false)
    const bare = pol({ collections: { members: { default: 'public' } } })
    expect(isPublic(bare, 'members', rec, 'email')).toBe(false)
    expect(publicView(bare, 'members', rec)).toEqual({ id: 'steward-a', name: 'Steward A' })
  })

  it('publicView drops non-public fields and the visibility key, and returns null for a members record', () => {
    const p = pol({ collections: { members: { default: 'public', fields: { name: 'members', notes: HAT } } } })
    const rec = { id: 'steward-a', name: 'Steward A', notes: 'n', role: 'steward', visibility: 'public' }
    expect(publicView(p, 'members', rec)).toEqual({ id: 'steward-a', role: 'steward' })
    expect(publicView(p, 'members', { ...rec, visibility: 'members' })).toBeNull()
    expect(publicView(pol({}), 'members', { id: 'steward-a' })).toBeNull()
    expect(rec.visibility).toBe('public') // not mutated
  })

  it('level is read as a synonym for default', () => {
    const { policy, problems } = readPolicy({ visibility: { collections: { systems: { level: 'public', fields: { name: 'members' } } } } })
    expect(problems).toEqual([])
    expect(isPublic(policy, 'systems', { id: 's' })).toBe(true)
    expect(isPublic(policy, 'systems', { id: 's' }, 'name')).toBe(false)
  })

  it('default and level that differ are a problem and read as members', () => {
    const { policy, problems } = readPolicy({ visibility: { collections: { systems: { default: 'public', level: 'members' } } } })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('systems')
    expect(isPublic(policy, 'systems', { id: 's' })).toBe(false)
    const same = readPolicy({ visibility: { collections: { systems: { default: 'public', level: 'public' } } } })
    expect(same.problems).toEqual([])
  })

  it('an unreadable field level reads as members and is reported', () => {
    const { policy, problems } = readPolicy({ visibility: { collections: { members: { default: 'public', fields: { name: 'secret' } } } } })
    expect(problems).toHaveLength(1)
    expect(isPublic(policy, 'members', { id: 'a' }, 'name')).toBe(false)
  })
})

describe('visibility registry', () => {
  it('is a document registry with top key visibility', () => {
    const def = REGISTRIES.find(r => r.name === 'visibility')
    expect(def).toMatchObject({ name: 'visibility', topKey: 'visibility', kind: 'document' })
  })

  it('validateEntry accepts the spec example and refuses level: 3', () => {
    const example = {
      collections: {
        systems: { default: 'public' },
        governance: { default: 'public' },
        proposals: { default: 'public' },
        members: { default: 'public', fields: { name: 'members', role: 'members', email: 'hat:<ops hat ref>' } },
      },
      defaults: { contact: 'hat:<ops hat ref>' },
    }
    expect(validateEntry('visibility', example).filter(p => p.level === 'error')).toEqual([])
    expect(validateEntry('visibility', { collections: { systems: { level: 3 } } }).filter(p => p.level === 'error').length).toBeGreaterThan(0)
    expect(validateEntry('visibility', { collections: { systems: { default: 'public', level: 'public' } } }).filter(p => p.level === 'error').length).toBeGreaterThan(0)
  })
})

// ---- L5 (spec §9): hat and role levels beside L8's git side ----

// The fixture tree eip155:42220:13: Top; under it Council (Ops under Council) and Treasurer.
const CHAIN = 'eip155:42220'
const TOP_ID = topHatId(13)
const COUNCIL_ID = childHatId(TOP_ID, 1)
const TOP = hatRef(CHAIN, TOP_ID)
const COUNCIL = hatRef(CHAIN, COUNCIL_ID)
const OPS = hatRef(CHAIN, childHatId(COUNCIL_ID, 1))
const TREASURER = hatRef(CHAIN, childHatId(TOP_ID, 2))
// The same refs written out by hand (hat id = tree id 13 in the top 32 bits, then 16 bits per level).
const Z = (s: string) => s.padEnd(64, '0')
const TOP_HAND = `eip155:42220:0x${Z('0000000d')}`
const COUNCIL_HAND = `eip155:42220:0x${Z('0000000d0001')}`
const OPS_HAND = `eip155:42220:0x${Z('0000000d00010001')}`

const PUB = { level: 'public' } as const
const MEM = { level: 'members' } as const
const hat = (h: string) => ({ level: 'hat' as const, hat: h })
const role = (r: string) => ({ level: 'role' as const, role: r })
const PUBLIC_VIEWER = { kind: 'public' } as const
const member = (hats: string[], roles: string[] = []) => ({ kind: 'member' as const, id: 'steward-a', hats, roles })

describe('L5 levels: the grammar (§9.1)', () => {
  it('the fixture refs are the hand-written ones', () => {
    expect([TOP, COUNCIL, OPS]).toEqual([TOP_HAND, COUNCIL_HAND, OPS_HAND])
  })

  it('each of the four spellings round-trips', () => {
    expect(parseLevel('public')).toEqual({ level: 'public' })
    expect(parseLevel('members')).toEqual({ level: 'members' })
    expect(parseLevel(`hat:${OPS_HAND}`)).toEqual({ level: 'hat', hat: OPS_HAND })
    expect(parseLevel('role:ops')).toEqual({ level: 'role', role: 'ops' })
    for (const t of ['public', 'members', `hat:${OPS_HAND}`, 'role:ops', 'role:treasury-2']) expect(formatLevel(parseLevel(t)!)).toBe(t)
  })

  it('a hat ref in another spelling of the same id reads as the canonical ref', () => {
    expect(parseLevel(`hat:eip155:42220:0x${Z('0000000D00010001')}`)).toEqual({ level: 'hat', hat: OPS_HAND })
  })

  it('hat: with a bad ref, role: with a bad id, private, "" and null are null', () => {
    for (const t of [
      'hat:eip155:42220:0x00000000000000000000000000000000000000a1', // an address, not a hat id
      'hat:<ops hat ref>', 'hat:', `hat:eip155:42220:0x${'0'.repeat(64)}`, 'hat:0x0000000d.0001',
      'role:Ops', 'role:', 'role:1ops', 'role:ops lead',
      'private', '', null, undefined, 3, { level: 'public' }, 'Public', ' public',
    ]) expect(parseLevel(t), String(t)).toBeNull()
  })
})

describe('L5 levels: order and admission (§5.3, §9.1)', () => {
  it('hatsAbove: the adminOf chain to the top hat, nearest first, as hat refs', () => {
    expect(hatsAbove(OPS_HAND)).toEqual([COUNCIL_HAND, TOP_HAND])
    expect(hatsAbove(COUNCIL_HAND)).toEqual([TOP_HAND])
    expect(hatsAbove(TOP_HAND)).toEqual([])
    expect(hatsAbove('not a hat ref')).toEqual([])
  })

  it('public ⊂ members ⊂ hat and role', () => {
    expect(narrowerOrEqual(MEM, PUB)).toBe(true)
    expect(narrowerOrEqual(PUB, MEM)).toBe(false)
    expect(narrowerOrEqual(hat(OPS), MEM)).toBe(true)
    expect(narrowerOrEqual(hat(OPS), PUB)).toBe(true)
    expect(narrowerOrEqual(MEM, hat(OPS))).toBe(false)
    expect(narrowerOrEqual(role('ops'), MEM)).toBe(true)
    expect(narrowerOrEqual(MEM, role('ops'))).toBe(false)
    for (const l of [PUB, MEM, hat(OPS), role('ops')]) expect(narrowerOrEqual(l, l)).toBe(true)
  })

  it('hat:Ops ⊂ hat:Council when Council is above Ops: everyone hat:Council admits, hat:Ops admits', () => {
    expect(narrowerOrEqual(hat(COUNCIL), hat(OPS))).toBe(true)
    expect(narrowerOrEqual(hat(OPS), hat(COUNCIL))).toBe(false)
    expect(narrowerOrEqual(hat(TOP), hat(OPS))).toBe(true)
    // Treasurer and Ops are on different branches: neither holds the other's readers.
    expect(narrowerOrEqual(hat(TREASURER), hat(OPS))).toBe(false)
    expect(narrowerOrEqual(hat(OPS), hat(TREASURER))).toBe(false)
    // A role and a hat, or two roles, are not ordered here: neither is within the other.
    expect(narrowerOrEqual(role('ops'), hat(OPS))).toBe(false)
    expect(narrowerOrEqual(hat(OPS), role('ops'))).toBe(false)
    expect(narrowerOrEqual(role('ops'), role('council'))).toBe(false)
  })

  it('admits: a Council wearer reads hat:Ops; an Ops wearer does not read hat:Council', () => {
    expect(admits(hat(OPS), member([COUNCIL]))).toBe(true)
    expect(admits(hat(OPS), member([OPS]))).toBe(true)
    expect(admits(hat(OPS), member([TOP]))).toBe(true)
    expect(admits(hat(COUNCIL), member([OPS]))).toBe(false)
    expect(admits(hat(OPS), member([TREASURER]))).toBe(false)
    expect(admits(hat(OPS), member([]))).toBe(false)
  })

  it('admits: a role by the viewer\'s roles; members by being a member', () => {
    expect(admits(role('ops'), member([], ['ops']))).toBe(true)
    expect(admits(role('ops'), member([OPS], ['council']))).toBe(false)
    expect(admits(MEM, member([]))).toBe(true)
    expect(admits(PUB, member([]))).toBe(true)
  })

  it('the public viewer reads only public', () => {
    expect(admits(PUB, PUBLIC_VIEWER)).toBe(true)
    for (const l of [MEM, hat(OPS), hat(TOP), role('ops')]) expect(admits(l, PUBLIC_VIEWER)).toBe(false)
  })

  it('gitAllows public and members only', () => {
    expect(gitAllows(PUB)).toBe(true)
    expect(gitAllows(MEM)).toBe(true)
    expect(gitAllows(hat(OPS))).toBe(false)
    expect(gitAllows(role('ops'))).toBe(false)
  })
})

describe('L5 levels: inheritance (§9.3)', () => {
  it('fullLevel agrees with L8 on every git level (hand-written answers)', () => {
    const none = readPolicy(undefined).policy
    expect(fullLevel(none, 'members', { id: 'steward-a' })).toEqual(MEM)
    const sys = pol({ collections: { systems: { default: 'public' } } })
    expect(fullLevel(sys, 'systems', { id: 's' })).toEqual(PUB)
    expect(fullLevel(sys, 'members', { id: 's' })).toEqual(MEM)
    expect(fullLevel(sys, 'systems', { id: 's', visibility: 'members' })).toEqual(MEM)
    expect(fullLevel(pol({}), 'systems', { id: 's', visibility: 'public' })).toEqual(PUB)
    const mem = pol({ collections: { members: { default: 'public', fields: { name: 'members', email: 'public' } } } })
    expect(fullLevel(mem, 'members', { id: 'steward-a' }, 'id')).toEqual(PUB)
    expect(fullLevel(mem, 'members', { id: 'steward-a' }, 'name')).toEqual(MEM)
    expect(fullLevel(mem, 'members', { id: 'steward-a' }, 'email')).toEqual(MEM) // never public
    const loose = pol({ collections: { members: { default: 'members', fields: { name: 'public' } } } })
    expect(fullLevel(loose, 'members', { id: 'a' }, 'name')).toEqual(MEM)
    expect(fullLevel(pol({ collections: { systems: { default: 'pub' } } }), 'systems', { id: 's' })).toEqual(MEM)
  })

  it('a hat: field is its full level; a role: field too', () => {
    const p = pol({ collections: { members: { default: 'public', fields: { email: `hat:${OPS}`, notes: 'role:ops' } } } })
    expect(fullLevel(p, 'members', { id: 'steward-a' }, 'email')).toEqual({ level: 'hat', hat: OPS_HAND })
    expect(fullLevel(p, 'members', { id: 'steward-a' }, 'notes')).toEqual({ level: 'role', role: 'ops' })
  })

  it('a field takes the stricter of record and field', () => {
    const p = pol({ collections: { members: { default: 'public', fields: { email: `hat:${OPS}`, phone: `hat:${COUNCIL}`, name: 'members' } } } })
    // a private-store record at hat:Council: its hat:Ops field stays hat:Council
    expect(fullLevel(p, 'members', { id: 'a', visibility: `hat:${COUNCIL}` }, 'email')).toEqual(hat(COUNCIL_HAND))
    // a record at hat:Ops: its hat:Council field is hat:Council
    expect(fullLevel(p, 'members', { id: 'a', visibility: `hat:${OPS}` }, 'phone')).toEqual(hat(COUNCIL_HAND))
    expect(fullLevel(p, 'members', { id: 'a', visibility: 'members' }, 'email')).toEqual(hat(OPS_HAND))
    expect(fullLevel(p, 'members', { id: 'a', visibility: 'role:ops' }, 'name')).toEqual(role('ops'))
    expect(fullLevel(p, 'members', { id: 'a' }, 'name')).toEqual(MEM)
  })

  it('a field whose level is not ordered with its record keeps its own restriction', () => {
    const p = pol({ collections: { members: { fields: { email: `hat:${OPS}`, notes: 'role:ops' } } } })
    // Treasurer and Ops are on different branches: an Ops field in a Treasurer record stays Ops
    expect(fullLevel(p, 'members', { id: 'a', visibility: `hat:${TREASURER}` }, 'email')).toEqual(hat(OPS_HAND))
    expect(admits(fullLevel(p, 'members', { id: 'a', visibility: `hat:${TREASURER}` }, 'email'), member([TREASURER]))).toBe(false)
    // a hat and a role are not ordered: a role:ops field in a hat:Ops record stays role:ops
    expect(fullLevel(p, 'members', { id: 'a', visibility: `hat:${OPS}` }, 'notes')).toEqual(role('ops'))
    expect(admits(fullLevel(p, 'members', { id: 'a', visibility: `hat:${OPS}` }, 'notes'), member([OPS], []))).toBe(false)
  })

  it('a hat: or role: token that does not parse admits nobody: field, record and contact', () => {
    const p = pol({
      collections: { members: { default: 'public', fields: { email: 'hat:0xOPS', notes: `hat:${OPS}` } } },
      defaults: { contact: 'hat:0xOPS' },
    })
    const typoField = fullLevel(p, 'members', { id: 'a' }, 'email')
    expect(typoField).toEqual({ level: 'hat', hat: '0xOPS' })
    expect(gitAllows(typoField)).toBe(false)
    for (const v of [PUBLIC_VIEWER, member([]), member([TOP, COUNCIL, OPS], ['ops'])]) expect(admits(typoField, v)).toBe(false)
    expect(restrictedFields(p, 'members')).toEqual({ email: { level: 'hat', hat: '0xOPS' }, notes: hat(OPS_HAND) })
    // a private record whose own visibility is a typo
    for (const visibility of ['hat:typo', 'role:Ops', 'role:']) {
      const l = fullLevel(p, 'systems', { id: 's', visibility })
      expect(gitAllows(l), visibility).toBe(false)
      expect(admits(l, member([TOP], ['ops', 'Ops', ''])), visibility).toBe(false)
    }
    expect(fullLevel(p, 'systems', { id: 's', visibility: 'role:Ops' })).toEqual({ level: 'role', role: 'Ops' })
    // a malformed contact level is kept, admitting nobody, not dropped
    expect(contactLevel(p)).toEqual({ level: 'hat', hat: '0xOPS' })
    expect(admits(contactLevel(p)!, member([TOP]))).toBe(false)
    // a token that says neither hat nor role still reads as members (L8)
    expect(fullLevel(pol({}), 'systems', { id: 's', visibility: 'secret' })).toEqual(MEM)
  })

  it("a record's visibility: hat:… is its full level, and gitAllows refuses it", () => {
    const p = pol({ collections: { systems: { default: 'public' } } })
    const rec = { id: 's', visibility: `hat:${OPS}` }
    expect(fullLevel(p, 'systems', rec)).toEqual(hat(OPS_HAND))
    expect(gitAllows(fullLevel(p, 'systems', rec))).toBe(false)
    expect(gitAllows(fullLevel(p, 'systems', { id: 's', visibility: 'members' }))).toBe(true)
    // L8's git answer for the same record is unchanged: members, not public
    expect(effectiveLevel(p, 'systems', rec)).toBe('members')
  })

  it('restrictedFields: the fields stricter than members; contactLevel: defaults.contact when a hat or role', () => {
    const p = pol({
      collections: { members: { default: 'public', fields: { name: 'members', email: `hat:${OPS}`, notes: 'role:ops', id: 'public' } } },
      defaults: { contact: `hat:${OPS}` },
    })
    expect(restrictedFields(p, 'members')).toEqual({ email: hat(OPS_HAND), notes: role('ops') })
    expect(restrictedFields(p, 'systems')).toEqual({})
    expect(contactLevel(p)).toEqual(hat(OPS_HAND))
    expect(contactLevel(pol({ defaults: { contact: 'role:ops' } }))).toEqual(role('ops'))
    expect(contactLevel(pol({ defaults: { contact: 'members' } }))).toBeNull()
    expect(contactLevel(pol({}))).toBeNull()
    expect(contactLevel(readPolicy(undefined).policy)).toBeNull()
  })
})

describe('L5 levels: readFullPolicy keeps what L8 rewrites to members (§9.2)', () => {
  const doc = (tok: string) => ({ collections: { members: { default: 'public', fields: { email: tok, name: 'members' } } }, defaults: { contact: tok } })

  it('a role: field outside the pattern admits nobody; L8 still reads it as members', () => {
    const { policy, problems } = readFullPolicy(doc('role:Ops'))
    const l = fullLevel(policy, 'members', { id: 'a' }, 'email')
    expect(l).toEqual({ level: 'role', role: 'Ops' })
    expect(gitAllows(l)).toBe(false)
    for (const v of [PUBLIC_VIEWER, member([]), member([TOP], ['ops', 'Ops'])]) expect(admits(l, v)).toBe(false)
    expect(restrictedFields(policy, 'members')).toEqual({ email: { level: 'role', role: 'Ops' } })
    expect(problems).toEqual(readPolicy(doc('role:Ops')).problems)
    expect(problems.length).toBeGreaterThan(0)
    // L8's git answers on the same policy are unchanged: members, not public
    expect(effectiveLevel(policy, 'members', { id: 'a' }, 'email')).toBe('members')
    expect(isPublic(policy, 'members', { id: 'a' }, 'email')).toBe(false)
    expect(publicView(policy, 'members', { id: 'a', email: 'e', name: 'n' })).toEqual({ id: 'a' })
  })

  it('a bare hat: field, and role: with a trailing space, admit nobody', () => {
    for (const tok of ['hat:', 'role:ops ', 'role:', 'HAT:0x1', ' hat:x']) {
      const { policy } = readFullPolicy(doc(tok))
      const l = fullLevel(policy, 'members', { id: 'a' }, 'email')
      expect(gitAllows(l), tok).toBe(false)
      expect(admits(l, member([TOP, COUNCIL, OPS], ['ops'])), tok).toBe(false)
      expect(Object.keys(restrictedFields(policy, 'members')), tok).toEqual(['email'])
    }
  })

  it('a role: contact outside the pattern is kept, admitting nobody', () => {
    const { policy } = readFullPolicy(doc('role:Ops'))
    expect(contactLevel(policy)).toEqual({ level: 'role', role: 'Ops' })
    expect(admits(contactLevel(policy)!, member([], ['ops', 'Ops']))).toBe(false)
    expect(contactLevel(readFullPolicy(doc('hat:')).policy)).not.toBeNull()
  })

  it('a well-formed policy reads the same as readPolicy', () => {
    const d = { collections: { members: { default: 'public', fields: { email: `hat:${OPS}`, notes: 'role:ops', name: 'secret' } }, systems: 'x' }, defaults: { contact: 'role:ops' } }
    expect(readFullPolicy(d)).toEqual(readPolicy(d))
    expect(readFullPolicy(undefined)).toEqual(readPolicy(undefined))
  })
})

describe('L5 levels: checkVisibilityPolicy (§9.2)', () => {
  const CTX = { registries: ['members', 'systems', 'governance', 'proposals'], roles: ['ops', 'council'], tree: 'eip155:42220:13' }
  const errors = (doc: unknown, ctx = CTX) => checkVisibilityPolicy(doc, ctx).filter(p => p.level === 'error')

  it('a hat:/role: field: readPolicy and checkVisibilityPolicy report nothing, restrictedFields lists it, isPublic stays false', () => {
    const doc = { visibility: { collections: { members: { default: 'public', fields: { email: `hat:${OPS}`, notes: 'role:ops' } } }, defaults: { contact: `hat:${OPS}` } } }
    const { policy, problems } = readPolicy(doc)
    expect(problems).toEqual([])
    expect(checkVisibilityPolicy(doc, CTX)).toEqual([])
    expect(Object.keys(restrictedFields(policy, 'members'))).toEqual(['email', 'notes'])
    expect(isPublic(policy, 'members', { id: 'steward-a' }, 'email')).toBe(false)
  })

  it('a hat: field L8 reads but that is no hat ref is an error', () => {
    const doc = { collections: { members: { fields: { email: 'hat:<ops hat ref>' } } } }
    expect(readPolicy(doc).problems).toEqual([])
    expect(errors(doc)).toEqual([{ level: 'error', path: 'visibility.collections.members.fields.email', message: '"hat:<ops hat ref>" is not a level: public, members, hat:<hat ref> or role:<role id>' }])
  })

  it('a collection level stricter than members is an error', () => {
    expect(COLLECTION_IN_GIT).toBe('a collection in git is public or members; keep a private collection in the private store')
    expect(errors({ collections: { members: { level: `hat:${OPS}` } } })).toContainEqual(
      { level: 'error', path: 'visibility.collections.members.level', message: COLLECTION_IN_GIT })
    expect(errors({ collections: { systems: { default: 'role:ops' } } })).toContainEqual(
      { level: 'error', path: 'visibility.collections.systems.default', message: COLLECTION_IN_GIT })
    expect(errors({ collections: { systems: { default: 'private' } } })).toContainEqual(
      { level: 'error', path: 'visibility.collections.systems.default', message: COLLECTION_IN_GIT })
    expect(errors({ collections: { systems: { default: 'pub' } } }).map(e => e.message)).not.toContain(COLLECTION_IN_GIT)
    expect(errors({ collections: { systems: { default: 'public' }, members: { level: 'members' } } })).toEqual([])
  })

  it('a field restricted to a role that does not exist is an error', () => {
    expect(errors({ collections: { members: { fields: { notes: 'role:treasury' } } } })).toEqual([
      { level: 'error', path: 'visibility.collections.members.fields.notes', message: 'no role is called treasury' },
    ])
  })

  it('a hat of another tree is an error; with no membership tree a hat level is a warning', () => {
    const other = hatRef(CHAIN, childHatId(topHatId(14), 1))
    expect(errors({ collections: { members: { fields: { email: `hat:${other}` } } } })).toEqual([
      { level: 'error', path: 'visibility.collections.members.fields.email', message: `${other} is not a hat of the membership tree eip155:42220:13` },
    ])
    const onOtherChain = hatRef('eip155:1', childHatId(TOP_ID, 1))
    expect(errors({ collections: { members: { fields: { email: `hat:${onOtherChain}` } } } })).toHaveLength(1)
    expect(checkVisibilityPolicy({ collections: { members: { fields: { email: `hat:${OPS}` } } } }, { ...CTX, tree: null })).toEqual([
      { level: 'warn', path: 'visibility.collections.members.fields.email', message: 'no membership tree is named, so a hat level admits nobody; use role:<role id>' },
    ])
  })

  it('defaults.contact must be a hat or a role', () => {
    for (const contact of ['members', 'public', 'secret', 3, 'hat:0xOPS']) {
      expect(errors({ defaults: { contact } }), String(contact)).toContainEqual(
        { level: 'error', path: 'visibility.defaults.contact', message: 'defaults.contact must be a hat or a role level: hat:<hat ref> or role:<role id>' })
    }
    expect(errors({ defaults: { contact: 'role:ops' } })).toEqual([])
    expect(errors({ defaults: { contact: 'role:nobody' } })).toEqual([
      { level: 'error', path: 'visibility.defaults.contact', message: 'no role is called nobody' },
    ])
  })

  it("every problem L8's readPolicy reports is among the errors, in its words", () => {
    const docs = [
      { collections: {
        systems: { default: 'public', level: 'members' }, // default and level differ
        members: 'x', // not a mapping
        proposals: { default: 'pub' }, // not public or members
        governance: { default: 'public', fields: [] }, // fields not a mapping
        library: { fields: { name: 'secret', notes: 'role:Ops' } }, // field not a level
      }, defaults: { contact: `hat:${OPS}`, imports: 'nope' } }, // a default not a level
      { collections: [], defaults: 'x' }, // collections and defaults not mappings
    ]
    const counts = docs.map(d => readPolicy(d).problems.length)
    expect(counts).toEqual([7, 2])
    for (const doc of docs) {
      const said = errors(doc).map(e => `${e.path}: ${e.message}`)
      for (const p of readPolicy(doc).problems) expect(said).toContain(p)
    }
  })

  it('a collection that is no registry is a warning', () => {
    expect(checkVisibilityPolicy({ collections: { sytems: { default: 'public' } } }, CTX)).toEqual([
      { level: 'warn', path: 'visibility.collections.sytems', message: 'no registry is called sytems' },
    ])
    expect(checkVisibilityPolicy(undefined, CTX)).toEqual([])
  })
})

describe('L5: the visibility schema', () => {
  const errs = (doc: unknown) => validateEntry('visibility', doc).filter(p => p.level === 'error')
  it('defaults.contact is a hat or a role; fields take every level', () => {
    expect(errs({ defaults: { contact: `hat:${OPS}` } })).toEqual([])
    expect(errs({ defaults: { contact: 'role:ops' } })).toEqual([])
    expect(errs({ defaults: { contact: 'members' } }).length).toBeGreaterThan(0)
    expect(errs({ defaults: { contact: 'public' } }).length).toBeGreaterThan(0)
    expect(errs({ collections: { members: { default: 'public', fields: { name: 'members', email: `hat:${OPS}`, notes: 'role:ops', id: 'public' } } } })).toEqual([])
    expect(errs({ collections: { members: { level: `hat:${OPS}` } } }).length).toBeGreaterThan(0)
  })
})
