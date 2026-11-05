import { useEffect, useState } from 'react'
import type { JsonSchema } from '../api.ts'
import { announce } from '../parts/live.tsx'
import { Refusal } from '../parts/SyncParts.tsx'
import { WizardFrame } from '../wizards/WizardFrame.tsx'
import type { Editor } from './useEditor.ts'
import type { Value } from './fields.ts'
import { FormPreview, GovernanceLine, useNewRecordForm } from './NewForm.tsx'

/** The last step's name: Option A's preview and its governance line, and Save to changes. */
export const CHECK = 'Check'

const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

/** The new-record form, Option B (spec 2026-11-04 §3): the same groups as Option A, one a step, on the wizard frame
 *  (step pills, Back, Skip on an optional step, Next), then Check: Option A's preview and governance line with Save to
 *  changes. Every step stays drawn, the ones not shown `hidden`, so Back finds each field as it was left (a half-typed
 *  date, a token not yet added). Focus goes to each step's heading (the frame's), and the page's one live region says
 *  the step ("Step 3 of 5: Where it stands"). A step whose field has a problem holds Next and Skip; a refusal or a
 *  problem found on saving takes the form back to the step that holds the field, where it is said. */
export function SteppedForm({ registry, schema, entries, ed, title, onSave, onCancel }: {
  registry: string; schema: JsonSchema; entries: readonly Value[]; ed: Editor; title: string; onSave: () => void; onCancel: () => void
}) {
  const { groups, undrawn, fields, groupOf } = useNewRecordForm(registry, schema, entries, ed)
  const [index, setIndex] = useState(0)
  const check = index >= groups.length
  const names = groups.map(g => g.label)
  const name = check ? CHECK : names[index]!
  const total = groups.length + 1

  useEffect(() => { announce(`Step ${index + 1} of ${total}: ${name}`) }, [index, name, total])

  // What holds a step: a problem the client found in one of its fields (the id with the title), or a field the
  // server refused. The first step that holds one is where the form goes back to from Check.
  const troubled = [...Object.keys(ed.problems), ...ed.errors.filter(e => e.field !== '').map(e => e.field)]
  const stepsTroubled = troubled.map(groupOf).filter(i => i >= 0)
  const first = stepsTroubled.length > 0 ? Math.min(...stepsTroubled) : null
  useEffect(() => { if (check && first !== null) setIndex(first) }, [check, first, troubled.join('\n')])

  const here = check ? [] : groups[index]!.fields
  const held = stepsTroubled.includes(index)
  const empty = here.every(k => !filled(ed.draft[k]))
  const optional = !check && groups[index]!.optional
  const go = (i: number) => setIndex(Math.max(0, Math.min(i, groups.length)))

  return (
    <WizardFrame title={title} steps={names} last={CHECK} view={check ? 'review' : 'step'} index={Math.min(index, groups.length - 1)}
      count={{ at: index + 1, of: total }} heading={name} ask={optional ? 'Optional.' : undefined}
      writes={check ? `data/${registry}.yaml · a new entry, as a staged change` : 'Nothing yet. Check saves it to Changes.'}
      actions={{
        cancel: { label: 'Cancel', onClick: onCancel },
        back: index > 0 ? { label: 'Back', onClick: () => go(index - 1) } : undefined,
        // Skip leaves an optional step out: offered while nothing in it is filled, so it never drops what was typed
        skip: optional && empty ? { label: 'Skip', onClick: () => go(index + 1), disabled: held } : undefined,
        next: check
          ? { label: 'Save to changes', onClick: onSave, disabled: !ed.canSave }
          : { label: 'Next', onClick: () => go(index + 1), disabled: held },
      }}>
      {undrawn.map((e, i) => <Refusal key={i}>{e.field === '' ? e.message : `${e.field}: ${e.message}`}</Refusal>)}
      {groups.map((g, i) => (
        // keyed by place and label: two groups may share a label (a schema's "More" beside the folded rest)
        <div key={`${i}:${g.label}`} hidden={i !== index}>{fields(g)}</div>
      ))}
      {check && (
        <div className="form-check">
          <FormPreview registry={registry} schema={schema} groups={groups} draft={ed.draft} />
          <GovernanceLine registry={registry} draft={ed.draft} />
        </div>
      )}
    </WizardFrame>
  )
}
