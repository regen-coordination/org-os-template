import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { records } from '../../server/resources/adapters/records.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

const ctx = (r: string): AdapterContext => ({ repo: r, now: () => new Date(2026, 9, 15, 12), run: runCommand, lastOk: () => null })
const read = async (r: string) => (await records.read(ctx(r))) as Graph

describe('records adapter', () => {
  it('names a registry that git tracks but the working tree lost, and stays quiet for one never there', async () => {
    rmSync(join(repo, 'data', 'members.yaml'))
    const g = await read(repo)
    expect(g.nodes.find(n => n.id === 'absent:records:members')).toMatchObject({
      kind: 'absent', name: 'data/members.yaml',
      attention: { level: 'warn', text: 'is in git but missing from the working tree — restore it before saving anything' } })
    expect(g.nodes.some(n => n.id === 'absent:records:relationships')).toBe(false)
  })

  it('reads people and projects, with lead and contributor edges', async () => {
    const g = await read(repo)
    expect(g.nodes.find(n => n.id === 'project:proj-001')).toMatchObject({
      kind: 'project', board: 'organization', name: 'Node Onboarding Program', status: 'execute',
      source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'proj-001' },
    })
    expect(g.nodes.find(n => n.id === 'person:ana')).toMatchObject({ name: 'Ana Silva', status: 'active' })
    expect(g.edges).toEqual(expect.arrayContaining([
      { from: 'project:proj-001', to: 'person:steward-a', kind: 'lead' },
      { from: 'project:proj-001', to: 'person:ana', kind: 'member' },
    ]))
  })

  it('reads the spelling real instances use: name, members, startDate', async () => {
    writeFileSync(join(repo, 'data', 'projects.yaml'), [
      'projects:', '  - id: site', '    name: studio.example', '    status: discovery', '    lead: steward-a',
      '    members: [steward-a, ana]', '    startDate: "2026-09-01"', '',
    ].join('\n'))
    const g = await read(repo)
    expect(g.nodes.find(n => n.id === 'project:site')).toMatchObject({ name: 'studio.example',
      facts: expect.objectContaining({ lead: 'steward-a', members: ['steward-a', 'ana'], started: '2026-09-01' }) })
    expect(g.edges).toEqual(expect.arrayContaining([{ from: 'project:site', to: 'person:ana', kind: 'member' }]))
    expect(g.edges).not.toContainEqual({ from: 'project:site', to: 'person:steward-a', kind: 'member' })
  })

  it('gives funding its deadline attention, and links owner, funded project and idea people', async () => {
    writeFileSync(join(repo, 'data', 'funding-opportunities.yaml'), [
      'opportunities:', '  - id: grant-x', '    title: Grant X', '    status: researching', '    deadline: "2026-10-17"', '    owner: ana', '',
    ].join('\n'))
    writeFileSync(join(repo, 'data', 'ideas.yaml'), [
      'ideas:', '  - id: idea-1', '    title: Idea one', '    status: surfaced', '    submitted_by: steward-a', '    champions: [ana]', '',
    ].join('\n'))
    writeFileSync(join(repo, 'data', 'projects.yaml'), [
      'projects:', '  - id: p', '    name: P', '    lead: steward-a', '    funding_source: grant-x', '    related_ideas: [idea-1]', '',
    ].join('\n'))
    const g = await read(repo)
    expect(g.nodes.find(n => n.id === 'funding:grant-x')?.attention).toEqual({ level: 'alert', text: 'deadline in 2 days' })
    expect(g.edges).toEqual(expect.arrayContaining([
      { from: 'funding:grant-x', to: 'person:ana', kind: 'lead' },
      { from: 'funding:grant-x', to: 'project:p', kind: 'funds' },
      { from: 'project:p', to: 'idea:idea-1', kind: 'works-on' },
      { from: 'idea:idea-1', to: 'person:steward-a', kind: 'submitted' },
      { from: 'idea:idea-1', to: 'person:ana', kind: 'champion' },
    ]))
  })

  it('summarises knowledge gaps in one card, counted by kind', async () => {
    writeFileSync(join(repo, 'data', 'knowledge-gaps.yaml'), [
      'gaps:', '  - id: a', '    kind: weak-community', '  - id: b', '    kind: weak-community', '  - id: c', '    kind: orphan', '',
    ].join('\n'))
    const g = await read(repo)
    expect(g.nodes.filter(n => n.kind === 'knowledge-gaps')).toEqual([expect.objectContaining({
      id: 'knowledge-gaps:summary', name: '3 knowledge gaps', facts: { total: 3, byKind: { 'weak-community': 2, orphan: 1 } },
      source: { path: 'data/knowledge-gaps.yaml', editable: false, registry: 'knowledge-gaps' },
    })])
  })

  it('turns a registry that cannot be read into one card naming the file, and keeps the rest', async () => {
    writeFileSync(join(repo, 'data', 'projects.yaml'), 'projects:\n  - id: a\n    lead: *nowhere\n')
    const g = await read(repo)
    expect(g.nodes.find(n => n.id === 'absent:records:projects')).toMatchObject({ kind: 'absent', name: 'data/projects.yaml' })
    expect(g.nodes.some(n => n.id === 'person:steward-a')).toBe(true)
  })

  it('makes no resource of an entry the platform cannot address: no id, null, or an empty one', async () => {
    writeFileSync(join(repo, 'data', 'projects.yaml'), [
      'projects:', '  - id: ""', '    name: Empty id', '  - name: No id', '  - id: null', '    name: Null id', '  - id: kept', '    name: Kept', '',
    ].join('\n'))
    const g = await read(repo)
    expect(g.nodes.filter(n => n.kind === 'project').map(n => n.id)).toEqual(['project:kept'])
  })

  it('on this repository\'s real data: more edges than projects, and no project alone', async () => {
    const g = await read(REAL_REPO)
    const projects = g.nodes.filter(n => n.kind === 'project')
    expect(projects.length).toBeGreaterThan(0)
    expect(g.edges.length).toBeGreaterThan(projects.length)
    for (const p of projects) expect(g.edges.some(e => e.from === p.id || e.to === p.id), p.id).toBe(true)
  })
})
