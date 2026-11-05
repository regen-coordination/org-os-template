import { useQuery } from '@tanstack/react-query'
import { api, type Resource } from '../api.ts'
import { DriverView, driverOf } from '../systems/DriverView.tsx'
import { systemFacts } from '../elements/rows/systemState.ts'
import { ButtonLink } from '../design/Button.tsx'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData } from './types.ts'

type SystemSource = { system: string; reading?: string }
const idOf = (cfg: BlockCfg) => `system:${(cfg.source as SystemSource | undefined)?.system ?? ''}`

function useSystemData(cfg: BlockCfg): BlockData {
  const id = idOf(cfg)
  const q = useQuery({ queryKey: ['resource', id], queryFn: () => api.resource(id) })
  if (q.error) return { state: 'error', error: q.error.message }
  if (q.isPending) return { state: 'loading' }
  const r = q.data!.resource
  const read = driverOf(r)
  // A failed read is ready: DriverView says the failure in an error note (P1, E-67), then the last good read when
  // there is one, else the note alone (Rulings, I-2).
  if (!read) return { state: 'unavailable', error: 'Nothing has read this system yet: its driver reports here once it does.' }
  return { state: 'ready', data: r }
}

function SystemBody({ data, ctx }: { data: unknown; ctx: BlockCtx }) {
  return <DriverView resource={data as Resource} now={ctx.now} />
}

/** The block's foot: the System's own link-out ("Open in Safe"), as its record header has it — the one link out of
 *  the Hub its reads give (an http(s) address only). */
function SystemFoot({ cfg }: { cfg: BlockCfg }) {
  const id = idOf(cfg)
  const q = useQuery({ queryKey: ['resource', id], queryFn: () => api.resource(id) })
  const r = q.data?.resource
  const open = r ? systemFacts(r).open : null
  return open ? <ButtonLink href={open.href} external>{open.label}</ButtonLink> : null
}

/** A System's reads as a block (spec §4.3, §14.2): its driver's sections as field rows or tables with their read age,
 *  and its own link-out in the foot. The Hub never signs. */
export const systemBlock = defineBlock<BlockCfg>({
  type: 'system', label: 'System',
  config: [{ key: 'title', label: 'title', input: 'text' }, { key: 'source.system', label: 'system', input: 'text' }, { key: 'source.reading', label: 'reading', input: 'text' }],
  title: cfg => cfg.title ?? 'System',
  useData: cfg => useSystemData(cfg),
  Body: SystemBody,
  Foot: SystemFoot,
})
