// The org's operating records as resources: meetings held, events to come, and the organizations the knowledge
// store knows (Local Nodes). Read-only facts a board can list, sort and narrow.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { records } from '../../server/resources/adapters/records.ts'
import { runCommand } from '../../server/resources/run.ts'
import { matches, runQuery } from '../../lib/board-query.mjs'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

const ctx = (r: string): AdapterContext => ({ repo: r, now: () => new Date(2026, 10, 10, 12), run: runCommand, lastOk: () => null })
const read = async (r: string) => (await records.read(ctx(r))) as Graph
const data = (name: string, text: string) => writeFileSync(join(repo, 'data', name), text)

describe('records adapter: meetings, events and organizations', () => {
  it('reads a meeting, and carries its recording link only when it may be shared', async () => {
    data('meetings.yaml', [
      'meetings:',
      '  - id: m-shared',
      '    title: Council session 11',
      '    date: "2026-10-28T16:00:00Z"',
      '    session_number: 11',
      '    recording_url: https://example.org/rec/11',
      '    recording_shared: true',
      '    decisions: [{ text: a }, { text: b }]',
      '    action_items: [x, y, z]',
      '    transcript: private/transcripts/11.md',
      '  - id: m-private',
      '    title: Subject call',
      '    date: "2026-11-06"',
      '    recording_url: https://example.org/rec/private',
      '  - id: m-short',
      '    title: Council Session 12 - a long sentence of what the room did',
      '    short_title: Council Session 12',
      '    date: "2026-11-11"',
      '  - id: m-shared-at',
      '    title: Session 10',
      '    date: "2026-10-14"',
      '    recording_shared: https://example.org/shared/10',
      '',
    ].join('\n'))
    const g = await read(repo)
    const shared = g.nodes.find(n => n.id === 'meeting:m-shared')
    expect(shared).toMatchObject({ kind: 'meeting', name: 'Council session 11',
      facts: { date: '2026-10-28T16:00:00Z', session: 11, recorded: true, recording: 'https://example.org/rec/11', decisions: 2, actions: 3 },
      source: { path: 'data/meetings.yaml', editable: true, registry: 'meetings', entityId: 'm-shared' } })
    expect(JSON.stringify(shared)).not.toContain('private/transcripts')
    expect(g.nodes.find(n => n.id === 'meeting:m-private')?.facts).toMatchObject({ recorded: true, recording: null })
    expect(g.nodes.find(n => n.id === 'meeting:m-short')).toMatchObject({ name: 'Council Session 12',
      facts: { summary: 'Council Session 12 - a long sentence of what the room did' } })
    const sharedAt = g.nodes.find(n => n.id === 'meeting:m-shared-at')
    expect(sharedAt?.facts).toMatchObject({ recorded: true, recording: null })
    expect(JSON.stringify(sharedAt)).not.toContain('example.org/shared')
  })

  it('reads events with a sortable start, and a board can ask for what comes after now', async () => {
    data('events.yaml', [
      'events:',
      '  - { id: e-past, title: Session 11, date: "2026-10-28", time: "16:00 UTC", session_number: 11 }',
      '  - { id: e-next, title: Session 12, date: "2026-11-11", time: "16:00 UTC", session_number: 12, agenda_ref: docs/agenda-12.md }',
      '  - { id: e-later, title: Year-end call, date: "2026-12-09" }',
      '',
    ].join('\n'))
    const g = await read(repo)
    expect(g.nodes.find(n => n.id === 'event:e-next')?.facts).toMatchObject({ start: '2026-11-11T16:00', session: 12, agenda: 'docs/agenda-12.md' })
    const events = g.nodes.filter(n => n.kind === 'event')
    const coming = runQuery({ kind: 'event', where: { start: { after: '2026-11-10T12:00' } }, sort: 'start' }, events)
    expect(coming.map((r: { id: string }) => r.id)).toEqual(['event:e-next', 'event:e-later'])
  })

  it('reads the knowledge store organizations as read-only records, with their place and stage', async () => {
    mkdirSync(join(repo, 'data', 'kb'), { recursive: true })
    data('kb/organization.yaml', [
      'entries:',
      '  node-a:',
      '    title: Node A',
      '    type: organization',
      '    org_type: local-node',
      '    stage: seed',
      '    status: active',
      '    place: Somewhere',
      '    part_of: region-x',
      '    coords: [41.38, 2.18]',
      '',
    ].join('\n'))
    const g = await read(repo)
    expect(g.nodes.find(n => n.id === 'organization:node-a')).toMatchObject({
      kind: 'organization', name: 'Node A', status: 'active',
      facts: { org_type: 'local-node', stage: 'seed', place: 'Somewhere', part_of: 'region-x', coords: [41.38, 2.18] },
      source: { path: 'data/kb/organization.yaml', editable: false, entityId: 'node-a' } })
  })

  it('names a knowledge store file it cannot read, and still reads the rest', async () => {
    mkdirSync(join(repo, 'data', 'kb'), { recursive: true })
    data('kb/organization.yaml', 'entries: [unclosed\n')
    const g = await read(repo)
    expect(g.nodes.some(n => n.id === 'absent:records:kb-organization')).toBe(true)
    expect(g.nodes.some(n => n.kind === 'project')).toBe(true)
  })

  it('reads an instance task list, read-only, with its asks of the Council and without its notes', async () => {
    data('tasks.yaml', [
      'tasks:',
      '  - { id: t-1, title: Read the poll, status: not-started, owner: Steward A, due: "2026-11-13", priority: high, audience: stewards, notes: keep this out }',
      '  - { id: t-2, title: Draft the plan, status: in-progress }',
      '  - { title: no id here }',
      '',
    ].join('\n'))
    const g = await read(repo)
    const t1 = g.nodes.find(n => n.id === 'task:t-1')
    expect(t1).toMatchObject({ kind: 'task', name: 'Read the poll', status: 'not-started',
      facts: { owner: 'Steward A', due: '2026-11-13', priority: 'high', audience: 'stewards' },
      source: { path: 'data/tasks.yaml', editable: false, entityId: 't-1' } })
    expect(JSON.stringify(t1)).not.toContain('keep this out')
    expect(g.nodes.filter(n => n.kind === 'task')).toHaveLength(2)
    const asks = runQuery({ kind: 'task', where: { audience: 'stewards', status: { in: ['not-started', 'in-progress'] } } }, g.nodes)
    expect(asks.map((r: { id: string }) => r.id)).toEqual(['task:t-1'])
  })

  it('reads "now" in before and after as the moment the query runs', () => {
    const at = () => new Date('2026-11-10T12:00:00Z')
    expect(matches('2026-11-11T16:00', { after: 'now' }, at)).toBe(true)
    expect(matches('2026-11-06', { after: 'now' }, at)).toBe(false)
    expect(matches('2026-11-06', { before: 'now' }, at)).toBe(true)
  })
})
