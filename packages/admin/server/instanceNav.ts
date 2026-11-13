// The instance's sidebar. The house draws its own sections (Home, Needs you, Proposals…); an instance may carry
// `house/nav.yaml` to group its sidebar its own way: named groups of the house's sections (by id, renamed if it likes),
// places in the house and other sites, each with the Roles it is for. The sections it does not name are kept, under a
// collapsed group at the foot, so nothing of the house is lost. Absent, or not readable as a nav, the answer is no
// groups and the house draws its own sections. Nothing of any organisation is written into the framework.
//
//   groups:
//     - items:                                   # a group without a label: the top of the sidebar
//         - { section: home, label: Dashboard }
//         - { section: needs }
//     - label: Governance
//       items:
//         - { label: Decided, href: /governance/decisions, audience: [steward] }
//         - { label: Funds, href: "https://old.example.org/funds", audience: [steward] }
//         - { label: Portal, href: /b/threads, hidden: true }   # its slot, not drawn until it is ready
//   more: More                                   # optional: the label of the group of sections not named
//
// An audience names who the item is drawn for: the Roles a signed-in person holds (steward, node-lead,
// network-member). It arranges the sidebar; it guards nothing. What a person may read is the server's gate, page by
// page, whatever the sidebar draws.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { ROLES, type Role } from './private/store.ts'

export const INSTANCE_NAV_PATH = '/api/instance/nav'
/** Where an instance keeps its nav, from its root. */
export const INSTANCE_NAV_FILE = join('house', 'nav.yaml')
/** A nav is a few dozen lines; a bigger file is a mistake, not a nav. */
export const INSTANCE_NAV_MAX_BYTES = 16 * 1024
/** More groups, or more items in one, than this do not make a sidebar a person can read. */
export const INSTANCE_NAV_MAX_GROUPS = 8
export const INSTANCE_NAV_MAX_ITEMS = 12
/** The house's sections an item may name: app/src/frame/sections.ts HOUSE_SECTIONS, in its order (a test keeps the
 *  two equal). */
export const NAV_SECTIONS = Object.freeze(['home', 'needs', 'proposals', 'systems', 'roles', 'treasury', 'workspace', 'library', 'changes'] as const)
export type NavSection = typeof NAV_SECTIONS[number]

/** One item: a house section (`section`, its label optional) or a link (`label` and `href`), never both. */
export interface NavItem { label?: string; section?: NavSection; href?: string; audience?: Role[]; icon?: string }
export interface NavGroup { label: string | null; items: NavItem[] }
export interface InstanceNav { groups: NavGroup[]; more: string | null }

const NONE: InstanceNav = { groups: [], more: null }
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' && v.trim().length <= max ? v.trim() : null)
/** Another site by its http(s) address, or a place in this house by a rooted path; nothing else is a link. */
const address = (v: unknown): string | null => {
  const u = text(v, 2000)
  return u && (/^https?:\/\/[^\s]+$/i.test(u) || /^\/(?![/\\])[^\s\\]*$/.test(u)) ? u : null
}
const audienceOf = (v: unknown): Role[] | null => {
  if (!Array.isArray(v)) return null
  const kept = ROLES.filter(r => v.includes(r))
  return kept.length > 0 ? kept : null
}

function itemOf(v: unknown): NavItem | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  if (e.hidden === true) return null
  const label = text(e.label, 40)
  const section = typeof e.section === 'string' && (NAV_SECTIONS as readonly string[]).includes(e.section) ? e.section as NavSection : null
  const href = address(e.href)
  let item: NavItem
  if (e.section !== undefined) {
    if (!section || e.href !== undefined) return null
    item = { section, ...(label ? { label } : {}) }
  } else {
    if (!label || !href) return null
    item = { label, href }
  }
  const audience = audienceOf(e.audience)
  const icon = typeof e.icon === 'string' && /^[a-z][a-z-]{0,23}$/.test(e.icon) ? e.icon : null
  return { ...item, ...(audience ? { audience } : {}), ...(icon ? { icon } : {}) }
}

/** The instance's nav, or no groups when it carries none (or a file that is not one). An item that is hidden, has no
 *  label, an address that is not a link, or a section the house does not have is left out; so is a group left with
 *  no items. Read on every call, so an edit shows on the next load without a restart. */
export function readInstanceNav(repo: string): InstanceNav {
  const file = join(repo, INSTANCE_NAV_FILE)
  if (!existsSync(file)) return NONE
  const st = statSync(file)
  if (!st.isFile() || st.size > INSTANCE_NAV_MAX_BYTES) return NONE
  let doc: unknown
  try { doc = parse(readFileSync(file, 'utf8')) } catch { return NONE }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return NONE
  const { groups, more } = doc as { groups?: unknown; more?: unknown }
  if (!Array.isArray(groups)) return NONE
  const out: NavGroup[] = []
  for (const g of groups) {
    if (out.length >= INSTANCE_NAV_MAX_GROUPS) break
    if (!g || typeof g !== 'object' || Array.isArray(g)) continue
    const { label, items } = g as { label?: unknown; items?: unknown }
    if (!Array.isArray(items)) continue
    const kept: NavItem[] = []
    for (const i of items) {
      if (kept.length >= INSTANCE_NAV_MAX_ITEMS) break
      const item = itemOf(i)
      if (item) kept.push(item)
    }
    if (kept.length > 0) out.push({ label: text(label, 40), items: kept })
  }
  return { groups: out, more: text(more, 40) }
}
