import { useId, useMemo, useRef, useState, type DragEvent, type JSX, type Ref, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError, type StageOp } from '../api.ts'
import { useChanges } from '../changes/useChanges.ts'
import { splitChangeKey } from '../hrefs.ts'
import { closeDialog, useSlot } from '../parts/panels.tsx'
import { announce } from '../parts/live.tsx'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { Note } from '../design/Note.tsx'
import { TableView, type Column } from '../elements/views/TableView.tsx'
import { shown } from '../record/fields.ts'
import { importPlan, parseSheet, type ImportRow } from './sheet.ts'

const plural = (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`

/** A file's text (FileReader: every browser, and jsdom, has it). */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error ?? new Error('the file could not be read'))
    r.readAsText(file)
  })
}

/** A refused batch's errors by the record they name; the rest (field '' or no record) for the whole import. */
function refusalsOf(err: unknown): { byRecord: Map<string, string[]>; whole: string[] } {
  const byRecord = new Map<string, string[]>()
  const whole: string[] = []
  if (err instanceof ApiError && err.errors.length > 0) {
    for (const e of err.errors) {
      const line = e.field ? `${e.field}: ${e.message}` : e.message
      if (e.record) byRecord.set(e.record, [...(byRecord.get(e.record) ?? []), line])
      else whole.push(line)
    }
  } else whole.push(err instanceof Error ? err.message : String(err))
  return { byRecord, whole }
}

/** Import from a sheet (spec 2026-11-04 §1c): the house's sheet (the modal dialog) where rows are pasted from a sheet
 *  or a CSV is dropped or chosen, the header row first. Headers match the registry's field ids or their schema titles.
 *  The preview — each row as it will be created, and its problems — is drawn before anything can be staged, and
 *  *Stage N records* stages the rows without problems as one batch of creates. Ids follow titles, unique against the
 *  file, what is staged and each other. `onDone` closes it; the caller unmounts it. */
export function ImportSheet({ registry, label, onDone, dialogRef }:
  { registry: string; label: string; onDone: () => void; dialogRef?: Ref<HTMLDialogElement> }) {
  const ch = useChanges()
  const schema = useQuery({ queryKey: ['schema', registry], queryFn: () => api.schema(registry) })
  // An empty section may have no file yet: then nothing in it is taken.
  const file = useQuery({ queryKey: ['registry', registry], queryFn: () => api.registry(registry), retry: false })
  const [text, setText] = useState('')
  const [refused, setRefused] = useState<{ byRecord: Map<string, string[]>; whole: string[] }>({ byRecord: new Map(), whole: [] })
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const id = useId()

  const taken = useMemo(() => {
    const ids = new Set((file.data?.entries ?? []).map(e => String(e.id)))
    for (const op of ch.view?.ops ?? []) { const k = splitChangeKey(op.record); if (k.registry === registry) ids.add(k.id) }
    return ids
  }, [file.data, ch.view, registry])
  const plan = useMemo(() => (schema.data && text.trim() !== '' ? importPlan(parseSheet(text), schema.data, registry, taken) : null), [schema.data, text, registry, taken])
  const problemsOf = (r: ImportRow) => [...r.problems, ...(refused.byRecord.get(`${registry}:${r.id}`) ?? [])]
  const ready = plan ? plan.rows.filter(r => problemsOf(r).length === 0) : []
  const held = plan ? plan.rows.length - ready.length : 0
  // until the file answers its ids are not known, so an id the rows take could be one it holds (M-2)
  const reading = file.isPending

  const put = (t: string) => { setText(t); setRefused({ byRecord: new Map(), whole: [] }) }
  const fromFile = async (f: File | undefined) => {
    if (!f) return
    try { put(await readText(f)) } catch (err) { setRefused({ byRecord: new Map(), whole: [err instanceof Error ? err.message : String(err)] }) }
  }
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void fromFile(e.dataTransfer.files[0]) }

  const stage = async () => {
    if (ready.length === 0 || busy || reading) return
    const ops: StageOp[] = ready.map(r => ({ op: 'create', record: `${registry}:${r.id}`, value: r.value }))
    setBusy(true)
    try {
      await ch.stage(ops)
      announce(`${plural(ops.length)} ${ops.length === 1 ? 'is' : 'are'} in your changes.`)
      onDone()
    } catch (err) {
      setRefused(refusalsOf(err))
      setBusy(false)
    }
  }

  const fields = plan ? plan.columns.filter(c => c.field !== null && c.field !== 'id') : []
  const columns: Column<ImportRow>[] = [
    ...fields.map((c): Column<ImportRow> => ({ key: c.field!, label: c.header.trim(), cell: r => shown(r.value[c.field!]) })),
    { key: '@id', label: 'Id', mono: true, cell: r => r.id || '—' },
    { key: '@problems', label: 'Problems', card: 'status', cell: r => {
      const ps = problemsOf(r)
      return ps.length === 0 ? 'Ready' : <ul className="imp-problems">{ps.map(p => <li key={p}>{p}</li>)}</ul>
    } },
  ]
  const left = plan ? plan.columns.filter(c => c.left !== null) : []

  return (
    <ConfirmDialog ref={dialogRef} wide title="Import from a sheet" confirm={`Stage ${plural(ready.length)}`} disabled={ready.length === 0 || reading}
      busy={busy ? 'Staging…' : undefined} onCancel={onDone} onConfirm={() => void stage()}
      note={<>Saved to <code>data/{registry}.yaml</code> as a staged change</>}
      body={
        <div className={over ? 'imp imp-over' : 'imp'} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}>
          <p className="imp-l">Paste rows from a sheet, or drop a CSV here, the header row first. Headers are matched to the fields of {label} by name. You’ll see every row before anything is staged.</p>
          <label className="imp-f" htmlFor={`${id}-t`}><span className="imp-fl">Rows, the header row first</span>
            <textarea id={`${id}-t`} className="input imp-text" rows={6} spellCheck={false} value={text} onChange={e => put(e.target.value)} />
          </label>
          <label className="imp-f" htmlFor={`${id}-f`}><span className="imp-fl">Or choose a CSV file</span>
            <input id={`${id}-f`} type="file" accept=".csv,text/csv,text/tab-separated-values" onChange={e => void fromFile(e.target.files?.[0])} />
          </label>
          {schema.error && <Note state="error">{schema.error.message}</Note>}
          {refused.whole.map(w => <Note key={w} state="error">{w}</Note>)}
          {plan && (
            <section className="imp-preview" aria-label="Preview">
              <h3 className="imp-t">Preview</h3>
              {left.length > 0 && <p className="imp-l">Left out: {left.map(c => `${c.header.trim() || 'a column'} (${c.left})`).join('; ')}.</p>}
              <TableView label="Rows to import" rows={plan.rows} columns={columns} rowKey={r => String(r.line)}
                empty={{ title: 'No rows under the header row yet.' }} />
              {plan.rows.length > 0 && <p className="imp-l imp-sum">{plural(ready.length)} ready{held > 0 ? `; ${held} with problems ${held === 1 ? 'is' : 'are'} left out` : ''}.</p>}
            </section>
          )}
        </div>
      } />
  )
}

/** The import's trigger, as a sheet on the overlay slot: `start()` opens it (from a plate's button or a head menu's
 *  item), `sheet` draws it. Escape, Cancel and a staged import close it; focus goes back to what opened it — a menu's
 *  item hands it to its menu's button, the item having closed with it. Mounted only while open, so a plate drawn
 *  outside the panels (a specimen) never needs them. */
export function useImportSheet(registry: string | undefined, label: string): { start: () => void; sheet: JSX.Element | null } {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const start = () => {
    const at = document.activeElement
    const menu = at instanceof HTMLElement ? at.closest('.menu-wrap') : null
    opener.current = (menu?.querySelector<HTMLElement>(':scope > button') ?? (at instanceof HTMLElement ? at : null))
    setOpen(true)
  }
  const sheet = open && registry ? <ImportHost registry={registry} label={label} opener={opener} onDone={() => setOpen(false)} /> : null
  return { start, sheet }
}

function ImportHost({ registry, label, opener, onDone }:
  { registry: string; label: string; opener: RefObject<HTMLElement | null>; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useSlot('overlay', `import:${registry}`, true, onDone, () => opener.current, () => closeDialog(ref.current))
  return <ImportSheet registry={registry} label={label} onDone={onDone} dialogRef={ref} />
}
