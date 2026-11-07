import { describe, it, expect } from 'vitest'
import { filterItems, findByAddress, highlight, inScope, paletteItems, places, recordContext, scopeLabel, scopes, type PaletteContext, type PaletteItem } from './palette.ts'
import { opHref } from '../hrefs.ts'
import type { Resource } from '../api.ts'
import { SKINS } from '../design/skins/index.ts'
import { HOUSE_SECTIONS } from '../frame/sections.ts'
import { fakeAddress } from '../elements/atoms/chain.ts'

const res = (id: string, kind: string, board: 'organization' | 'systems', name: string, facts: Record<string, unknown> = {}): Resource =>
  ({ id, kind, board, name, status: null, attention: null, changed: null, facts, source: null })
const nowhere: PaletteContext = { hasChanges: false, canApply: false, record: null }
const items = paletteItems(
  [res('role:platform', 'role', 'systems', 'platform'), res('project:site', 'project', 'organization', 'studio.example'), res('absent:crew', 'absent', 'systems', 'Crew')],
  [{ label: 'Projects', href: '/projects', detail: 'section' }, { label: 'Home', href: '/b/home', detail: 'page' }, { label: 'Systems map', href: '/b/systems', detail: 'map' }],
  [{ op: 'role.seat', label: 'Seat platform', resource: 'role:platform', resourceName: 'platform', board: 'systems', confirm: true, preset: null },
   { op: 'connector.ingest', label: 'Ingest', resource: 'connector:example-commons', resourceName: 'example-commons', board: 'systems', confirm: true, preset: null }],
  nowhere,
)
const of = (group: PaletteItem['group'], list = items) => list.filter(i => i.group === group)

/** One entry per skin the client ships, so adding a skin does not change what this file counts. */
const SKIN_LABELS = SKINS.map(k => `Skin: ${k.label}`)

describe('palette', () => {
  it('lists Jump to, Records, Actions, Views, in that order', () => {
    const order = items.map(i => i.group).filter((g, i, all) => all.indexOf(g) === i)
    expect(order).toEqual(['jump', 'records', 'actions', 'views'])
  })

  it('jumps to the nine sections with their g-keys, then the other pages (a section named twice is listed once)', () => {
    const jump = of('jump')
    expect(jump.map(i => i.label)).toEqual([...HOUSE_SECTIONS.map(s => s.label), 'Projects'])
    expect(jump.find(i => i.label === 'Treasury')).toMatchObject({ go: '/b/treasury', keys: 'g t', icon: 'safe' })
    expect(jump.at(-1)!.go).toBe('/projects')
    expect(of('views').map(i => i.label)).toEqual(['Systems map'])
  })

  it('offers records (not absences), operations and actions, each with where it goes', () => {
    expect(of('records').map(i => i.label)).toEqual(['platform', 'studio.example'])
    expect(of('records')[0]!).toMatchObject({ go: '/r/role/platform', inspect: 'role:platform', detail: 'crew role · platform' })
    expect(of('actions').map(i => i.label)).toEqual(['Seat platform on platform', 'Ingest on example-commons', 'Toggle dark', ...SKIN_LABELS, 'Go to map', 'View as Public'])
    expect(of('actions')[0]!.go).toBe(opHref('role:platform', { id: 'role.seat', label: 'Seat platform' }))
    expect(of('actions')[2]!.action).toBe('theme')
    expect(of('actions').find(i => i.label === 'Skin: Hub')).toMatchObject({ action: 'skin:house' }) // C9 (E-75): the house skin reads as the Hub's
    expect(items.filter(i => i.action?.startsWith('skin:')).map(i => i.action)).toEqual(SKINS.map(k => `skin:${k.id}`))
  })

  it("offers the record's own actions on a record page, and Apply only when it can apply", () => {
    const here = of('actions', paletteItems([], [], [], { hasChanges: true, canApply: false, record: { kind: 'project', id: 'p1' } })).map(i => i.label)
    expect(here).toEqual(['Edit this record', 'Discard changes', 'Toggle dark', ...SKIN_LABELS, 'Go to map', 'View as Public'])
    expect(paletteItems([], [], [], { hasChanges: true, canApply: true, record: null }).map(i => i.label)).toContain('Apply changes')
  })

  // design pass 2026-11-04: typing "new" lists New <kind> for each section the viewer can add to, then New board
  it('lists what the viewer can make first among the actions, found by "new"', () => {
    const adds = [{ label: 'New project', go: '/new/projects' }, { label: 'New idea', go: '/new/ideas' }, { label: 'New board', go: '/boards?new=1' }]
    const made = filterItems(paletteItems([], [], [], { ...nowhere, adds }), 'new')
    expect(made.map(i => i.label)).toEqual(['New project', 'New idea', 'New board'])
    expect(made.every(i => i.group === 'actions')).toBe(true)
    expect(made.at(-1)!.go).toBe('/boards?new=1')
    expect(of('actions').some(i => i.detail === 'new')).toBe(false) // none passed, none listed
  })

  it('"View as Public" is an action; previewing, Exit preview is one too', () => {
    expect(of('actions').find(i => i.label === 'View as Public')).toMatchObject({ action: 'view-public' })
    const asPublic = of('actions', paletteItems([], [], [], { ...nowhere, viewing: 'public' })).map(i => i.label)
    expect(asPublic).not.toContain('View as Public')
    expect(asPublic).toContain('Exit preview')
    expect(of('actions', paletteItems([], [], [], { ...nowhere, viewing: 'other' })).map(i => i.label)).toEqual(expect.arrayContaining(['View as Public', 'Exit preview']))
  })

  it('lists Skin: … only when more than one skin ships', () => {
    expect(SKINS.length).toBe(2) // house and bare ship: listed
    expect(items.filter(i => i.label.startsWith('Skin: ')).length).toBe(2)
    // C9 (§3.1, E-75): the skins are ⌘K's alone now that the Skin select left the frame — Bare, and the Hub's
    expect(items.filter(i => i.label.startsWith('Skin: ')).map(i => i.label)).toEqual(['Skin: Bare', 'Skin: Hub'])
    const one = paletteItems([], [], [], { ...nowhere, skins: [{ id: 'house', label: 'Hub' }] }) // C9 (E-75): the label is the Hub's
    expect(one.filter(i => i.label.startsWith('Skin: '))).toEqual([])
  })

  it('finds records by id as well as name', () => {
    expect(filterItems(items, 'site').map(i => i.label)).toEqual(['studio.example'])
  })

  it('filters on every word, in any order, and keeps the order it was given', () => {
    expect(filterItems(items, 'seat plat').map(i => i.label)).toEqual(['Seat platform on platform'])
    expect(filterItems(items, 'ingest example').map(i => i.label)).toEqual(['Ingest on example-commons'])
    expect(filterItems(items, '').length).toBe(items.length)
    expect(filterItems(items, 'nothing like this')).toEqual([])
  })

  it('stops each group at its limit', () => {
    const many = paletteItems(Array.from({ length: 40 }, (_, i) => res(`project:p${i}`, 'project', 'organization', `P${i}`)), [], [], nowhere)
    expect(of('records', filterItems(many, '')).length).toBe(30)
    expect(of('jump', filterItems(many, '')).length).toBe(HOUSE_SECTIONS.length)
  })

  it('keeps what an address names, whatever the words', () => {
    expect(filterItems(items, '0xabc', 30, new Set(['r:role:platform'])).map(i => i.label)).toEqual(['platform'])
  })

  it('lists every page of the menu, and the sections that have records', () => {
    const labels = places([res('project:p', 'project', 'organization', 'P')], [{ name: 'meetings', kind: 'collection', count: 0 }], new Map()).map(p => p.label)
    expect(labels).toEqual(['Home', 'Activity', 'Library', 'Projects', 'Rules', 'Decisions', 'Proposals', 'Organization map', 'Systems map', 'All records'])
  })

  it('knows when the page is a record', () => {
    expect(recordContext('/r/person/github%3Asteward-a')).toEqual({ kind: 'person', id: 'github:steward-a' })
    expect(recordContext('/projects')).toBeNull()
  })
})

describe('highlight', () => {
  it('marks the first place each word appears, in any case, overlaps merged', () => {
    expect(highlight('Treasury', 'tre')).toEqual([{ text: 'Tre', match: true }, { text: 'asury', match: false }])
    expect(highlight('How the treasury is run', 'tre')).toEqual([
      { text: 'How the ', match: false }, { text: 'tre', match: true }, { text: 'asury is run', match: false }])
    expect(highlight('Treasury Safe', 'safe treas tre')).toEqual([
      { text: 'Treas', match: true }, { text: 'ury ', match: false }, { text: 'Safe', match: true }])
    expect(highlight('Home', '')).toEqual([{ text: 'Home', match: false }])
    expect(highlight('Home', 'zz')).toEqual([{ text: 'Home', match: false }])
  })
})

describe('findByAddress', () => {
  const safe = res('system:treasury-safe', 'system', 'organization', 'Treasury Safe', { driver: 'safe', address: fakeAddress(3) })
  const hat = res('hat:13.1.1', 'hat', 'systems', 'Treasury signer', { wearers: [{ address: fakeAddress(4) }] })
  const other = res('project:p', 'project', 'organization', 'P', { note: 'nothing here' })

  it('finds the System that holds a full address, in any case, bare or inside a CAIP-10 id', () => {
    expect(findByAddress(fakeAddress(3), [other, safe, hat])).toEqual([safe])
    expect(findByAddress(fakeAddress(3).toUpperCase().replace('0X', '0x'), [safe])).toEqual([safe])
    expect(findByAddress(`  eip155:42220:${fakeAddress(3)} `, [safe])).toEqual([safe])
    expect(findByAddress(fakeAddress(4), [other, safe, hat])).toEqual([hat])
  })

  it('finds nothing for a query that is not a full address', () => {
    expect(findByAddress('0x1234', [safe])).toEqual([])
    expect(findByAddress(fakeAddress(3) + 'a', [safe])).toEqual([]) // a 41-character typo
    expect(findByAddress('treasury', [safe])).toEqual([])
    expect(findByAddress('', [safe])).toEqual([])
  })
})

describe('the scope chip', () => {
  const treasury = items.find(i => i.label === 'Treasury')!
  const proposals = items.find(i => i.label === 'Proposals')!
  it('offers All, the section the page is in, then In this page', () => {
    expect(scopes('/governance/proposals').map(s => scopeLabel(s, '/governance/proposals'))).toEqual(['All', 'Proposals', 'In this page'])
    expect(scopes('/b/treasury').map(s => scopeLabel(s, '/b/treasury'))).toEqual(['All', 'Treasury', 'In this page'])
    expect(scopes('/activity')).toEqual(['all', 'page'])
  })

  it('keeps, in a section, what belongs to it; in a page, what belongs to the page', () => {
    expect(inScope(treasury, 'all', '/governance/proposals')).toBe(true)
    expect(inScope(treasury, 'section', '/governance/decisions')).toBe(false)
    expect(inScope(proposals, 'section', '/governance/decisions')).toBe(true)
    expect(inScope(proposals, 'page', '/governance/decisions')).toBe(false)
    expect(inScope(proposals, 'page', '/governance/proposals?x=1')).toBe(true)
    const record = items.find(i => i.label === 'platform')!
    expect(inScope(record, 'section', '/b/systems')).toBe(true) // on the Systems board
    expect(inScope(record, 'page', '/b/systems')).toBe(true)
    expect(inScope(items.find(i => i.label === 'Toggle dark')!, 'page', '/b/systems')).toBe(false)
  })
})
