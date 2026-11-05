import type { BoardRead, ChangeView, Resource, RuleSummary } from '../api.ts'
import { BUILTIN_BOARDS } from './builtinBoards.ts'
import { deriveChangeState } from '../../../lib/machines/change.mjs'

export const resource = (over: Partial<Resource> = {}): Resource => ({
  id: 'project:p1', kind: 'project', board: 'organization', name: 'Project one', status: 'develop',
  attention: null, changed: null, facts: {},
  source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'p1' }, ...over,
})

export const soloRule: RuleSummary = { direct: true, sentence: 'the maintainer decides alone', source: 'implied by model: solo-maintainer' }

export const changeView = (over: Partial<ChangeView> = {}): ChangeView => {
  const v = { id: 'chg_1', actor: 'steward-a', created: '2026-10-16T10:00:00Z', updated: '2026-10-16T10:00:00Z',
    ops: [], classes: [], rule: soloRule, stale: [], current: [], ...over }
  return { ...v, state: over.state ?? deriveChangeState(v) }
}

export const boardRead = (over: Partial<BoardRead> = {}): BoardRead => ({
  id: 'b1', name: 'Board one', audience: 'members', layout: 'flow', blocks: [], origin: 'instance', overrides: false, ...over,
})

export const knownActor = { id: 'steward-a', name: 'Steward A', kind: 'person' }

/** What every page around a test reads: who you are, what is staged, the status line. */
export const baseRoutes = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  'GET /api/actor': knownActor,
  'GET /api/changes': changeView(),
  'GET /api/boards': BUILTIN_BOARDS,
  'GET /api/status': { org: 'Fixture Org', branch: 'main', dirty: false },
  'GET /api/session': { mode: 'local', signIn: null, signedIn: false },
  'GET /api/registries/systems': () => new Response(JSON.stringify({ error: 'No data/systems.yaml' }), { status: 404 }),
  ...over,
})

/** A refusal as a route answer: a function, so each fetch gets a fresh body (a Response is read once). */
export const refuse = (status: number, body: Record<string, unknown>) => () => new Response(JSON.stringify(body), { status })

/** A Safe that only its data/systems.yaml entry places in the treasury: its resource names no section (review I-2). */
export const entryPlacedSafe = resource({ id: 'system:safe', kind: 'system', name: 'Main Safe', status: null, facts: {},
  source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: 'safe' } })
/** data/systems.yaml holding that entry. */
export const treasuryEntries = { name: 'systems', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'safe', kind: 'safe', section: 'organization/treasury' }] }
/** The two reads of data/systems.yaml that place no system yet: one still out, one failed (review I-2). */
export const SYSTEMS_UNREAD = [
  ['is still being read', () => new Promise<Response>(() => {})],
  ['could not be read', refuse(500, { error: 'data/systems.yaml cannot be read' })],
] as const
