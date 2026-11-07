import { useEffect, useState } from 'react'
import { look, type Common, type Look } from './common.ts'

/** A string that would not survive a one-line input: it holds a line break (which `<input>` strips),
 *  or is long enough to want room. */
const wantsArea = (prose: boolean, value: unknown): boolean =>
  prose || (typeof value === 'string' && (value.includes('\n') || value.length > 80))

/** A text field: one line, or a textarea for prose. Once a textarea, it stays one while you edit it,
 *  and a one-line input never becomes one as you type: neither swap takes the focus from under you. */
export function TextInput({ common, prose, value, readOnly, onChange, ...shown }:
  { common: Common; prose: boolean; value: unknown; readOnly: boolean; onChange: (v: unknown) => void } & Look) {
  const [area, setArea] = useState(() => wantsArea(prose, value))
  // A break arriving from outside (Take theirs) needs the textarea; a value typed long stays where it is.
  useEffect(() => { if (!area && typeof value === 'string' && value.includes('\n')) setArea(true) }, [area, value])
  const v = value == null ? '' : String(value)
  const change = (t: string) => onChange(t === '' ? null : t)
  const { attrs, after } = look(common, shown, area ? 'input prose' : 'input')
  if (area) return <><textarea {...attrs} rows={Math.max(3, Math.ceil(v.length / 80) + v.split('\n').length - 1)} value={v} readOnly={readOnly} onChange={e => change(e.target.value)} />{after}</>
  return <><input {...attrs} type="text" value={v} readOnly={readOnly} onChange={e => change(e.target.value)} />{after}</>
}
