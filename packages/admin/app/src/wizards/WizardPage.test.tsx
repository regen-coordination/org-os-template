// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import WizardPage from './WizardPage.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { refuse } from '../test/data.ts'

const wizardDef = (id: string) => ({
  id, title: `Wizard ${id}`, summary: 's', intro: { body: 'b', writes: 'Nothing.' },
  steps: [{ id: 'a', title: 'A', ask: 'ask', writes: 'Nothing yet.' }], review: { title: 'R', ask: 'a', writes: 'w' }, done: { title: 'D', body: 'b' },
})

describe('/wizards/:id', () => {
  it('draws the wizard that has screens, under its own title', async () => {
    fetchRoutes({
      'GET /api/wizards/claim-handle': wizardDef('claim-handle'),
      'GET /api/bootstrap/claim': { available: true, refusal: null, address: 'a@b.c', candidates: [], canCreate: false, rule: 'bootstrap/claim' },
      'GET /api/wizards/claim-handle/draft': null,
    })
    renderAt(<WizardPage id="claim-handle" />, '/wizards/claim-handle')
    expect(await screen.findByRole('heading', { level: 1, name: 'Wizard claim-handle' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy()
  })

  it('says so, and draws nothing else, for a definition no screen draws yet', async () => {
    fetchRoutes({ 'GET /api/wizards/future': wizardDef('future') })
    renderAt(<WizardPage id="future" />, '/wizards/future')
    expect((await screen.findByText(/no screens in this app yet/)).textContent).toMatch(/This wizard/)
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('is the not-found page for a wizard that does not exist', async () => {
    fetchRoutes({ 'GET /api/wizards/nope': refuse(404, { error: 'No wizard "nope".' }) })
    renderAt(<WizardPage id="nope" />, '/wizards/nope')
    expect(await screen.findByRole('heading', { level: 1, name: 'No page at /wizards/nope.' })).toBeTruthy()
  })

  // R8 (fix wave): a read the server could not answer for was drawn as "no page at …", stating something false.
  it('says a read failed, and does not say the wizard is absent (R8)', async () => {
    fetchRoutes({ 'GET /api/wizards/broken': refuse(500, { error: 'wizards/open-instance.yaml: could not be read.' }) })
    renderAt(<WizardPage id="broken" />, '/wizards/broken')
    const note = await screen.findByText('wizards/open-instance.yaml: could not be read.', { selector: '.note-error .note-t' })
    expect(note).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: /No page at/ })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Wizard' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })
})
