// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import { fetchRoutes } from '../../test/fetchRoutes.ts'
import { PartsGroupPage } from '../PartsPage.tsx'
import Lib from './Lib.tsx'

describe('/parts/lib', () => {
  it('draws the shelf’s four cards, one in each state, the second open', () => {
    renderAt(<Lib />, '/parts/lib')
    const cards = within(screen.getByRole('group', { name: 'Entry cards' })).getAllByRole('article')
    expect(cards.map(c => [c.querySelector('.lib-card-k')!.textContent, c.getAttribute('aria-label'), c.querySelector('.smark')!.textContent])).toEqual([
      ['DAO template', 'Council + Safe + Hats', 'Not added'], ['System kind', 'Hats tree', 'Added'],
      ['Rule set', 'Conviction via Gardens', 'Needs a Garden'], ['Board', 'Treasury', 'Built in'],
    ])
    expect(cards.map(c => c.querySelector('a')!.getAttribute('aria-current'))).toEqual([null, 'true', null, null])
  })

  it('draws the DAO template’s preview in two columns, its taken id in clay, from the fixtures (E-23)', () => {
    renderAt(<Lib />, '/parts/lib')
    const p = screen.getByRole('region', { name: 'Council + Safe + Hats preview' })
    expect(p.querySelector('.lib-prev-s')).toBeTruthy()
    expect(within(p).getByText('id taken · would be treasury-2').closest('li')!.className).toContain('lib-row-clay')
    expect(within(p).getByRole('button', { name: 'Add — stage a change' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Install|not available yet/)
  })

  it('draws the receipt after an add, and what removing would do, the edited record in clay', () => {
    renderAt(<Lib />, '/parts/lib')
    expect(screen.getByText('Added by p-2026-10-12-001-ab12 on 2026-10-12 · created 1 record')).toBeTruthy()
    const rm = screen.getByRole('region', { name: 'Remove Test desk' })
    expect(within(rm).getByText('boards:test-desk').closest('li')!.textContent).toContain('edited since added — asks before taking it')
  })

  it('draws the wizard’s screen, running, done, failed, and the narrow screen', () => {
    renderAt(<Lib />, '/parts/lib')
    const step = screen.getByRole('region', { name: 'Compose a DAO' })
    expect(step.querySelector('.wiz-k')!.textContent).toBe('Compose a DAO · 3 of 5')
    expect(within(step).getByRole('radio', { name: /A new “Signers” hat/ })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Compose a DAO: running' })).getByRole('list', { name: 'Progress' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Compose a DAO: done' }).querySelector('.wiz-out .ktile-moss')).toBeTruthy()
    const failed = screen.getByRole('region', { name: 'Compose a DAO: failed' })
    expect(failed.querySelector('.wiz-out .ktile-attn')).toBeTruthy()
    expect(within(failed).getAllByRole('button').map(b => b.textContent)).toEqual(['Back to review', 'Try again'])
    const narrow = within(screen.getByRole('group', { name: 'A wizard screen under 560px' })).getByRole('region')
    expect(narrow.querySelector('.wiz-top')!.textContent).toBe('Signers · step 3 of 5')
    // each specimen is its own radio group, so both show the choice made
    expect(screen.getAllByRole('radio', { name: /A new “Signers” hat/ }).map(r => (r as HTMLInputElement).checked)).toEqual([true, true])
  })

  // Moved from PartsPage.test's blocks case (E-25): the claim-handle wizard in each state its machine has.
  it('draws 0.6’s claim-handle wizard in every state its machine has, each saying what it writes', () => {
    renderAt(<Lib />, '/parts/lib')
    for (const view of ['intro', 'step', 'review', 'running', 'done', 'failed', 'closed']) {
      const frame = document.querySelector(`[data-wizard="${view}"]`)
      expect(frame, view).toBeTruthy()
      expect(frame!.querySelector('[aria-label="What this writes"]')?.textContent, view).toMatch(/This screen writes\S/)
    }
  })

  it('sends no request', async () => {
    const { calls } = fetchRoutes({})
    renderAt(<PartsGroupPage id="lib" />, '/parts/lib')
    expect(await screen.findByRole('heading', { level: 1, name: 'Library and wizards' })).toBeTruthy()
    await new Promise(r => setTimeout(r, 50))
    expect(calls).toEqual([])
  })
})
