import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type DriverRead } from '../api.ts'
import { useResources, useSystemsRead } from '../queries.ts'
import { driverOf } from '../systems/DriverView.tsx'
import { factText } from '../kinds.ts'
import { ago } from '../time.ts'
import { Amount } from '../elements/atoms/Amount.tsx'
import { ReadAge } from '../elements/atoms/ReadAge.tsx'
import { readStateOf } from '../elements/atoms/FromMark.tsx'
import { fieldOf, runQuery, systemsWait } from './query.ts'
import { entryKinds, useEntryOf } from './entries.ts'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData, FrameView, RecordSource } from './types.ts'

/** A records source, or a system's fact (P4-C9): `fact` names the fact, `reading` which reading, as on the system block. */
type MetricSource = RecordSource & { system?: string; fact?: string; reading?: string }
type MetricView = FrameView & { measure?: 'count' | 'sum'; field?: string; label?: string; unit?: string; decimals?: number }
/** The number, what it is, its unit and places when it is an amount, and the read it came from (a System's). */
interface Metric { value: string; label: string; unit: string; decimals: number; read: DriverRead | null }

/** One number: a count of records, a sum of one of their number fields, or a value a system's
 *  driver read (spec §4.3). It does no arithmetic beyond that (spec §12). */
function useMetric(cfg: BlockCfg, ctx: BlockCtx): BlockData {
  const source = (cfg.source ?? {}) as MetricSource
  const view = (cfg.view ?? {}) as MetricView
  const system = source.system !== undefined ? `system:${source.system}` : null
  const resources = useResources()
  const systemsRead = useSystemsRead()
  const systems = systemsRead.entries
  const one = useQuery({ queryKey: ['resource', system], queryFn: () => api.resource(system!), enabled: system !== null })
  const key = JSON.stringify(source)
  const entries = useEntryOf(system ? [] : entryKinds(source, [view.measure === 'sum' ? view.field : undefined]))
  const rows = useMemo(() => (system ? [] : runQuery(source, resources.data ?? [], systems, entries.entryOf)), [resources.data, systems, key, entries.entryOf])
  if (system) {
    if (one.error) return { state: 'error', error: one.error.message }
    if (one.isPending) return { state: 'loading' }
    const read = driverOf(one.data!.resource)
    if (!read) return { state: 'unavailable', error: 'Nothing has read this system yet.' }
    const value = factText(read.facts[source.fact ?? ''])
    const age = read.readAt ? ago(read.readAt, ctx.now) : null
    if (!read.ok) {
      return { state: 'unavailable', error: `Read failed: ${read.error ?? 'no reason given'}.${value ? ` The last good read${age ? `, ${age}` : ''}: ${value}.` : ''}` }
    }
    return { state: 'ready', data: { value, label: view.label ?? source.fact ?? '', unit: view.unit ?? '', decimals: view.decimals ?? 0, read } satisfies Metric }
  }
  if (resources.error) return { state: 'error', error: resources.error.message }
  // a section that sorts systems by their data/systems.yaml entry is counted once that file answered, never "0" before (I-2)
  const waiting = systemsWait(source, systemsRead)
  if (waiting?.state === 'error') return waiting
  if (resources.isPending || entries.pending || waiting) return { state: 'loading' }
  const value = view.measure === 'sum'
    // Only numbers: Number() would count true as 1 and "250" as 250 (M-9).
    ? String(rows.reduce((n, r) => { const v = fieldOf(r, view.field ?? '', entries.entryOf(r)); return typeof v === 'number' && Number.isFinite(v) ? n + v : n }, 0))
    : String(rows.length)
  return { state: 'ready', data: { value, label: view.label ?? '', unit: view.unit ?? '', decimals: view.decimals ?? 0, read: null } satisfies Metric }
}

const DECIMAL = /^-?\d+(\.\d+)?$/

/** The amount, large (§7.7, §14.2): a number in the display face — with its unit when it is money — then what it is,
 *  then, for a System's fact, its read age. A value that is not a number ("2 of 4") is drawn in the same face. */
function MetricBody({ data, ctx }: { data: unknown; ctx: BlockCtx }) {
  const m = data as Metric
  const aged = m.read?.state === 'aged'
  return (
    <p className="bmetric">
      {DECIMAL.test(m.value)
        ? <Amount value={m.value} unit={m.unit} decimals={Math.max(0, Math.trunc(m.decimals))} size="large" aged={aged} />
        : <span className="amt amt-display bmetric-t">{m.value}</span>}
      {m.label && <span className="bmetric-l">{m.label}</span>}
      {m.read && <ReadAge state={readStateOf(m.read)} readAt={m.read.readAt} now={ctx.now} />}
    </p>
  )
}

export const metricBlock = defineBlock<BlockCfg>({
  type: 'metric', label: 'Metric',
  config: [
    { key: 'title', label: 'title', input: 'text' },
    { key: 'source.kind', label: 'kind', input: 'kind' },
    { key: 'source.where', label: 'where', input: 'yaml' },
    { key: 'view.measure', label: 'measure', input: 'select', options: ['count', 'sum'] },
    { key: 'view.field', label: 'sum of', input: 'text' },
    { key: 'source.system', label: 'system', input: 'text' },
    { key: 'source.fact', label: 'fact', input: 'text' },
    { key: 'source.reading', label: 'reading', input: 'text' },
    { key: 'view.label', label: 'label', input: 'text' },
    { key: 'view.unit', label: 'unit', input: 'text' },
    { key: 'view.decimals', label: 'places', input: 'number' },
  ],
  title: cfg => cfg.title ?? 'Metric',
  useData: (cfg, ctx) => useMetric(cfg, ctx),
  Body: MetricBody,
})
