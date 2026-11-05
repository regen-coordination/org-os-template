// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button, ButtonLink } from './Button.tsx'

describe('Button', () => {
  it('is a real button, secondary by default and filled when primary', () => {
    const onClick = vi.fn()
    render(<><Button onClick={onClick}>Discard all</Button><Button primary onClick={onClick}>Apply · 1 commit</Button></>)
    const plain = screen.getByRole('button', { name: 'Discard all' }) as HTMLButtonElement
    expect(plain.type).toBe('button')
    expect(plain.className).toBe('btn secondary')
    expect(screen.getByRole('button', { name: 'Apply · 1 commit' }).className).toBe('btn primary')
    fireEvent.click(plain)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('says when it is pressed or expanded, and does nothing when disabled', () => {
    const onClick = vi.fn()
    render(<><Button pressed onClick={onClick}>source</Button><Button expanded={false} disabled onClick={onClick}>Show</Button></>)
    expect(screen.getByRole('button', { name: 'source' }).getAttribute('aria-pressed')).toBe('true')
    const show = screen.getByRole('button', { name: 'Show' })
    expect(show.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(show)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps focus while its unavailable reason comes and goes: the same button, never remounted (E-57)', () => {
    const { rerender } = render(<Button unavailable={undefined}>Approve</Button>)
    const b = screen.getByRole('button', { name: 'Approve' })
    b.focus()
    expect(b.getAttribute('aria-describedby')).toBeNull()
    rerender(<Button unavailable="You approved it already.">Approve</Button>)
    const held = screen.getByRole('button', { name: 'Approve' })
    expect(held).toBe(b)
    expect(document.activeElement).toBe(b)
    expect(held.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(held.getAttribute('aria-describedby')!)?.textContent).toBe('You approved it already.')
    rerender(<Button unavailable={undefined}>Approve</Button>)
    expect(screen.getByRole('button', { name: 'Approve' })).toBe(b)
    expect(document.activeElement).toBe(b)
    expect(b.getAttribute('aria-disabled')).toBeNull()
    expect(b.getAttribute('aria-describedby')).toBeNull()
  })

  it('ButtonLink is a link that looks like a button', () => {
    render(<ButtonLink href="/r/project/p1">Open record →</ButtonLink>)
    const a = screen.getByRole('link', { name: 'Open record →' })
    expect(a.getAttribute('href')).toBe('/r/project/p1')
    expect(a.className).toBe('btn secondary')
  })
})
