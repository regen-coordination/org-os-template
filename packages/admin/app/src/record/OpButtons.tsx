import { useQuery } from '@tanstack/react-query'
import { api, type Resource } from '../api.ts'
import { opHref } from '../hrefs.ts'
import { ButtonLink } from '../design/Button.tsx'

/** The head's operation buttons: each opens that operation's box in the Operations section. */
export default function OpButtons({ resource }: { resource: Resource }) {
  const ops = useQuery({ queryKey: ['operations', resource.id], queryFn: () => api.operations(resource.id), enabled: resource.kind !== 'absent' })
  return <>{(ops.data ?? []).filter(o => o.unavailable === null).map(o => <ButtonLink key={`${o.id}:${o.label}`} href={opHref(resource.id, o)}>{o.label}</ButtonLink>)}</>
}
