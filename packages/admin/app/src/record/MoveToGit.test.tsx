// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MoveDialog } from './MoveToGit.tsx'

// walk W4, D3: "the DAO" only where a Hats tree is set; otherwise "the organization"
describe('the move dialog’s words', () => {
  it('says "Every member of the organization" when no Hats tree is set', () => {
    render(<MoveDialog levels={['members']} onCancel={vi.fn()} onMove={vi.fn()} />)
    expect(screen.getByText('Every member of the organization')).toBeTruthy()
  })
  it('says "Every member of the DAO" when a Hats tree is set', () => {
    render(<MoveDialog levels={['members']} dao onCancel={vi.fn()} onMove={vi.fn()} />)
    expect(screen.getByText('Every member of the DAO')).toBeTruthy()
  })
})
