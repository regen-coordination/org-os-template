import { Link, useRoute } from 'wouter'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'

function NavItem({ href, label, count }: { href: string; label: string; count?: number | null }) {
  const [active] = useRoute(href)
  return (
    <Link href={href} className={`nav-item${active ? ' active' : ''}`}>
      <span>{label}</span>
      {typeof count === 'number' && <span style={{ color: 'var(--text-faint)' }}>{count}</span>}
    </Link>
  )
}

export default function Sidebar() {
  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: api.registries })
  return (
    <nav className="sidebar">
      <NavItem href="/" label="▦ Overview" />
      <div className="nav-section">REGISTRIES</div>
      {registries?.map(r => (
        <NavItem key={r.name} href={`/r/${r.name}`} label={r.name} count={r.count} />
      ))}
    </nav>
  )
}
