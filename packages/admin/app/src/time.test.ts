// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { ageText, ago, clock, seconds, stamp } from './time.ts'

// C-28 (spec §7.9): relative under 24 h, a no-break space before the unit; then "28 Oct"; "28 Oct 2025" across years
const now = new Date('2026-10-29T12:00:00Z')
describe('ageText', () => {
  it('reads the brief’s four forms', () => {
    expect(ageText('2026-10-29T11:56:00Z', now)).toBe('4\u00a0min ago')
    expect(ageText('2026-10-29T10:00:00Z', now)).toBe('2\u00a0h ago')
    expect(ageText('2026-10-28T08:00:00Z', now)).toBe('28 Oct')
    expect(ageText('2025-10-28T08:00:00Z', now)).toBe('28 Oct 2025')
  })
  it.each([
    ['2026-10-29T11:59:30Z', 'just now'], ['2026-10-29T11:59:00Z', '1\u00a0min ago'], ['2026-10-29T11:00:01Z', '59\u00a0min ago'],
    ['2026-10-29T11:00:00Z', '1\u00a0h ago'], ['2026-10-28T12:00:01Z', '23\u00a0h ago'], ['2026-10-29T12:00:05Z', 'just now'], ['not a date', ''],
  ])('%s → %s', (iso, text) => expect(ageText(iso, now)).toBe(text))
  it('writes a date a day or more back in local time, the year only when it is not this one', () => {
    const local = (y: number, m: number, d: number) => new Date(y, m, d, 9, 30).toISOString()
    const here = new Date(2026, 9, 29, 12)
    expect(ageText(local(2026, 9, 28), here)).toBe('28 Oct')
    expect(ageText(local(2026, 0, 3), here)).toBe('3 Jan')
    expect(ageText(local(2025, 11, 31), here)).toBe('31 Dec 2025')
  })
})

describe('ago', () => {
  it('is ageText under its 0.6 name: one way to say an age', () => {
    for (const iso of ['2026-10-29T11:56:00Z', '2026-10-29T10:00:00Z', '2026-10-28T08:00:00Z', '2025-10-28T08:00:00Z', 'not a date']) expect(ago(iso, now)).toBe(ageText(iso, now))
  })
  it('seconds counts whole seconds, never below zero', () => {
    const at = new Date('2026-10-15T12:00:00Z')
    expect(seconds('2026-10-15T11:59:47.6Z', at)).toBe(12)
    expect(seconds('2026-10-15T12:00:05Z', at)).toBe(0)
  })
})

describe('useNow', () => {
  it('ticks each second while active, and stops when not', async () => {
    const { renderHook, act } = await import('@testing-library/react')
    const { useNow } = await import('./time.ts')
    vi.useFakeTimers({ now: new Date('2026-10-15T12:00:00Z') })
    try {
      const { result, rerender } = renderHook(({ on }) => useNow(on), { initialProps: { on: true } })
      const first = result.current.getTime()
      act(() => { vi.advanceTimersByTime(3000) })
      expect(result.current.getTime() - first).toBe(3000)
      rerender({ on: false })
      const stopped = result.current.getTime()
      act(() => { vi.advanceTimersByTime(3000) })
      expect(result.current.getTime()).toBe(stopped)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
describe('clock and stamp', () => {
  it('write an instant in local wall-clock time', () => {
    const iso = new Date(2026, 9, 16, 22, 4).toISOString()
    expect(clock(iso)).toBe('22:04')
    expect(stamp(iso)).toBe('2026-10-16 22:04')
    expect(clock('not a date')).toBe('')
    expect(stamp('not a date')).toBe('')
  })
})
