// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import Gov from './Gov.tsx'

describe('/parts/gov', () => {
  it('draws the prepared transaction partly signed, then its other states, the house never signing in each', () => {
    renderAt(<Gov />, '/parts/gov')
    const full = screen.getByRole('region', { name: 'prepared transaction · partly signed' })
    const card = within(full).getByRole('region', { name: 'Prepared transaction' })
    expect(card.querySelectorAll('.ptx-call')).toHaveLength(2)
    expect(card.querySelector('.ptx-never')!.textContent).toBe('The Hub never signs. Signers review and sign this in the Safe app.')
    const others = screen.getByRole('region', { name: 'prepared transaction · other states' })
    expect([...others.querySelectorAll('.ptx-brief .ptx-t')].map(t => t.textContent)).toEqual([
      'Preparing', 'Prepared transaction', 'Ready to execute', 'Executed and read back', 'Executed and read back', 'Not what was prepared',
      'Nonce 18 was used by another transaction', 'The proposal changed after this was prepared', 'Prepared transaction',
    ])
    expect(within(others).getByRole('button', { name: 'Prepare again' })).toBeTruthy()
    // the house never signs, in every state, the brief ones too
    expect([...others.querySelectorAll('.ptx-brief .ptx-never')]).toHaveLength(9)
  })

  it('then the proposal timeline, its other step states and the compact form; the proposal rows; the rule statuses; the events (B4)', () => {
    renderAt(<Gov />, '/parts/gov')
    const tl = screen.getByRole('region', { name: 'proposal timeline · each step’s states' })
    const path = within(tl).getByRole('list', { name: 'Path of p-2026-10-17-001' })
    expect([...path.querySelectorAll('.tl-step')].map(li => li.className.replace('tl-step tl-', ''))).toEqual(['done', 'done', 'done', 'done', 'current', 'waiting'])
    const other = within(tl).getByRole('list', { name: 'Other step states' })
    expect([...other.querySelectorAll('.tl-step')].map(li => li.className.replace('tl-step tl-', ''))).toEqual(['yours', 'failed', 'not-needed'])
    expect(tl.querySelector('.tlc-l')!.textContent).toBe('Signing · 2 of 4')

    const rows = within(screen.getByRole('region', { name: 'proposal rows' })).getByRole('list', { name: 'Proposals' })
    expect([...rows.querySelectorAll('.tlc-l')].map(l => l.textContent)).toEqual([
      'Approving · 2 of 4', 'Approving · 2 of 4', 'Approving · 1 of 3', 'Signing · 2 of 4', 'Signing · 2 of 4', 'Decided',
    ])

    const rules = within(screen.getByRole('region', { name: 'rule status' })).getByRole('list', { name: 'Rules' })
    expect([...rules.querySelectorAll('.rst')].map(e => e.className.replace('rst rst-', ''))).toEqual(['met', 'waiting', 'held', 'failed', 'expired'])

    const events = within(screen.getByRole('region', { name: 'proposal events' })).getByRole('list', { name: 'Events' })
    expect(events.querySelectorAll('.evt')).toHaveLength(9)
    expect(events.querySelector('.evt-object .evt-d')!.textContent).toBe('Return the pools only after the spring call closes.')
  })
})
