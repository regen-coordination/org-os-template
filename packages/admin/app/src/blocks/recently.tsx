import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type DecisionRow, type ProposalView, type Resource } from '../api.ts'
import { useResources } from '../queries.ts'
import { recordHref } from '../hrefs.ts'
import { driverOf } from '../systems/DriverView.tsx'
import { systemKind } from '../elements/rows/systemState.ts'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { preparedFromProposal, totalsOf } from '../elements/governance/prepared.ts'
import { formatAmount } from '../elements/atoms/chain.ts'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData } from './types.ts'

/** What Recently reads: `all` — the decisions and what the Safes read back executed (Home); `money` — the decisions
 *  that moved money (a ratified proposal with a Safe transaction) and what the Safes executed (Treasury). */
export type RecentlySource = { recently: 'all' | 'money' }
export const RECENTLY = ['all', 'money'] as const

/** One row of Recently: what happened, its second line, when (an ISO day, or the read's own words), where it opens,
 *  and the record it stands for, for the viewer's filter (a decision with no record of its own reads as members). */
export interface RecentItem { id: string; kind: string; title: string; second: string; at: string | null; when: string; href: string; item: unknown }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "15 Oct", with the year when it is not `now`'s. */
export function dayOf(iso: string, now: Date): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  return d.getUTCFullYear() === now.getUTCFullYear() ? day : `${day} ${d.getUTCFullYear()}`
}

/** A decision as a row: its title, its id and status; dated by its day. */
function decisionItem(d: DecisionRow, now: Date): RecentItem {
  return { id: `decision:${d.id}`, kind: 'proposal', title: d.title, second: [d.id, d.status].filter(Boolean).join(' · '), at: d.date,
    when: dayOf(d.date, now), href: '/governance/decisions', item: {} }
}

/** Each Safe's executed transactions as its read gives them (the "Executed" section: `#nonce`, what it did, when,
 *  ok or failed). */
export function executedItems(safes: Resource[]): RecentItem[] {
  return safes.flatMap(r => {
    const rows = driverOf(r)?.sections.find(s => s.title === 'Executed')?.rows ?? []
    return rows.map((row, i) => {
      const [nonce = '', what = '', when = '', outcome = ''] = row.cells.map(String)
      return { id: `executed:${r.id}:${nonce || i}`, kind: 'safe', title: what || `Transaction ${nonce}`,
        second: [r.name, nonce, outcome === 'failed' ? 'failed on chain' : 'executed · read back'].filter(Boolean).join(' · '),
        at: null, when, href: recordHref(r.id), item: r }
    })
  })
}

/** A ratified proposal that carried a Safe transaction: a decision that moved money, with what it moved. */
function movedItem(v: ProposalView, safes: Resource[], now: Date): RecentItem | null {
  if (v.state !== 'ratified') return null
  const txs = preparedFromProposal(v)
  if (txs.length === 0) return null
  const sums = totalsOf(txs.flatMap(t => t.calls)).map(t => `${formatAmount(t.value, 2)} ${t.unit}`)
  const at = (v.closed as { at?: unknown } | undefined)?.at
  const safe = safes.find(s => txs.some(t => s.facts.address !== undefined && String(s.facts.address).toLowerCase() === t.safe.address.toLowerCase()))
  return { id: `proposal:${v.id}`, kind: 'proposal', title: String(v.title), second: [String(v.id), ...sums].join(' · '),
    at: typeof at === 'string' ? at : null, when: typeof at === 'string' ? dayOf(at, now) : '', href: recordHref(`proposal:${v.id}`), item: safe ?? {} }
}

/** Recently's rows, newest first (dated rows by their day; the Safes' executed reads, which carry no day, after
 *  them), at most `limit`. */
export function recentItems(source: RecentlySource['recently'], o: { decisions: DecisionRow[]; proposals: ProposalView[]; resources: Resource[]; now: Date; limit: number }): RecentItem[] {
  const safes = o.resources.filter(r => r.kind === 'system' && systemKind(r) === 'safe')
  const dated = source === 'all'
    ? o.decisions.map(d => decisionItem(d, o.now))
    : o.proposals.flatMap(v => movedItem(v, safes, o.now) ?? [])
  const sorted = [...dated].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  return [...sorted, ...executedItems(safes)].slice(0, o.limit)
}

const sourceOf = (cfg: BlockCfg): RecentlySource['recently'] => ((cfg.source as { recently?: unknown } | undefined)?.recently === 'money' ? 'money' : 'all')

function useRecentlyData(cfg: BlockCfg, ctx: BlockCtx): BlockData {
  const source = sourceOf(cfg)
  const limit = Number((cfg.view as { limit?: unknown } | undefined)?.limit ?? 6)
  const resources = useResources()
  const governance = useQuery({ queryKey: ['governance'], queryFn: api.governance, enabled: source === 'all' })
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals, enabled: source === 'money' })
  const { viewer, sees } = useViewer()
  const vis = useVisibilitySource()
  const read = source === 'all' ? governance : proposals
  const items = useMemo(() => (resources.data && read.data
    // what the viewer may not see is not drawn and not counted (§6.3), judged on the record each row stands for
    ? recentItems(source, { decisions: governance.data?.decisions ?? [], proposals: proposals.data ?? [], resources: resources.data, now: ctx.now, limit: Number.POSITIVE_INFINITY })
      .filter(i => sees(i.item)).slice(0, limit) : null),
  [resources.data, governance.data, proposals.data, source, limit, viewer, vis])
  const error = resources.error?.message ?? read.error?.message
  if (error !== undefined) return { state: 'error', error }
  if (items === null) return { state: 'loading' }
  return items.length === 0 ? { state: 'empty' } : { state: 'ready', data: items }
}

function RecentlyBody({ cfg, data }: { cfg: BlockCfg; data: unknown; ctx: BlockCtx }) {
  const items = data as RecentItem[]
  return (
    <DataList label={cfg.title ?? 'Recently'}>
      {items.map(i => <DataRow key={i.id} kind={i.kind} title={i.title} second={i.second} href={i.href} marks={[]} item={i.item}
        // a decision's day has a `<time>`; a Safe's executed read has the server's own age ("12 d"), which is a
        // function of now: marked, so the route shots mask it (C11's baselines went stale every day)
        trailing={i.at ? <time dateTime={i.at}>{i.when}</time> : <span data-volatile="">{i.when}</span>} />)}
    </DataList>
  )
}

/** Recently (§14.1): data rows of what was decided and what the Safes read back executed — on Home every decision,
 *  on Treasury the decisions that moved money. It stages nothing. */
export const recentlyBlock = defineBlock<BlockCfg>({
  type: 'recently', label: 'Recently',
  config: [
    { key: 'title', label: 'title', input: 'text' },
    { key: 'source.recently', label: 'which', input: 'select', options: [...RECENTLY] },
    { key: 'view.limit', label: 'limit', input: 'number' },
  ],
  title: cfg => cfg.title ?? 'Recently',
  useData: (cfg, ctx) => useRecentlyData(cfg, ctx),
  Body: RecentlyBody,
})
