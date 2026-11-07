// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { EntryCard } from './EntryCard.tsx'
import { renderAt } from '../test/render.tsx'
import { listed, SHELF } from '../test/fixtures/library.ts'
import type { ListedEntry } from '../api.ts'

const card = (name: string) => screen.getByRole('article', { name })
const link = (name: string) => within(card(name)).getByRole('link')

describe('EntryCard (§11.1)', () => {
  it('is a link to the entry’s preview, named by its title: the eyebrow kind, the title, the summary and the foot', () => {
    renderAt(<EntryCard entry={listed()} />)
    const a = link('Onboarding')
    expect(a.getAttribute('href')).toBe('/library/board%3Aonboarding')
    expect(a.closest('.lib-card')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Onboarding' })).toBe(a)
    const c = card('Onboarding')
    expect(c.querySelector('.lib-card-k')!.textContent).toBe('Board')
    expect(c.querySelector('.lib-card-t')!.textContent).toBe('Onboarding')
    expect(c.querySelector('.lib-card-d')!.textContent).toMatch(/^A page for someone new/) // clamped to two lines by the sheet
    const foot = c.querySelector('.lib-card-f')!
    expect(foot.querySelector('.lib-card-src')!.textContent).toBe('framework')
    expect(foot.querySelector('.mono')!.textContent).toBe('v1.0.0')
  })

  it('names its kind as the shelf reads it: DAO template, System kind, Rule set, Board, Wizard (E-A1)', () => {
    const kinds: [string, string][] = [['template', 'DAO template'], ['system', 'System kind'], ['rules', 'Rule set'], ['board', 'Board'], ['wizard', 'Wizard']]
    for (const [shelf, word] of kinds) {
      const { unmount } = renderAt(<EntryCard entry={listed({ id: `${shelf}/x`, shelf: shelf as ListedEntry['shelf'], title: `A ${shelf}` })} />)
      expect(card(`A ${shelf}`).querySelector('.lib-card-k')!.textContent, shelf).toBe(word)
      unmount()
    }
  })

  it('ends on one state mark, a shape and its word: Not added, Added, Needs …, Built in', () => {
    const marks = SHELF.map(e => {
      const { unmount } = renderAt(<EntryCard entry={e} />)
      const m = card(e.title).querySelector('.smark')!
      const out = [m.className.replace('smark smark-', ''), m.textContent]
      unmount()
      return out
    })
    expect(marks).toEqual([['open', 'Not added'], ['done', 'Added'], ['needs', 'Needs a Garden'], ['closed', 'Built in']])
  })

  it('says Built in with no version number, the shelf alone beside it', () => {
    renderAt(<EntryCard entry={listed({ builtin: true, installable: false, version: 'built in', adds: 'built in', maturity: null })} />)
    const foot = card('Onboarding').querySelector('.lib-card-f')!
    expect(foot.querySelector('.mono')).toBeNull()
    expect(foot.textContent).toBe('frameworkBuilt in')
  })

  it('says raw out loud: an untried entry is shown as untried', () => {
    renderAt(<EntryCard entry={listed({ maturity: 'raw' })} />)
    expect(within(card('Onboarding')).getByText('raw')).toBeTruthy()
  })

  it('marks the open one as the current item: the moss outline for the eye, aria-current for a screen reader', () => {
    renderAt(<EntryCard entry={listed()} selected />)
    expect(link('Onboarding').getAttribute('aria-current')).toBe('true')
    expect(link('Onboarding').closest('.lib-card')!.className).toContain('sel')
  })

  it('the link’s visible words are its title, its whole name: the rest of the card describes it (2.5.3, axe label-content-name-mismatch)', () => {
    renderAt(<EntryCard entry={listed()} />)
    const a = link('Onboarding')
    expect(a.textContent).toBe('Onboarding')
    const said = (a.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)!.textContent)
    expect(said[0]).toBe('Board')
    expect(said[1]).toMatch(/^A page for someone new/)
  })
})
