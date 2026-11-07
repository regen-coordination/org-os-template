import { useState } from 'react'
import { RECORD_KINDS } from '../../../lib/board-query.mjs'
import { blockType, type ConfigField } from '../blocks/index.ts'
import { usePanel } from '../parts/panels.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Button } from '../design/Button.tsx'
import { NumberInput, SelectInput, TextInput, YamlInput } from '../design/inputs/index.ts'
import { arrangeStore, useArrangeDraft } from './arrangeStore.ts'
import { getField, setField } from './arrange.ts'

const TITLE: ConfigField = { key: 'title', label: 'title', input: 'text' }

/** The inputs give null for nothing typed; a block field left empty is removed (`setField`). */
const orUnset = (v: unknown): unknown => (v === null || v === '' ? undefined : v)

function Setting({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (v: unknown) => void }) {
  const id = `set-${field.key.replace(/\W/g, '-')}`
  // A list of fields keeps the text as typed: parsing each keystroke back into the input would eat a trailing comma.
  // It is read on blur. YAML is parsed as it is typed, and text that does not parse is said under it (the last good
  // value stands).
  const [text, setText] = useState(() => (field.input === 'fields' && Array.isArray(value) ? value.join(', ') : ''))
  const [error, setError] = useState<string | undefined>()
  const common = { id }
  let input
  switch (field.input) {
    case 'number':
      input = <NumberInput common={common} value={typeof value === 'number' ? value : null} onChange={v => onChange(orUnset(v))} />
      break
    case 'select':
    case 'kind': {
      // The blank option is "not set": choosing it removes the field.
      const options = field.input === 'kind' ? ['*', ...RECORD_KINDS] : field.options ?? []
      input = <SelectInput common={common} options={options} value={value ?? ''} onChange={v => onChange(orUnset(v))} />
      break
    }
    case 'fields':
      input = (
        <span className="set-fields" onBlur={() => { const list = text.split(',').map(s => s.trim()).filter(Boolean); onChange(list.length > 0 ? list : undefined) }}>
          <TextInput common={common} prose={false} readOnly={false} value={text} onChange={v => setText(typeof v === 'string' ? v : '')} />
        </span>
      )
      break
    case 'yaml':
      input = <YamlInput id={id} value={value} error={error} onChange={v => onChange(orUnset(v))}
        onProblem={p => setError(p === null ? undefined : `Not YAML yet: ${p}`)} />
      break
    case 'markdown':
      input = <TextInput common={common} prose readOnly={false} value={typeof value === 'string' ? value : ''} onChange={v => onChange(orUnset(v))} />
      break
    default:
      input = <TextInput common={common} prose={false} readOnly={false} value={typeof value === 'string' ? value : ''} onChange={v => onChange(orUnset(v))} />
  }
  return <FieldRow label={field.label} htmlFor={id}>{input}</FieldRow>
}

/** The selected block's settings while arranging (spec §5.3; §14.2 "settings in the inspector"): in the right slot,
 *  drawn in the inspector's frame at the panel's width (--w-panel, E-71) — the type as its eyebrow, the block's name,
 *  Close — then its title and its type's config (contract: BlockDef.config) as field rows on the house's inputs,
 *  edited into the draft. Escape closes it (the panel stack). */
export function BlockSettings({ blockId }: { blockId: string }) {
  const draft = useArrangeDraft()
  const panel = usePanel('right')
  const entry = draft?.board.blocks.find(b => b.id === blockId)
  if (!draft || !entry) return null
  const def = blockType(entry.type)
  const label = entry.title ?? def?.title(entry as never) ?? entry.id
  const config = def?.config ?? []
  // Most types list their title first; the rest get it here, once.
  const fields = config.some(f => f.key === 'title') ? config : [TITLE, ...config]
  return (
    <aside className="insp insp-settings" aria-label={`Block settings: ${label}`}>
      <div className="insp-in">
        <div className="insp-h">
          <div className="insp-hm">
            <div className="insp-k">{def?.label ?? entry.type} · block settings</div>
            <h2 className="insp-t" title={label}>{label}</h2>
          </div>
          <Button small variant="ghost" onClick={panel.close}>Close</Button>
        </div>
        <div className="insp-b">
          <FieldTable label="Block settings">
            {fields.map(f => (
              <Setting key={`${blockId}:${entry.type}:${f.key}`} field={f} value={getField(entry, f.key)} onChange={v => arrangeStore.update(b => setField(b, blockId, f.key, v))} />
            ))}
          </FieldTable>
        </div>
      </div>
    </aside>
  )
}
