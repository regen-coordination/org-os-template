import { describe, it, expect } from 'vitest'
import { CARD_FIELDS, FACT_COLUMNS, KIND_ORDER, RESOURCE_KINDS, KIND_OF_REGISTRY, REGISTRY_OF_KIND, cardFacts, factText, kindLabel, splitId } from './kinds.ts'
import { resource as aResource } from './test/data.ts'
import type { Resource } from './api.ts'

const r = (over: Partial<Resource>): Resource => ({ id: 'system:safe', kind: 'system', board: 'organization', name: 'Treasury',
  status: null, attention: null, changed: null, facts: {}, source: null, ...over })

describe('kinds', () => {
  it('splits a resource id at its first colon only', () => {
    expect(splitId('person:github:steward-a')).toEqual({ kind: 'person', id: 'github:steward-a' })
    expect(splitId('project:a b/c')).toEqual({ kind: 'project', id: 'a b/c' })
    expect(splitId('nocolon')).toEqual({ kind: 'nocolon', id: '' })
  })

  it('maps kinds to the registry names the change engine uses, and back (the client side of alias resolution)', () => {
    expect(REGISTRY_OF_KIND.funding).toBe('funding-opportunities')
    expect(KIND_OF_REGISTRY['funding-opportunities']).toBe('funding')
    expect(KIND_OF_REGISTRY.opportunities).toBeUndefined() // a file's top key is never a registry name
    for (const [kind, registry] of Object.entries(REGISTRY_OF_KIND)) expect(KIND_OF_REGISTRY[registry]).toBe(kind)
  })

  it('labels kinds in words', () => {
    expect(kindLabel('seat')).toBe('crew seat')
    expect(kindLabel('project')).toBe('project')
  })

  it('writes facts as plain text', () => {
    expect(factText(null)).toBe('')
    expect(factText(['a', 'b'])).toBe('a, b')
    expect(factText({ x: 1 })).toBe('{"x":1}')
    expect(factText(3)).toBe('3')
  })

  it("reads a system's kind from its systems.yaml entry, and says when its driver's read failed", () => {
    const [kind, read] = FACT_COLUMNS.system!
    expect(kind!.value(r({}), { kind: 'safe' })).toBe('safe')
    expect(kind!.value(r({ facts: { kind: 'link' } }))).toBe('link')
    expect(read!.value(r({ facts: { driver: { ok: false, readAt: null, facts: {}, sections: [], open: null, error: 'timeout' } } }))).toBe('read failed')
    expect(read!.value(r({}))).toBe('')
  })
})

describe('CARD_FIELDS', () => {
  it("names each kind's facts by their column label: every one in a row, the first two on a tile", () => {
    expect(CARD_FIELDS.project).toEqual({ row: ['lead', 'started'], tile: ['lead', 'started'] })
    expect(Object.keys(CARD_FIELDS).sort()).toEqual(Object.keys(FACT_COLUMNS).sort())
  })

  it('reads the facts a card shows, joined with the entry where a column does', () => {
    const r = aResource({ facts: { lead: 'steward-a', started: '2026-10-02' } })
    expect(cardFacts(r, ['lead', 'nope', 'started'])).toEqual([{ label: 'lead', value: 'steward-a' }, { label: 'started', value: '2026-10-02' }])
    const s = aResource({ id: 'system:safe', kind: 'system', facts: {} })
    expect(cardFacts(s, ['kind'], { kind: 'safe' })).toEqual([{ label: 'kind', value: 'safe' }])
  })
})

describe('the proposal kind', () => {
  it('is on the map, in words, with the facts a card shows', () => {
    expect(KIND_ORDER).toContain('proposal')
    expect(RESOURCE_KINDS.has('proposal')).toBe(true)
    expect(kindLabel('proposal')).toBe('proposal')
    const p = r({ id: 'proposal:p-1', kind: 'proposal', facts: { author: 'carla', closesAt: '2026-10-22T12:00:00Z' } })
    expect(cardFacts(p, CARD_FIELDS.proposal!.row)).toEqual([{ label: 'author', value: 'carla' }, { label: 'closes', value: '2026-10-22' }])
    expect(CARD_FIELDS.proposal!.tile).toEqual(['author', 'closes'])
  })
})
