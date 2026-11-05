import { describe, it, expect } from 'vitest'
import { MEMBER_KINDS, memberKind, gitEmails, findMemberByEmail } from '../../lib/members.mjs'

// Synthetic entries in the shapes the 2026-10-16 fleet survey found: five id
// styles, `type: individual`, a top-level email and the hub's `roles`. No
// instance content is copied.
const SURVEY: Record<string, unknown>[] = [
  { id: 'github:ana-example', name: 'Ana Example', handles: { github: 'ana-example', git: ['ana@example.org', 'Ana.Work@Example.ORG'] } },
  { id: 'did:fixture:bruno', name: 'Bruno', type: 'individual', handles: { git: 'bruno@example.org' } },
  { id: 'did:bloom:bloom', name: 'Bloom', kind: 'organization' },
  { id: 'fixture:role:source-lead', name: 'Source lead', kind: 'role', layer: 'dao-global' },
  { id: 'carla', name: 'Carla', email: 'Carla@Example.org', roles: [{ org: 'Fixture Org', role: 'steward' }] },
  { id: 'crew-engineer', name: 'Engineer seat', kind: 'agent', handles: { email: 'engineer@crew.example' } },
]

describe('memberKind', () => {
  it('is the four kinds of F1 §3.2', () => expect(MEMBER_KINDS).toEqual(['person', 'agent', 'organization', 'role']))
  it('reads kind, and person where none is stated', () => {
    expect(SURVEY.map(e => memberKind(e))).toEqual(['person', 'person', 'organization', 'role', 'person', 'agent'])
  })
  it('reads type: individual as person', () => expect(memberKind({ id: 'x', type: 'individual' })).toBe('person'))
  it('reads a kind outside the four as person (validate:data reports it)', () => expect(memberKind({ id: 'x', kind: 'robot' })).toBe('person'))
  it('reads nothing as person', () => expect(memberKind(null)).toBe('person'))
})

describe('gitEmails', () => {
  it('reads a list in handles.git, lowercased', () => expect(gitEmails(SURVEY[0])).toEqual(['ana@example.org', 'ana.work@example.org']))
  it('reads one string in handles.git', () => expect(gitEmails(SURVEY[1])).toEqual(['bruno@example.org']))
  it('reads a top-level email (the hub writes it there)', () => expect(gitEmails(SURVEY[4])).toEqual(['carla@example.org']))
  it('reads handles.email', () => expect(gitEmails(SURVEY[5])).toEqual(['engineer@crew.example']))
  it('names each address once, wherever it is written', () => {
    expect(gitEmails({ id: 'x', email: 'X@e.org', handles: { git: ['x@e.org', ' x@E.org '], email: 'x@e.org' } })).toEqual(['x@e.org'])
  })
  it('ignores what is not an address', () => {
    expect(gitEmails({ id: 'x', handles: { git: [null, 3, ''] } })).toEqual([])
    expect(gitEmails({ id: 'x', handles: 'ana' })).toEqual([])
    expect(gitEmails(undefined)).toEqual([])
  })
})

describe('findMemberByEmail', () => {
  it('finds a member by the second of their git emails, ignoring case', () => {
    expect(findMemberByEmail(SURVEY, 'ANA.work@example.org')?.id).toBe('github:ana-example')
  })
  it('finds a member by a top-level email', () => expect(findMemberByEmail(SURVEY, 'carla@example.org')?.id).toBe('carla'))
  it('is null for an address no member commits with', () => expect(findMemberByEmail(SURVEY, 'someone@else.org')).toBeNull())
  it('is null for no address', () => {
    expect(findMemberByEmail(SURVEY, '')).toBeNull()
    expect(findMemberByEmail(SURVEY, undefined)).toBeNull()
  })
  it('is null when two members claim the address: never the first of them', () => {
    const twice = [...SURVEY, { id: 'ana-again', handles: { git: 'ana@example.org' } }]
    expect(findMemberByEmail(twice, 'ana@example.org')).toBeNull()
  })
  it('never matches a name or an id', () => {
    expect(findMemberByEmail(SURVEY, 'Carla')).toBeNull()
    expect(findMemberByEmail(SURVEY, 'github:ana-example')).toBeNull()
  })
})
