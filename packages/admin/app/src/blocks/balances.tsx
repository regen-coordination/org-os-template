import { useMemo } from 'react'
import type { DriverRead, Resource } from '../api.ts'
import { useResources, useSystemsRead } from '../queries.ts'
import { driverOf } from '../systems/DriverView.tsx'
import { Amount } from '../elements/atoms/Amount.tsx'
import { Note } from '../design/Note.tsx'
import { TableView, type Column } from '../elements/views/TableView.tsx'
import { mainSafeOfResources } from '../map/fromRecords.ts'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData } from './types.ts'

/** One balance of a Safe on one chain, as its read lists it (the "Balances" section: chain, token, amount). It carries
 *  its Safe's facts (and visibility key), so a table filters it as it filters the Safe (CC-14). */
export interface Balance { key: string; chain: string; token: string; amount: string; aged: boolean; facts: Record<string, unknown>; visibility?: unknown }

/** A Safe's balances by chain, from its read: each row of its Balances section. A several-chain read's rows are
 *  [chain, token, amount]; a single chain's are [token, amount], their chain the read's network, as the several-chain
 *  rows name theirs (review I-3). An aged read's amounts are mute. */
export function balancesOf(safe: Resource | null): Balance[] {
  const read: DriverRead | null = safe ? driverOf(safe) : null
  const rows = read?.sections.find(s => s.title === 'Balances')?.rows ?? []
  const own = (safe as { visibility?: unknown } | null)?.visibility
  const network = String((read?.facts as Record<string, unknown> | undefined)?.network ?? '')
  return rows.map((row, i) => {
    const cells = row.cells.map(String)
    const [chain = '', token = '', amount = ''] = cells.length === 2 ? [network, ...cells] : cells
    return { key: `${chain}:${token}:${i}`, chain, token, amount, aged: read?.state === 'aged', facts: safe?.facts ?? {}, ...(own !== undefined ? { visibility: own } : {}) }
  })
}

/** Names as a sentence lists them: "Celo", "Gnosis and Celo", "Base, Gnosis and Celo". */
const listed = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** What a Safe's read says of the chains whose balances it does not know: the chains read from the chain because the
 *  Safe Transaction Service did not answer (L7-D15), which says nothing of balances. Not known, never none, as L7 says
 *  of signatures and the fund flow of transfers (review I-2). Null when every chain's balances were read. */
export function balancesUnknown(safe: Resource | null): string | null {
  const read: DriverRead | null = safe ? driverOf(safe) : null
  if (!read?.ok) return null
  const facts = read.facts as Record<string, unknown>
  const chains = Array.isArray(facts.chains) ? (facts.chains as Record<string, unknown>[]) : null
  const names = chains
    ? chains.filter(c => c?.source === 'chain').map(c => String(c.network ?? c.chain ?? ''))
    : facts.source === 'chain' ? [String(facts.network ?? facts.chain ?? '')] : []
  return names.length === 0 ? null
    : `Balances on ${listed(names)} are not known: the Safe Transaction Service did not answer, so the Safe was read from the chain.`
}

/** The DAO's main Safe the viewer may see (§8.2: the Safe in organization/treasury, else the one most edges point
 *  at), with every System given: null when there is none, or the viewer may not see it. The treasury is its
 *  data/systems.yaml entry's section, so no Safe is chosen until that file answered (`pending`), nor after it failed
 *  (its `error`): another Safe would stand in for the main one (review I-2). */
export function useMainSafe(): { safe: Resource | null; pending: boolean; error?: string } {
  const resources = useResources()
  const read = useSystemsRead()
  const entries = read.entries
  const { viewer, sees } = useViewer()
  const source = useVisibilitySource()
  const safe = useMemo(() => {
    const systems = (resources.data ?? []).filter(r => r.kind === 'system')
    const main = mainSafeOfResources(systems, r => (r.source?.entityId ? entries.get(r.source.entityId) ?? null : null))
    return main && sees(main) ? main : null
  }, [resources.data, entries, viewer, source])
  const error = resources.error?.message ?? read.error?.message
  const pending = resources.isPending || read.pending
  return { safe: pending || error !== undefined ? null : safe, pending, error }
}

const COLUMNS: Column<Balance>[] = [
  { key: 'chain', label: 'Chain', cell: b => b.chain, sort: b => b.chain },
  { key: 'token', label: 'Token', cell: b => b.token, mono: true, sort: b => b.token },
  { key: 'amount', label: 'Amount', right: true, cell: b => <Amount value={b.amount} unit={b.token} decimals={2} aged={b.aged} />, card: 'status' },
]

/** What the block draws: the balances read, and the sentence for the chains whose balances are not known. */
interface BalancesData { rows: Balance[]; unknown: string | null }

function useBalancesData(): BlockData {
  const { safe, pending, error } = useMainSafe()
  if (error !== undefined) return { state: 'error', error }
  if (pending) return { state: 'loading' }
  const rows = balancesOf(safe)
  const unknown = balancesUnknown(safe)
  // no balance read and some not known: not known, not empty
  if (rows.length === 0) return unknown ? { state: 'unavailable', error: unknown } : { state: 'empty' }
  return { state: 'ready', data: { rows, unknown } satisfies BalancesData, count: rows.length }
}

function BalancesBody({ cfg, data }: { cfg: BlockCfg; data: unknown; ctx: BlockCtx }) {
  const { rows, unknown } = data as BalancesData
  return (
    <>
      {unknown && <Note state="unavailable">{unknown}</Note>}
      <TableView label={cfg.title ?? 'Balances'} rows={rows} columns={COLUMNS} rowKey={b => b.key} empty={{ title: 'No balances read yet.' }} head />
    </>
  )
}

/** The main Safe's balances by chain (Treasury, §14.1) in a table view: chain, token, the amount (§7.7). A chain read
 *  from the chain is said, not drawn as holding nothing (review I-2). Read only. */
export const balancesBlock = defineBlock<BlockCfg>({
  type: 'balances', label: 'Balances',
  config: [{ key: 'title', label: 'title', input: 'text' }],
  title: cfg => cfg.title ?? 'Balances',
  useData: () => useBalancesData(),
  Body: BalancesBody,
})
