// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PageHead } from './PageHead.tsx'
import { Section } from './Section.tsx'
import { Empty } from './Empty.tsx'

describe('PageHead', () => {
  it('puts the title over its meta line, skipping what is missing, then the buttons', () => {
    const { container } = render(<PageHead title="River Commons" meta={['project', null, 'data/projects.yaml', '', undefined, 'brasil']}><button>Edit</button></PageHead>)
    const h1 = screen.getByRole('heading', { level: 1, name: 'River Commons' })
    expect(h1.className).toBe('rh-title')
    expect(container.querySelector('.rh .rh-meta')!.textContent).toBe('project · data/projects.yaml · brasil')
    expect(within(container.querySelector<HTMLElement>('.rh-acts')!).getByRole('button', { name: 'Edit' })).toBeTruthy()
  })
})

describe('Section', () => {
  it('heads "Needs you" with its count 3 in faint and an end slot', () => {
    render(<Section label="Needs you" count={3} end={<a href="/needs">All</a>}><p>rows</p></Section>)
    const region = screen.getByRole('region', { name: 'Needs you' })
    expect(within(region).getByRole('heading', { level: 2, name: 'Needs you' })).toBeTruthy()
    expect(region.querySelector('.sect-n')!.textContent).toBe('3')
    expect(within(region.querySelector<HTMLElement>('.sect-end')!).getByRole('link', { name: 'All' })).toBeTruthy()
    expect(within(region).getByText('rows')).toBeTruthy()
  })

  it('keeps 0.6’s note, at the end of the head, and draws no count it was not given', () => {
    render(<Section label="Needs you · 4" note="oldest first"><p>rows</p></Section>)
    const region = screen.getByRole('region', { name: 'Needs you · 4' })
    expect(region.querySelector('.sect-end .sect-note')!.textContent).toBe('oldest first')
    expect(region.querySelector('.sect-n')).toBeNull()
  })
})

// C10 (ledger): KindLabel and Absent are gone with their callers; Empty keeps its line.
describe('Empty', () => {
  it('renders its one line', () => {
    render(<Empty>Nothing needs you.</Empty>)
    expect(screen.getByText('Nothing needs you.').closest('.note')!.className).toBe('note note-empty')
  })
})
