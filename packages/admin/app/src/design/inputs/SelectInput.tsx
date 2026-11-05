import { look, type Common, type Look } from './common.ts'

/** A select over fixed options after a blank one; the blank stages null (a null option is that blank). `labels` names an
 *  option by other words than its value (the form's Other…). */
export function SelectInput({ common, options, value, onChange, labels, ...shown }:
  { common: Common; options: readonly unknown[]; value: unknown; onChange: (v: unknown) => void; labels?: Record<string, string> } & Look) {
  const { attrs, after } = look(common, shown)
  return (
    <>
      <select {...attrs} value={String(value ?? '')} onChange={e => onChange(e.target.value || null)}>
        <option value="" />
        {options.filter(o => o !== null).map(o => <option key={String(o)} value={String(o)}>{labels?.[String(o)] ?? String(o)}</option>)}
      </select>
      {after}
    </>
  )
}
