import { Redirect, useSearch } from 'wouter'
import { routeOfRegistry } from './sections.ts'
import { safeDecode } from './hrefs.ts'

/** The old one-segment `/r/:registry` → the registry's section board, or All records. */
export function RegistryRedirect({ registry }: { registry: string }) {
  return <Redirect to={routeOfRegistry(safeDecode(registry))} replace />
}

/** An old address (`/`, `/<section>`, `/maps/<map>`) to its board, keeping `?select=` and the rest (spec §5.4). */
export function ToBoard({ id }: { id: string }) {
  const search = useSearch()
  return <Redirect to={`/b/${encodeURIComponent(id)}${search ? `?${search}` : ''}`} replace />
}

/** A proposal's resource address, where its Cards link (`/r/proposal/<id>`), to its page: one URL per proposal (spec §3.14). */
export function ProposalRedirect({ id }: { id: string }) {
  return <Redirect to={`/governance/proposals/${encodeURIComponent(safeDecode(id))}`} replace />
}
