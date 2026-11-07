import { useCallback, useReducer, useRef } from 'react'
import { sentence, transition, type Guards, type Machine, type MachineEvent, type Mark } from '../../lib/machines/run.mjs'

export type { Machine, Guards, MachineEvent, Mark } from '../../lib/machines/run.mjs'

export interface MachineHandle {
  state: string
  send: (e: MachineEvent | string) => boolean
  can: (type: string) => boolean
  refusal: string | null
  shows: { mark: Mark | null; text: string }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** One machine in a component (P4 spec §3.2). The state lives in a ref, so `send` is synchronous
 *  (a second event in the same tick sees the first one's state) and `send` and `can` are stable
 *  across renders: a listener registered once may hold them. Guards read the latest `context`. */
export function useMachine(m: Machine, o: { guards?: Guards; context: unknown; initial?: string;
  onEffect?: (effect: string, event: MachineEvent) => void }): MachineHandle {
  const state = useRef(o.initial ?? m.initial)
  const refusal = useRef<string | null>(null)
  const opts = useRef(o)
  opts.current = o
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  const send = useCallback((e: MachineEvent | string): boolean => {
    const event = typeof e === 'string' ? { type: e } : e
    const r = transition(m, opts.current.guards ?? {}, state.current, event, opts.current.context)
    if (!r.ok) {
      refusal.current = r.reason
      rerender()
      return false
    }
    state.current = r.state
    refusal.current = null
    rerender() // before the effects: one that throws must not leave the screen behind the state
    for (const effect of r.effects) opts.current.onEffect?.(effect, event)
    return true
  }, [m])

  const can = useCallback((type: string): boolean =>
    transition(m, opts.current.guards ?? {}, state.current, { type }, opts.current.context).ok, [m])

  return { state: state.current, send, can, refusal: refusal.current, shows: { ...m.states[state.current]!.shows, text: sentence(m, state.current, isRecord(o.context) ? o.context : undefined) } }
}
