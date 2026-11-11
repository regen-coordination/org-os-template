// DAO-OS L6 Task 17: the Hub's collections on /workspace (spec §15) — Tasks, Meetings and each collection data/collections.yaml
// defines (and a private one the viewer is admitted to, as GET /api/collections gives it), each a row that opens it at
// /c/<id> with its count; and New collection, which asks for a name and its fields (§7.3) and refuses what §7.4 refuses
// in the server's words. A new collection is a workspace write to data/collections.yaml.
import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { api, ApiError } from '../api.ts'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { useRegistries } from '../queries.ts'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { FIELD_TYPES } from '../../../lib/workspace/collections.mjs'
import type { FieldType } from '../../../server/workspace/collections.ts'
import { BUILTIN_NAMES, collectionIdOf, fieldIdOf, WORKSPACE_BUILTINS } from './collections.ts'

/** Each field type in a person's words. */
export const TYPE_WORDS: Record<FieldType, string> = {
  text: 'Text', longtext: 'Long text', number: 'Number', select: 'Select', multiselect: 'Multi-select', date: 'Date',
  daterange: 'Date range', checkbox: 'Checkbox', url: 'Link', person: 'Person', relation: 'Relation', page: 'Page', email: 'Email', phone: 'Phone',
}
export const COLLECTION_STAGED = 'The new collection is staged in your change: it needs approval.'
const NEEDS_NAME = 'A collection needs a name.'

export function HubCollections() {
  const canWrite = useCanWrite()
  const defs = useQuery({ queryKey: ['collections'], queryFn: api.collections, retry: false })
  const registries = useRegistries().data ?? []
  const [making, setMaking] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const custom = (defs.data?.collections ?? []).filter(d => !d.builtin)
  const rows = [...WORKSPACE_BUILTINS.map(id => ({ id, name: BUILTIN_NAMES[id] ?? id })), ...custom.map(d => ({ id: d.id, name: d.name ?? d.id }))]
  return (
    <section className="cl-hub" aria-labelledby="cl-hub-t">
      <div className="pg-tree-h">
        <h2 className="pg-tree-t" id="cl-hub-t">Collections in the Hub</h2>
        {canWrite && !making && <Button small icon="plus" onClick={() => { setMaking(true); setNote(null) }}>New collection</Button>}
      </div>
      {making && <NewCollection names={[...WORKSPACE_BUILTINS, ...custom.map(d => d.id), 'projects']} onDone={() => setMaking(false)} onStaged={() => { setMaking(false); setNote(COLLECTION_STAGED) }} />}
      {note && <Note state="notYet">{note}</Note>}
      <DataList label="Collections in the Hub">
        {rows.map(r => {
          const n = registries.find(g => g.name === r.id)?.count ?? 0
          // walk I15, D1: a name another collection shares (an import's "Tasks") is told apart by the collection's id
          const shared = rows.filter(x => x.name === r.name).length > 1
          return <DataRow key={r.id} kind="page" title={r.name} second={`${n} record${n === 1 ? '' : 's'}${shared ? ` · ${r.id}` : ''}`} href={`/c/${encodeURIComponent(r.id)}`} marks={[]} />
        })}
      </DataList>
    </section>
  )
}

interface FieldDraft { name: string; type: FieldType; options: string; to: string }

/** New collection (§7.3): a name (its id from it, which can be changed), then its fields, each a name and a type (a
 *  select's options, a relation's collection). */
export function NewCollection({ names, onDone, onStaged }: { names: string[]; onDone(): void; onStaged(): void }) {
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const [name, setName] = useState('')
  const [id, setId] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldDraft[]>([{ name: 'Name', type: 'text', options: '', to: '' }])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const idNow = id ?? collectionIdOf(name)
  const put = (i: number, f: Partial<FieldDraft>) => setFields(fs => fs.map((x, j) => (j === i ? { ...x, ...f } : x)))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (name.trim() === '') { setErrors([NEEDS_NAME]); return }
    setBusy(true)
    setErrors([])
    const defs = fields.filter(f => f.name.trim() !== '').map(f => ({
      id: fieldIdOf(f.name), type: f.type, name: f.name.trim(),
      ...((f.type === 'select' || f.type === 'multiselect') && f.options.trim() !== '' ? { options: f.options.split(',').map(o => o.trim()).filter(Boolean) } : {}),
      ...(f.type === 'relation' && f.to !== '' ? { to: f.to } : {}),
    }))
    try {
      const out = await api.createCollection({ id: idNow, name: name.trim(), fields: defs })
      await qc.invalidateQueries({ queryKey: ['collections'] })
      void qc.invalidateQueries({ queryKey: ['registries'] })
      if (out.staged) { onStaged(); return }
      navigate(`/c/${encodeURIComponent(out.id)}`)
    } catch (err) {
      setErrors(err instanceof ApiError && err.errors.length > 0 ? err.errors.map(x => x.message) : [err instanceof Error ? err.message : String(err)])
      setBusy(false)
    }
  }

  return (
    <form className="cl-new" aria-label="New collection" onSubmit={e => void submit(e)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onDone() } }}>
      <div className="vfilter">
        <label className="vfilter-f vfilter-v"><span className="vfilter-l">Name</span>
          <input className="input" value={name} autoFocus onChange={e => { setName(e.target.value); setErrors([]) }} />
        </label>
        <label className="vfilter-f"><span className="vfilter-l">Id</span>
          <input className="input" value={idNow} onChange={e => { setId(e.target.value); setErrors([]) }} />
        </label>
      </div>
      <fieldset className="cl-fields">
        <legend className="vfilter-l">Fields</legend>
        {fields.map((f, i) => (
          <div className="vfilter cl-field" key={i}>
            <label className="vfilter-f vfilter-v"><span className="vfilter-l">Field name</span>
              <input className="input" value={f.name} onChange={e => put(i, { name: e.target.value })} />
            </label>
            <label className="vfilter-f"><span className="vfilter-l">Type</span>
              <select className="input" value={f.type} onChange={e => put(i, { type: e.target.value as FieldType })}>
                {(FIELD_TYPES as readonly FieldType[]).map(t => <option key={t} value={t}>{TYPE_WORDS[t]}</option>)}
              </select>
            </label>
            {(f.type === 'select' || f.type === 'multiselect') && (
              <label className="vfilter-f vfilter-v"><span className="vfilter-l">Options, comma between</span>
                <input className="input" value={f.options} onChange={e => put(i, { options: e.target.value })} />
              </label>
            )}
            {f.type === 'relation' && (
              <label className="vfilter-f"><span className="vfilter-l">To</span>
                <select className="input" value={f.to} onChange={e => put(i, { to: e.target.value })}>
                  <option value="">Choose a collection</option>
                  {[...new Set([...names, idNow])].filter(Boolean).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            {fields.length > 1 && <Button small variant="ghost" icon="x" iconOnly label={`Remove the field ${f.name || i + 1}`} onClick={() => setFields(fs => fs.filter((_, j) => j !== i))} />}
          </div>
        ))}
        <Button small variant="ghost" icon="plus" onClick={() => setFields(fs => [...fs, { name: '', type: 'text', options: '', to: '' }])}>Field</Button>
      </fieldset>
      <p className="meta">A collection and its records are kept in the repository: every member can read them.</p>
      {errors.map((m, i) => <Note key={i} state="error">{m}</Note>)}
      <div className="vfilter-acts">
        <Button small primary type="submit" busy={busy ? 'Creating…' : undefined}>Create collection</Button>
        <Button small variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}
