import { useState } from 'react'
import type { StageOp } from '../api.ts'
import { splitId } from '../kinds.ts'
import { recordHref } from '../hrefs.ts'
import { useCanEdit } from '../editable.ts'
import { useRecord } from '../record/useRecord.ts'
import { refusalErrors, useEditor } from '../record/useEditor.ts'
import { staleOf, stagedView } from '../record/fields.ts'
import { FieldsEdit, FieldsRead, StaleCard } from '../record/SchemaFields.tsx'
import { Button, ButtonLink } from '../design/Button.tsx'
import { Card } from '../parts/Card.tsx'
import { Refusal } from '../parts/SyncParts.tsx'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { marksOf } from '../parts/marks.ts'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData } from './types.ts'

const target = (cfg: BlockCfg) => splitId(String((cfg.source as { record?: unknown } | undefined)?.record ?? ''))

function useRecordData(cfg: BlockCfg): BlockData {
  const { kind, id } = target(cfg)
  const m = useRecord(kind, id)
  if (m.loading) return { state: 'loading' }
  if (m.error) return { state: 'error', error: m.error }
  return { state: 'ready', data: { kind, id } }
}

const deleteOps = (record: string): StageOp[] => [{ op: 'delete', record }]

/** One record as field rows, edited in place (spec §4.3, §14.2 `blocks/record`): read in schema order — staged,
 *  stale and restricted as on the record page — Edit turns the fields into inputs, Save stages only what changed.
 *  Delete stages a delete; the tray is its confirmation. Previewing, nothing is offered that writes (C-23). */
function RecordBody({ data, ctx }: { data: unknown; ctx: BlockCtx }) {
  const { kind, id } = data as { kind: string; id: string }
  const m = useRecord(kind, id)
  const r = m.detail?.resource ?? null
  const view = stagedView(m.entry, m.staged)
  const canWrite = useCanWrite()
  const writable = useCanEdit({ resource: r, registry: m.registry, id: m.entityId }) && canWrite
  const ed = useEditor({ registry: m.registry, entityId: m.entityId, latest: view.value, creating: false, stage: ctx.stage })
  const [refused, setRefused] = useState<string | null>(null)
  const names = new Map((m.detail?.neighbours ?? []).map(n => [n.id, n.name]))
  const del = async () => {
    setRefused(null)
    if (!m.changeKey) return
    try { await ctx.stage(deleteOps(m.changeKey)) } catch (err) { setRefused(refusalErrors(err, m.changeKey).map(e => e.message).join(' ')) }
  }
  return (
    <>
      {ed.gone && <Refusal>This entry is no longer in the file: it was removed while you were editing it.</Refusal>}
      {ed.stale && view.value && <StaleCard schema={m.schema} differing={ed.differing} draft={ed.draft} latest={view.value} onKeep={ed.keepMine} onTake={ed.takeTheirs} />}
      {refused && <Refusal>{refused}</Refusal>}
      {/* A preview ends the edit's drawing (C-23: hidden, never disabled). The fields stay as the read rows they were
          and Cancel — which writes nothing — is left, so the edit can be put down (R7). */}
      {ed.editing && canWrite && m.registry && m.schema
        ? <FieldsEdit key={ed.epoch} registry={m.registry} schema={m.schema} draft={ed.draft} file={m.entry} creating={false}
            errors={ed.errors} problems={ed.problems} onChange={ed.set} onProblem={ed.problem} restricted={m.restricted} />
        : view.value && m.registry && m.schema
          ? <FieldsRead registry={m.registry} schema={m.schema} value={view.value} was={view.was} names={names} restricted={m.restricted} stale={staleOf(m.entry, m.staged)} />
          : r && <Card record={r} marks={marksOf(r, ctx.marks)} />}
      <p className="blk-acts">
        {ed.editing && canWrite ? (
          <>
            <Button onClick={ed.cancel}>Cancel</Button>
            <Button primary disabled={!ed.canSave || !writable} onClick={() => { if (writable) void ed.save() }}>Save to changes</Button>
          </>
        ) : ed.editing ? (
          <Button onClick={ed.cancel}>Cancel</Button>
        ) : (
          <>
            {writable && <Button onClick={ed.start}>Edit</Button>}
            {r && <ButtonLink href={recordHref(r.id)}>Open record →</ButtonLink>}
            {writable && m.changeKey && <Button onClick={() => void del()}>Delete</Button>}
          </>
        )}
      </p>
    </>
  )
}

export const recordBlock = defineBlock<BlockCfg>({
  type: 'record', label: 'Record',
  config: [{ key: 'title', label: 'title', input: 'text' }, { key: 'source.record', label: 'record', input: 'text' }],
  title: cfg => cfg.title ?? String((cfg.source as { record?: unknown } | undefined)?.record ?? 'Record'),
  useData: cfg => useRecordData(cfg),
  Body: RecordBody,
  actions: { delete: deleteOps },
})
