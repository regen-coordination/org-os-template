/** Attention and value on the map (spec §8.5). Attention matches Needs you one to one: every need names the nodes it
 *  concerns, and those nodes carry the clay dot. Value moving: when a transaction is prepared, and again when it is
 *  read back executed, a moss dash runs along every edge it touches, three runs, then those edges stay moss (the
 *  path), and a polite sentence says what moved. Pure. */
import type { NeedItem } from '../elements/needs/needs.ts'
import type { MapNodeData } from './HouseNode.tsx'

/** A transaction's value on the map: the edges it moves along, each `[from, to]` the way the value goes, and the
 *  sentence said once ("Transaction 18 prepared. It moves 3,100 USDGLO from the two pools to the Treasury."). */
export interface ValueFlow { id: string; edges: [string, string][]; sentence: string }

/** One run of the travelling dash: house.css's `--dur-flow`. The dash runs FLOW_RUNS times, then stops. */
export const FLOW_RUN_MS = 1100
export const FLOW_RUNS = 3

/** What moved, in a sentence: the amount as the caller formatted it (formatAmount), and from and to as a sentence
 *  says them ("the two pools", "the Treasury"). */
export function flowSentence(o: { nonce: number; phase: 'prepared' | 'executed'; amount: string; from: string; to: string }): string {
  return o.phase === 'prepared'
    ? `Transaction ${o.nonce} prepared. It moves ${o.amount} from ${o.from} to ${o.to}.`
    : `Transaction ${o.nonce} executed. It moved ${o.amount} from ${o.from} to ${o.to}.`
}

/** Whether a flow touches the edge from → to: `along` it, `against` it (value going the other way, back up an admin
 *  edge), or not at all. */
export function flowDirection(flow: ValueFlow | null | undefined, from: string, to: string): 'along' | 'against' | null {
  if (!flow) return null
  if (flow.edges.some(([a, b]) => a === from && b === to)) return 'along'
  if (flow.edges.some(([a, b]) => a === to && b === from)) return 'against'
  return null
}

/** The map's nodes with attention from Needs you: each node a need names gains `needs`, and the first such need's
 *  title (needs come in Needs you's order, so the first is the most pressing). */
export function withNeeds(items: MapNodeData[], needs: Pick<NeedItem, 'title' | 'nodes'>[]): MapNodeData[] {
  return items.map(d => {
    const need = needs.find(n => n.nodes.includes(d.item.id))
    if (!need) return d
    return { ...d, states: d.states.includes('needs') ? d.states : [...d.states, 'needs'], need: d.need ?? need.title }
  })
}
