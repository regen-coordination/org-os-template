// The workspace class, its implied rule `workspace/direct`, and raising by split (DAO-OS L6 spec §3.1, §3.2, §3.5).
// Repositories are throwaway ones (makeChangeRepo), never the worktree. Placeholders only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { CHANGE_CLASSES, WORKSPACE, classOf, governedClassOf } from '../../lib/change-classes.mjs'
import { WORKSPACE_DIRECT, workspaceRuleFor, mayWriteWorkspace, effectiveRules, checkGovernance, type Rule } from '../../lib/rules.mjs'
import { pageTargets, recordTargets, AGENT_TARGETS, targetsOfPath } from '../../lib/workspace/targets.mjs'
import { effectiveRule, ruleIds, readRuleContext, type RuleContext } from '../../server/governance/effective.ts'
import { targetsOf } from '../../server/changes/stage.ts'
import { createApp } from '../../server/app.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo } from '../changes/fixtures.ts'

const TABLE = JSON.parse(readFileSync(new URL('../../../../schemas/change-classes.json', import.meta.url), 'utf8'))

const TREE = 'eip155:42220:13'
const TREE_HAT = 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000'
const OTHER_TREE_HAT = 'eip155:42220:0x0000000e00010000000000000000000000000000000000000000000000000000'
const A1 = 'eip155:42220:0x00000000000000000000000000000000000000a1'

/** L6 §3.1, row for row: the workspace rows sit after the visibility row and before `*`. */
const WORKSPACE_ROWS: { registry?: string; path?: string; class: string }[] = [
  { path: 'pages/**', class: 'workspace' },
  { registry: 'tasks', class: 'workspace' },
  { registry: 'meetings', class: 'workspace' },
  { registry: 'collections', class: 'workspace' },
  { registry: 'imports', class: 'workspace' },
  { path: 'data/collections/**', class: 'workspace' },
  { path: 'data/kb/**', class: 'workspace' },
  { path: 'memory/**', class: 'workspace' },
  { path: 'MEMORY.md', class: 'workspace' },
  { path: 'HEARTBEAT.md', class: 'workspace' },
  { path: 'docs/plans/**', class: 'workspace' },
  { path: 'docs/agent-plans/**', class: 'workspace' },
]

describe('the class table (L6 §3.1)', () => {
  it('has workspace last and the spec\'s rows, before *', () => {
    expect(TABLE).toEqual({
      classes: ['records', 'members', 'governance', 'identity', 'systems', 'treasury', 'operations', 'publication', 'workspace'],
      map: [
        { registry: 'members', class: 'members' },
        { registry: 'governance', class: 'governance' },
        { registry: 'systems', class: 'systems' },
        { path: 'IDENTITY.md', class: 'identity' },
        { path: 'federation.yaml', class: 'identity' },
        { path: '.well-known/**', class: 'identity' },
        { registry: 'federation-requests', class: 'identity' },
        { registry: 'invites', class: 'identity' },
        { path: 'federation/**', class: 'identity' },
        { registry: 'visibility', class: 'publication' },
        ...WORKSPACE_ROWS,
        { registry: '*', class: 'records' },
      ],
    })
    expect(CHANGE_CLASSES.at(-1)).toBe('workspace')
    expect(WORKSPACE).toBe('workspace')
  })

  describe('no governed registry or path is classed workspace (the boundary)', () => {
    it.each(['members', 'governance', 'systems', 'visibility', 'proposals', 'library'])('registry %s', registry => {
      expect(classOf({ registry })).not.toBe('workspace')
      expect(classOf({ path: `data/${registry}.yaml` })).not.toBe('workspace')
      expect(TABLE.map.filter((r: { registry?: string; class: string }) => r.registry === registry && r.class === 'workspace')).toEqual([])
    })
    it.each(['IDENTITY.md', 'federation.yaml', '.well-known/**', '.well-known/dao.json'])('path %s', path => {
      expect(classOf({ path })).not.toBe('workspace')
      expect(TABLE.map.filter((r: { path?: string; class: string }) => r.path === path && r.class === 'workspace')).toEqual([])
    })
    it('the 0.6 registries stay records (§20 Q1)', () => {
      for (const registry of ['projects', 'ideas', 'funding-opportunities', 'boards']) expect(classOf({ registry })).toBe('records')
    })
    it('treasury, operations and publication are never assigned by a workspace row', () => {
      for (const row of WORKSPACE_ROWS) {
        const cls = classOf(row.path !== undefined ? { path: row.path.replace('/**', '/x') } : { registry: row.registry as string })
        expect(cls).toBe('workspace')
        expect(['treasury', 'operations', 'publication']).not.toContain(cls)
      }
    })
  })

  it('a page is workspace; memory and the plans are governed as workspace; knowledge/ is not governed', () => {
    expect(classOf({ path: 'pages/a-1f2e.md' })).toBe('workspace')
    expect(governedClassOf('memory/2026-10-30.md')).toBe('workspace')
    expect(governedClassOf('docs/plans/x.md')).toBe('workspace')
    expect(governedClassOf('knowledge/x.md')).toBeNull()
    expect(governedClassOf('data/tasks.yaml')).toBe('workspace')
    expect(governedClassOf('data/collections/circles.yaml')).toBe('workspace')
    expect(governedClassOf('data/kb/resource.yaml')).toBe('workspace')
    expect(governedClassOf('pages/assets/a-1f2e/plan.png')).toBe('workspace')
  })
})

describe('targets (L6 §3.2)', () => {
  const pages: Record<string, { parent: string | null }> = {
    'handbook-3f2a': { parent: null },
    'onboarding-9c1d': { parent: 'handbook-3f2a' },
    'first-week-77aa': { parent: 'onboarding-9c1d' },
    'sibling-0b0b': { parent: null },
    'loop-a-1111': { parent: 'loop-b-2222' },
    'loop-b-2222': { parent: 'loop-a-1111' },
    'orphan-3333': { parent: 'gone-4444' },
  }
  const readPage = (id: string) => pages[id] ?? null

  it('a page: itself, each ancestor, then pages, then workspace', () => {
    expect(pageTargets('a-1f2e', [])).toEqual(['workspace:tree-a-1f2e', 'workspace:pages', 'workspace'])
    expect(targetsOfPath('pages/first-week-77aa.md', readPage)).toEqual([
      'workspace:tree-first-week-77aa', 'workspace:tree-onboarding-9c1d', 'workspace:tree-handbook-3f2a', 'workspace:pages', 'workspace',
    ])
    expect(targetsOfPath('pages/assets/onboarding-9c1d/plan.png', readPage)).toEqual(pageTargets('onboarding-9c1d', ['handbook-3f2a']))
  })
  it('a parent loop or a missing parent ends the chain', () => {
    expect(targetsOfPath('pages/loop-a-1111.md', readPage)).toEqual(pageTargets('loop-a-1111', ['loop-b-2222']))
    expect(targetsOfPath('pages/orphan-3333.md', readPage)).toEqual(pageTargets('orphan-3333', []))
  })
  it('a record: its collection, then workspace; the agent layer; nothing for a file that is not workspace', () => {
    expect(recordTargets('tasks')).toEqual(['workspace:tasks', 'workspace'])
    expect(targetsOfPath('data/tasks.yaml', readPage)).toEqual(['workspace:tasks', 'workspace'])
    expect(targetsOfPath('data/collections/circles.yaml', readPage)).toEqual(['workspace:circles', 'workspace'])
    expect(targetsOfPath('data/kb/resource.yaml', readPage)).toEqual(['workspace:knowledge', 'workspace'])
    expect(AGENT_TARGETS).toEqual(['workspace:agent', 'workspace'])
    for (const p of ['memory/2026-10-30.md', 'MEMORY.md', 'HEARTBEAT.md', 'docs/plans/x.md', 'docs/agent-plans/y.md']) {
      expect(targetsOfPath(p, readPage)).toEqual(AGENT_TARGETS)
    }
    expect(targetsOfPath('data/members.yaml', readPage)).toBeNull()
    expect(targetsOfPath('knowledge/x.md', readPage)).toBeNull()
  })
})

const rule = (id: string, applies_to: string[], decide: Rule['decide'] = { by: 'council', method: 'approve', count: 2 }): Rule =>
  ({ id, applies_to, propose: 'member', decide })
const CONSENT_ALL = rule('consent', ['all'], { by: 'council', method: 'consent', window: 'P7D' })

describe('workspaceRuleFor: all never reaches the workspace', () => {
  it('ignores an all rule', () => {
    expect(workspaceRuleFor([CONSENT_ALL], pageTargets('a-1f2e', []))).toBe(WORKSPACE_DIRECT)
    expect(workspaceRuleFor([CONSENT_ALL], ['workspace'])).toBe(WORKSPACE_DIRECT)
    expect(WORKSPACE_DIRECT).toEqual({ id: 'workspace/direct', applies_to: ['workspace'], decide: { method: 'direct' } })
  })
  it('a rule naming workspace:tree-handbook-3f2a raises that page and its subpages, not a sibling', () => {
    const handbook = rule('handbook', ['workspace:tree-handbook-3f2a'])
    const rules = [CONSENT_ALL, handbook]
    expect(workspaceRuleFor(rules, pageTargets('handbook-3f2a', []))).toBe(handbook)
    expect(workspaceRuleFor(rules, pageTargets('first-week-77aa', ['onboarding-9c1d', 'handbook-3f2a']))).toBe(handbook)
    expect(workspaceRuleFor(rules, pageTargets('sibling-0b0b', []))).toBe(WORKSPACE_DIRECT)
  })
  it('a rule naming workspace:tasks raises tasks only', () => {
    const tasks = rule('tasks', ['workspace:tasks'])
    expect(workspaceRuleFor([tasks], recordTargets('tasks'))).toBe(tasks)
    expect(workspaceRuleFor([tasks], recordTargets('meetings'))).toBe(WORKSPACE_DIRECT)
    expect(workspaceRuleFor([tasks], pageTargets('a-1f2e', []))).toBe(WORKSPACE_DIRECT)
  })
  it('the most specific target wins, and a rule naming workspace raises all of it', () => {
    const all = rule('ws', ['workspace'])
    const tree = rule('tree', ['workspace:tree-handbook-3f2a'])
    expect(workspaceRuleFor([all, tree], pageTargets('handbook-3f2a', []))).toBe(tree)
    expect(workspaceRuleFor([all, tree], recordTargets('tasks'))).toBe(all)
  })
})

describe('checkGovernance and the workspace', () => {
  const governance = {
    model: 'consensus',
    roles: { council: { members: ['steward-a', 'steward-b'] }, member: { all: true } },
    rules: [
      { id: 'consent', applies_to: ['all'], propose: 'member', decide: { by: 'council', method: 'consent', window: 'P7D' } },
      { id: 'handbook', applies_to: ['workspace:tree-handbook-3f2a', 'workspace:tasks'], propose: 'member', decide: { by: 'council', method: 'approve', count: 1 } },
    ],
  }
  const members = [{ id: 'steward-a', kind: 'person' }, { id: 'steward-b', kind: 'person' }]
  it('accepts splits of workspace', () => {
    expect(checkGovernance(governance, { members, systems: null, classes: CHANGE_CLASSES }).filter(p => p.level === 'error')).toEqual([])
  })
  it('never says no rule covers the class workspace', () => {
    const only = { ...governance, rules: [{ id: 'records', applies_to: ['records', 'members', 'governance', 'identity', 'systems', 'treasury', 'operations', 'publication'], propose: 'member', decide: { by: 'council', method: 'approve', count: 1 } }] }
    expect(checkGovernance(only, { members, systems: null, classes: CHANGE_CLASSES }).map(p => p.message).join('\n')).not.toMatch(/workspace/)
  })
})

describe('mayWriteWorkspace (L6 §3.2)', () => {
  const known = new Set(['steward-a', 'agent-a'])
  it('admits a member id, an agent and a CAIP-10 actor wearing a hat of the tree', () => {
    expect(mayWriteWorkspace({ id: 'steward-a' }, known, null)).toBe(true)
    expect(mayWriteWorkspace({ id: 'agent-a' }, known, TREE)).toBe(true)
    expect(mayWriteWorkspace({ id: A1, hats: [TREE_HAT] }, known, TREE)).toBe(true)
  })
  it('refuses an unknown git identity with 0.6\'s read-only sentence', () => {
    expect(mayWriteWorkspace({ id: 'stranger' }, known, TREE)).toBe('Read-only: no member matches this git identity.')
  })
  it('refuses a CAIP-10 actor wearing no hat of the tree, or with no tree', () => {
    expect(mayWriteWorkspace({ id: A1, hats: [OTHER_TREE_HAT] }, known, TREE)).toMatch(/^Read-only: /)
    expect(mayWriteWorkspace({ id: A1, hats: [TREE_HAT] }, known, null)).toMatch(/^Read-only: /)
  })
})

const person = { id: 'steward-a', name: 'Steward A', kind: 'person' }
const agent = { id: 'agent-a', name: 'Agent A', kind: 'agent' }
const MEMBERS = [person, { id: 'steward-b', name: 'Steward B', kind: 'person' }, agent]
/** Pilot-shaped: one consent rule for everything, and governance decided by the council's approval. */
const PILOT = {
  model: 'consensus',
  roles: { council: { members: ['steward-a', 'steward-b'] }, member: { all: true } },
  rules: [
    { id: 'governance', applies_to: ['governance'], propose: 'member', decide: { by: 'council', method: 'approve', count: 2 } },
    { id: 'consent', applies_to: ['all'], propose: 'member', decide: { by: 'council', method: 'consent', window: 'P7D' } },
  ],
}
const ctx = (over: Partial<RuleContext> = {}): RuleContext =>
  ({ org: 'Org', governance: PILOT, shape: 'wrapped', problems: [], modelImplied: false, actor: person, members: MEMBERS, ...over })
const PAGE = [pageTargets('a-1f2e', [])]

describe('effectiveRule judges workspace targets (L6 §3.2, §3.3)', () => {
  it('a change of one page under the pilot-shaped consent rules is direct', () => {
    expect(effectiveRule(ctx(), ['workspace'], PAGE)).toMatchObject({ direct: true, source: 'workspace/direct' })
    expect(effectiveRule(ctx({ actor: agent }), ['workspace'], PAGE).direct).toBe(true)
  })
  it('a change of a page and a governance op is not direct', () => {
    const r = effectiveRule(ctx(), ['workspace', 'governance'], [...PAGE, ['governance']])
    expect(r).toMatchObject({ direct: false, proposable: true })
    expect(r.sentence).toMatch(/rule "governance" needs 2 approvals/)
  })
  it('without targets, the class workspace resolves to workspace/direct, never to all', () => {
    expect(effectiveRule(ctx(), ['workspace']).direct).toBe(true)
    expect(ruleIds(ctx(), ['workspace'])).toEqual(['workspace'])
    expect(ruleIds(ctx(), ['workspace', 'records'], [PAGE[0], ['records']])).toEqual(['workspace', 'consent'])
  })
  it('a raised tree is judged by its rule: proposable, not direct', () => {
    const raised = { ...PILOT, rules: [...PILOT.rules, { id: 'handbook', applies_to: ['workspace:tree-a-1f2e'], propose: 'member', decide: { by: 'council', method: 'approve', count: 1 } }] }
    expect(effectiveRule(ctx({ governance: raised }), ['workspace'], PAGE)).toMatchObject({ direct: false, proposable: true, source: 'data/governance.yaml rules: handbook' })
    expect(ruleIds(ctx({ governance: raised }), ['workspace'], PAGE)).toEqual(['handbook'])
  })
  it('a raised tree and a class rule that tie: the tray names the tree\'s rule, the more specific (walk M2)', () => {
    const records = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'council', method: 'approve', count: 1 } }
    const handbook = { id: 'handbook', applies_to: ['workspace:tree-a-1f2e'], propose: 'member', decide: { by: 'council', method: 'approve', count: 1 } }
    const g = { ...PILOT, rules: [records, handbook, ...PILOT.rules] }
    const r = effectiveRule(ctx({ governance: g }), ['workspace', 'records'], [...PAGE, ['records']])
    expect(r).toMatchObject({ direct: false, proposable: true, source: 'data/governance.yaml rules: handbook' })
    expect(r.sentence).toMatch(/rule "handbook"/)
    // a stricter class rule still wins: it is what holds the change
    const closed = { ...g, rules: [{ ...records, propose: 'nobody-here' }, handbook] }
    expect(effectiveRule(ctx({ governance: closed }), ['workspace', 'records'], [...PAGE, ['records']]).proposable).toBe(false)
  })
  it('an agent writes the workspace directly under the solo default', () => {
    const solo = ctx({ governance: { model: 'solo-maintainer' }, actor: agent })
    expect(effectiveRule(solo, ['workspace'], PAGE).direct).toBe(true)
    expect(effectiveRule(solo, ['records']).direct).toBe(false)
    expect(ruleIds(solo, ['workspace'], PAGE)).toEqual(['workspace'])
    // and with no governance file at all (the implied model)
    const implied = ctx({ governance: { model: 'solo-maintainer' }, modelImplied: true, actor: agent })
    expect(effectiveRule(implied, ['workspace'], PAGE).direct).toBe(true)
  })
  it('an agent writes the workspace directly under a model with no rules', () => {
    const bare = ctx({ governance: { model: 'consensus' }, actor: agent })
    expect(effectiveRule(bare, ['workspace'], PAGE).direct).toBe(true)
    expect(effectiveRule(bare, ['workspace', 'records'], [...PAGE, ['records']]).direct).toBe(false)
  })
  it('a CAIP-10 actor is admitted by a hat of the membership tree', () => {
    const siwe = { id: A1, name: A1, kind: 'person' as const, via: 'siwe' as const, account: A1, hats: [TREE_HAT], reading: { block: 7, readAt: '2026-10-30T00:00:00Z' } }
    expect(effectiveRule(ctx({ actor: siwe, tree: TREE }), ['workspace'], PAGE).direct).toBe(true)
    const outside = { ...siwe, hats: [OTHER_TREE_HAT] }
    expect(effectiveRule(ctx({ actor: outside, tree: TREE }), ['workspace'], PAGE)).toMatchObject({ direct: false, proposable: false })
  })
  it('the old answers stay: no class, a record class', () => {
    expect(effectiveRule(ctx(), ['records']).direct).toBe(false)
    expect(effectiveRule(ctx(), [])).toMatchObject({ direct: false, source: 'data/governance.yaml rules' })
    expect(effectiveRules(PILOT).rules.map(r => r.id)).toEqual(['governance', 'consent'])
  })
})

const GOV_YAML = `schema_version: "2.0"
governance:
  model: consensus
  decisions: []
  roles:
    council: { members: [steward-a, ana] }
    member: { all: true }
  rules:
    - id: governance
      applies_to: [governance]
      propose: member
      decide: { by: council, method: approve, count: 2 }
    - id: consent
      applies_to: [all]
      propose: member
      decide: { by: council, method: consent, window: P7D }
`

describe('targetsOf and the write path (L6 §3.2, ruling P-2)', () => {
  let repo: string
  beforeEach(() => { repo = makeChangeRepo(GOV_YAML) })
  afterEach(() => removeFixtureRepo(repo))

  it('one target list per op; a non-workspace op is its class', () => {
    writeFileSync(join(repo, 'data', 'collections.yaml'), 'collections:\n  - id: circles\n    fields: []\n')
    expect(targetsOf({ ops: [
      { op: 'update', record: 'tasks:t-1', set: { title: 'x' } },
      { op: 'update', record: 'circles:c-1', set: { name: 'x' } },
    ] as never }, repo)).toEqual([['workspace:tasks', 'workspace'], ['workspace:circles', 'workspace']])
    expect(targetsOf({ ops: [{ op: 'update', record: 'projects:proj-001', set: { title: 'y' } }] as never }, repo)).toEqual([['records']])
    expect(targetsOf({ ops: [], private: [{ op: 'private', ref: 'r', class: 'workspace' }, { op: 'private', ref: 's', class: 'records', publication: true }] }, repo))
      .toEqual([['workspace'], ['records'], ['publication']])
    expect(targetsOf(null, repo)).toEqual([])
  })

  it('a task written under the pilot-shaped rules commits at once as workspace/direct; a project does not', async () => {
    const app = createApp(repo)
    const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    const res = await app.request('/api/registries/tasks', json('POST', { id: 't-1', title: 'Write the handbook' }))
    expect(res.status).toBe(201)
    const trailers = parseTrailers(execSync('git log -1 --pretty=%B', { cwd: repo }).toString())
    expect(trailers).toMatchObject({ actor: 'steward-a', rule: 'workspace/direct' })
    const project = await app.request('/api/registries/projects/proj-001', json('PUT', { id: 'proj-001', title: 'Renamed', status: 'develop', type: 'program', lead: 'ana' }))
    expect(project.status).toBe(403)
  })

  it('readRuleContext reads the membership tree', () => {
    mkdirSync(join(repo, 'data'), { recursive: true })
    writeFileSync(join(repo, 'data', 'systems.yaml'), 'systems:\n  - { id: hats-main, kind: hats-tree, name: Hats, chain: "eip155:42220", address: "13" }\n')
    expect(readRuleContext(repo, person).tree).toBe(TREE)
  })
})
