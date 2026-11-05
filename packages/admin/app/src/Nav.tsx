import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api.ts'
import { useActor } from './actor.ts'
import { useChanges } from './changes/useChanges.ts'
import { Sidebar } from './frame/Sidebar.tsx'
import { BottomBar } from './frame/BottomBar.tsx'
import { INSTANCE_LINKS, WORKSPACE_ORDER, houseCounts, type Identity, type SideLink } from './frame/sections.ts'
import { SECTIONS, sectionCount, sectionRows, type SectionDef } from './sections.ts'
import { useRegistries, useResources, useStatus, useSystemEntries } from './queries.ts'
import { useCanWrite, useViewer } from './viewAs/ViewAs.tsx'
import { needsFrom } from './elements/needs/needs.ts'
import { useNow } from './time.ts'
import { useSessionView } from './session/session.ts'
import type { SignedInView } from './api.ts'
import { hatLevel, parseHatRef, prettyHatId } from '../../lib/hats.mjs'

/** A signed-in member as the identity draws them (L5 spec §11.3): the lowest worn hat's name (the deepest in the tree; the
 *  first of equals), the bare 0x address, that hat's pretty id, and the names of every hat worn. A reading that shows
 *  none: "No hats", as the sign-in card says; hats not known (stale, or `unread`): "Hats not read", never "No hats". */
/** The identity of a session whose hats are not known (past the grace, or not read yet: final review I1). */
export const HATS_NOT_READ = 'Hats not read'

export function sessionIdentity(s: SignedInView): Identity {
  let lowest: { hat: string; name: string; id: string } | null = null
  let level = -1
  for (const h of s.hats) {
    const parsed = parseHatRef(h.hat)
    const l = parsed ? hatLevel(parsed.hatId) : -1
    if (parsed && l > level) { lowest = { ...h, id: parsed.hatId }; level = l }
  }
  return {
    hatName: lowest?.name ?? s.hats[0]?.name ?? (s.stale || s.unread ? HATS_NOT_READ : 'No hats'),
    address: s.account.slice(s.account.lastIndexOf(':') + 1),
    hatId: lowest ? prettyHatId(lowest.id) : null,
    hats: s.hats.map(h => h.name),
  }
}

const order = (id: string) => { const at = WORKSPACE_ORDER.indexOf(id); return at < 0 ? WORKSPACE_ORDER.length : at }

/** The house's places on 0.6's queries (spec §5.2): the nine sections' counts — what needs you (Needs you's items:
 *  the proposals and Systems that wait on you), the open proposals, the Systems, your staged ops — each of what the
 *  viewer may see (rule 7); Workspace's collections are 0.6's organization sections that hold records (Q-L4-3);
 *  the Instance group is 0.6's org-os boards (C-8). The identity is the session's while one is live (L5 §11.3), else
 *  who git says you are (0.6's form). The sidebar and the phone's bottom bar both read it. */
/** Workspace's collections (§5.2 item 4, Q-L4-3): 0.6's organization sections that hold a record the viewer may see,
 *  in WORKSPACE_ORDER. A registry-only one (meetings) is read from its file, which has no visibility of its own yet:
 *  it reads as members-only. The sidebar lists them, and /workspace. */
export function useWorkspaceCollections({ empty = false }: { empty?: boolean } = {}): { collections: (SideLink & { def: SectionDef })[]; has(def: SectionDef): boolean } {
  const resources = useResources().data ?? []
  const registries = useRegistries().data ?? []
  const systems = useSystemEntries()
  const { visible, sees } = useViewer()
  const has = (def: SectionDef) => def.registry
    ? sectionCount(def, resources, registries, systems) > 0 && sees({})
    : visible(sectionRows(def, resources, systems)).length > 0
  // `empty` (the sidebar, design pass 2026-11-04): a collection whose file the server lists to this viewer, with nothing
  // in it they may see, is listed too, as empty; a members' file is not one for a Public preview (`sees({})`)
  const unset = (def: SectionDef) => empty && sees({}) && registries.some(g => g.name === (def.registry ?? def.newRegistry))
  const collections = SECTIONS.filter(d => d.group === 'organization' && d.id !== 'treasury' && (has(d) || unset(d)))
    .sort((a, b) => order(a.id) - order(b.id)).map(def => ({ id: def.id, label: def.label, href: def.route, def, ...(has(def) ? {} : { empty: true }) }))
  return { collections, has }
}

function useHouseNav() {
  const resources = useResources().data ?? []
  const all = useQuery({ queryKey: ['proposals'], queryFn: api.proposals }).data
  const open = all?.filter(v => v.state === 'open') ?? []
  const staged = useChanges().view?.ops.length ?? 0
  const status = useStatus()
  const { actor } = useActor()
  const { visible } = useViewer()
  const canWrite = useCanWrite()
  const now = useNow(false)
  const id = actor && 'id' in actor ? actor.id : null
  // Needs you's items, as /needs and the map read them (E-34)
  const needs = useMemo(() => needsFrom(resources, all ?? [], id, now), [resources, all, id, Math.floor(now.getTime() / 60_000)])

  const counts = houseCounts({ resources, open, needs, staged }, visible, canWrite)
  const { collections: listed, has } = useWorkspaceCollections({ empty: true })
  const collections = listed.map(({ id, label, href, empty }) => ({ id, label, href, ...(empty ? { empty } : {}) }))
  const link = (def: SectionDef): SideLink => ({ id: def.id, label: def.label, href: def.route })
  const boards = SECTIONS.filter(d => d.group === 'systems' && INSTANCE_LINKS.some(l => l.href === d.route) && has(d)).map(link)
  const instance = boards.length === 0 ? [] : INSTANCE_LINKS
    .filter(l => !l.href.startsWith('/b/') || boards.some(b => b.href === l.href))
    .map(l => ({ id: l.href, label: l.label, href: l.href }))

  const session = useSessionView()
  const identity: Identity = session?.signedIn ? sessionIdentity(session)
    : actor === null
    ? { hatName: '…', address: null, hatId: null, hats: [] }
    : 'id' in actor ? { hatName: actor.name, address: null, hatId: null, hats: [] }
    : { hatName: 'Read-only', address: null, hatId: null, hats: [] }

  return { org: { name: status.data?.org ?? 'org-os', mark: null }, counts, identity, collections, instance }
}

/** The house sidebar (§5.2). */
export default function Nav() {
  const { org, counts, identity, collections, instance } = useHouseNav()
  return <Sidebar org={org} counts={counts} identity={identity} collections={collections} instance={instance} />
}

/** The phone's bottom bar and its More sheet (§5.4), on the same counts. */
export function HouseBottom() {
  const { counts, identity, collections } = useHouseNav()
  return <BottomBar counts={counts} identity={identity} collections={collections} />
}
