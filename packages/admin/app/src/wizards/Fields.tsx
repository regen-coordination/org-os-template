import type { WizardField, WizardStep } from '../api.ts'
import { Choice, TextInput } from '../design/inputs/index.ts'

type Values = Record<string, string | undefined>

/** The inputs of one wizard step, drawn from its data (§11.3): doors (a choice of one, as choice cards, a sentence and
 *  a result each) and fields (text, email, a choice, addresses one per line, or a count: L7 §7.1). A door marked `later`
 *  is shown and cannot be chosen. `errors` (by field id) are said under their field, which is marked invalid. */
export function StepBody({ step, values, errors = {}, onChange }: { step: WizardStep; values: Values; errors?: Record<string, string | undefined>; onChange: (id: string, value: string) => void }) {
  return (
    <>
      {step.doors && (
        <fieldset className="wiz-doors">
          <legend className="sr-only">{step.title}</legend>
          {step.doors.map(d => (
            <Choice key={d.value} type="card" name={step.id} checked={values[step.id] === d.value} disabled={d.later} onChange={() => onChange(step.id, d.value)}
              label={d.label} hint={`${d.help}${d.later ? ' Not built yet.' : ''}`} />
          ))}
        </fieldset>
      )}
      {step.fields?.map(f => <Field key={f.id} field={f} value={values[f.id] ?? ''} error={errors[f.id]} onChange={v => onChange(f.id, v)} />)}
    </>
  )
}

function Field({ field, value, error, onChange }: { field: WizardField; value: string; error?: string; onChange: (v: string) => void }) {
  const id = `wiz-f-${field.id}`
  const help = field.help ? `${id}-help` : undefined
  const common = { id, 'aria-describedby': help, ...(field.required ? { 'aria-required': true } : {}) }
  if (field.kind === 'choice') {
    return (
      <fieldset className="wiz-doors">
        <legend className="wiz-legend">{field.label}</legend>
        {field.options!.map(o => (
          <Choice key={o.value} type="card" name={field.id} checked={value === o.value} onChange={() => onChange(o.value)} label={o.label} hint={o.help} />
        ))}
        {field.help && <p className="wiz-help">{field.help}</p>}
      </fieldset>
    )
  }
  return (
    <div className="wiz-field">
      <label htmlFor={id}>{field.label}</label>
      {field.kind === 'email'
        ? <input id={id} className="input" type="email" value={value} onChange={e => onChange(e.target.value)} autoComplete="email" aria-describedby={help} />
        : field.kind === 'count'
          // a whole number, 1 or more: typed as text and read by lib/wizard-answers.mjs, which says what is wrong with it
          ? <TextInput common={common} mono error={error} prose={false} readOnly={false} value={value} onChange={v => onChange(v == null ? '' : String(v))} />
          // addresses, one per line: always the textarea, in Mono
          : <TextInput common={common} mono={field.kind === 'addresses'} error={error} prose={field.kind === 'addresses'} readOnly={false} value={value} onChange={v => onChange(v == null ? '' : String(v))} />}
      {field.help && <p className="wiz-help" id={help}>{field.help}</p>}
    </div>
  )
}
