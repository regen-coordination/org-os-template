// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { walk } from '../../../lib/machines/run.mjs'
import { MachineDiagram, layoutMachine } from './MachineDiagram.tsx'
import { job } from '../../../lib/machines/job.mjs'
import { change } from '../../../lib/machines/change.mjs'

describe('MachineDiagram', () => {
  it('places the initial state first and each state a column further than the first way in', () => {
    const l = layoutMachine(job)
    const col = (s: string) => l.boxes.find(b => b.state === s)!.col
    expect(col('queued')).toBe(0)
    expect(col('running')).toBe(1)
    expect(col('ok')).toBe(2)
    expect(l.boxes).toHaveLength(Object.keys(job.states).length)
  })

  it('is a named figure in the tab order: its picture scrolls inside it, and a keyboard scrolls it (2.1.1; C11, axe scrollable-region-focusable)', () => {
    render(<MachineDiagram machine={change} />)
    const fig = screen.getByRole('figure', { name: 'change: its states and transitions' })
    expect(fig.tabIndex).toBe(0)
  })

  it("draws every state with its sentence, final states double-ruled, and lists every transition as a table", () => {
    const { container } = render(<MachineDiagram machine={change} />)
    for (const s of Object.keys(change.states)) expect(container.querySelector(`[data-state="${s}"]`)).toBeTruthy()
    const table = screen.getByRole('table', { name: 'change transitions' })
    expect(within(table).getAllByRole('row')).toHaveLength(walk(change).edges.length + 1)
    const { container: j } = render(<MachineDiagram machine={job} />)
    expect(j.querySelector('[data-state="ok"]')!.className).toContain('final')
  })

  it('draws its states as house nodes, initial and final by shape and word, and its transitions as labelled house edges (§14.2)', () => {
    const { container } = render(<MachineDiagram machine={job} />)
    const node = (s: string) => container.querySelector<HTMLElement>(`[data-state="${s}"]`)!
    for (const s of Object.keys(job.states)) expect(node(s).classList.contains('hnode')).toBe(true)
    expect(node('queued').classList.contains('hnode-initial')).toBe(true)
    expect(node('queued').querySelector('.hnode-tag')!.textContent).toBe('initial')
    expect(node('ok').classList.contains('hnode-final')).toBe(true)
    expect(node('ok').querySelector('.hnode-tag')!.textContent).toBe('final')
    expect(node('running').querySelector('.hnode-tag')).toBeNull()
    const moves = walk(job).edges.filter(e => e.from !== e.to)
    expect(container.querySelectorAll('path.hedge')).toHaveLength(moves.length)
    expect([...container.querySelectorAll('.hlabel')].map(l => l.textContent)).toEqual(moves.map(e => (e.when.length ? `${e.event} [${e.when.join(', ')}]` : e.event)))
    expect(container.querySelector('.mdiag, [class*="mdiag"]')).toBeNull()
  })
})
