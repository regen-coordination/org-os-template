// @vitest-environment jsdom
// DAO-OS L6 Task 19: the Sources page (/sources, spec §10, §15) and the editor table (§11.1, F-L3-3).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXTURE_SOURCE, type Viewer } from '../viewAs/visibility.ts'
import { EDITORS } from '../../../lib/workspace/editors.mjs'
import type { Source } from '../api.ts'
import SourcesPage, { EDITORS_LABEL } from './SourcesPage.tsx'

const NOW = Date.now()
const ago = (ms: number) => new Date(NOW - ms).toISOString()

/** GET /api/sources as the server answers a member (synthetic, placeholders only). */
const SOURCES: Source[] = [
  { id: 'instance', kind: 'instance', name: 'Fixture Org', read: { at: ago(120_000), state: 'fresh' },
    supplies: [
      { what: 'tasks', count: 4, href: '/c/tasks' }, { what: 'projects', count: 2, href: '/c/projects' },
      { what: 'pages', count: 3, href: '/workspace' }, { what: 'other governed files', count: 9 },
    ] },
  { id: 'system:treasury', kind: 'system', name: 'Treasury', href: '/r/system/treasury', read: { at: ago(240_000), state: 'fresh' },
    supplies: [{ what: 'Owners', count: 3 }, { what: 'Balances', count: 2 }] },
  { id: 'system:pool', kind: 'system', name: 'Funding pool', href: '/r/system/pool', read: { at: ago(7_200_000), state: 'failed' }, supplies: [] },
  { id: 'system:handbook', kind: 'repo', name: 'Handbook repo', href: '/r/system/handbook', from: 'from example-org/handbook',
    read: { at: null, state: 'unknown' }, supplies: [{ what: 'data/projects.yaml', count: 5 }, { what: 'data/meetings.yaml' }] },
  { id: 'import:imp-1', kind: 'import', name: 'Notion', read: { at: '2026-08-12', state: 'aged' },
    supplies: [{ what: 'pages', count: 12, href: '/workspace' }, { what: 'tasks', count: 6, href: '/c/tasks' }] },
]

afterEach(() => { vi.unstubAllGlobals() })

function routes(over: Record<string, unknown> = {}) {
  return fetchRoutes({ ...baseRoutes(), 'GET /api/sources': SOURCES, 'GET /api/editors': EDITORS, ...over })
}
function draw(viewer?: Viewer) {
  const ui = viewer ? <ViewAsProvider source={FIXTURE_SOURCE} initial={viewer}><SourcesPage /></ViewAsProvider> : <SourcesPage />
  return renderAt(ui, '/sources')
}
const list = (name: string) => screen.findByRole('list', { name })
const rowsOf = (ul: HTMLElement) => within(ul).getAllByRole('listitem')
const text = (li: HTMLElement, sel: string) => li.querySelector(sel)?.textContent ?? null

describe('/sources — where the Hub’s things come from', () => {
  it('lists the instance, each System and each import, with what each supplies and the read age; a failed read reads “couldn’t read”', async () => {
    routes()
    draw()
    expect(await screen.findByRole('heading', { level: 1, name: 'Sources' })).toBeTruthy()
    const rows = rowsOf(await list('Sources'))
    expect(rows.map(li => text(li, '.drow-t'))).toEqual(['Fixture Org', 'Treasury', 'Funding pool', 'Handbook repo', 'Notion'])
    const [instance, treasury, pool, repo, notion] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement]
    // the instance: what it supplies, in words (no run of small links: the a11y walk's target size at 390, R-L6-T19-1)
    expect(text(instance, '.drow-s')).toBe('Instance · tasks 4 · projects 2 · pages 3 · other governed files 9')
    expect(within(instance).queryByRole('link')).toBeNull()
    expect(text(instance, '.drow-end')).toBe('read 2 min ago')
    // a System: the row opens it; what its read supplies, and its age
    expect(treasury.querySelector('a.drow')!.getAttribute('href')).toBe('/r/system/treasury')
    expect(text(treasury, '.drow-s')).toBe('System · Owners 3 · Balances 2')
    expect(text(treasury, '.drow-end')).toBe('read 4 min ago')
    // a failed read, in the house's words
    expect(text(pool, '.drow-s')).toBe('System')
    expect(text(pool, '.drow-end')).toMatch(/^couldn’t read · last 2 h ago$/)
    expect(pool.querySelector('.age-failed')).not.toBeNull()
    // a repo System: "from <owner>/<repo>" and its files, a file it could not read with no count
    expect(text(repo, '.drow-s')).toBe('Repository · from example-org/handbook · data/projects.yaml 5 · data/meetings.yaml')
    expect(text(repo, '.drow-end')).toBe('not read yet')
    // an import: its export day, and what of it the viewer may read
    expect(text(notion, '.drow-s')).toBe('Import · pages 12 · tasks 6')
    expect(text(notion, '.drow-end')).toMatch(/^exported 12 Aug( 2026)?$/)
    expect(notion.querySelector('time')!.getAttribute('datetime')).toBe('2026-08-12')
  })

  it('draws only what the server sends: no row, count or word for anything it leaves out', async () => {
    routes({ 'GET /api/sources': [{ ...SOURCES[0], supplies: [{ what: 'tasks', count: 1, href: '/c/tasks' }] }] })
    draw()
    const rows = rowsOf(await list('Sources'))
    expect(rows).toHaveLength(1)
    expect(text(rows[0]!, '.drow-s')).toBe('Instance · tasks 1')
    expect(within(screen.getByRole('list', { name: 'Sources' })).queryByText(/System|Import|hidden|private/)).toBeNull()
  })

  it('says why when Sources cannot be read, as a note with Try again (no alert)', async () => {
    routes({ 'GET /api/sources': () => new Response(JSON.stringify({ error: 'The private store is down.' }), { status: 503 }) })
    draw()
    const note = (await screen.findByText(/Couldn’t load Sources/)).closest('.note')!
    expect(note.textContent).toContain('The private store is down.')
    expect(note.getAttribute('role')).not.toBe('alert')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('every row of GET /api/editors links to its editor', async () => {
    routes()
    draw()
    const rows = rowsOf(await list(EDITORS_LABEL))
    expect(rows).toHaveLength(EDITORS.length)
    const href = (pattern: string) => within(rows[EDITORS.findIndex(r => r.pattern === pattern)]!).getByRole('link').getAttribute('href')
    for (const li of rows) expect(within(li).getByRole('link').getAttribute('href')).toMatch(/^\//)
    expect(href('data/governance.yaml')).toBe('/files/data/governance.yaml')
    expect(href('data/visibility.yaml')).toBe('/files/data/visibility.yaml')
    expect(href('data/collections.yaml')).toBe('/files/data/collections.yaml')
    expect(href('IDENTITY.md')).toBe('/files/IDENTITY.md')
    expect(href('memory/**')).toBe('/files/memory/')
    expect(href('data/*.yaml')).toBe('/files/data/')
    expect(href('.well-known/**')).toBe('/files/.well-known/')
    expect(href('data/tasks.yaml')).toBe('/c/tasks')
    expect(href('data/projects.yaml')).toBe('/all/projects')
    expect(href('data/systems.yaml')).toBe('/systems')
    expect(href('data/collections/**')).toBe('/workspace')
    expect(href('pages/**')).toBe('/workspace')
    expect(href('data/kb/**')).toBe('/c/knowledge')
    expect(href('data/boards.yaml')).toBe('/boards')
    expect(href('data/library.yaml')).toBe('/library')
    expect(href('data/proposals.yaml')).toBe('/governance/proposals')
    expect(href('DECISIONS.md')).toBe('/governance/decisions')
    const governance = rows[EDITORS.findIndex(r => r.pattern === 'data/governance.yaml')]!
    expect(text(governance, '.drow-s')).toBe('Rules page, and the source editor for the whole file · class governance')
    expect(text(rows[EDITORS.findIndex(r => r.pattern === 'data/proposals.yaml')]!, '.drow-s')).toBe('The proposal routes · no class: by design')
  })

  it('a row the viewer may not read draws no link to the source editor (0.7.1 D6): the agent layer, for one who does not decide it', async () => {
    const deciders = new Set(['memory/**', 'MEMORY.md', 'HEARTBEAT.md', 'docs/plans/**', 'docs/agent-plans/**'])
    routes({ 'GET /api/editors': EDITORS.map(r => ({ ...r, readable: !deciders.has(r.pattern) })) })
    draw()
    const rows = rowsOf(await list(EDITORS_LABEL))
    expect(rows).toHaveLength(EDITORS.length)
    rows.forEach((li, i) => {
      const pattern = EDITORS[i]!.pattern
      expect([pattern, within(li).queryByRole('link') !== null]).toEqual([pattern, !deciders.has(pattern)])
    })
    expect(document.querySelector('a[href^="/files/memory"]')).toBeNull()
    expect(document.querySelector('a[href="/files/IDENTITY.md"]')).not.toBeNull()
  })

  it('previewing as Public, nothing of Sources is drawn', async () => {
    routes()
    draw({ as: 'public' })
    expect(await screen.findByText('No sources here.')).toBeTruthy()
    expect(screen.queryByText('Fixture Org')).toBeNull()
    expect(screen.queryByText('data/governance.yaml')).toBeNull()
  })

  it('previewing as Public, nothing is drawn even of a row that would read as public: the branch is explicit, not the list filter (T19 review M4)', async () => {
    // a source and an editor row carrying a public level, which a list filtered by the viewer alone would let through
    const { calls } = routes({ 'GET /api/sources': SOURCES.map(s => ({ ...s, facts: { visibility: 'public' } })),
      'GET /api/editors': EDITORS.map(r => ({ ...r, facts: { visibility: 'public' } })) })
    draw({ as: 'public' })
    expect(await screen.findByText('No sources here.')).toBeTruthy()
    expect(screen.getByText('No editors here.')).toBeTruthy()
    expect(screen.queryByText('Fixture Org')).toBeNull()
    expect(screen.queryByText('data/governance.yaml')).toBeNull()
    expect(calls.some(c => c.path === '/api/sources' || c.path === '/api/editors')).toBe(false)
  })

  it('previewing as anyone else, the instance alone, supplying nothing: the counts are yours, and not counted again (PF-R77)', async () => {
    routes()
    draw({ as: 'members' })
    const rows = rowsOf(await list('Sources'))
    expect(rows.map(li => text(li, '.drow-t'))).toEqual(['Fixture Org'])
    expect(text(rows[0]!, '.drow-s')).toBe('Instance')
    expect(screen.queryByText(/Treasury|Notion|tasks 4/)).toBeNull()
  })
})
