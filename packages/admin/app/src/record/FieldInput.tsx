import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import { controlKind, entryName, type Prop } from './fields.ts'
import { refOf } from '../refs.ts'
import { DateInput, NumberInput, SelectInput, TextInput, YamlInput, type Common } from '../design/inputs/index.ts'
import { Icon } from '../design/Icon.tsx'
import { useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { restrictedOf, shownName } from './restricted.ts'

export { DateInput, NumberInput, SelectInput, TextInput, YamlInput } from '../design/inputs/index.ts'

/** A reference's choices: each record of `target` by its name as the viewer may read it. One whose name the gate keeps
 *  reads "<hat> only" (D-12, E-70) and is `masked`: its label is never matched against what is typed, and nothing
 *  prints its id beside it (an id is often its name). */
export interface RefOption { id: string; label: string; masked?: true }

/** A reference's choices and how to name one of its ids. While the records are read, an id reads "…"; when they could
 *  not be read, "a member" (or "a record"): either way never the id, which may be a name the gate keeps (D-12, E-70;
 *  DP-71). Once read, a record by its name as the viewer may read it; an id no record has, by itself. */
export interface RefChoices { options: RefOption[]; nameOf: (id: string) => string; read: boolean }
export const UNREAD_NAME = '…'
export const unreadableName = (target: string) => (target === 'members' ? 'a member' : 'a record')
export function useRefChoices(target: string): RefChoices {
  const q = useQuery({ queryKey: ['registry', target], queryFn: () => api.registry(target), retry: false })
  const source = useVisibilitySource()
  return useMemo(() => {
    const options: RefOption[] = (q.data?.entries ?? []).map(e => {
      const id = String(e.id)
      if (restrictedOf(e).name === undefined) return { id, label: entryName(e) ?? id }
      return { id, label: shownName({ name: id }, e, source), masked: true as const }
    })
    const read = q.data !== undefined
    const unread = q.isError ? unreadableName(target) : UNREAD_NAME
    const nameOf = (id: string) => (read ? options.find(o => o.id === id)?.label ?? id : unread)
    return { options, nameOf, read }
  }, [q.data, q.isError, source, target])
}
export const useOptions = (target: string): RefOption[] => useRefChoices(target).options

const parseList = (t: string) => t.split(',').map(s => s.trim()).filter(Boolean)
function ListInput({ common, value, onChange }: { common: Common; value: unknown; onChange: (v: unknown) => void }) {
  const outer = Array.isArray(value) ? value.map(String) : []
  const key = JSON.stringify(outer)
  const [text, setText] = useState(outer.join(', '))
  useEffect(() => { if (JSON.stringify(parseList(text)) !== key) setText(outer.join(', ')) }, [key])
  return <input {...common} className="input" type="text" value={text} onChange={e => { setText(e.target.value); onChange(parseList(e.target.value)) }} />
}

export function RefSelect({ common, target, value, onChange }: { common: Common; target: string; value: unknown; onChange: (v: unknown) => void }) {
  const { options, nameOf } = useRefChoices(target)
  const v = value == null ? '' : String(value)
  const all: RefOption[] = v && !options.some(o => o.id === v) ? [{ id: v, label: nameOf(v) }, ...options] : options
  return (
    <select {...common} className="input" value={v} onChange={e => onChange(e.target.value || null)}>
      <option value="" />
      {all.map(o => <option key={o.id} value={o.id}>{o.label === o.id || o.masked || !options.includes(o) ? o.label : `${o.label} (${o.id})`}</option>)}
    </select>
  )
}

function RefTokens({ common, target, value, onChange }: { common: Common; target: string; value: unknown; onChange: (v: unknown) => void }) {
  const { options, nameOf, read } = useRefChoices(target)
  const list = Array.isArray(value) ? value.map(String) : []
  const [text, setText] = useState('')
  const add = (raw: string) => {
    const t = raw.trim()
    setText('')
    if (t && !list.includes(t)) onChange([...list, t])
  }
  return (
    <span className="tokens">
      {list.map((t, i) => {
        // a record whose name the gate keeps reads "<hat> only", never its id (D-12, E-70; as the new form's tokens);
        // the others keep their ids here, as before. Unread, every token is unnamed and its button says which one.
        const masked = options.find(o => o.id === t && o.masked)?.label
        const shown = read ? masked ?? t : nameOf(t)
        const removes = read ? shown : `${shown} ${i + 1} of ${list.length}`
        return <span key={t} className="token">{shown}<button type="button" aria-label={`Remove ${removes}`} onClick={() => onChange(list.filter(x => x !== t))}>×</button></span>
      })}
      <input {...common} className="input" type="text" list={`${common.id}-list`} placeholder="add…" value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(text) } }}
        onBlur={() => { if (options.some(o => o.id === text.trim())) add(text) }} />
      <datalist id={`${common.id}-list`}>
        {/* a masked record is not offered: its option's value would print its id */}
        {options.filter(o => !o.masked && !list.includes(o.id)).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </datalist>
    </span>
  )
}

/** A yes/no field: the house's checkbox (§7.2), 16px and moss when on, labelled by its field row's label. */
export function CheckInput({ common, value, onChange }: { common: Common; value: unknown; onChange: (v: unknown) => void }) {
  return (
    <span className="choice-box">
      <input {...common} type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />
      <Icon name="check" size="xs" />
    </span>
  )
}

/** One field's input, chosen by controlKind (spec §6.4), drawn with the house's inputs (§7.2): a reference's picker
 *  and its tokens wear the input's look, a yes/no its checkbox. */
export default function FieldInput({ registry, field, prop, value, readOnly = false, invalid = false, onChange, onProblem = () => {} }:
  { registry: string; field: string; prop: Prop; value: unknown; readOnly?: boolean; invalid?: boolean; onChange: (v: unknown) => void; onProblem?: (p: string | null) => void }) {
  const id = `f-${field}`
  const common: Common = { id, 'aria-invalid': invalid || undefined, 'aria-describedby': invalid ? `${id}-err` : undefined }
  switch (controlKind(registry, field, prop)) {
    case 'enum': return <SelectInput common={common} options={prop.enum ?? []} value={value} onChange={onChange} />
    case 'date': return <DateInput common={common} value={value} onChange={onChange} onProblem={onProblem} />
    case 'number': return <NumberInput common={common} value={value} onChange={onChange} />
    case 'boolean': return <CheckInput common={common} value={value} onChange={onChange} />
    case 'list': return <ListInput common={common} value={value} onChange={onChange} />
    case 'ref': return <RefSelect common={common} target={refOf(registry, field)!.target} value={value} onChange={onChange} />
    case 'refs': return <RefTokens common={common} target={refOf(registry, field)!.target} value={value} onChange={onChange} />
    case 'yaml': return <YamlInput id={id} value={value} onChange={onChange} onProblem={onProblem} />
    default: return <TextInput common={common} prose={prop.format === 'textarea'} value={value} readOnly={readOnly} onChange={onChange} />
  }
}
