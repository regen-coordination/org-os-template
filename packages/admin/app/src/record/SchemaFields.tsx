import { Fragment, useEffect } from 'react'
import { Link } from 'wouter'
import { stringify } from 'yaml'
import type { JsonSchema, StageError } from '../api.ts'
import { controlKind, orderedKeys, propOf, shown, unchanged, wasShown, type Value } from './fields.ts'
import FieldInput from './FieldInput.tsx'
import { refOf } from '../refs.ts'
import { KIND_OF_REGISTRY } from '../kinds.ts'
import { entryHref } from '../hrefs.ts'
import { Section } from '../design/Section.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { Refusal } from '../parts/SyncParts.tsx'
import { announce } from '../parts/live.tsx'
import { useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { restrictedHat, restrictedOf } from './restricted.ts'
import { labelOf } from './form.ts'

function ReadValue({ registry, field, value, names }: { registry: string; field: string; value: unknown; names: Map<string, string> }) {
  if (value === undefined || value === null || value === '') return <span className="faint">—</span>
  const ref = refOf(registry, field)
  if (ref) {
    const ids = Array.isArray(value) ? value.map(String) : [String(value)]
    const kind = KIND_OF_REGISTRY[ref.target] ?? ref.target
    return <>{ids.map((v, i) => <Fragment key={`${v}:${i}`}>{i > 0 && ', '}<Link href={entryHref(ref.target, v)}>{names.get(`${kind}:${v}`) ?? v}</Link></Fragment>)}</>
  }
  if (Array.isArray(value) && value.every(x => typeof x !== 'object' || x === null)) return <>{value.map(String).join(', ')}</>
  if (typeof value === 'object') return <pre className="mono-well">{stringify(value)}</pre>
  return <span className="wrap">{String(value)}</span>
}

/** The keys a record's field rows draw: the schema's order over what the value holds, and every field the viewer is
 *  not admitted to among them (it holds no value here, but it has one: §6.3, schema is not secret). */
function keysOf(schema: JsonSchema, value: Value, editing: boolean, restricted: Record<string, string>): string[] {
  const keys = orderedKeys(schema, { ...Object.fromEntries(Object.keys(restricted).map(k => [k, null])), ...value }, editing)
  return keys.filter(k => k !== 'restricted' || Object.hasOwn(restricted, k))
}

/** The name a restricted field is shown under, from the house's visibility source (E-60): L5 swaps the source. */
function useRestrictedName(): (level: string) => string {
  const source = useVisibilitySource()
  return level => restrictedHat(level, source)
}

/** The entry's fields, read (§9.3): schema order, then what the schema doesn't name. References link to their
 *  records by name. A staged field gets the moss bar and its old value struck; one whose value moved on the trunk
 *  since (`stale`, the file's value now) the clay bar and "now <value> on the trunk"; one the viewer is not admitted to
 *  (`restricted`, the gate's marker) the lock and "<hat> only", never a value. */
export function FieldsRead({ registry, schema, value, was, names, restricted: given = {}, stale = {} }:
  { registry: string; schema: JsonSchema; value: Value; was: Value; names: Map<string, string>; restricted?: Record<string, string>; stale?: Record<string, string> }) {
  // L5 §11.5: a value that still carries the gate's marker is read restricted too, with no prop
  const restricted = { ...restrictedOf(value), ...given }
  const nameOf = useRestrictedName()
  const keys = keysOf(schema, value, false, restricted)
  return (
    <Section label="Fields">
      <FieldTable label="Fields">
        {keys.map(k => {
          if (Object.hasOwn(restricted, k)) return <FieldRow key={k} label={labelOf(schema, k)} restricted={{ hat: nameOf(restricted[k]!) }}>{null}</FieldRow>
          const moved = Object.hasOwn(stale, k)
          const staged = !moved && Object.hasOwn(was, k)
          return (
            <FieldRow key={k} label={labelOf(schema, k)} staged={staged} was={staged ? wasShown(was[k]) : undefined} stale={moved ? stale[k] : undefined}>
              <ReadValue registry={registry} field={k} value={value[k]} names={names} />
            </FieldRow>
          )
        })}
      </FieldTable>
    </Section>
  )
}

/** The entry's fields as inputs (spec §6.4). A field that differs from the file gets the ink rule
 *  and the file's value struck; an error sits under its field; a refusal about a field with no row
 *  of its own is shown at the top with the field's name. */
export function FieldsEdit({ registry, schema, draft, file, creating, errors, problems, onChange, onProblem, restricted: given = {} }: {
  registry: string; schema: JsonSchema; draft: Value; file: Value | null; creating: boolean
  errors: StageError[]; problems: Record<string, string>
  onChange: (key: string, value: unknown) => void; onProblem: (key: string, problem: string | null) => void
  /** Fields the viewer is not admitted to: drawn restricted, with no input, so nothing is typed over a value unseen. */
  restricted?: Record<string, string>
}) {
  // L5 §11.5: a draft that still carries the gate's marker is drawn restricted too, with no prop
  const restricted = { ...restrictedOf(draft), ...given }
  const nameOf = useRestrictedName()
  const keys = keysOf(schema, draft, true, restricted)
  const errorFor = (k: string) => problems[k] ?? errors.find(e => e.field === k || e.field.startsWith(`${k}.`))?.message
  const undrawn = errors.filter(e => e.field === '' || !keys.includes(e.field.split('.')[0]!))
  return (
    <Section label="Fields" note="editing">
      {undrawn.map((e, i) => <Refusal key={i}>{e.field === '' ? e.message : `${e.field}: ${e.message}`}</Refusal>)}
      <FieldTable label="Fields">
        {keys.map(k => {
          if (Object.hasOwn(restricted, k)) return <FieldRow key={k} label={labelOf(schema, k)} restricted={{ hat: nameOf(restricted[k]!) }}>{null}</FieldRow>
          const prop = propOf(schema, k)
          const yaml = controlKind(registry, k, prop) === 'yaml'
          const changed = !creating && file !== null && !unchanged(Object.hasOwn(file, k) ? file[k] : undefined, draft[k])
          const err = errorFor(k)
          return (
            <FieldRow key={k} label={yaml ? `${labelOf(schema, k)} (YAML)` : labelOf(schema, k)} htmlFor={`f-${k}`} staged={changed} was={changed ? wasShown(file![k]) : undefined} error={err}>
              <FieldInput registry={registry} field={k} prop={prop} value={draft[k]} readOnly={k === 'id' && !creating} invalid={err !== undefined}
                onChange={v => onChange(k, v)} onProblem={p => onProblem(k, p)} />
            </FieldRow>
          )
        })}
      </FieldTable>
    </Section>
  )
}

const STALE_SAID = 'This entry changed while you were editing it.'

/** The entry moved under an open editor (§6.2 stale, E-67): a note, said once through the polite region; each field
 *  that differs as a stale field row — yours, then "now <theirs> on the trunk" in clay — and a choice before any save. */
export function StaleCard({ schema, differing, draft, latest, onKeep, onTake }:
  { schema: JsonSchema | null; differing: string[]; draft: Value; latest: Value; onKeep: () => void; onTake: () => void }) {
  useEffect(() => { announce(STALE_SAID) }, [])
  return (
    <div className="rp-stale">
      <Note state="error" quiet>{STALE_SAID}</Note>
      <FieldTable label="Yours and theirs">
        {differing.map(k => <FieldRow key={k} label={schema ? labelOf(schema, k) : k} stale={shown(latest[k])}>{shown(draft[k])}</FieldRow>)}
      </FieldTable>
      <div className="rp-acts"><Button onClick={onKeep}>Keep mine</Button><Button onClick={onTake}>Take theirs</Button></div>
    </div>
  )
}
