import { useEffect, useState } from 'react'
import { look, type Common, type Look } from './common.ts'

/** Why a date as typed is not one, or null for one that is (or for nothing typed). */
export function dateProblem(text: string): string | null {
  if (text === '') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) return 'not a date: write it as YYYY-MM-DD'
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12) return `not a date: month ${mo}`
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (d < 1 || d > days) return `not a date: day ${d} (month ${mo} has ${days})`
  return null
}

export function DateInput({ common, value, onChange, onProblem, ...shown }:
  { common: Common; value: unknown; onChange: (v: unknown) => void; onProblem: (p: string | null) => void } & Look) {
  const outer = value == null ? '' : String(value)
  const [text, setText] = useState(outer)
  useEffect(() => { if (outer !== text && dateProblem(text) === null) setText(outer) }, [outer])
  const { attrs, after } = look(common, shown)
  return (<>
    <input {...attrs} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={text} onChange={e => {
      const t = e.target.value
      setText(t)
      const p = dateProblem(t)
      onProblem(p)
      if (!p) onChange(t === '' ? null : t)
    }} />
    {after}
  </>)
}
