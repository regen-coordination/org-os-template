import { transition, type Guards, type Machine, type MachineEvent } from '../lib/machines/run.mjs'
import { Refusal } from './changes/apply.ts'

/** A lifecycle event the machine refuses, answered 409 `{ code: 'REFUSED', machine, state, event,
 *  reason, error }` (interfaces, P4-R2: only where a route had no refusal of its own). A Refusal, so
 *  the app's onError and the change routes' `answer` both send its body as it is. */
export class MachineRefusal extends Refusal {
  constructor(public machine: string, public state: string, public event: string, public reason: string) {
    super(409, { code: 'REFUSED', machine, state, event, reason, error: reason })
  }
}

/** The state `event` leads to, or a MachineRefusal saying why not. */
export function check(m: Machine, guards: Guards, state: string, event: MachineEvent, context: unknown): string {
  const r = transition(m, guards, state, event, context)
  if (!r.ok) throw new MachineRefusal(m.id, state, event.type, r.reason)
  return r.state
}
