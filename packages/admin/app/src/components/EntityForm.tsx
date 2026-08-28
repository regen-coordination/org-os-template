import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Entity, type JsonSchema, type FieldError } from '../api.ts'
import YamlField from './YamlField.tsx'

interface Props {
  registry: string
  schema: JsonSchema
  entity: Entity | null // null = create mode
  onClose: () => void
}

type Prop = NonNullable<JsonSchema['properties']>[string]
const typeOf = (p: Prop): string =>
  Array.isArray(p.type) ? (p.type.find(t => t !== 'null') ?? 'string') : (p.type ?? '')

export default function EntityForm({ registry, schema, entity, onClose }: Props) {
  const isNew = entity === null
  const [draft, setDraft] = useState<Entity>(() => entity ?? ({ id: '' } as Entity))
  const [errors, setErrors] = useState<FieldError[]>([])
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  const props = schema.properties ?? {}
  const ordered = [
    ...(schema['x-order'] ?? []).filter(k => k in props || k === 'id'),
    ...Object.keys(props).filter(k => !(schema['x-order'] ?? []).includes(k)),
    ...Object.keys(draft).filter(k => !(k in props)),
  ].filter((k, i, all) => all.indexOf(k) === i)

  const set = (key: string, value: unknown) => setDraft(d => ({ ...d, [key]: value }))
  const errorFor = (key: string) => errors.find(e => e.field === key || e.field.startsWith(`${key}.`))

  const control = (key: string) => {
    const p: Prop = props[key] ?? {}
    const value = draft[key]
    if (p.enum) {
      return (
        <select id={`f-${key}`} value={String(value ?? '')} onChange={e => set(key, e.target.value || null)}>
          <option value="" />
          {p.enum.map(opt => <option key={String(opt)} value={String(opt)}>{String(opt)}</option>)}
        </select>
      )
    }
    switch (typeOf(p)) {
      case 'string':
        return <input id={`f-${key}`} type={p.format === 'date' ? 'date' : 'text'}
          value={String(value ?? '')} readOnly={key === 'id' && !isNew}
          onChange={e => set(key, e.target.value === '' ? null : e.target.value)} />
      case 'number': case 'integer':
        return <input id={`f-${key}`} type="number" value={value == null ? '' : String(value)}
          onChange={e => set(key, e.target.value === '' ? null : Number(e.target.value))} />
      case 'boolean':
        return <input id={`f-${key}`} type="checkbox" style={{ width: 'auto' }} checked={Boolean(value)}
          onChange={e => set(key, e.target.checked)} />
      case 'array':
        if (p.items?.type === 'string') {
          return <input id={`f-${key}`}
            value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
            onChange={e => set(key, e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
        }
        return <YamlField label={key} value={value} onChange={v => set(key, v)} />
      default:
        return <YamlField label={key} value={value} onChange={v => set(key, v)} />
    }
  }

  const save = async () => {
    setBusy(true); setErrors([])
    try {
      if (isNew) await api.create(registry, draft)
      else await api.save(registry, String(entity.id), draft)
      await queryClient.invalidateQueries({ queryKey: ['registry', registry] })
      await queryClient.invalidateQueries({ queryKey: ['registries'] })
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.errors.length > 0) setErrors(err.errors)
      else setErrors([{ field: '', message: err instanceof Error ? err.message : 'save failed' }])
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!entity || !confirm(`Delete ${entity.id} from ${registry}?`)) return
    setBusy(true)
    try {
      await api.remove(registry, String(entity.id))
      await queryClient.invalidateQueries({ queryKey: ['registry', registry] })
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <div className="panel">
      <div className="row">
        <h3 style={{ flex: 1, margin: 0 }}>{isNew ? `New ${registry} entry` : String(entity.id)}</h3>
        <button onClick={onClose}>✕</button>
      </div>
      {errors.filter(e => e.field === '').map((e, i) => <div key={i} className="error">{e.message}</div>)}
      {ordered.map(key => {
        const p: Prop = props[key] ?? {}
        const isYaml = !p.enum && !['string', 'number', 'integer', 'boolean'].includes(typeOf(p)) &&
          !(typeOf(p) === 'array' && p.items?.type === 'string')
        return (
          <div className="field" key={key}>
            {!isYaml && <label htmlFor={`f-${key}`}>{key}</label>}
            {control(key)}
            {errorFor(key) && <div className="error">{errorFor(key)!.message}</div>}
          </div>
        )
      })}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" onClick={save} disabled={busy}>Save</button>
        {!isNew && <button className="danger" onClick={remove} disabled={busy}>Delete</button>}
        <span style={{ flex: 1 }} />
      </div>
    </div>
  )
}
