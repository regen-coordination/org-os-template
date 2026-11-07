import type { IconName } from '../design/Icon.tsx'
import { SECTIONS } from '../sections.ts'
import { safeDecode } from '../hrefs.ts'

/** The house's nine sections (spec §5.2), in the house spec's order, with their g-key (§5.8). */
export type SectionId = 'home' | 'needs' | 'proposals' | 'systems' | 'roles' | 'treasury' | 'workspace' | 'library' | 'changes'
export interface HouseSection { id: SectionId; label: string; href: string; icon: IconName; key: string }

export const HOUSE_SECTIONS: readonly HouseSection[] = [
  { id: 'home', label: 'Home', href: '/', icon: 'home', key: 'h' },
  { id: 'needs', label: 'Needs you', href: '/needs', icon: 'needs', key: 'n' },
  { id: 'proposals', label: 'Proposals', href: '/governance/proposals', icon: 'proposal', key: 'p' },
  { id: 'systems', label: 'Systems', href: '/systems', icon: 'systems', key: 's' },
  { id: 'roles', label: 'Roles', href: '/roles', icon: 'roles', key: 'r' },
  { id: 'treasury', label: 'Treasury', href: '/b/treasury', icon: 'safe', key: 't' },
  { id: 'workspace', label: 'Workspace', href: '/workspace', icon: 'workspace', key: 'w' },
  { id: 'library', label: 'Library', href: '/library', icon: 'library', key: 'l' },
  { id: 'changes', label: 'Changes', href: '/changes', icon: 'changes', key: 'c' },
]

/** The Instance group (call C-8, §18 answer 5): 0.6's org-os boards that are not DAO sections. */
export const INSTANCE_LINKS: readonly { label: string; href: string }[] = [
  { label: 'Crew', href: '/b/crew' },
  { label: 'Fleet', href: '/b/fleet' },
  { label: 'Modules', href: '/b/modules' },
  { label: 'Sources', href: '/b/sources' },
  { label: 'Activity', href: '/activity' },
  { label: 'All records', href: '/all' },
  { label: 'Boards', href: '/boards' },
]

/** Workspace's collections come in this order, then any other the viewer may see (§5.2 item 4). Tasks and
 *  Knowledge appear when L6 adds them (Q-L4-3). */
export const WORKSPACE_ORDER: readonly string[] = ['meetings', 'tasks', 'projects', 'knowledge']

/** A Workspace collection or an Instance board, as the sidebar lists it; `empty`, a collection with nothing in it the
 *  viewer may see (its dashed dot, design pass 2026-11-04). */
export interface SideLink { id: string; label: string; href: string; empty?: boolean }

/** The counts the sidebar shows: each of what the viewer may see (rule 7). */
export interface HouseCounts { needs: number; proposals: number; systems: number; changes: number }

/** A count as the sidebar draws it: nothing for zero, `99+` past 99. */
export function countText(n: number): string | null {
  if (!(n > 0)) return null
  return n > 99 ? '99+' : String(Math.floor(n))
}

/** The org as the switcher draws it: its name, and its mark from the instance's configuration — null is the
 *  neutral seal (§18 answer 4), never a DAO's logo by default. */
export interface OrgMark { name: string; mark: string | null }

/** Who is signed in, as the sidebar's foot draws them (L5 replaces where it comes from). */
/** Who is signed in. A wallet session names its hat, address and hats; an email session (Lane 3) names the person in
 *  `hatName`, has no address and no hats, and gives its Roles as words in `roles`. */
export interface Identity { hatName: string; address: string | null; hatId: string | null; hats: string[]; roles?: string[] }

/** What the counts are read from: the lists as the server gives them, filtered here by `visible` (the viewer's
 *  eyes, §6.3) — so a preview as Public counts only what the door would show. Needs you's count is its items
 *  (`needsFrom`, E-34), so the sidebar, the list and the map agree. Staged changes are the member's own writes: while
 *  previewing (`canWrite` false) there are none to count, as the tray is hidden. */
export function houseCounts<R extends { kind: string }, P, N>(
  lists: { resources: R[]; open: P[]; needs: N[]; staged: number },
  visible: <T>(items: T[]) => T[], canWrite: boolean,
): HouseCounts {
  const resources = visible(lists.resources)
  const open = visible(lists.open)
  return {
    needs: visible(lists.needs).length,
    proposals: open.length,
    systems: resources.filter(r => r.kind === 'system').length,
    changes: canWrite ? lists.staged : 0,
  }
}

const strip = (path: string) => (path.split(/[?#]/)[0] ?? '/').replace(/(.)\/+$/, '$1') || '/'
const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`)

/** The section a record page (`/r/<kind>/<id>`) belongs to, by its kind (E-64): a System is Systems', a proposal
 *  Proposals', a record of one of 0.6's organization collections (a project, a person, a meeting…) Workspace's. A kind
 *  of the Instance group's boards (a module, a crew seat) is no section of the Hub. */
function recordSection(kind: string): SectionId | null {
  if (kind === 'system') return 'systems'
  if (kind === 'proposal') return 'proposals'
  const home = SECTIONS.find(d => d.group === 'organization' && d.id !== 'treasury' && (d.kinds.includes(kind) || d.registry === kind))
  return home ? 'workspace' : null
}

/** The section a path belongs to, if any. Home is `/` and its board; the Proposals tabs (decisions, rules) are
 *  Proposals (L4-R10); a Workspace collection is Workspace; a record page is its kind's (E-64). */
export function sectionOf(path: string, collections: readonly SideLink[] = []): SectionId | null {
  const p = strip(path)
  if (p === '/' || p === '/b/home') return 'home'
  const record = /^\/r\/([^/]+)\/[^/]+$/.exec(p)
  if (record) return recordSection(safeDecode(record[1]!))
  if (under(p, '/governance')) return 'proposals'
  if (collections.some(c => under(p, c.href))) return 'workspace'
  const found = HOUSE_SECTIONS.filter(s => s.href !== '/' && under(p, s.href))
  return found[0]?.id ?? null
}

/** Is this link the page you are on, or an ancestor of it? */
export function isCurrent(path: string, href: string): boolean {
  return under(strip(path), href)
}
