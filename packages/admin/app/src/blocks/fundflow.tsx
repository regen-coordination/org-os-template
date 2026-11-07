import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type Resource } from '../api.ts'
import { useResources } from '../queries.ts'
import { driverOf } from '../systems/DriverView.tsx'
import { FundFlow } from '../elements/governance/FundFlow.tsx'
import { flowsOf, transfersOf } from '../elements/governance/fromReads.ts'
import type { Flow } from '../elements/governance/fundflow.ts'
import { list, str } from '../elements/rows/systemState.ts'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { useMainSafe } from './balances.tsx'
import { pendingPrepared } from './prepared.tsx'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData } from './types.ts'

/** The window the Safe driver reads the transfers in (server/systems/safe-transfers.ts, TRANSFER_WINDOW_DAYS), in words. */
export const FLOW_WINDOW_WORDS = 'the last 90 days'

/** What the block draws: the flows, and the Safe they run through. */
export interface FundflowData { flows: Flow[]; safe: string }

/** The sentence for transfers the Safe's read could not give whole (a failed request, a chain not read, or more than
 *  its pages hold): the chart is never drawn from part of the window (C12 review I-1). */
export const TRANSFERS_UNREAD = 'The Safe’s transfers couldn’t all be read, so where its value went is not drawn. It is read again with the Safe.'

/** The name of another System at `address` the viewer may see (a pool, a Safe), for a flow's other end; null for an
 *  address the Hub knows no System at, or one the viewer may not see (its name is not shown, its address is). */
export function systemNamer(systems: Resource[], safe: Resource, sees: (r: Resource) => boolean): (address: string) => string | null {
  const byAddress = new Map<string, string>()
  for (const r of systems) {
    if (r.id === safe.id || !sees(r)) continue
    const addresses = [str(r.facts.address), ...list(driverOf(r)?.facts.chains).map(c => str(c.account)?.split(':').at(-1) ?? null)]
    for (const a of addresses) if (a && /^0x[0-9a-fA-F]{40}$/.test(a) && !byAddress.has(a.toLowerCase())) byAddress.set(a.toLowerCase(), r.name)
  }
  return address => byAddress.get(address.toLowerCase()) ?? null
}

function useFundflowData(): BlockData {
  const { safe, pending, error } = useMainSafe()
  const resources = useResources()
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals })
  const { viewer, sees } = useViewer()
  const source = useVisibilitySource()
  const read = safe ? driverOf(safe) : null
  const transfers = transfersOf(read)
  const data = useMemo((): FundflowData | null => {
    if (!safe || !transfers || transfers.length === 0 || !resources.data || !proposals.data) return null
    const systems = resources.data.filter(r => r.kind === 'system')
    const waiting = pendingPrepared(proposals.data, resources.data).filter(c => c.safe?.id === safe.id).map(c => c.tx)
    const flows = flowsOf(read, waiting, { safe: safe.name, nameOf: systemNamer(systems, safe, sees) })
    // transfers that are none of this Safe's own flows are no transfers either
    return flows.some(f => f.status === 'executed') ? { safe: safe.name, flows } : null
  }, [safe, read, resources.data, proposals.data, viewer, source])
  if (pending) return { state: 'loading' }
  // No Safe the viewer may see (E-39), the resources not read, or the Safe not read: no block, before any error is said
  // (C12 review M-2). A read without its transfers says so.
  if (error !== undefined || !safe || !read?.ok) return { state: 'empty' }
  if (proposals.error) return { state: 'error', error: proposals.error.message }
  if (proposals.isPending) return { state: 'loading' }
  if (transfers === null) return { state: 'unavailable', error: TRANSFERS_UNREAD }
  return data === null ? { state: 'empty' } : { state: 'ready', data }
}

function FundflowBody({ data }: { cfg: BlockCfg; data: unknown; ctx: BlockCtx }) {
  const d = data as FundflowData
  return <FundFlow flows={d.flows} safe={d.safe} window={FLOW_WINDOW_WORDS} />
}

/** Where the main Safe's value went in the last 90 days (Treasury, §9.8, Q59): its executed transfers, read by the Safe
 *  driver, and the prepared calls that still wait on signers. It is not drawn for a viewer who may not see the Safe, nor
 *  for a window in which nothing moved (with `view.quiet`); transfers that could not be read are said, not drawn. Read
 *  only. */
export const fundflowBlock = defineBlock<BlockCfg>({
  type: 'fundflow', label: 'Fund flow',
  config: [{ key: 'title', label: 'title', input: 'text' }],
  title: cfg => cfg.title ?? 'Fund flow',
  useData: () => useFundflowData(),
  Body: FundflowBody,
})
