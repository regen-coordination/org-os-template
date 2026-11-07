import { useState } from 'react'
import { parse, stringify } from 'yaml'
import { look, type Look } from './common.ts'

/** A value no single input can draw, edited as YAML (in Mono, as code is). It is parsed as you type; text that does not
 *  parse is a problem for the row to show, and the last good value stands. */
export function YamlInput({ id, value, onChange, onProblem, mono = true, ...shown }:
  { id: string; value: unknown; onChange: (v: unknown) => void; onProblem: (p: string | null) => void } & Look) {
  const [text, setText] = useState(() => (value == null ? '' : stringify(value)))
  const { attrs, after } = look({ id }, { mono, ...shown })
  return (<>
    <textarea {...attrs} rows={Math.max(3, text.split('\n').length)} value={text} onChange={e => {
      const t = e.target.value
      setText(t)
      try {
        const v: unknown = t.trim() === '' ? null : parse(t)
        onProblem(null)
        onChange(v)
      } catch (err) {
        onProblem(err instanceof Error ? err.message.split('\n')[0]! : 'this is not YAML')
      }
    }} />
    {after}
  </>)
}
