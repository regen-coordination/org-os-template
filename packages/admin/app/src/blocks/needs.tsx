import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type Resource } from '../api.ts'
import { useActor } from '../actor.ts'
import { useResources } from '../queries.ts'
import { driverOf } from '../systems/DriverView.tsx'
import { ageText } from '../time.ts'
import { needsFrom, orderNeeds, type NeedItem } from '../elements/needs/needs.ts'
import { NeedsList } from '../elements/needs/NeedsList.tsx'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData, FrameView } from './types.ts'

/** What the Systems were read as, for a sentence: how many the viewer may see, how many failed, and the newest good
 *  read among them. */
export interface SystemsRead { count: number; failing: number; readAt: string | null }
export function systemsRead(systems: Resource[]): SystemsRead {
  let failing = 0
  let readAt: string | null = null
  for (const r of systems) {
    const read = driverOf(r)
    if (read && !read.ok) failing++
    else if (read?.ok && read.readAt && (readAt === null || read.readAt > readAt)) readAt = read.readAt
  }
  return { count: systems.length, failing, readAt }
}

const systemsWord = (n: number) => `${n} ${n === 1 ? 'System' : 'Systems'}`
const failingWord = (n: number) => (n === 0 ? 'none failing' : `${n} failing`)

/** Needs you's empty line (§9.4): "9 Systems read 4 min ago, none failing." */
export function systemsLine(s: SystemsRead, now: Date): string {
  if (s.count === 0) return 'No Systems are read here yet.'
  return s.readAt ? `${systemsWord(s.count)} read ${ageText(s.readAt, now)}, ${failingWord(s.failing)}.` : `${systemsWord(s.count)}, none read yet.`
}

/** Needs you's items, live (E-34): from the Resources and the open proposals, for the actor, at `now`, in their order,
 *  only what the viewer may see (§6.3). The sidebar's count, the list and the map read these same items. `items` is
 *  null until both answer. */
export function useNeeds(now: Date): { items: NeedItem[] | null; error?: string; retry(): void; systems: Resource[] } {
  const resources = useResources()
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals })
  const { actor } = useActor()
  const { viewer, visible } = useViewer()
  const source = useVisibilitySource()
  const id = actor && 'id' in actor ? actor.id : null
  const minute = Math.floor(now.getTime() / 60_000) // the order moves with deadlines, not with every tick
  const all = useMemo(() => (resources.data && proposals.data ? orderNeeds(needsFrom(resources.data, proposals.data, id, now), now) : null),
    [resources.data, proposals.data, id, minute])
  const items = useMemo(() => (all ? visible(all) : null), [all, viewer, source])
  const systems = useMemo(() => visible((resources.data ?? []).filter(r => r.kind === 'system')), [resources.data, viewer, source])
  const error = resources.error?.message ?? proposals.error?.message
  return { items, error, systems, retry: () => { void resources.refetch(); void proposals.refetch() } }
}

type NeedsView = FrameView & { limit?: number }
interface NeedsData { items: NeedItem[]; line: string }

function useNeedsData(cfg: BlockCfg, ctx: BlockCtx): BlockData {
  const needs = useNeeds(ctx.now)
  if (needs.error !== undefined) return { state: 'error', error: needs.error }
  if (needs.items === null) return { state: 'loading' }
  const limit = (cfg.view as NeedsView | undefined)?.limit
  const items = typeof limit === 'number' && limit >= 0 ? needs.items.slice(0, limit) : needs.items
  // nothing waiting is the list's own empty state (Nothing waits on you, and the Systems' line), with no count
  const count = needs.items.length > 0 ? needs.items.length : undefined
  return { state: 'ready', count, data: { items, line: systemsLine(systemsRead(needs.systems), ctx.now) } satisfies NeedsData }
}

function NeedsBody({ data, ctx }: { cfg: BlockCfg; data: unknown; ctx: BlockCtx }) {
  const d = data as NeedsData
  return <NeedsList items={d.items} systemsLine={d.line} now={ctx.now} />
}

/** Needs you (§9.4) as a block: the attention items that wait on this member, overdue first; `view.limit` draws the
 *  first few (Home), and nothing waiting is "Nothing waits on you." over the Systems' line. It reads no source. */
export const needsBlock = defineBlock<BlockCfg>({
  type: 'needs', label: 'Needs you',
  config: [
    { key: 'title', label: 'title', input: 'text' },
    { key: 'view.limit', label: 'limit', input: 'number' },
  ],
  title: cfg => cfg.title ?? 'Needs you',
  useData: (cfg, ctx) => useNeedsData(cfg, ctx),
  Body: NeedsBody,
})
