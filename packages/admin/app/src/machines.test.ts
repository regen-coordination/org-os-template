// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { defineMachine } from '../../lib/machines/run.mjs'
import { useMachine } from './machines.ts'

const lamp = defineMachine({
  id: 'lamp', initial: 'off', events: ['ON', 'OFF', 'BLOW'], guards: ['powered'],
  states: {
    off: { shows: { mark: null, text: 'Off.' }, on: { ON: { to: 'on', when: 'powered', effects: ['click'] } } },
    on: { shows: { mark: 'running', text: 'On.' }, on: { OFF: 'off', BLOW: 'blown' } },
    blown: { shows: { mark: 'failed', text: 'Blown.' }, final: true },
  },
})
const guards = { powered: (ctx: { power: boolean }) => ctx.power || 'there is no power' }

describe('useMachine', () => {
  it('starts in the initial state, or the one it is given', () => {
    expect(renderHook(() => useMachine(lamp, { guards, context: { power: true } })).result.current.state).toBe('off')
    expect(renderHook(() => useMachine(lamp, { guards, context: { power: true }, initial: 'on' })).result.current.state).toBe('on')
  })

  it('send moves and re-renders; the shows of the new state come with it; effects reach onEffect', () => {
    const onEffect = vi.fn()
    const { result } = renderHook(() => useMachine(lamp, { guards, context: { power: true }, onEffect }))
    let sent = false
    act(() => { sent = result.current.send('ON') })
    expect(sent).toBe(true)
    expect(result.current.state).toBe('on')
    expect(result.current.shows).toEqual({ mark: 'running', text: 'On.' })
    expect(onEffect).toHaveBeenCalledWith('click', { type: 'ON' })
  })

  it('a refused event leaves the state and says why', () => {
    const { result } = renderHook(() => useMachine(lamp, { guards, context: { power: false } }))
    act(() => { expect(result.current.send('ON')).toBe(false) })
    expect(result.current.state).toBe('off')
    expect(result.current.refusal).toBe('there is no power')
    expect(result.current.can('ON')).toBe(false)
  })

  it('reads the latest context, not the one of its first render', () => {
    const { result, rerender } = renderHook((p: { power: boolean }) => useMachine(lamp, { guards, context: p }), { initialProps: { power: false } })
    expect(result.current.can('ON')).toBe(false)
    rerender({ power: true })
    expect(result.current.can('ON')).toBe(true)
  })

  it('send and can are stable and see the current state, so a listener registered once may hold them (ruling 11)', () => {
    const { result } = renderHook(() => useMachine(lamp, { guards, context: { power: true } }))
    const { send, can } = result.current
    act(() => { send('ON') })
    expect(can('OFF')).toBe(true)
    expect(result.current.send).toBe(send)
    expect(result.current.can).toBe(can)
  })

  it('send is synchronous: a second event in the same tick sees the first one\'s state', () => {
    const { result } = renderHook(() => useMachine(lamp, { guards, context: { power: true } }))
    act(() => {
      expect(result.current.send('ON')).toBe(true)
      expect(result.current.send('ON')).toBe(false) // already on: ON has no transition from on
    })
  })

  it('a throwing onEffect still leaves the new state on screen', () => {
    const onEffect = () => { throw new Error('effect failed') }
    const { result } = renderHook(() => useMachine(lamp, { guards, context: { power: true }, onEffect }))
    act(() => { expect(() => result.current.send('ON')).toThrow('effect failed') })
    expect(result.current.state).toBe('on')
  })

  it('shows.text has its {placeholders} filled from a plain-object context', () => {
    const jam = defineMachine({
      id: 'jam', initial: 'stuck', events: ['GO'], guards: [],
      states: { stuck: { shows: { mark: 'failed', text: 'Not moved: {reason}.' }, on: { GO: 'stuck' } } },
    })
    const { result } = renderHook(() => useMachine(jam, { context: { reason: 'it is locked' } }))
    expect(result.current.shows.text).toBe('Not moved: it is locked.')
  })
})
