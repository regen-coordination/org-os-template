import { useQuery } from '@tanstack/react-query'
import { api, isKnownActor, type ProposalView, type Resource } from '../api.ts'
import { DataList } from '../elements/rows/DataList.tsx'
import { ProposalRow } from '../elements/governance/ProposalRow.tsx'
import { shownFor } from '../elements/governance/seen.ts'
import { useViewer } from '../viewAs/ViewAs.tsx'
import { PROPOSAL_SOURCES } from '../../../lib/board-query.mjs'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData } from './types.ts'

export type ProposalsSource = (typeof PROPOSAL_SOURCES)[number]

const sourceOf = (cfg: BlockCfg): ProposalsSource => {
  const s = (cfg.source as { proposals?: unknown } | undefined)?.proposals
  return PROPOSAL_SOURCES.find(x => x === s) ?? 'open'
}

/** A proposal as the resource store draws it, for its Card. What asks for attention here is the person's own say:
 *  an open proposal that waits on them; the store's attention (every open proposal) is not theirs. Stale is its own mark. */
export function proposalResource(v: ProposalView): Resource {
  const open = v.state === 'open'
  return {
    id: `proposal:${v.id}`, kind: 'proposal', board: 'organization', name: String(v.title), status: v.derived,
    attention: open && v.needsYou ? { level: 'warn', text: v.evaluation.missing } : null,
    changed: null, facts: { author: v.author, closesAt: v.evaluation.closesAt, stale: v.stale },
    source: { path: 'data/proposals.yaml', editable: false, registry: 'proposals', entityId: String(v.id) },
  }
}

const pick = (views: ProposalView[], source: ProposalsSource, actor: string | null): ProposalView[] => {
  switch (source) {
    case 'open': return views.filter(v => v.state === 'open')
    case 'closed': return views.filter(v => v.state !== 'open')
    case 'mine': return views.filter(v => v.author === actor)
    case 'needs-me': return views.filter(v => v.state === 'open' && v.needsYou)
    default: return []
  }
}

function useProposalsData(cfg: BlockCfg): BlockData {
  const source = sourceOf(cfg)
  const list = useQuery({ queryKey: ['proposals'], queryFn: api.proposals })
  const who = useQuery({ queryKey: ['actor'], queryFn: api.actor, staleTime: 60_000, retry: false, enabled: source === 'mine' })
  if (list.error) return { state: 'error', error: list.error.message }
  if (list.isPending || (source === 'mine' && who.isPending)) return { state: 'loading' }
  if (source === 'mine' && (who.error || !who.data || !isKnownActor(who.data))) {
    const email = who.data && 'unknown' in who.data ? who.data.unknown : ''
    return { state: 'unavailable', error: email ? `Your proposals are not known: ${email} matches no member.` : 'Your proposals are not known: git has no user.email set here.' }
  }
  const actor = who.data && isKnownActor(who.data) ? who.data.id : null
  const rows = pick(list.data!, source, actor)
  return rows.length === 0 ? { state: 'empty', count: 0 } : { state: 'ready', data: rows, count: rows.length }
}

function ProposalsBody({ cfg, data, ctx }: { cfg: BlockCfg; data: unknown; ctx: BlockCtx }) {
  const rows = data as ProposalView[]
  // Each a proposal row (§9.2, CC-4): its id, title, route, compact timeline and meter, and its deadline; the one
  // that waits on the viewer in the attention style. A row the viewer may not see is not drawn (its resource's facts).
  return (
    <DataList label={cfg.title ?? 'Proposals'}>
      {rows.map(v => <ProposalItem key={String(v.id)} view={v} now={ctx.now} />)}
    </DataList>
  )
}

/** A proposal row as the viewer is shown it (E-50, rule 8, `shownFor`): absent, whole, or in its restricted form. */
function ProposalItem({ view, now }: { view: ProposalView; now: Date }) {
  const { viewer, sees } = useViewer()
  // only a preview judges the records the ops touch: you are shown what the server gave you, and read nothing more
  const resources = useQuery({ queryKey: ['resources'], queryFn: api.resources, enabled: viewer.as !== 'you' })
  const shown = sees(proposalResource(view)) ? shownFor(view, resources.data, viewer, sees) : null
  return shown ? <ProposalRow view={shown} now={now} /> : null
}

/** The proposals the ledger holds, read from GET /api/proposals: the open ones, the closed ones, the actor's own, or
 *  those that wait on the actor (spec §3.14). It stages nothing. */
export const proposalsBlock = defineBlock<BlockCfg>({
  type: 'proposals', label: 'Proposals',
  config: [
    { key: 'title', label: 'title', input: 'text' },
    { key: 'source.proposals', label: 'which', input: 'select', options: [...PROPOSAL_SOURCES] },
  ],
  title: cfg => cfg.title ?? 'Proposals',
  useData: cfg => useProposalsData(cfg),
  Body: ProposalsBody,
})

