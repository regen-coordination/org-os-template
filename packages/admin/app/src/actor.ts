import { useQuery } from '@tanstack/react-query'
import { api, isKnownActor, type Actor } from './api.ts'

/** Why you cannot change anything, after "Read only: ", for an actor the server could not match to a member; null for
 *  a known one. An empty `unknown` means git has no user.email here (server/actor.ts). The band (ReadOnly.tsx) and the
 *  proposal page's held reason say the same words (C10); the band names the address in its title. */
export function readOnlyReason(a: Actor): string | null {
  if (!('unknown' in a)) return null
  return a.unknown === '' ? 'git has no address set here. Set user.email to one a member’s handles.git holds.' : 'your git address is not a member’s.'
}

/** The sentence read only says, beside a held control: "Read only: <the reason>". */
export function readOnlySentence(a: Actor): string | null {
  const why = readOnlyReason(a)
  return why === null ? null : `Read only: ${why}`
}

/** Who you are (contract: GET /api/actor, which answers the request's actor, L5 spec §11.1): a signed-in member, else
 *  the member your git email names, else git's unknown address (0.6's read-only sentences). Signing in and out read it
 *  again (session.ts). In hosted mode with no session it is a 401, which sends the person to sign in. Not knowing
 *  counts as read-only. */
export function useActor(): { actor: Actor | null; known: boolean; error: string | null } {
  // No retries: a failed read means read-only at once, not a page held on Loading… while it retries.
  const q = useQuery({ queryKey: ['actor'], queryFn: api.actor, staleTime: 60_000, retry: false })
  const actor = q.data ?? null
  return { actor, known: actor !== null && isKnownActor(actor), error: q.error ? q.error.message : null }
}
