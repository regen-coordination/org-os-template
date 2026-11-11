// @vitest-environment jsdom
/** The commons page (spec §4.1): the four lanes with their reasons, the plate's "no rule of its own" sentence, the
 *  three views of the same rows, and one sentence when this instance has no canon. */
import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import Commons from './Commons.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes } from '../test/data.ts'
import { knowledgeView, row } from '../test/fixtures/knowledge.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import type { Viewer } from '../viewAs/visibility.ts'

const atAs = (initial: Viewer) => renderAt(<ViewAsProvider initial={initial}><Commons /></ViewAsProvider>, '/c/knowledge')

const routes = (over: Record<string, unknown> = {}) => ({ ...baseRoutes(), 'GET /api/knowledge': knowledgeView(), ...over })

describe('the commons', () => {
  it('draws the four lanes in pipeline order, with their counts and what moves a row on', async () => {
    fetchRoutes(routes())
    renderAt(<Commons />, '/c/knowledge')
    expect(await screen.findByRole('heading', { level: 1, name: 'Example DAO Commons' })).toBeTruthy()
    const lanes = ['Draft', 'Awaiting review', 'Published', 'Internal only']
    for (const name of lanes) expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Moves on: a person.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Moves on: a run.').length).toBeGreaterThan(0)
  })

  it('puts each row’s reason on the row, in the data’s words', async () => {
    fetchRoutes(routes())
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByText('Seed swap notes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('raw · written with AI help').length).toBeGreaterThan(0)
    expect(screen.getAllByText('public use: internal only').length).toBeGreaterThan(0)
  })

  it('says what decides: no rule of its own, so an entry’s public use alone (in words: walk W7, D3)', async () => {
    fetchRoutes(routes())
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByText(/sets no rule of its own/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/public use alone decides/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/plans it and shows its receipt/).length).toBeGreaterThan(0)
  })

  it('shows the same rows as a table, by kind, when asked', async () => {
    fetchRoutes(routes())
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByRole('heading', { level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const table = screen.getByRole('table', { name: 'Every entry' })
    expect(within(table).getByText('Living mulch')).toBeTruthy()
    expect(within(table).getAllByText('encyclopedia-entry').length).toBeGreaterThan(0)
  })

  it('filters by kind, and the lane counts follow the filter', async () => {
    fetchRoutes(routes())
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByRole('heading', { level: 1 })
    fireEvent.click(screen.getByRole('button', { name: /Claim evidence/ }))
    // Only the claim is left: the published lane is empty, and the awaiting lane holds it.
    expect(screen.queryAllByText('Living mulch')).toHaveLength(0)
    expect(screen.getAllByText('Seed swap notes').length).toBeGreaterThan(0)
  })

  it('reads the peers from the answer, not from a second guess; the files are the setup page’s (walk W7, D3)', async () => {
    fetchRoutes(routes())
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText(/couldn’t read · last good read 9 d ago/)).toBeTruthy()
    expect(screen.queryByText('data/kms-reads.json')).toBeNull()
  })

  it('answers one sentence, and the way to set one up, when there is no canon', async () => {
    fetchRoutes(routes({
      'GET /api/knowledge': {
        configured: false, reason: 'the commons is not set up here (no kms.yaml).', instance: null, did: null, sentence: null,
        counts: { entries: 0, kinds: 0, sources: 0, peers: 0, published: 0, awaiting: 0, internal: 0, draft: 0 },
        lanes: [], kinds: [], peers: [], runs: [], files: [], rule: { module: null, sentence: 'There is no canon here.' },
        plane: { dir: 'public', pages: false, static: true, atproto: false, lastRun: null },
      },
    }))
    renderAt(<Commons />, '/c/knowledge')
    expect(await screen.findByText('The knowledge commons is not set up here.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Set up the commons' })).toBeTruthy()
  })

  it('lists a run with the house’s sentence', async () => {
    fetchRoutes(routes({
      'GET /api/knowledge': knowledgeView({
        runs: [{ id: 'job-1', op: 'knowledge.publish', label: 'publish', status: 'ok', at: '2026-10-27T10:00:00Z', sentence: 'Done. It changed public/; nothing was committed.', changed: ['public/'] }],
      }),
    }))
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText(/Done\. It changed public\//)).toBeTruthy()
  })

  it('names the Runs link for the page it opens: the dry read, not a preview the app does not render (walk M10)', async () => {
    fetchRoutes(routes())
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('link', { name: 'Render the preview' })).toBeNull()
    expect(screen.getByRole('link', { name: 'See the dry read' }).getAttribute('href')).toBe('/c/knowledge/setup')
  })

  it('keeps every row reachable at its record address', async () => {
    fetchRoutes(routes())
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByRole('heading', { level: 1 })
    const link = screen.getAllByRole('link', { name: /Living mulch/ })[0]!
    expect(link.getAttribute('href')).toBe('/c/knowledge/encyclopedia-entry/living-mulch')
  })
})

describe('words members read (walk W7, W8, D3)', () => {
  const PLAN = {
    ok: true, refused: null, command: 'org-os-kms publish --apply', plane: 'public', classes: ['publication'],
    counts: { joins: 1, unchanged: 5, leaves: 2, withheld: 0, internal: 1 },
    calls: [{ n: 1, what: 'One index, and a page per kind', where: 'public/index.html · public/k/' }], report: { gate: {} }, from: [],
  }
  it('the commons page says no kms term, file path or command: those are the setup page\'s', async () => {
    fetchRoutes(routes({ 'GET /api/knowledge/plan': PLAN }))
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByText('Publication')
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/canon|the floor|publish\.gate|org-os-kms|kms\.yaml|data\/|public\/|--apply/i)
    expect(screen.queryByRole('button', { name: 'Copy the command' })).toBeNull()
  })
  it('says "Awaiting review" and its reason once on the plate', async () => {
    fetchRoutes(routes({ 'GET /api/knowledge/plan': PLAN }))
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByRole('heading', { level: 1 })
    const plate = document.querySelector('.gateplate')!.textContent ?? ''
    expect(plate.split('Awaiting review').length - 1).toBe(1)
    expect(plate.split('a person’s turn').length - 1).toBe(1)
  })
})

describe('the canon row the page draws', () => {
  it('is the fixture’s own row shape', () => {
    const r = row('published', 'Living mulch')
    expect(r.id).toBe('encyclopedia-entry/living-mulch')
    expect(r.why).toBe('in the selection')
  })
})

describe('publishing, from the commons page', () => {
  const plan = {
    ok: true, refused: null, command: 'org-os-kms publish --apply', plane: 'public', classes: ['publication'],
    counts: { joins: 1, unchanged: 5, leaves: 2, withheld: 0, internal: 1 },
    calls: [
      { n: 1, what: 'One index, and a page per kind', where: 'public/index.html · public/k/' },
      { n: 2, what: 'A page and an API object per selected entry', where: 'public/k/ · public/api/' },
    ],
    report: { gate: { passed: 6, rejected: 0 }, static: { status: 'planned', dir: 'public' } },
    from: ['kms selectPublic: the framework floor, then this instance’s own rule'],
  }

  it('draws the prepared publication: the counts, the calls, and the sentence that says the app never publishes', async () => {
    fetchRoutes(routes({ 'GET /api/knowledge/plan': plan }))
    renderAt(<Commons />, '/c/knowledge')
    expect(await screen.findByText('Publication')).toBeTruthy()
    expect(screen.getByText(/\+1 join the commons · 5 unchanged · 2 leave · 0 withheld by the rule/)).toBeTruthy()
    expect(screen.getByText(/The app never publishes\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run it' })).toBeTruthy()
  })

  it('says how many of the entries a run would publish are still awaiting review', async () => {
    fetchRoutes(routes({ 'GET /api/knowledge/plan': { ...plan, counts: { ...plan.counts, awaiting: 1 } } }))
    renderAt(<Commons />, '/c/knowledge')
    expect(await screen.findByText(/1 of them awaits review: the run publishes it as it stands/)).toBeTruthy()
  })

  // walk W7, D3: the command is the setup page's; here it asks, then runs only what the plan named (its nonce)
  it('asks before it runs, says what it writes in words, and runs only what it planned', async () => {
    const { calls } = fetchRoutes(routes({
      'GET /api/knowledge/plan': plan,
      'POST /api/operations/knowledge.publish/plan': { op: 'knowledge.publish', resource: 'knowledge:commons', inProcess: false, cmd: '/usr/bin/node', args: ['cli.mjs', 'publish', '--apply', '--dir', '/repo'], writes: ['public/'], timeoutMs: 300000, confirm: true, nonce: 'nonce-1' },
      'POST /api/jobs': { id: 'job-1', op: 'knowledge.publish', resource: 'knowledge:commons', status: 'queued', created: '2026-10-29T12:00:00Z', sentence: null, changed: [] },
      'GET /api/jobs/job-1': { job: { id: 'job-1', op: 'knowledge.publish', resource: 'knowledge:commons', status: 'ok', created: '2026-10-29T12:00:00Z', sentence: 'Done. It changed public/; nothing was committed.', changed: ['public/'] }, log: '' },
    }))
    renderAt(<Commons />, '/c/knowledge')
    fireEvent.click(await screen.findByRole('button', { name: 'Run it' }))
    expect(await screen.findByText('Run this now?')).toBeTruthy()
    expect(screen.getByText(/It writes the public pages and the manifest/)).toBeTruthy()
    expect(screen.queryByText(/cli\.mjs publish --apply/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm — run it' }))
    await waitFor(() => expect(calls.some(c => c.path === '/api/jobs')).toBe(true))
    expect(await screen.findByText(/Done\. It changed public\//)).toBeTruthy()
  })

  it('says a canon publishes nothing itself, and offers no run', async () => {
    fetchRoutes(routes({ 'GET /api/knowledge/plan': { ...plan, ok: false, refused: 'this instance is a canon: it publishes nothing itself.' } }))
    renderAt(<Commons />, '/c/knowledge')
    expect(await screen.findByText(/this instance is a canon/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refused' })).toBeTruthy()
  })
})

describe('review fixes: the house’s rows, and View as Public (2026-11-04)', () => {
  const PLAN = {
    ok: true, refused: null, command: 'org-os-kms publish --apply', plane: 'public', classes: ['publication'],
    counts: { joins: 0, unchanged: 3, leaves: 0, withheld: 0, internal: 1, awaiting: 0 }, calls: [], report: {}, from: [],
  }

  it('draws the standline’s rows as the house’s data rows, each a link to its entry', async () => {
    fetchRoutes(routes({ 'GET /api/knowledge/plan': PLAN }))
    renderAt(<Commons />, '/c/knowledge')
    await screen.findByRole('heading', { level: 1 })
    const published = screen.getAllByRole('list', { name: 'Published' })[0]!
    const link = within(published).getByRole('link', { name: /Living mulch/ })
    expect(link.getAttribute('href')).toBe('/c/knowledge/encyclopedia-entry/living-mulch')
  })

  it('previewing as Public: the selection only — no awaiting or internal entry, no plate, no publishing, no setup', async () => {
    fetchRoutes(routes({ 'GET /api/knowledge/plan': PLAN }))
    atAs({ as: 'public' })
    await screen.findByRole('heading', { level: 1, name: 'Example DAO Commons' })
    expect(screen.getAllByText('Living mulch').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('Seed swap notes')).toHaveLength(0)
    expect(screen.queryAllByText('Staff handbook')).toHaveLength(0)
    expect(screen.queryByText('Where the entries stand')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run it' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Set up the commons' })).toBeNull()
    // Counted as the public counts them: nothing it may not see.
    expect(screen.queryByText(/5 entries/)).toBeNull()
  })

  it('previewing as Members: the whole canon, and no action', async () => {
    fetchRoutes(routes({ 'GET /api/knowledge/plan': PLAN }))
    atAs({ as: 'members' })
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByText('Seed swap notes').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Run it' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Set up the commons' })).toBeNull()
  })
})
