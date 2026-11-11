// @vitest-environment jsdom
/** The setup page (spec §4.4, R-36): today it is the dry read — the selection run in memory — and what a run would
 *  write. It says the decisions are kms.yaml's rather than drawing a wizard that cannot write. */
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import CommonsSetup from './CommonsSetup.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes } from '../test/data.ts'
import { knowledgeView } from '../test/fixtures/knowledge.ts'

const dryRead = {
  counts: { canon: 8, selected: 6, internal: 1, awaiting: 1, withheld: 0 },
  withheld: [], broken: [{ slug: 'no-such-note', type: 'encyclopedia-entry', entry: 'living-mulch', fix: 'No entry with this name. Fix the reference or publish the entry.' }],
  kinds: [{ schema: 'encyclopedia-entry', label: 'Encyclopedia entry', writes: 2 }],
  peers: [{ name: 'atproto', state: 'failed' }],
  writes: 'Nothing has been written. This is the same selection `publish` uses.',
}

const plan = {
  ok: true, refused: null, command: 'org-os-kms publish --apply', plane: 'public', classes: ['publication'],
  counts: { joins: 1, unchanged: 5, leaves: 2, withheld: 0, internal: 1 },
  calls: [{ n: 1, what: 'One index, and a page per kind', where: 'public/index.html · public/k/' }],
  report: {}, from: [],
}

const routes = () => ({
  ...baseRoutes(),
  'GET /api/knowledge': knowledgeView(),
  'POST /api/knowledge/dry-read': dryRead,
  'GET /api/knowledge/plan': plan,
})

describe('setting up', () => {
  it('says the decisions are kms.yaml’s, not a wizard’s that cannot write', async () => {
    fetchRoutes(routes())
    renderAt(<CommonsSetup />, '/c/knowledge/setup')
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up the commons' })).toBeTruthy()
    // The sentence is split by its mono span, so match on the whole paragraph's text.
    expect(document.body.textContent).toContain('are kms.yaml’s')
  })

  // walk W7, D3: kms's own terms are said here, and only here
  it('says what decides in kms’s terms: the floor, publish.gate and the command a run is', async () => {
    fetchRoutes(routes())
    renderAt(<CommonsSetup />, '/c/knowledge/setup')
    await screen.findByText('One index, and a page per kind')
    const text = document.body.textContent ?? ''
    expect(text).toContain('The floor decides what may be public')
    expect(text).toContain('publish.gate')
    expect(text).toContain('org-os-kms publish --apply')
  })

  it('shows the dry read: the selection, the broken reference, and that nothing is written', async () => {
    fetchRoutes(routes())
    renderAt(<CommonsSetup />, '/c/knowledge/setup')
    const region = await screen.findByRole('region', { name: /The dry read/ })
    expect(region.textContent).toContain('would go public')
    expect(region.textContent).toContain('6')
    expect(region.textContent).toContain('No entry with this name')
    expect(region.textContent).toContain('Nothing has been written')
  })

  it('names the families of files a run would write, and the command it would run', async () => {
    fetchRoutes(routes())
    renderAt(<CommonsSetup />, '/c/knowledge/setup')
    expect(await screen.findByText('One index, and a page per kind')).toBeTruthy()
    expect(screen.getByText(/this page never runs it/)).toBeTruthy()
  })
})
