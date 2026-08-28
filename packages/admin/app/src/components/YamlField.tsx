import { useState } from 'react'
import { parse, stringify } from 'yaml'

interface Props {
  label: string
  value: unknown
  readOnly?: boolean
  onChange?: (value: unknown) => void
}

/** Nested structures (arrays of objects, maps) edit as YAML text — per M1 scope. */
export default function YamlField({ label, value, readOnly, onChange }: Props) {
  const [text, setText] = useState(() => (value == null ? '' : stringify(value)))
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="field">
      <label>{label} (yaml)</label>
      <textarea
        rows={Math.max(3, text.split('\n').length)}
        value={text}
        readOnly={readOnly}
        onChange={e => setText(e.target.value)}
        onBlur={() => {
          if (readOnly || !onChange) return
          try {
            setError(null)
            onChange(text.trim() === '' ? null : parse(text))
          } catch (e) {
            setError(e instanceof Error ? e.message : 'invalid yaml')
          }
        }}
      />
      {error && <div className="error">{error}</div>}
    </div>
  )
}
