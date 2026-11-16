/** Value moving on the compose canvas (spec §7.4): the edges a prepared step touches, as L4b's ValueFlow, so the map
 *  runs its dash along them. Pure. */
import type { ValueFlow } from '../../map/valueFlow.ts'
import type { ComposeEdge } from './compose.ts'

/** The System an id belongs to: a hat (`<tree>/<key>`) is its tree's. */
const systemOf = (id: string) => (id.includes('/') ? id.slice(0, id.indexOf('/')) : id)

/** Every valid edge with an end in one of the steps' Systems, the way it is drawn. */
export function flowOf(steps: { system: string }[], edges: ComposeEdge[]): ValueFlow {
  const systems = [...new Set(steps.map(s => s.system))]
  const touched = edges.filter(e => !e.invalid && (systems.includes(e.from) || systems.includes(e.to) || systems.includes(systemOf(e.from)) || systems.includes(systemOf(e.to))))
  const n = steps.length
  return {
    id: `compose:${systems.join('+')}`,
    edges: touched.map(e => [e.from, e.to]),
    sentence: `${n} prepared transaction${n === 1 ? '' : 's'} touch ${touched.length} relation${touched.length === 1 ? '' : 's'} on the map.`,
  }
}
