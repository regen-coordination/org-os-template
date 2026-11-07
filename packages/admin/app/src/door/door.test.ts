import { describe, it, expect } from 'vitest'
import { DEFAULT_SECTION_NAMES, doorDate, doorFacts, doorLead, doorSections, publicOnly, type DoorModel } from './door.ts'
import { DOOR_FIXTURE, DOOR_PUBLIC, DOOR_RECORDS } from '../test/fixtures/house/door.ts'
import { FIXTURE_SOURCE } from '../viewAs/visibility.ts'

const names = (m: DoorModel) => doorSections(m).map(s => `${s.no} ${s.name}`)

describe('doorSections (§12.4)', () => {
  it('all present → 01 Who holds what, 02 What we fund, 03 Treasury, 04 Decisions, 05 Writing', () => {
    expect(names(DOOR_PUBLIC)).toEqual(['01 Who holds what', '02 What we fund', '03 Treasury', '04 Decisions', '05 Writing'])
    expect(doorSections(DOOR_PUBLIC).map(s => s.id)).toEqual(['who', 'fund', 'treasury', 'decisions', 'writing'])
  })

  it('sections renumber: no pools, no decisions → 01 Who holds what, 02 Treasury, 03 Writing', () => {
    expect(names({ ...DOOR_PUBLIC, pools: [], decisions: [] })).toEqual(['01 Who holds what', '02 Treasury', '03 Writing'])
  })

  it('a section with nothing public is absent: no hats, no treasury, no writing', () => {
    const { treasury: _, ...noTreasury } = DOOR_PUBLIC
    expect(names({ ...noTreasury, hats: [], writing: [] })).toEqual(['01 What we fund', '02 Decisions'])
  })

  it('takes the org’s names for its sections over DAO-OS’s defaults (E-30); a blank one keeps the default', () => {
    const renamed = { ...DOOR_PUBLIC, sectionNames: { who: 'Our roles', fund: 'Grants', writing: '  ' } }
    expect(names(renamed)).toEqual(['01 Our roles', '02 Grants', '03 Treasury', '04 Decisions', '05 Writing'])
    expect(DEFAULT_SECTION_NAMES.decisions).toBe('Decisions')
  })
})

describe('doorFacts (§12.2, E-31)', () => {
  it('computes the facts from the model: the treasury’s threshold of its signers, its chains, the public pools', () => {
    expect(doorFacts(DOOR_PUBLIC)).toEqual([
      { figure: '4 of 8', label: 'signers move funds' },
      { figure: '7', label: 'chains, one treasury' },
      { figure: '2', label: 'grant pools' },
    ])
  })

  it('drops a fact whose source is absent, and says one in the singular', () => {
    const { treasury: _, ...noTreasury } = DOOR_PUBLIC
    expect(doorFacts({ ...noTreasury, pools: DOOR_PUBLIC.pools.slice(0, 1) })).toEqual([{ figure: '1', label: 'grant pool' }])
    expect(doorFacts({ ...DOOR_PUBLIC, pools: [], treasury: { ...DOOR_PUBLIC.treasury!, chains: ['eip155:42220'] } }))
      .toEqual([{ figure: '4 of 8', label: 'signers move funds' }, { figure: '1', label: 'chain, one treasury' }])
    expect(doorFacts({ ...noTreasury, pools: [] })).toEqual([])
  })

  it('the fixture holds no hand-written fact: its facts are doorFacts of itself', () => {
    expect(DOOR_FIXTURE.facts).toEqual(doorFacts(DOOR_FIXTURE))
    expect(DOOR_PUBLIC.facts).toEqual(doorFacts(DOOR_PUBLIC))
  })
})

describe('publicOnly (rule 6): fails closed', () => {
  const ids = (m: DoorModel) => ({
    nodes: m.map.items.map(d => d.item.id), pools: m.pools.map(p => p.id), decisions: m.decisions.map(d => d.id),
    hats: m.hats.length, writing: m.writing.length, note: m.openNote?.id ?? null,
  })

  it('a members-level pool or decision is dropped, by its own record', () => {
    expect(DOOR_FIXTURE.pools.map(p => p.name)).toContain('Steward stipends')
    const stipends = DOOR_FIXTURE.pools.find(p => p.name === 'Steward stipends')!
    // the pool's record is its own: no map node shares its id
    expect(DOOR_FIXTURE.map.items.some(d => d.item.id === stipends.id)).toBe(false)
    expect(DOOR_RECORDS).toContainEqual({ id: stipends.id, facts: { visibility: 'members' } })
    expect(DOOR_FIXTURE.decisions.map(d => d.id)).toContain('DR-2026-012')
    const out = publicOnly(DOOR_FIXTURE, DOOR_RECORDS)
    expect(out.pools.map(p => p.name)).toEqual(['Network Projects', 'Local Starter'])
    expect(out.decisions.map(d => d.id)).toEqual(['DR-2026-010', 'DR-2026-011', 'DR-2026-009'])
  })

  it('publicOnly(model, []) drops every pool, decision and map node that names a record, and the note with them', () => {
    const out = publicOnly(DOOR_PUBLIC, [])
    expect(ids(out)).toEqual({ nodes: [], pools: [], decisions: [], hats: 0, writing: 0, note: null })
    expect(out.map.links).toEqual([])
    expect(out.facts).toEqual([{ figure: '4 of 8', label: 'signers move funds' }, { figure: '7', label: 'chains, one treasury' }])
  })

  it('an entry whose id raw does not hold is dropped: unknown is not public', () => {
    const records = DOOR_RECORDS.filter(r => !['DR-2026-011', 'system:network-projects'].includes((r as { id: string }).id))
    const out = publicOnly(DOOR_PUBLIC, records)
    expect(out.decisions.map(d => d.id)).toEqual(['DR-2026-010', 'DR-2026-009'])
    expect(out.pools.map(p => p.name)).toEqual(['Local Starter'])
    expect(out.map.items.map(d => d.item.id)).not.toContain('system:network-projects')
  })

  it('a record with no visibility is members-level (the default), so what it names is dropped', () => {
    const records = DOOR_RECORDS.map(r => ((r as { id: string }).id === 'DR-2026-011' ? { id: 'DR-2026-011' } : r))
    expect(publicOnly(DOOR_PUBLIC, records).decisions.map(d => d.id)).toEqual(['DR-2026-010', 'DR-2026-009'])
  })

  it('an entry with no id is not a record and is kept: a hat read from the chain, a page listed without one', () => {
    const model = { ...DOOR_PUBLIC, hats: DOOR_PUBLIC.hats.map(({ id: _, ...h }) => h), writing: DOOR_PUBLIC.writing.map(({ id: _, ...w }) => w) }
    const out = publicOnly(model, [])
    expect(out.hats).toEqual(model.hats)
    expect(out.writing).toEqual(model.writing)
  })

  it('a map node and its record each have a say, and the stricter wins', () => {
    const first = DOOR_PUBLIC.map.items[0]!
    const marked = (visibility: string) => ({ ...first, item: { ...first.item, facts: { ...first.item.facts, visibility } } })
    const withNode = (d: typeof first) => ({ ...DOOR_PUBLIC, map: { ...DOOR_PUBLIC.map, items: [d] } })
    const recordAs = (visibility: string) => DOOR_RECORDS.map(r => ((r as { id: string }).id === first.item.id ? { id: first.item.id, facts: { visibility } } : r))
    const kept = (d: typeof first, records: unknown[]) => publicOnly(withNode(d), records).map.items.length === 1
    expect(kept(first, recordAs('public'))).toBe(true) // the node carries no mark: its record decides
    expect(kept(marked('members'), recordAs('public'))).toBe(false) // the node's own mark is stricter
    expect(kept(marked('public'), recordAs('members'))).toBe(false) // the record's is stricter
    expect(kept(marked('hat:treasury'), recordAs('public'))).toBe(false)
    expect(kept(marked('public'), recordAs('public'))).toBe(true)
    // L5's source reads an item's own top-level visibility first: the node's say goes through the same reader
    const l5 = { ...FIXTURE_SOURCE, visibilityOf: (x: unknown) => {
      const own = (x as { visibility?: unknown }).visibility
      return own === 'members' ? { level: 'members' as const } : FIXTURE_SOURCE.visibilityOf(x)
    } }
    expect(publicOnly(withNode({ ...first, item: { ...first.item, visibility: 'members' } as typeof first.item }), recordAs('public'), l5).map.items).toEqual([])
  })

  it('a members-level map node goes, and every link that touches it', () => {
    const out = publicOnly(DOOR_FIXTURE, DOOR_RECORDS)
    expect(out.map.items.map(d => d.item.name)).not.toContain('Steward stipends')
    expect(out.map.links.some(k => k.to === 'system:steward-stipends' || k.from === 'system:steward-stipends')).toBe(false)
    expect(DOOR_FIXTURE.map.links.some(k => k.to === 'system:steward-stipends')).toBe(true)
  })

  it('counts nothing it dropped: the facts are computed again from what is left', () => {
    expect(DOOR_FIXTURE.facts.find(f => f.label === 'grant pools')!.figure).toBe('3')
    expect(publicOnly(DOOR_FIXTURE, DOOR_RECORDS).facts.find(f => f.label === 'grant pools')!.figure).toBe('2')
  })

  it('the open-decisions note goes with its decision', () => {
    const records = DOOR_RECORDS.map(r => ((r as { id: string }).id === 'DR-2026-010' ? { id: 'DR-2026-010', facts: { visibility: 'members' } } : r))
    const out = publicOnly(DOOR_FIXTURE, records)
    expect(out.decisions.map(d => d.id)).not.toContain('DR-2026-010')
    expect(out.openNote).toBeUndefined()
    expect(publicOnly(DOOR_FIXTURE, DOOR_RECORDS).openNote?.id).toBe('DR-2026-010')
  })

  it('changes nothing on a public model given the public records it was read from', () => {
    expect(publicOnly(DOOR_PUBLIC, DOOR_RECORDS)).toEqual(DOOR_PUBLIC)
  })
})

describe('the door’s words', () => {
  it('writes each lead from the records unless the org wrote its own', () => {
    expect(doorLead(DOOR_PUBLIC, 'fund')).toBe('Two grant pools, each with what it funds and the address its funds are held at.')
    expect(doorLead(DOOR_PUBLIC, 'treasury')).toBe('One Safe, the same address on every chain the DAO uses. No single person can move its funds.')
    expect(doorLead({ ...DOOR_PUBLIC, leads: { fund: 'Where our grants come from.' } }, 'fund')).toBe('Where our grants come from.')
  })

  it('dates a decision as a calendar day with its year, whatever the time zone', () => {
    expect(doorDate('2026-09-28')).toBe('28 Sep 2026')
    expect(doorDate('2026-10-08T23:30:00Z')).toBe('8 Oct 2026')
    expect(doorDate('soon')).toBe('soon')
  })
})
