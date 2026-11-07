import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type ProposalView, type Resource } from '../api.ts'
import { useResources } from '../queries.ts'
import { record, str } from '../elements/rows/systemState.ts'
import { preparedFromProposal, type PreparedView } from '../elements/governance/prepared.ts'
import { NEVER_SIGNS, PreparedTx } from '../elements/governance/PreparedTx.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { ButtonLink } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { chainName } from '../elements/atoms/chain.ts'
import { driverOf, safeHref } from '../systems/DriverView.tsx'
import { systemFacts } from '../elements/rows/systemState.ts'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData } from './types.ts'

/** The System a proposal's current attach names (`system:<id>`), when there is one. */
export function attachedSystem(v: ProposalView): string | null {
  const events = (v.events as unknown as Record<string, unknown>[]).filter(e => e.rev === v.rev && e.kind === 'attach')
  const id = str(record(events.at(-1)?.ref).system)
  return id === null ? null : `system:${id}`
}

/** A prepared transaction still waiting: not yet executed (preparing, unsigned, partly signed, ready, or a mismatch to
 *  look at). */
const PENDING: ReadonlySet<PreparedView['state']> = new Set(['preparing', 'unsigned', 'partly-signed', 'ready', 'mismatch'])

/** The pending prepared transactions of the open proposals (§9.6), one card per chain, each with the Safe it is for:
 *  the card carries no facts of its own (E-39), so its Safe's Resource is what the viewer's filter reads. */
export function pendingPrepared(proposals: ProposalView[], resources: Resource[]): { key: string; tx: PreparedView; safe: Resource | null }[] {
  const byId = new Map(resources.map(r => [r.id, r]))
  return proposals.filter(v => v.state === 'open').flatMap(v => {
    const sys = attachedSystem(v)
    const safe = sys ? byId.get(sys) ?? null : null
    return preparedFromProposal(v, safe ?? undefined).filter(tx => PENDING.has(tx.state))
      .map(tx => ({ key: `${v.id}:${tx.safe.chain}:${tx.nonce}`, tx, safe }))
  })
}

/** A transaction a Safe's own read lists as waiting on signers (its "Waiting on signers" section), which no open
 *  proposal prepared: a Safe's signers may queue one in the Safe app, and Home's Needs you asks for it (walk
 *  2026-11-04). Its row's cells are `[network,] #nonce, what it does, "n of t signatures", age`. */
export interface SafeWaiting { key: string; safe: Resource; nonce: number; network: string | null; summary: string; signatures: string; age: string; href: string | null }

/** Every transaction the Safes' reads list as waiting, but those a prepared card already stands for (the same Safe
 *  and nonce, and the same chain when the row names one). A Safe whose read failed lists none. */
export function safeWaiting(resources: Resource[], cards: { tx: PreparedView; safe: Resource | null }[]): SafeWaiting[] {
  return resources.filter(r => r.kind === 'system' && systemFacts(r).kind === 'safe').flatMap(safe => {
    const read = driverOf(safe)
    if (!read?.ok) return []
    const rows = read.sections.find(s => s.title === 'Waiting on signers')?.rows ?? []
    return rows.flatMap((row, i) => {
      const cells = row.cells.map(String)
      const at = cells.findIndex(c => /^#\d+$/.test(c))
      if (at < 0) return []
      const nonce = Number(cells[at]!.slice(1))
      const network = at > 0 ? cells[at - 1]! : null
      const covered = cards.some(c => c.safe?.id === safe.id && c.tx.nonce === nonce && (network === null || chainName(c.tx.safe.chain) === network))
      if (covered) return []
      const [summary = '', signatures = '', age = ''] = cells.slice(at + 1)
      return [{ key: `${safe.id}:${network ?? ''}:${nonce}:${i}`, safe, nonce, network, summary, signatures, age, href: safeHref(row.href) }]
    })
  })
}

interface PreparedData { cards: ReturnType<typeof pendingPrepared>; waiting: SafeWaiting[] }

function usePreparedData(): BlockData {
  const resources = useResources()
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals })
  const { viewer, sees } = useViewer()
  const source = useVisibilitySource()
  // a card the viewer may not see its Safe of is not drawn (E-39); a Safe not known here reads as members-only
  const shown = useMemo((): PreparedData | null => {
    if (!resources.data || !proposals.data) return null
    const all = pendingPrepared(proposals.data, resources.data)
    // the Safe's read is deduplicated against every card, seen or not, so a hidden card is never drawn as its read
    return { cards: all.filter(c => sees(c.safe ?? {})), waiting: safeWaiting(resources.data, all).filter(w => sees(w.safe)) }
  }, [resources.data, proposals.data, viewer, source])
  const error = resources.error?.message ?? proposals.error?.message
  if (error !== undefined) return { state: 'error', error }
  if (shown === null) return { state: 'loading' }
  const count = shown.cards.length + shown.waiting.length
  // an empty block draws no count (Review Focus 1: "Waiting on signers", never "· 0")
  return count === 0 ? { state: 'empty' } : { state: 'ready', count, data: shown }
}

const the = (name: string) => (/\bsafe$/i.test(name) ? name : `${name} Safe`)

function PreparedBody({ cfg, data, ctx }: { cfg: BlockCfg; data: unknown; ctx: BlockCtx }) {
  const { cards, waiting } = data as PreparedData
  return (
    <div className="blk-cards">
      {cards.map(c => <PreparedTx key={c.key} tx={c.tx} now={ctx.now} />)}
      {waiting.length > 0 && (
        <div>
          <DataList label={`${cfg.title ?? 'Prepared transactions'}, read from the Safe`}>
            {waiting.map(w => (
              <DataRow key={w.key} kind="safe" marks={['needs']} title={w.summary || `nonce ${w.nonce}`}
                second={[`${the(w.safe.name)} · nonce ${w.nonce}`, w.network, w.signatures, w.age].filter(Boolean).join(' · ')}
                trailing={w.href ? <ButtonLink href={w.href} external small>Open in Safe</ButtonLink> : undefined} />
            ))}
          </DataList>
          {cards.length === 0 && <p className="board-note"><span className="ptx-never"><Icon name="key" size="sm" />{NEVER_SIGNS}</span></p>}
        </div>
      )}
    </div>
  )
}

/** The prepared Safe transactions that wait on signers (Treasury, §14.1): one card per chain, read from the proposals'
 *  ledger. The Hub never signs; the card says so and opens the Safe app. It stages nothing. */
export const preparedBlock = defineBlock<BlockCfg>({
  type: 'prepared', label: 'Prepared transactions',
  config: [{ key: 'title', label: 'title', input: 'text' }],
  title: cfg => cfg.title ?? 'Prepared transactions',
  useData: () => usePreparedData(),
  Body: PreparedBody,
})
