import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'

export default function TopBar() {
  const { data } = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 5000 })
  return (
    <div className="topbar">
      <strong style={{ color: 'var(--text-bright)' }}>⬡ {data?.org ?? '…'}</strong>
      {data && (
        <span className={`badge ${data.dirty ? 'yellow' : 'green'}`}>
          ⎇ {data.branch} · {data.dirty ? 'dirty' : 'clean'}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <span className="badge" title="Direct mode — every save commits to the current branch">Direct mode</span>
    </div>
  )
}
