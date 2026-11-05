import type { Mark } from '../machines.ts'
import type { ChangeView, JobRecord, Resource } from '../api.ts'
import { changeKeyOf } from '../hrefs.ts'
import { kindLabel } from '../kinds.ts'

/** What a card's marks are read from: your staged change, the jobs running or waiting (by resource
 *  id), the selection, and the neighbours drawn faint because they are not in the block. */
export interface MarkContext { change: ChangeView | null; jobs: Map<string, JobRecord>; selected: string | null; faint?: Set<string> }
export const NO_MARKS: MarkContext = { change: null, jobs: new Map(), selected: null }

/** A proposal that is no longer open: its state is the one it closed in (lib/proposals.mjs PROPOSAL_STATES). */
const CLOSED = new Set(['ratified', 'rejected', 'withdrawn', 'expired'])
export const isClosedProposal = (r: Resource): boolean => r.kind === 'proposal' && r.status !== null && CLOSED.has(r.status)
/** A proposal's own stale ops (resource facts `stale`: the positions of ops whose record moved on the trunk). */
const staleProposal = (r: Resource): boolean => r.kind === 'proposal' && !isClosedProposal(r) && Array.isArray(r.facts.stale) && r.facts.stale.length > 0

/** A record's marks, in the order a card shows them (contract): needs, stale or staged, running,
 *  selected, faint. A stale op is staged too; the card says only the stronger word. A record that
 *  comes from no registry has no change key, so it is never staged. */
export function marksOf(r: Resource, ctx: MarkContext): Mark[] {
  const out: Mark[] = []
  if (r.attention) out.push('needs')
  const key = changeKeyOf(r)
  const ops = key && ctx.change ? ctx.change.ops.flatMap((o, i) => (o.record === key ? [i] : [])) : []
  if (ops.some(i => ctx.change!.stale.includes(i)) || staleProposal(r)) out.push('stale')
  else if (ops.length > 0) out.push('staged')
  const job = ctx.jobs.get(r.id)
  if (job && (job.status === 'running' || job.status === 'queued')) out.push('running')
  if (ctx.selected === r.id) out.push('selected')
  if (ctx.faint?.has(r.id) || isClosedProposal(r)) out.push('faint')
  return out
}

/** A node's accessible name: what a sighted reader takes in at a glance. */
export const nodeName = (r: Resource): string =>
  [r.name, kindLabel(r.kind), r.status, r.attention && `needs you: ${r.attention.text}`].filter(Boolean).join(', ')

const SPOKEN: Partial<Record<Mark, string>> = { stale: 'changed since you staged it', staged: 'staged', running: 'running' }

/** A record's accessible name on a card or a map node: the node's name, then what is staged or running.
 *  Selection and faintness are said by the control (aria-current, the list it sits in), not here. */
export function cardName(r: Resource, marks: Mark[]): string {
  return [nodeName(r), ...marks.flatMap(m => (SPOKEN[m] ? [SPOKEN[m]!] : []))].join(', ')
}
