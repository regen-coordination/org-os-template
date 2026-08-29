import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { stringify } from 'yaml'
import { api, type Entity } from '../api.ts'
import EntityForm from './EntityForm.tsx'

const scalar = (v: unknown) =>
  v == null ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? '{…}' : String(v)

export default function RegistryPage({ name }: { name: string }) {
  const { data: reg } = useQuery({ queryKey: ['registry', name], queryFn: () => api.registry(name) })
  const { data: schema } = useQuery({ queryKey: ['schema', name], queryFn: () => api.schema(name) })
  const [selected, setSelected] = useState<Entity | 'new' | null>(null)

  if (!reg || !schema) return <p style={{ color: 'var(--text-dim)' }}>Loading…</p>

  if (reg.kind === 'document') {
    return (
      <>
        <div className="row"><h2 style={{ flex: 1 }}>{name}</h2><span className="badge">read-only in M1</span></div>
        <pre style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg-raised)', padding: 16, borderRadius: 8 }}>
          {stringify(reg.document ?? {})}
        </pre>
      </>
    )
  }

  const columns = schema['x-order'] ?? ['id']
  return (
    <>
      <div className="row">
        <h2 style={{ flex: 1 }}>{name}</h2>
        <button className="primary" onClick={() => setSelected('new')}>+ New</button>
      </div>
      <table>
        <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {reg.entries!.map(e => (
            <tr key={e.id} onClick={() => setSelected(e)}>
              {columns.map(c => <td key={c}>{scalar(e[c])}</td>)}
            </tr>
          ))}
          {reg.entries!.length === 0 && (
            <tr><td colSpan={columns.length} style={{ color: 'var(--text-faint)' }}>No entries yet.</td></tr>
          )}
        </tbody>
      </table>
      {selected && (
        // `key` is load-bearing, not decoration. EntityForm seeds its draft
        // state once from `entity`; without a key, React reuses the same
        // instance when you click a different row, so the heading shows the
        // new entity while every field still holds the old one — and saving
        // 422s on an id mismatch (or 409s as a duplicate, after `+ New`).
        <EntityForm
          key={selected === 'new' ? 'new' : String((selected as { id?: unknown }).id ?? 'unknown')}
          registry={name}
          schema={schema}
          entity={selected === 'new' ? null : selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
