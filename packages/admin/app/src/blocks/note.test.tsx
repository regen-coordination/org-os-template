// @vitest-environment jsdom
// C9 (§14.2): a note block is page prose; a quoted paragraph in it is a callout (the workspace's, C3).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlockView } from './BlockFrame.tsx'
import { noteBlock } from './note.tsx'
import { renderMarkdown } from './markdown.tsx'
import { NO_MARKS } from '../parts/marks.ts'
import { renderAt } from '../test/render.tsx'

const ctx = { now: new Date('2026-10-17T12:00:00Z'), marks: NO_MARKS, stage: vi.fn(async () => {}) }

describe('the note block', () => {
  it('draws its text as page prose: headings, paragraphs and links in the editor’s measure', () => {
    renderAt(<BlockView def={noteBlock} cfg={{ title: 'Welcome', text: '## Who we are\n\nA **council** of three. [Site](https://example.org)' }} id="n"
      data={{ state: 'ready', data: '## Who we are\n\nA **council** of three. [Site](https://example.org)' }} ctx={ctx} />)
    const region = screen.getByRole('region', { name: 'Welcome' })
    const prose = region.querySelector('.bf-body > .ed-prose')!
    expect(prose).not.toBeNull()
    expect(prose.querySelector('h3')!.textContent).toBe('Who we are')
    expect(prose.querySelector('p strong')!.textContent).toBe('council')
    expect(screen.getByRole('link', { name: 'Site' }).getAttribute('href')).toBe('https://example.org')
  })
})

describe('renderMarkdown callouts', () => {
  it('draws a quoted paragraph as a callout: the info glyph and its text, inline marks kept', () => {
    const { container } = render(<div>{renderMarkdown('Before.\n\n> Signers sign in the **Safe** app.\n> Nothing is sent from here.\n\nAfter.')}</div>)
    const callout = container.querySelector('.ed-callout')!
    expect(callout).not.toBeNull()
    expect(callout.querySelector('svg')).not.toBeNull()
    expect(callout.querySelector('.ed-callout-t')!.textContent).toBe('Signers sign in the Safe app. Nothing is sent from here.')
    expect(callout.querySelector('strong')!.textContent).toBe('Safe')
    expect([...container.querySelectorAll('p')].map(p => p.textContent)).toEqual(['Before.', 'After.'])
  })

  it('keeps a lone > that opens no quote as text', () => {
    const { container } = render(<div>{renderMarkdown('5 > 3')}</div>)
    expect(container.querySelector('.ed-callout')).toBeNull()
    expect(container.textContent).toBe('5 > 3')
  })
})
