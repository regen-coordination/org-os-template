import { QueryClient } from '@tanstack/react-query'
import type { ChangeView, DriverRead, JobRecord, Resource } from '../../api.ts'
import type { BlockCfg, BlockCtx, BlockData, BlockState } from '../../blocks/types.ts'
import { proposalViews } from './proposals.ts'

/** /parts and the block contract test draw from these, never from the instance (spec §6). */
export const FIXED_NOW = new Date('2026-10-17T12:00:00Z')
const at = (hoursAgo: number) => ({ at: new Date(FIXED_NOW.getTime() - hoursAgo * 3_600_000).toISOString(), by: 'Steward A' })
const src = (registry: string, entityId: string) => ({ path: `data/${registry}.yaml`, editable: true, registry, entityId })

const safeRead: DriverRead = {
  ok: true, readAt: new Date(FIXED_NOW.getTime() - 120_000).toISOString(), error: undefined,
  facts: { threshold: '2 of 4', nonce: 8 }, open: { url: 'https://app.safe.global/home?safe=gno:0x0000000000000000000000000000000000000001', embeddable: false },
  sections: [
    { title: 'Signers', rows: [{ cells: ['Steward A', '0x0000…0001'] }, { cells: ['Steward B', '0x0000…0002'] }] },
    { title: 'Pending', note: 'none', rows: [] },
  ],
}

export const fixtureResources: Resource[] = [
  { id: 'project:site', kind: 'project', board: 'organization', name: 'example-os site v2', status: 'discovery', attention: { level: 'alert', text: 'v2 waits for your go' },
    changed: at(30), facts: { lead: 'steward-a', started: '2026-09-01' }, source: src('projects', 'site') },
  { id: 'project:cofund', kind: 'project', board: 'organization', name: 'co-fund explorer', status: 'active', attention: null,
    changed: at(3), facts: { lead: 'steward-a', started: '2026-10-10' }, source: src('projects', 'cofund') },
  { id: 'project:garden', kind: 'project', board: 'organization', name: 'Garden seat', status: 'active', attention: null,
    changed: at(50), facts: { lead: 'steward-b' }, source: src('projects', 'garden') },
  { id: 'person:steward-a', kind: 'person', board: 'organization', name: 'Steward A', status: 'active', attention: null,
    changed: null, facts: { role: 'Council steward', layer: 'core' }, source: src('members', 'steward-a') },
  { id: 'seat:reviewer', kind: 'seat', board: 'systems', name: 'reviewer', status: 'seated', attention: { level: 'warn', text: 'waiting at a dialog' },
    changed: at(1), facts: { state: 'dialog', branch: 'crew/x' }, source: { path: 'memory/crew/s1.md', editable: false } },
  { id: 'system:safe', kind: 'system', board: 'organization', name: 'Treasury Safe', status: null, attention: null,
    changed: null, facts: { kind: 'safe', driver: safeRead }, source: src('systems', 'safe') },
]

export const fixtureChange: ChangeView = {
  id: 'chg_parts', actor: 'steward-a', created: FIXED_NOW.toISOString(), updated: FIXED_NOW.toISOString(),
  ops: [
    { op: 'update', record: 'projects:cofund', set: { status: 'develop' }, base: 'h1', before: { status: 'active' } },
    { op: 'update', record: 'projects:garden', set: { lead: 'steward-a' }, base: 'h2', before: { lead: 'steward-b' } },
  ],
  classes: ['records'], rule: { direct: true, sentence: 'the maintainer decides alone', source: 'implied by model: solo-maintainer' },
  stale: [1], current: [null, { lead: 'ops-lead' }], state: 'stale',
} as ChangeView

export const fixtureJobs: JobRecord[] = [
  { id: 'j1', op: 'crew.check', resource: 'seat:reviewer', label: 'Check seat', cmd: null, args: [], writes: [], status: 'running',
    created: new Date(FIXED_NOW.getTime() - 12_000).toISOString(), started: new Date(FIXED_NOW.getTime() - 12_000).toISOString(), ended: null, exitCode: null, changed: [], surprises: [], sentence: null },
]

export const fixtureCtx: BlockCtx = {
  now: FIXED_NOW,
  marks: { change: fixtureChange, jobs: new Map(fixtureJobs.map(j => [j.resource, j])), selected: 'project:site' },
  stage: async () => {},
}

const projects = fixtureResources.filter(r => r.kind === 'project')
const graph = { board: 'organization' as const, portals: [{ id: 'portal:systems', toBoard: 'systems' as const, text: '1 link', targets: ['seat:reviewer'] }],
  nodes: fixtureResources.filter(r => r.board === 'organization' && r.kind !== 'system'),
  edges: [{ from: 'project:site', to: 'person:steward-a', kind: 'lead' }, { from: 'project:cofund', to: 'person:steward-a', kind: 'lead' }] }
const schema = { 'x-order': ['id', 'title', 'status', 'lead', 'started'], properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, lead: { type: 'string' }, started: { type: 'string', format: 'date' } } }
const entries = [{ id: 'site', title: 'example-os site v2', status: 'discovery', lead: 'steward-a', started: '2026-09-01' }]

/** Each block state's data, the same for every type except `ready`, which is the type's own. */
const states = (ready: unknown, count?: number): Record<BlockState, BlockData> => ({
  loading: { state: 'loading' }, ready: { state: 'ready', data: ready, count }, empty: { state: 'empty', count: 0 },
  error: { state: 'error', error: 'the records cannot be read' }, notYet: { state: 'notYet' },
  unavailable: { state: 'unavailable', error: 'No crew: scripts/crew.mjs is missing' },
})

export const blockFixtures: Record<string, { cfg: BlockCfg; states: Record<BlockState, BlockData>; actionArgs?: Record<string, unknown[]> }> = {
  // /parts stays on its page (M-7): a click on a row or a node selects nothing and goes nowhere.
  list: { cfg: { title: 'Open projects', source: { kind: 'project' }, view: { empty: 'No projects yet.', select: false } }, states: states(projects, projects.length) },
  metric: { cfg: { title: 'Open projects', source: { kind: 'project' }, view: { label: 'projects' } }, states: states({ value: '3', label: 'projects', unit: '', decimals: 0, read: null }) },
  map: { cfg: { title: 'Organization map', source: { map: 'organization' }, view: { select: false } }, states: states({ full: true, board: 'organization', graph, saved: {}, layoutReady: true, entryOf: () => null }, graph.nodes.length) },
  system: { cfg: { title: 'Treasury Safe', source: { system: 'safe' } }, states: states(fixtureResources.find(r => r.id === 'system:safe')) },
  kanban: { cfg: { title: 'Pipeline', source: { kind: 'project' }, view: { group: 'status', columns: ['discovery', 'active', 'develop'] } },
    states: states({ rows: projects, entryOf: () => undefined }, projects.length), actionArgs: { move: [projects[0], 'status', 'active'] } },
  note: { cfg: { title: 'About this board', text: '## Council\n\nMeets **Thursdays**.' }, states: states('## Council\n\nMeets **Thursdays**.') },
  proposals: { cfg: { title: 'Open proposals', source: { proposals: 'open' }, view: { empty: 'No open proposals.' } },
    states: states(proposalViews.filter(v => v.state === 'open'), proposalViews.filter(v => v.state === 'open').length) },
  record: { cfg: { title: 'example-os site v2', source: { record: 'project:site' } }, states: states({ kind: 'project', id: 'site' }), actionArgs: { delete: ['projects:site'] } },
  // C6: the house's own blocks (Home's and Treasury's), each from a few rows of its own
  needs: { cfg: { title: 'Needs you', view: { count: 'title' } }, states: states({ items: [
    { id: 'proposal:p-1', kind: 'proposal', title: 'Approve the budget line', href: '/r/proposal/p-1', ref: 'p-1', route: 'two stewards approve',
      meter: { done: 1, of: 2, words: '1 of 2 approved' }, deadline: new Date(FIXED_NOW.getTime() + 5 * 86_400_000).toISOString(), nodes: [] },
  ], line: '1 System read 2 min ago, none failing.' }, 1) },
  systems: { cfg: { title: 'Systems', view: { count: 'title' } }, states: states(fixtureResources.filter(r => r.kind === 'system'), 1) },
  recently: { cfg: { title: 'Recently', source: { recently: 'all' } }, states: states([
    { id: 'decision:DR-2026-001', kind: 'proposal', title: 'Adopt the budget line', second: 'DR-2026-001 · ratified', at: '2026-10-15', when: '15 Oct', href: '/governance/decisions', item: {} },
  ]) },
  // the prepared cards, and what a Safe's own read lists as waiting beyond them (walk 2026-11-04)
  prepared: { cfg: { title: 'Waiting on signers' }, states: states({ waiting: [], cards: [{ key: 'p-1:gno:8', safe: null, tx: {
    state: 'partly-signed', safe: { name: 'Treasury Safe', address: '0x0000000000000000000000000000000000000001', chain: 'eip155:100' }, nonce: 8, signed: 1, of: 2,
    calls: [{ title: 'Pay the node kit', from: 'eip155:100:0x0000000000000000000000000000000000000001', to: 'eip155:100:0x0000000000000000000000000000000000000002',
      amount: { raw: '250000000000000000000', unit: 'xDAI', decimals: 18 } }],
    total: 'Total', payload: { to: '0x0000000000000000000000000000000000000002', value: '250000000000000000000', operation: 0, dataHash: `0x${'0'.repeat(64)}`, safeTxHash: `0x${'8'.repeat(64)}` },
    openHref: 'https://app.safe.global/home?safe=gno:0x0000000000000000000000000000000000000001',
  } }] }, 1) },
  balances: { cfg: { title: 'Balances' }, states: states({ rows: [{ key: 'Gnosis:xDAI:0', chain: 'Gnosis', token: 'xDAI', amount: '1271.5', aged: false, facts: {} }], unknown: null }, 1) },
  // C12: where the Treasury's value went, from its transfers and a prepared call
  fundflow: { cfg: { title: 'Fund flow', view: { note: 'the last 90 days' } }, states: states({ safe: 'Treasury Safe', flows: [
    { from: 'Ops wallet', to: 'Treasury Safe', value: '2500', unit: 'xDAI', status: 'executed' },
    { from: 'Treasury Safe', to: 'Node kit', value: '250', unit: 'xDAI', status: 'prepared' },
  ] }) },
}

/** A query client holding every answer /parts reads, kept fresh forever: nothing is fetched. */
export function partsClient(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false } } })
  const site = fixtureResources[0]!
  const set: [unknown[], unknown][] = [
    [['resources'], fixtureResources], [['changes'], fixtureChange], [['jobs'], fixtureJobs],
    [['actor'], { id: 'steward-a', name: 'Steward A', kind: 'person' }], [['registries'], [{ name: 'projects', kind: 'collection', count: 3 }]],
    [['registry', 'systems'], { name: 'systems', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'safe', kind: 'safe', section: 'organization/treasury' }] }],
    [['registry', 'projects'], { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries }], [['schema', 'projects'], schema],
    [['resource', 'project:site'], { resource: site, edges: graph.edges.slice(0, 1), neighbours: [fixtureResources[3]] }],
    [['resource', 'system:safe'], { resource: fixtureResources[5], edges: [], neighbours: [] }],
    [['graph', 'organization'], graph], [['layout', 'organization'], {}],
    // Needs you reads the open proposals (the map lights its nodes from them, E-35); Recently the decisions
    [['proposals'], proposalViews], [['governance'], { model: null, description: null, rules: [], decisions: [], problems: [] }],
    [['registry', 'members'], { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'steward-a', name: 'Steward A' }] }],
  ]
  for (const [key, data] of set) qc.setQueryData(key, data)
  return qc
}
