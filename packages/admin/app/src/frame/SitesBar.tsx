import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { api, type InstanceBar } from '../api.ts'

/** The instance's sites bar, drawn: whose sites these are, then each site in the instance's order. The one this house
 *  is carries `aria-current`; a site elsewhere opens in its own tab and says so; a rooted path is a place in the house.
 *  A site's note is its tooltip. No sites, no bar. */
export function SitesBarView({ bar }: { bar: InstanceBar }) {
  if (bar.sites.length === 0) return null
  return (
    <nav className="sites" aria-label={bar.label ? `${bar.label} sites` : 'Sites'}>
      {bar.label && <span className="sites-org">{bar.label}</span>}
      <ul className="sites-l">
        {bar.sites.map(s => {
          const current = s.current ? 'page' as const : undefined
          return (
            <li key={`${s.label} ${s.href}`}>
              {s.href.startsWith('/')
                ? <Link className="sites-a" href={s.href} aria-current={current} title={s.note}>{s.label}</Link>
                : <a className="sites-a" href={s.href} aria-current={current} title={s.note} target="_blank" rel="noopener noreferrer">
                    {s.label}<span className="sites-out" aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
                  </a>}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** The bar as the frame reads it (server/instanceBar.ts): asked once; while it has not answered, or when the
 *  server has none to give (an older server, an instance without `house/bar.yaml`), nothing is drawn. */
export function SitesBar() {
  const q = useQuery({ queryKey: ['house', 'bar'], queryFn: api.houseBar, retry: false, staleTime: Infinity })
  return q.data && Array.isArray(q.data.sites) ? <SitesBarView bar={q.data} /> : null
}
