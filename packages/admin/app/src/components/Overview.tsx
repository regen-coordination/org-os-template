import { Link } from 'wouter'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'

export default function Overview() {
  const { data: registries, isLoading } = useQuery({ queryKey: ['registries'], queryFn: api.registries })
  if (isLoading) return <p style={{ color: 'var(--text-dim)' }}>Loading…</p>
  return (
    <>
      <h2>Overview</h2>
      <div className="cards">
        {registries?.map(r => (
          <Link key={r.name} href={`/r/${r.name}`} className="card" style={{ display: 'block' }}>
            <h3>{r.name}</h3>
            <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              {r.kind === 'collection' ? `${r.count} entries` : 'document'}
              {r.kind === 'document' && <span className="badge" style={{ marginLeft: 6 }}>read-only</span>}
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
