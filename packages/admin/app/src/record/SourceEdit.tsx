import { useState } from 'react'
import { parse, stringify } from 'yaml'
import type { Value } from './fields.ts'
import { Section } from '../design/Section.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'

/** *source* while editing (§14.1): the YAML well, edited in place — the whole entry as YAML in Mono, staged as one
 *  whole-entry op (spec §6.4). Text that is not one entry is the row's problem, and Save waits for it. */
export default function SourceEdit({ draft, problem, onValue, onProblem }:
  { draft: Value; problem?: string; onValue: (v: Value) => void; onProblem: (p: string | null) => void }) {
  const [text, setText] = useState(() => stringify(draft))
  return (
    <Section label="Source" note="editing the whole entry">
      <FieldTable label="Source">
        <FieldRow label="yaml" htmlFor="f-source" error={problem}>
          <textarea id="f-source" className="input mono-in rp-yaml" aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'f-source-err' : undefined}
            rows={Math.max(8, text.split('\n').length + 1)} value={text} onChange={e => {
            const t = e.target.value
            setText(t)
            try {
              const v: unknown = parse(t)
              if (typeof v !== 'object' || v === null || Array.isArray(v)) { onProblem('the source must be one entry: a map of fields'); return }
              onProblem(null)
              onValue(v as Value)
            } catch (err) {
              onProblem(err instanceof Error ? err.message.split('\n')[0]! : 'this is not YAML')
            }
          }} />
        </FieldRow>
      </FieldTable>
    </Section>
  )
}
