import { describe, it, expect } from 'vitest'
import { NO_MARKS, cardName, marksOf, nodeName } from './marks.ts'
import { nodeName as fromFlow } from '../map/flow.ts'
import { changeView, resource } from '../test/data.ts'
import type { JobRecord } from '../api.ts'

const job = (resourceId: string, status: JobRecord['status']): JobRecord => ({ id: 'j', op: 'x', resource: resourceId, label: 'X', cmd: null, args: [], writes: [],
  status, created: '2026-10-17T10:00:00Z', started: null, ended: null, exitCode: null, changed: [], surprises: [], sentence: null })
const op = (record: string) => ({ op: 'update' as const, record, set: { status: 'x' }, base: 'h', before: { status: 'y' } })

describe('marksOf', () => {
  it('marks needs, staged, running, selected and faint, in that order', () => {
    const r = resource({ attention: { level: 'warn', text: 'w' } })
    const ctx = { change: changeView({ ops: [op('projects:p1')] }), jobs: new Map([['project:p1', job('project:p1', 'running')]]), selected: 'project:p1', faint: new Set(['project:p1']) }
    expect(marksOf(r, ctx)).toEqual(['needs', 'staged', 'running', 'selected', 'faint'])
    expect(marksOf(r, NO_MARKS)).toEqual(['needs'])
  })

  it('says stale, not staged, for a record whose op is stale', () => {
    const ctx = { ...NO_MARKS, change: changeView({ ops: [op('projects:other'), op('projects:p1')], stale: [1] }) }
    expect(marksOf(resource(), ctx)).toEqual(['stale'])
  })

  it('says stale, not staged, when a record has a stale op and a fresh one', () => {
    const ctx = { ...NO_MARKS, change: changeView({ ops: [op('projects:p1'), op('projects:p1')], stale: [0] }) }
    expect(marksOf(resource(), ctx)).toEqual(['stale'])
  })

  it('never marks a record that comes from no registry as staged (Review Focus 4)', () => {
    const mod = resource({ id: 'module:m', kind: 'module', board: 'systems', source: null })
    const ctx = { ...NO_MARKS, change: changeView({ ops: [op('modules:m')] }) }
    expect(marksOf(mod, ctx)).toEqual([])
  })

  it('marks a staged create whose resource is not in the registry yet, without throwing (Review Focus 4)', () => {
    const fresh = resource({ id: 'project:new', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'new' } })
    const create = { op: 'create' as const, record: 'projects:new', value: { name: 'New' }, base: null, before: null }
    const ctx = { ...NO_MARKS, change: changeView({ ops: [create], current: [null] }) }
    expect(marksOf(fresh, ctx)).toEqual(['staged'])
    expect(cardName(fresh, marksOf(fresh, ctx))).toContain('staged')
  })

  it('reads an absent placeholder and a queued job without throwing', () => {
    const absent = resource({ id: 'absent:crew', kind: 'absent', name: 'Crew', source: null, attention: { level: 'warn', text: 'No crew' } })
    expect(marksOf(absent, { ...NO_MARKS, jobs: new Map([['absent:crew', job('absent:crew', 'queued')]]) })).toEqual(['needs', 'running'])
    expect(marksOf(resource(), { ...NO_MARKS, jobs: new Map([['project:p1', job('project:p1', 'ok')]]) })).toEqual([])
  })
})

describe('cardName', () => {
  it("is the node's name, then what is staged or running, said", () => {
    const r = resource({ name: 'studio.example', status: 'discovery', attention: { level: 'alert', text: 'v2 waits for your go' } })
    expect(cardName(r, ['needs'])).toBe('studio.example, project, discovery, needs you: v2 waits for your go')
    expect(cardName(r, ['needs', 'stale', 'running', 'selected'])).toBe('studio.example, project, discovery, needs you: v2 waits for your go, changed since you staged it, running')
    expect(cardName(resource({ name: 'Ana', kind: 'person', status: null }), ['staged'])).toBe('Ana, person, staged')
  })

  it('is the same nodeName the maps already used', () => {
    expect(fromFlow).toBe(nodeName)
  })
})

describe('marksOf for a proposal', () => {
  const p = (over: Partial<import('../api.ts').Resource> = {}) => resource({ id: 'proposal:p-1', kind: 'proposal', name: 'A proposal', status: 'approving',
    attention: { level: 'warn', text: 'open: needs 1 more approval' }, facts: { stale: [] }, source: { path: 'data/proposals.yaml', editable: false, registry: 'proposals', entityId: 'p-1' }, ...over })

  it('marks an open proposal that asks for attention as needs', () => {
    expect(marksOf(p(), NO_MARKS)).toEqual(['needs'])
  })

  it('marks a proposal with stale ops as stale, from its own facts, with no staged change', () => {
    expect(marksOf(p({ status: 'stale', facts: { stale: [0] }, attention: { level: 'alert', text: 'stale' } }), NO_MARKS)).toEqual(['needs', 'stale'])
  })

  it('marks a closed proposal faint, and asks nothing of you', () => {
    for (const status of ['ratified', 'rejected', 'withdrawn', 'expired']) expect(marksOf(p({ status, attention: null }), NO_MARKS)).toEqual(['faint'])
  })

  it('names a proposal card with what it asks, like any record', () => {
    expect(cardName(p(), ['needs', 'stale'])).toBe('A proposal, proposal, approving, needs you: open: needs 1 more approval, changed since you staged it')
  })
})
