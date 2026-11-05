import type { OperationPair, RegistrySummary, Resource } from '../api.ts'
import { kindLabel, splitId } from '../kinds.ts'
import { opHref, recordHref, safeDecode } from '../hrefs.ts'
import { SKINS } from '../design/skins/index.ts'
import { kindIcon, type IconName } from '../design/Icon.tsx'
import { HOUSE_SECTIONS, sectionOf, type HouseSection, type SectionId } from '../frame/sections.ts'
import { SECTIONS, sectionCount, type SystemEntries } from '../sections.ts'

export type ActionId = 'edit' | 'apply' | 'discard' | 'theme' | 'map' | 'view-public' | 'exit-preview' | `skin:${string}`

/** The palette's groups (§5.7), in the order it lists them: sections and boards with their g-keys, records,
 *  every operation and action the viewer can perform, saved views. */
export type PaletteGroup = 'jump' | 'records' | 'actions' | 'views'
export const GROUPS: readonly { id: PaletteGroup; label: string }[] = [
  { id: 'jump', label: 'Jump to' }, { id: 'records', label: 'Records' }, { id: 'actions', label: 'Actions' }, { id: 'views', label: 'Views' },
]

/** One result. `detail` is searched with the label and drawn faint beside a record or a view; `keys` are its
 *  g-keys ("g t"); `hint` trails an operation ("asks first"); `where` is the page the item belongs to, which the
 *  scope chip reads. */
export interface PaletteItem {
  key: string; group: PaletteGroup; label: string; detail: string; keys?: string; icon?: IconName; hint?: string; where?: string
  go?: string; inspect?: string; action?: ActionId
}
export interface Place { label: string; href: string; detail: string }

/** What the actions depend on. Write actions (Edit, Apply, Discard) are asked for by the caller only when the
 *  viewer may write (not while previewing, C-23). `viewing` offers "View as Public" — or, previewing, also "Exit
 *  preview". `path` is the page the record's own actions act on. `skins` defaults to the skins that ship. */
export interface PaletteContext {
  hasChanges: boolean; canApply: boolean; record: { kind: string; id: string } | null
  path?: string; viewing?: 'you' | 'public' | 'other'; skins?: readonly { id: string; label: string }[]
  /** What the viewer can make, in order: *New <kind>* for each section they can add to, then *New board* (design
   *  pass 2026-11-04). Writes: the caller passes none while previewing (C-23). */
  adds?: readonly { label: string; go: string }[]
}

/** Every page of the menu: Home, Activity, the sections that have records, Governance, the maps, All records. */
export function places(resources: Resource[], registries: RegistrySummary[], systems: SystemEntries): Place[] {
  return [
    { label: 'Home', href: '/b/home', detail: 'page' },
    { label: 'Activity', href: '/activity', detail: 'page' },
    { label: 'Library', href: '/library', detail: 'page' },
    ...SECTIONS.filter(d => sectionCount(d, resources, registries, systems) > 0).map(d => ({ label: d.label, href: d.route, detail: 'section' })),
    { label: 'Rules', href: '/governance/rules', detail: 'governance' },
    { label: 'Decisions', href: '/governance/decisions', detail: 'governance' },
    { label: 'Proposals', href: '/governance/proposals', detail: 'governance' },
    { label: 'Organization map', href: '/b/organization', detail: 'map' },
    { label: 'Systems map', href: '/b/systems', detail: 'map' },
    { label: 'All records', href: '/all', detail: 'page' },
  ]
}

const placeIcon = (p: Place): IconName =>
  p.detail === 'governance' ? 'proposal' : p.href === '/all' ? 'table' : p.href === '/activity' ? 'clock' : 'file'

function actions(ctx: PaletteContext): PaletteItem[] {
  const out: PaletteItem[] = []
  const act = (action: ActionId, label: string, icon: IconName, where?: string): PaletteItem =>
    ({ key: `a:${action}`, group: 'actions', label, detail: 'action', icon, action, where })
  for (const a of ctx.adds ?? []) out.push({ key: `n:${a.go}:${a.label}`, group: 'actions', label: a.label, detail: 'new', icon: 'plus', go: a.go })
  if (ctx.record) out.push(act('edit', 'Edit this record', 'pen', ctx.path))
  if (ctx.canApply) out.push(act('apply', 'Apply changes', 'check'))
  if (ctx.hasChanges) out.push(act('discard', 'Discard changes', 'x'))
  out.push(act('theme', 'Toggle dark', 'moon'))
  // The Skin select left the menu: a builder reaches the skins here, and only when there is a choice (§3.1).
  const skins = ctx.skins ?? SKINS
  if (skins.length > 1) for (const k of skins) out.push(act(`skin:${k.id}`, `Skin: ${k.label}`, 'layers'))
  // Go to map goes to the record's place on its map from a record page: an action of that page; elsewhere, of none.
  out.push(act('map', 'Go to map', 'map', ctx.path !== undefined && recordContext(ctx.path) ? ctx.path : undefined))
  const viewing = ctx.viewing ?? 'you'
  if (viewing !== 'public') out.push(act('view-public', 'View as Public', 'globe'))
  if (viewing !== 'you') out.push(act('exit-preview', 'Exit preview', 'eye'))
  return out
}

const sectionItem = (s: HouseSection): PaletteItem =>
  ({ key: `s:${s.id}`, group: 'jump', label: s.label, detail: 'section', keys: `g ${s.key}`, icon: s.icon, go: s.href, where: s.href })

/** The palette's items, group by group (§5.7): Jump to (the house's nine sections with their g-keys, then the
 *  other pages, a section's name listed once), Records (by name and id; never an absence), Actions (operations on
 *  records, "Run doctor assess on example-coop-os", then the actions), Views (the maps). The caller passes only what
 *  the viewer may see (rule 7). */
export function paletteItems(resources: Resource[], placeList: Place[], ops: OperationPair[], ctx: PaletteContext): PaletteItem[] {
  const named = new Set(HOUSE_SECTIONS.map(s => s.label))
  const pages = placeList.filter(p => p.detail !== 'map' && !named.has(p.label))
  return [
    ...HOUSE_SECTIONS.map(sectionItem),
    ...pages.map((p): PaletteItem => ({ key: `p:${p.href}`, group: 'jump', label: p.label, detail: p.detail, icon: placeIcon(p), go: p.href, where: p.href })),
    ...resources.filter(r => r.kind !== 'absent').map((r): PaletteItem => ({
      key: `r:${r.id}`, group: 'records', label: r.name, detail: `${kindLabel(r.kind)} · ${splitId(r.id).id}`, icon: kindIcon(r.kind),
      go: recordHref(r.id), inspect: r.id, where: `/b/${r.board}`,
    })),
    ...ops.map((o): PaletteItem => ({
      key: `o:${o.op}:${o.resource}:${o.label}`, group: 'actions', label: `${o.label} on ${o.resourceName}`,
      detail: o.confirm ? 'asks first' : 'runs on click', hint: o.confirm ? 'asks first' : undefined, icon: 'arrow-right',
      go: opHref(o.resource, { id: o.op, label: o.label }), where: recordHref(o.resource),
    })),
    ...actions(ctx),
    ...placeList.filter(p => p.detail === 'map').map((p): PaletteItem => ({ key: `v:${p.href}`, group: 'views', label: p.label, detail: p.detail, icon: 'map', go: p.href, where: p.href })),
  ]
}

/** Every word must appear in the label or the detail, in any order; the given order is kept, and each group stops
 *  at `limit`. Items whose key is in `also` are kept whatever the words: the records an address names. */
export function filterItems(items: PaletteItem[], query: string, limit = 30, also: ReadonlySet<string> = new Set()): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const seen = new Map<PaletteGroup, number>()
  return items.filter(i => {
    const hay = `${i.label} ${i.detail}`.toLowerCase()
    if (!also.has(i.key) && !words.every(w => hay.includes(w))) return false
    const n = (seen.get(i.group) ?? 0) + 1
    seen.set(i.group, n)
    return n <= limit
  })
}

/** The label cut into plain and matched runs (a matched run is drawn in `<mark>`, 600 ink): the first place each
 *  word of the query appears, in any case, overlaps merged. */
export function highlight(label: string, query: string): { text: string; match: boolean }[] {
  const lower = label.toLowerCase()
  const spans: [number, number][] = []
  for (const w of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = lower.indexOf(w)
    if (at >= 0) spans.push([at, at + w.length])
  }
  spans.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const s of spans) {
    const last = merged.at(-1)
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
    else merged.push([s[0], s[1]])
  }
  const out: { text: string; match: boolean }[] = []
  let from = 0
  for (const [a, b] of merged) {
    if (a > from) out.push({ text: label.slice(from, a), match: false })
    out.push({ text: label.slice(a, b), match: true })
    from = b
  }
  if (from < label.length) out.push({ text: label.slice(from), match: false })
  return out
}

/** A full address: 0x and 40 hex digits, not the start of a longer run. */
const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/

/** Does any string in this value hold the address (lower case given)? */
function holds(value: unknown, address: string, depth = 0): boolean {
  if (typeof value === 'string') return value.toLowerCase().includes(address)
  if (depth > 6 || value === null || typeof value !== 'object') return false
  return Object.values(value).some(v => holds(v, address, depth + 1))
}

/** An address pasted into the palette (§5.7) — bare, or inside a CAIP-10 id — finds the records that hold it: the
 *  System whose facts carry it, a hat, a member. Nothing for a query without a full address. The caller passes only
 *  what the viewer may see. */
export function findByAddress(query: string, resources: Resource[]): Resource[] {
  const m = ADDRESS.exec(query)
  if (!m) return []
  const address = m[0].toLowerCase()
  return resources.filter(r => r.kind !== 'absent' && (r.id.toLowerCase().includes(address) || holds(r.facts, address)))
}

/** The scope chip (§5.7): All, the section the page is in, the page itself. Tab cycles them. */
export type Scope = 'all' | 'section' | 'page'

const strip = (path: string) => (path.split(/[?#]/)[0] ?? '/').replace(/(.)\/+$/, '$1') || '/'

/** The house section a path is in: a section's page or what is under it, or its board (`/b/systems`). */
export function sectionAt(path: string): SectionId | null {
  const p = strip(path)
  return sectionOf(p) ?? HOUSE_SECTIONS.find(s => p === `/b/${s.id}`)?.id ?? null
}

/** The scopes a page offers: All, its section (when it is in one), In this page. */
export function scopes(path: string): Scope[] {
  return sectionAt(path) ? ['all', 'section', 'page'] : ['all', 'page']
}

/** The chip's words: "All", the section's name, "In this page". */
export function scopeLabel(scope: Scope, path: string): string {
  if (scope === 'all') return 'All'
  if (scope === 'page') return 'In this page'
  const id = sectionAt(path)
  return HOUSE_SECTIONS.find(s => s.id === id)?.label ?? 'All'
}

/** Is the item in the scope, on this page? An item that belongs to no page (Toggle dark) is in All only. */
export function inScope(item: PaletteItem, scope: Scope, path: string): boolean {
  if (scope === 'all') return true
  if (item.where === undefined) return false
  if (scope === 'page') return strip(item.where) === strip(path)
  const here = sectionAt(path)
  return here !== null && sectionAt(item.where) === here
}

/** The record the page shows, from its path; null on any other page. */
export function recordContext(path: string): { kind: string; id: string } | null {
  const m = /^\/r\/([^/]+)\/([^/]+)$/.exec(path)
  return m ? { kind: safeDecode(m[1]!), id: safeDecode(m[2]!) } : null
}
