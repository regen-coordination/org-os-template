import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type { JsonProp, JsonSchema } from '../api.ts'
import { refOf } from '../refs.ts'
import { Seg } from '../design/Seg.tsx'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { FieldRow } from '../design/FieldRow.tsx'
import { DateInput, NumberInput, SelectInput, TextInput, YamlInput, type Common } from '../design/inputs/index.ts'
import { CheckInput, RefSelect, useRefChoices, type RefChoices } from './FieldInput.tsx'
import { propOf, type Value } from './fields.ts'
import { choicesOf, formKindOf, helpOf, humanise, labelOf, type FormKind } from './form.ts'

/** The new-record form's controls (spec 2026-11-04 §3), one per `FormKind`, each a house input. Option A draws them
 *  in its groups; Option B (one group a step) draws the same `FormField`s. */

const OTHER = 'org-os:other'
const OTHER_WORD = 'Other…'

type Change = (v: unknown) => void

/** Choices as a segmented control (or, past SEG_MAX, a select), with Other… where the vocabulary is open: Other opens a
 *  text field beside them, named "<label>, other", and a value none of the choices holds is drawn there. Pressing the
 *  chosen one again clears it. */
export function ChoiceInput({ id, label, kind, options, other, value, describedBy, named, onChange }:
  { id: string; label: string; kind: 'seg' | 'select'; options: string[]; other: boolean; value: unknown; describedBy?: string; named?: string; onChange: Change }) {
  const v = value == null ? '' : String(value)
  const custom = v !== '' && !options.includes(v)
  const [open, setOpen] = useState(custom)
  const otherShown = other && (open || custom)
  const pick = (x: string) => {
    if (x === OTHER) {
      setOpen(true)
      if (!custom) onChange(null)
      requestAnimationFrame(() => document.getElementById(`${id}-other`)?.focus())
      return
    }
    setOpen(false)
    onChange(x === v ? null : x)
  }
  const field = otherShown && (
    <TextInput common={{ id: `${id}-other`, 'aria-label': `${label}, other`, 'aria-describedby': describedBy }} prose={false}
      value={custom ? v : ''} readOnly={false} onChange={onChange} />
  )
  if (kind === 'select') {
    return (
      <span className="form-choice">
        <SelectInput common={{ id, 'aria-label': named, 'aria-describedby': describedBy }} options={[...options, ...(other ? [OTHER] : [])]}
          value={otherShown ? OTHER : v} onChange={x => pick(x == null ? '' : String(x))} labels={{ [OTHER]: OTHER_WORD }} />
        {field}
      </span>
    )
  }
  return (
    <span className="form-choice">
      <Seg label={label} describedBy={describedBy} value={otherShown ? OTHER : v} onChange={pick}
        options={[...options.map(o => ({ value: o, label: o })), ...(other ? [{ value: OTHER, label: OTHER_WORD }] : [])]} />
      {field}
    </span>
  )
}

/** A list of strings as tokens, each with its remove button, then the input that adds one (Enter, a comma, or leaving
 *  it). Over a reference's records (`options`), a token is named by its record and only a record can be added: typed
 *  by name or id, or picked from the input's list. */
export function TokenInput({ common, value, onChange, refs }:
  { common: Common; value: unknown; onChange: Change; refs?: RefChoices }) {
  const options = refs?.options
  const list = Array.isArray(value) ? value.map(String) : []
  const [text, setText] = useState('')
  const nameOf = (t: string) => refs?.nameOf(t) ?? t
  const unread = refs !== undefined && !refs.read
  const resolve = (raw: string): string | null => {
    const t = raw.trim()
    if (t === '') return null
    if (!options) return t
    const lower = t.toLowerCase()
    // a masked label ("Ops only") names no one record: only its id finds it
    return options.find(o => o.id === t || (!o.masked && o.label.toLowerCase() === lower))?.id ?? null
  }
  const add = (raw: string) => {
    const t = resolve(raw)
    if (t === null) return false
    setText('')
    if (!list.includes(t)) onChange([...list, t])
    return true
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || (e.key === ',' && !options)) { e.preventDefault(); add(text) }
    else if (e.key === 'Backspace' && text === '' && list.length > 0) onChange(list.slice(0, -1))
  }
  const remove = (t: string) => { const next = list.filter(x => x !== t); onChange(next.length > 0 ? next : null) }
  return (
    <span className="tokens">
      {list.map((t, i) => (
        <span key={t} className="token">{nameOf(t)}<button type="button" aria-label={`Remove ${unread ? `${nameOf(t)} ${i + 1} of ${list.length}` : nameOf(t)}`} onClick={() => remove(t)}>×</button></span>
      ))}
      <input {...common} className="input" type="text" list={options ? `${common.id}-list` : undefined} placeholder="add…" value={text}
        onChange={e => setText(e.target.value)} onKeyDown={onKeyDown} onBlur={() => { add(text) }} />
      {options && (
        <datalist id={`${common.id}-list`}>
          {/* a masked record is not offered by name: its option would print its id, or fill a label that finds no one */}
          {options.filter(o => !o.masked && !list.includes(o.id)).map(o => <option key={o.id} value={o.label}>{o.id}</option>)}
        </datalist>
      )}
    </span>
  )
}

function RefTokenInput({ common, target, value, onChange }: { common: Common; target: string; value: unknown; onChange: Change }) {
  return <TokenInput common={common} value={value} onChange={onChange} refs={useRefChoices(target)} />
}

const article = (noun: string) => (/^[aeiou]/i.test(noun) ? 'an' : 'a')
const isDate = (p: JsonProp) => p.format === 'date' || p['x-format'] === 'date'
const filledRow = (r: Value) => Object.values(r).some(v => v !== undefined && v !== null && v !== '')

/** A list of objects as rows, one input per property its items name, with Remove on each and *+ Add <noun>* (the
 *  items' `title`, else "row"). A row left empty is kept on screen and never sent. */
export function RowsInput({ id, label, prop, value, onChange, onProblem }:
  { id: string; label: string; prop: JsonProp; value: unknown; onChange: Change; onProblem: (p: string | null) => void }) {
  const props = prop.items?.properties ?? {}
  const keys = Object.keys(props)
  const noun = prop.items?.title?.toLowerCase() ?? 'row'
  const [rows, setRows] = useState<Value[]>(() => (Array.isArray(value) ? value.filter((r): r is Value => typeof r === 'object' && r !== null) : []))
  const [problems, setProblems] = useState<Record<string, string>>({})
  const put = (next: Value[]) => {
    setRows(next)
    const kept = next.filter(filledRow)
    onChange(kept.length > 0 ? kept : null)
  }
  const cell = (i: number, k: string, v: unknown) => put(rows.map((r, n) => {
    if (n !== i) return r
    const out = { ...r }
    if (v === null || v === undefined || v === '') delete out[k]
    else out[k] = v
    return out
  }))
  const problem = (key: string, p: string | null) => setProblems(ps => {
    const next = { ...ps }
    if (p) next[key] = p
    else delete next[key]
    onProblem(Object.values(next)[0] ?? null)
    return next
  })
  return (
    <div className="form-rows" role="group" aria-label={label}>
      {rows.length > 0 && (
        <ol className="form-rows-l">
          {rows.map((r, i) => (
            <li key={i} className="form-row">
              {keys.map(k => {
                const p = props[k]!
                const name = `${p.title ?? humanise(k)}, ${noun} ${i + 1}`
                const common: Common = { id: `${id}-${i}-${k}`, 'aria-label': name, 'aria-invalid': problems[`${i}.${k}`] ? true : undefined }
                const input = p.enum
                  ? <SelectInput common={common} options={p.enum} value={r[k]} onChange={v => cell(i, k, v)} />
                  : isDate(p)
                    ? <DateInput common={common} value={r[k]} onChange={v => cell(i, k, v)} onProblem={x => problem(`${i}.${k}`, x)} />
                    : <TextInput common={common} prose={false} value={r[k]} readOnly={false} onChange={v => cell(i, k, v)} />
                // the cell's word over it, for the eye; its name says which row too
                return <span key={k} className="form-cell"><span className="form-cell-k" aria-hidden="true">{p.title ?? humanise(k)}</span>{input}</span>
              })}
              <Button small variant="ghost" icon="x" iconOnly label={`Remove ${noun} ${i + 1}`}
                onClick={() => { put(rows.filter((_, n) => n !== i)); for (const k of keys) problem(`${i}.${k}`, null) }} />
            </li>
          ))}
        </ol>
      )}
      <Button small variant="ghost" icon="plus" onClick={() => setRows([...rows, {}])}>{`Add ${article(noun)} ${noun}`}</Button>
    </div>
  )
}

/** One field's control, chosen by its kind. `named` names it where no label points at it (a field drawn bare). */
export function FormControl({ registry, field, prop, kind, choices, label, value, invalid, describedBy, named, onChange, onProblem }: {
  registry: string; field: string; prop: JsonProp; kind: FormKind; choices: { options: string[]; other: boolean } | null
  label: string; value: unknown; invalid: boolean; describedBy?: string; named?: string; onChange: Change; onProblem: (p: string | null) => void
}) {
  const id = `f-${field}`
  const common: Common = { id, 'aria-label': named, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy }
  switch (kind) {
    case 'seg': case 'select':
      return <ChoiceInput id={id} label={label} kind={kind} options={choices?.options ?? (prop.enum ?? []).filter(v => v !== null).map(String)}
        other={choices?.other ?? false} value={value} describedBy={describedBy} named={named} onChange={onChange} />
    case 'date': return <DateInput common={common} value={value} onChange={onChange} onProblem={onProblem} />
    case 'number': return <NumberInput common={common} value={value} onChange={onChange} />
    case 'boolean': return <CheckInput common={common} value={value} onChange={onChange} />
    case 'ref': return <RefSelect common={common} target={refOf(registry, field)!.target} value={value} onChange={onChange} />
    case 'refs': return <RefTokenInput common={common} target={refOf(registry, field)!.target} value={value} onChange={onChange} />
    case 'tokens': return <TokenInput common={common} value={value} onChange={onChange} />
    case 'rows': return <RowsInput id={id} label={label} prop={prop} value={value} onChange={onChange} onProblem={onProblem} />
    case 'yaml': return <YamlInput id={id} value={value} onChange={onChange} onProblem={onProblem} />
    default: return <TextInput common={common} prose={kind === 'prose'} value={value} readOnly={false} onChange={onChange} />
  }
}

/** Kinds whose control is no one labelled input: named by their own group, described through the row's ids. */
const UNLABELLED: ReadonlySet<FormKind> = new Set(['seg', 'rows'])

/** A field's control kind on the form, as `FormField` draws it. */
export function fieldKindOf(registry: string, schema: JsonSchema, field: string, entries: readonly Value[]): FormKind {
  const prop = propOf(schema, field)
  return formKindOf(registry, field, prop, choicesOf(field, prop, entries))
}

/** One field of the new-record form as a field row: its label and help from the schema, its control, its error; `after`
 *  sits under the control (the title's id line). `solo` draws it bare, without a row of its own: the one field of a
 *  group whose label is its own (DP-41), so the label is the group's head alone and the control is named by it. A
 *  YAML field is never solo: its text area takes no name but its label's. */
export function FormField({ registry, schema, field, entries, value, error, solo = false, onChange, onProblem, after }: {
  registry: string; schema: JsonSchema; field: string; entries: readonly Value[]; value: unknown; error?: string; solo?: boolean
  onChange: Change; onProblem: (p: string | null) => void; after?: ReactNode
}) {
  const prop = propOf(schema, field)
  const choices = choicesOf(field, prop, entries)
  const kind = formKindOf(registry, field, prop, choices)
  const label = labelOf(schema, field)
  const help = helpOf(schema, field)
  const id = `f-${field}`
  const describedBy = [help ? `${id}-help` : null, error ? `${id}-err` : null].filter(Boolean).join(' ') || undefined
  const labelled = !UNLABELLED.has(kind)
  if (solo && kind !== 'yaml') {
    return (
      <div className="form-solo">
        <FormControl registry={registry} field={field} prop={prop} kind={kind} choices={choices} label={label} value={value}
          invalid={error !== undefined} describedBy={describedBy} named={labelled ? label : undefined} onChange={onChange} onProblem={onProblem} />
        {after}
        {help && <span className="fields-help" id={`${id}-help`}>{help}</span>}
        {error && <span className="note note-error" id={`${id}-err`}><Icon name="alert" size="sm" />{error}</span>}
      </div>
    )
  }
  return (
    <FieldRow label={kind === 'yaml' ? `${label} (YAML)` : label} htmlFor={labelled ? id : undefined} describe={labelled ? undefined : id}
      help={help ?? undefined} error={error}>
      <FormControl registry={registry} field={field} prop={prop} kind={kind} choices={choices} label={label} value={value}
        invalid={error !== undefined} describedBy={describedBy} onChange={onChange} onProblem={onProblem} />
      {after}
    </FieldRow>
  )
}
