import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type JsonSchema, type RuleSummary, type StageError, type StageOp } from '../api.ts'
import { refOf } from '../refs.ts'
import { slug } from '../slug.ts'
import { splitChangeKey } from '../hrefs.ts'
import { ruleWords } from '../changes/rows.ts'
import { useChanges } from '../changes/useChanges.ts'
import { Section } from '../design/Section.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { TextInput } from '../design/inputs/index.ts'
import { Refusal } from '../parts/SyncParts.tsx'
import type { Editor } from './useEditor.ts'
import { useRefChoices } from './FieldInput.tsx'
import { FormField, fieldKindOf } from './FormControl.tsx'
import { shown, type Value } from './fields.ts'
import { groupsOf, idProblem, labelOf, previewFields, summaryFieldOf, titleFieldOf, type FieldGroup } from './form.ts'

/** The new-record form, Option A (spec 2026-11-04 §3): the schema's groups on one page, the rarely used fields folded
 *  under "Show n more", the id following the title, and beside it (under it, when the page is narrow) the preview, the
 *  governance line and Save to changes. Generic: every registry's New draws it from its schema and its entries. */

/** The ids a new record may not take: the file's, and those the change already stages on the registry. */
export function useTaken(registry: string, entries: readonly Value[]): ReadonlySet<string> {
  const { view } = useChanges()
  return useMemo(() => {
    const ids = new Set(entries.map(e => String(e.id)))
    for (const op of view?.ops ?? []) { const k = splitChangeKey(op.record); if (k.registry === registry) ids.add(k.id) }
    return ids
  }, [entries, view, registry])
}

const errorOf = (ed: Editor, k: string): string | undefined =>
  ed.problems[k] ?? ed.errors.find((e: StageError) => e.field === k || e.field.startsWith(`${k}.`))?.message

/** The id under the title: faint, following it, with *edit*; once edited, a field of its own. Its problem (taken, a
 *  position, missing) is said under it. */
function IdLine({ id, editing, error, onEdit, onChange }:
  { id: string; editing: boolean; error?: string; onEdit: () => void; onChange: (v: unknown) => void }) {
  return (
    <span className="form-id">
      {editing
        ? <TextInput common={{ id: 'f-id', 'aria-label': 'id', 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? 'f-id-err' : undefined }}
            prose={false} value={id} readOnly={false} onChange={onChange} />
        : <><span className="form-id-k">id</span> <span className="form-id-v">{id === '' ? '—' : id}</span>
            <button type="button" className="form-id-edit" aria-label="Edit the id" onClick={onEdit}>edit</button></>}
      {error && <span className="note note-error" id="f-id-err"><Icon name="alert" size="sm" />{error}</span>}
    </span>
  )
}

/** Names the records a reference holds, by their names ("…" while those are read, never their ids: DP-71). */
function RefNames({ target, ids }: { target: string; ids: string[] }) {
  const { nameOf } = useRefChoices(target)
  return <>{ids.map(nameOf).join(', ')}</>
}

function PreviewValue({ registry, field, value }: { registry: string; field: string; value: unknown }) {
  const ref = refOf(registry, field)
  if (ref) return <RefNames target={ref.target} ids={Array.isArray(value) ? value.map(String) : [String(value)]} />
  if (Array.isArray(value) && value.some(x => typeof x === 'object' && x !== null)) {
    // a list of rows reads as each row's first words
    return <>{value.map(r => (typeof r === 'object' && r !== null ? Object.values(r).find(v => typeof v === 'string') ?? '' : String(r))).filter(Boolean).join(', ')}</>
  }
  return <>{shown(value)}</>
}

/** How the record will read: its title, its summary line, and its first filled field rows. */
export function FormPreview({ registry, schema, groups, draft }: { registry: string; schema: JsonSchema; groups: readonly FieldGroup[]; draft: Value }) {
  const titleField = titleFieldOf(schema)
  const summaryField = summaryFieldOf(schema)
  const title = titleField ? draft[titleField] : draft.id
  const summary = summaryField ? draft[summaryField] : null
  const rows = previewFields(schema, groups, draft)
  return (
    <Section label="Preview" note="how it will read">
      <div className="form-prev">
        <h3 className="form-prev-t">{typeof title === 'string' && title !== '' ? title : <span className="faint">Untitled</span>}</h3>
        {typeof summary === 'string' && summary !== '' && <p className="form-prev-s">{summary}</p>}
        {rows.length > 0 && (
          <FieldTable label="Preview">
            {rows.map(k => <FieldRow key={k} label={labelOf(schema, k)}><PreviewValue registry={registry} field={k} value={draft[k]} /></FieldRow>)}
          </FieldTable>
        )}
      </div>
    </Section>
  )
}

/** A value, once it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => { const t = setTimeout(() => setSettled(value), ms); return () => clearTimeout(t) }, [value, ms])
  return settled
}

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`)

/** "Saving adds it to Changes." and who decides: the rule the change would fall under with this create added, as the
 *  tray says it (`ruleWords`), read from the server's read-only route; when it can't be read, where to look instead. */
export function GovernanceLine({ registry, draft }: { registry: string; draft: Value }) {
  const value = useSettled(JSON.stringify(draft), 300)
  const q = useQuery({
    queryKey: ['wouldRule', registry, value],
    queryFn: (): Promise<RuleSummary> => {
      const v = JSON.parse(value) as Value
      const id = typeof v.id === 'string' && v.id.trim() !== '' ? v.id.trim() : 'new'
      const op: StageOp = { op: 'create', record: `${registry}:${id}`, value: { ...v, id } }
      return api.wouldRule([op])
    },
    retry: false,
    placeholderData: keepPreviousData,
  })
  const who = q.data ? sentence(ruleWords(q.data)) : q.isError ? 'The tray says who decides before you propose.' : null
  return <p className="form-decide"><b>Saving adds it to Changes.</b>{who && <> {who}</>}</p>
}

/** What both options draw from (spec 2026-11-04 §3): the schema's groups, the id following the title and checked as it
 *  changes, each group's field rows, and the refusals no drawn field holds. Option A lays the groups out on one page;
 *  Option B (`SteppedForm`) one a step. */
export function useNewRecordForm(registry: string, schema: JsonSchema, entries: readonly Value[], ed: Editor) {
  const groups = useMemo(() => groupsOf(schema, entries), [schema, entries])
  const taken = useTaken(registry, entries)
  const titleField = titleFieldOf(schema)
  const [follows, setFollows] = useState(true)
  const id = String(ed.draft.id ?? '')
  const takenKey = [...taken].join('\n')
  // The id is checked as it is typed (or follows the title): taken, or read as a position.
  useEffect(() => {
    const p = idProblem(registry, id.trim(), taken)
    if (p !== (ed.problems.id ?? null)) ed.problem('id', p)
  }, [id, takenKey])

  const set = (k: string, v: unknown) => {
    ed.set(k, v)
    if (k === titleField && follows) ed.set('id', slug(typeof v === 'string' ? v : ''))
  }
  const drawn = new Set(['id', ...groups.flatMap(g => g.fields)])
  const undrawn = ed.errors.filter(e => e.field === '' || !drawn.has(e.field.split('.')[0]!))
  const field = (k: string, solo = false) => (
    <FormField key={k} registry={registry} schema={schema} field={k} entries={entries} value={ed.draft[k]} error={k === 'id' ? undefined : errorOf(ed, k)}
      solo={solo} onChange={v => set(k, v)} onProblem={p => ed.problem(k, p)}
      after={k === titleField ? <IdLine id={id} editing={!follows} error={errorOf(ed, 'id')} onEdit={() => { setFollows(false); requestAnimationFrame(() => document.getElementById('f-id')?.focus()) }} onChange={v => ed.set('id', v ?? '')} /> : undefined} />
  )
  // with no title to follow, the id is a field of the first group, typed
  const idField = (k: string) => (
    <FieldRow key={k} label={labelOf(schema, 'id')} htmlFor="f-id" error={errorOf(ed, 'id')}>
      <TextInput common={{ id: 'f-id', 'aria-invalid': errorOf(ed, 'id') ? true : undefined, 'aria-describedby': errorOf(ed, 'id') ? 'f-id-err' : undefined }}
        prose={false} value={id} readOnly={false} onChange={v => ed.set('id', v ?? '')} />
    </FieldRow>
  )
  /** A group's field rows. A group of one field whose label is the group's draws that field bare, under the group's
   *  head alone, so its label is said once ("Milestones", not "Milestones / Milestones": DP-41). */
  const fields = (g: FieldGroup) => {
    const only = g.fields.length === 1 ? g.fields[0]! : null
    const solo = only !== null && only !== 'id' && only !== titleField && labelOf(schema, only).toLowerCase() === g.label.toLowerCase()
      && fieldKindOf(registry, schema, only, entries) !== 'yaml'
    if (solo) return field(only, true)
    return <FieldTable label={g.label}>{g.fields.map(k => (k === 'id' && titleField === null ? idField(k) : field(k)))}</FieldTable>
  }
  /** The step (the group's index) that draws a field: the id is drawn with the title, or as a field of its own. */
  const groupOf = (k: string): number => {
    const at = k === 'id' && titleField !== null ? titleField : k.split('.')[0]!
    return groups.findIndex(g => g.fields.includes(at))
  }
  return { groups, undrawn, fields, groupOf }
}

export function NewRecordForm({ registry, schema, entries, ed, onSave, onCancel }: {
  registry: string; schema: JsonSchema; entries: readonly Value[]; ed: Editor; onSave: () => void; onCancel: () => void
}) {
  const { groups, undrawn, fields } = useNewRecordForm(registry, schema, entries, ed)
  const [more, setMore] = useState(false)
  const folded = groups.find(g => g.folded)
  const open = more || (folded?.fields.some(k => errorOf(ed, k) !== undefined) ?? false)
  const group = (g: FieldGroup) => (
    <Section key={g.label} label={g.label} note={g.optional && !g.folded ? 'optional' : undefined}>{fields(g)}</Section>
  )
  return (
    <div className="pp form">
      <div className="pp-main">
        {undrawn.map((e, i) => <Refusal key={i}>{e.field === '' ? e.message : `${e.field}: ${e.message}`}</Refusal>)}
        {groups.filter(g => !g.folded).map(group)}
        {folded && (
          <div className="form-more">
            {!open && <span className="form-more-l">{folded.fields.map(k => labelOf(schema, k)).join(', ')}</span>}
            <Button variant="ghost" small expanded={open} controls={open ? 'form-folded' : undefined} onClick={() => setMore(!open)}>
              {open ? 'Show fewer' : `Show ${folded.fields.length} more`}
            </Button>
          </div>
        )}
        {folded && open && <div id="form-folded">{group(folded)}</div>}
      </div>
      <div className="pp-aside">
        <FormPreview registry={registry} schema={schema} groups={groups} draft={ed.draft} />
        <GovernanceLine registry={registry} draft={ed.draft} />
        <div className="form-acts">
          <Button primary disabled={!ed.canSave} onClick={onSave}>Save to changes</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
