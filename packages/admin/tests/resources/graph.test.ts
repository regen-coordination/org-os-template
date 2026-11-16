import { describe, it, expect } from 'vitest'
import { assemble, boardView, seatLinks, absentCard } from '../../server/resources/graph.ts'
import type { Resource } from '../../server/resources/types.ts'

const r = (id: string, kind: Resource['kind'], board: Resource['board'], facts: Record<string, unknown> = {}, name = id): Resource =>
  ({ id, kind, board, name, status: null, attention: null, changed: null, facts, source: null })
const ad = (name: string, board: Resource['board'] = 'organization') => ({ name, board, title: name.toUpperCase() })

describe('assemble', () => {
  it('drops edges whose ends are missing, collapses duplicates, marks crossings', () => {
    const g = assemble([
      { adapter: ad('records'), result: { nodes: [r('project:p1', 'project', 'organization', {}, 'Onboarding'), r('person:a', 'person', 'organization')],
        edges: [
          { from: 'project:p1', to: 'person:a', kind: 'lead' },
          { from: 'project:p1', to: 'person:a', kind: 'lead' },
          { from: 'project:p1', to: 'person:ghost', kind: 'member' },
        ] } },
      { adapter: ad('crew', 'systems'), result: { nodes: [r('seat:s1', 'seat', 'systems', { brief: 'Polish the onboarding docs' })], edges: [] } },
    ])
    expect(g.edges).toEqual([
      { from: 'project:p1', to: 'person:a', kind: 'lead' },
      { from: 'seat:s1', to: 'project:p1', kind: 'works-on', crosses: true },
    ])
  })

  it('turns an absence into one dashed card on the adapter board, that asks nothing of the person (LOW 1)', () => {
    const g = assemble([{ adapter: ad('crew', 'systems'), result: { absent: "Crew isn't installed here" } }])
    expect(g.nodes).toEqual([absentCard(ad('crew', 'systems'), "Crew isn't installed here", 'crew', true)])
    expect(g.nodes[0]).toMatchObject({ id: 'absent:crew', kind: 'absent', board: 'systems', name: 'CREW',
      attention: null, facts: { why: "Crew isn't installed here" } })
  })

  it('keeps a failed read a warning: an adapter that threw needs the person, a source that is not here does not', () => {
    const g = assemble([{ adapter: ad('crew', 'systems'), result: { absent: 'CREW could not be read: boom', failed: true } }])
    expect(g.nodes[0]).toMatchObject({ id: 'absent:crew', attention: { level: 'warn', text: 'CREW could not be read: boom' } })
  })

  it('keeps the first of two nodes with one id', () => {
    const g = assemble([
      { adapter: ad('a'), result: { nodes: [r('person:x', 'person', 'organization', {}, 'first')], edges: [] } },
      { adapter: ad('b'), result: { nodes: [r('person:x', 'person', 'organization', {}, 'second')], edges: [] } },
    ])
    expect(g.nodes.map(n => n.name)).toEqual(['first'])
  })
})

describe('seatLinks', () => {
  it('links a seat to a project its brief or title names, by id or by a name of 4+ characters', () => {
    const nodes = [
      r('project:site-v2', 'project', 'organization', {}, 'studio.example'),
      r('project:ab', 'project', 'organization', {}, 'AB'),
      r('seat:1', 'seat', 'systems', { title: 'site', brief: 'Ship STUDIO.EXAMPLE v2' }),
      r('seat:2', 'seat', 'systems', { title: null, brief: 'work on ab' }),
    ]
    expect(seatLinks(nodes)).toEqual([{ from: 'seat:1', to: 'project:site-v2', kind: 'works-on' }])
  })
})

describe('boardView', () => {
  it('keeps one board, and gathers its crossings into one link to the other map', () => {
    const g = assemble([
      { adapter: ad('records'), result: { nodes: [r('project:p1', 'project', 'organization', {}, 'Onboarding')], edges: [] } },
      { adapter: ad('crew', 'systems'), result: { nodes: [r('seat:s1', 'seat', 'systems', { brief: 'onboarding work' }), r('seat:s2', 'seat', 'systems', { brief: 'more onboarding' })], edges: [] } },
    ])
    const sys = boardView(g, 'systems')
    expect(sys.nodes.map(n => n.id)).toEqual(['seat:s1', 'seat:s2'])
    expect(sys.edges).toEqual([])
    expect(sys.portals).toEqual([{ id: 'portal:organization', toBoard: 'organization', targets: ['project:p1'],
      text: '2 here link to 1 on Organization' }])
    expect(boardView(g, 'organization').portals[0]).toMatchObject({ toBoard: 'systems', targets: ['seat:s1', 'seat:s2'] })
  })
})

describe('boardView: the Systems map takes every System (walk I14)', () => {
  it('a Safe the organization board holds is on the Systems map too, with its edges among what is there', () => {
    const g = assemble([
      { adapter: ad('records'), result: { nodes: [r('person:org', 'person', 'organization')], edges: [] } },
      { adapter: ad('systems', 'systems'), result: { nodes: [
        r('system:test-dao-safe', 'system', 'organization', { kind: 'safe', section: 'organization/treasury' }),
        r('system:treasury-safe', 'system', 'organization', { kind: 'safe', section: 'organization/treasury' }),
        r('system:hats', 'system', 'systems', { kind: 'hats-tree' }),
      ], edges: [
        { from: 'system:treasury-safe', to: 'person:org', kind: 'held-by' },
        { from: 'system:hats', to: 'system:treasury-safe', kind: 'depends-on' },
      ] } },
    ])
    const sys = boardView(g, 'systems')
    expect(sys.nodes.map(n => n.id)).toEqual(['system:test-dao-safe', 'system:treasury-safe', 'system:hats'])
    expect(sys.edges).toEqual([{ from: 'system:hats', to: 'system:treasury-safe', kind: 'depends-on' }])
    expect(sys.portals).toEqual([{ id: 'portal:organization', toBoard: 'organization', targets: ['person:org'], text: '1 here link to 1 on Organization' }])
    // the Organization map keeps its Safes as it had them
    const org = boardView(g, 'organization')
    expect(org.nodes.map(n => n.id)).toEqual(['person:org', 'system:test-dao-safe', 'system:treasury-safe'])
    expect(org.edges).toEqual([{ from: 'system:treasury-safe', to: 'person:org', kind: 'held-by' }])
  })
})
