import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type VisibilityView } from '../api.ts'
import { FIXTURE_SOURCE, type Visibility, type VisibilitySource } from '../viewAs/visibility.ts'

/** The Hub's real visibility source (L5 spec §11.2), built from `GET /api/visibility`. L4a's elements read it through
 *  `ViewAsProvider`; nothing in `viewAs/` is redrawn. `FIXTURE_SOURCE` stays for tests and /parts. */

const PUBLIC: Visibility = { level: 'public' }
const MEMBERS: Visibility = { level: 'members' }
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** The level token an item carries: the gate's `visibility`, else the fixtures' `facts.visibility`; null for none. */
function tokenOf(item: unknown): string | null {
  if (!isObj(item)) return null
  if (typeof item.visibility === 'string') return item.visibility
  const facts = item.facts
  return isObj(facts) && typeof facts.visibility === 'string' ? facts.visibility : null
}

/** A role held, as the source names it: a hat whose id is `role:<id>` (an org without a tree, §5.4, §9.1). */
const roleHat = (id: string) => ({ hat: `role:${id}`, name: id })

export function houseSource(v: VisibilityView): VisibilitySource {
  const names = new Map(v.tree.map(h => [h.hat, h.name]))
  const above = new Map(v.tree.map(h => [h.hat, h.above]))
  // Without a tree, the third level is a governance role (§5.4): the ones this member holds are what they may give.
  const roles = v.tree.length > 0 ? [] : v.levels.filter(l => l.startsWith('role:')).map(l => roleHat(l.slice('role:'.length)))
  return {
    /** `public`, `members`, `hat:<ref>` (named from the tree), `role:<id>` (a hat named by the role); none is members. */
    visibilityOf(item) {
      const t = tokenOf(item)
      if (t === 'public') return PUBLIC
      if (t !== null && t.startsWith('hat:') && t.length > 'hat:'.length) {
        const hat = t.slice('hat:'.length)
        return { level: 'hat', hat, name: names.get(hat) ?? hat }
      }
      if (t !== null && t.startsWith('role:') && t.length > 'role:'.length) return { level: 'hat', ...roleHat(t.slice('role:'.length)) }
      return MEMBERS
    },
    hatsAbove: hat => [...(above.get(hat) ?? [])],
    hats: () => (v.tree.length > 0 ? v.tree.map(({ hat, name }) => ({ hat, name })) : roles),
    worn: () => [...v.worn, ...roles.map(r => r.hat)],
  }
}

/** GET /api/visibility, read once per session (signing in or out reads it again with everything else). */
export function useVisibilityView(): VisibilityView | null {
  return useQuery({ queryKey: ['visibility'], queryFn: api.visibility, retry: false, staleTime: 60_000 }).data ?? null
}

/** The source the Hub reads with: the fixtures' until the view loads (they read anything without a level as members,
 *  so nothing flashes open), then the real one. */
export function useHouseSource(): VisibilitySource {
  const view = useVisibilityView()
  return useMemo(() => (view ? houseSource(view) : FIXTURE_SOURCE), [view])
}
