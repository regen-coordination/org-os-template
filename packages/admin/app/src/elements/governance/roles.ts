/** The role tree's pure parts (§9.7): the tree a Hats read gives, what of it is visible, and type-ahead. */
import type { DriverRead } from '../../../../server/systems/driver.ts'
import type { HatFact } from '../../../../server/systems/hats.ts'

/** One hat, as the role tree draws it. `wearers.shown` are the wearers who made theirs public (null: none are, and
 *  the tree says a count or an address, never a name: rule 9); `address` is the one wearer's CAIP-10 account; `complete`
 *  says whether the holders list was read whole. `active` false is a hat switched off: it is not an empty hat. */
export interface RoleNode { id: string; prettyId: string; name: string | null; level: number; children: RoleNode[]; does: string
  wearers: { count: number; shown: { handle: string; role: string }[] | null; address?: string; complete?: boolean }; yours?: boolean
  active?: boolean }

/** A hat with no wearer that is switched on: it needs someone (the needs mark, attention). */
export const isEmptyHat = (n: RoleNode) => n.active !== false && n.wearers.count === 0

/** The hats a reader sees, depth first: the hats inside an open hat follow it. `level` is the item's depth, 1 at the
 *  top (its aria-level); `parent` the hat it is inside. */
export function flattenVisible(nodes: RoleNode[], open: Set<string>): { node: RoleNode; level: number; parent: string | null }[] {
  const out: { node: RoleNode; level: number; parent: string | null }[] = []
  const walk = (list: RoleNode[], level: number, parent: string | null) => {
    for (const node of list) {
      out.push({ node, level, parent })
      if (node.children.length > 0 && open.has(node.id)) walk(node.children, level + 1, node.id)
    }
  }
  walk(nodes, 1, null)
  return out
}

/** The row a typed run of letters moves to (APG type-ahead): the next hat whose name (an unnamed hat's id) starts with
 *  them. One letter looks from the row after `from`; a longer run from `from` itself, so the focus stays while it still
 *  matches. Wraps; with no match the focus stays at `from`. */
export function typeAhead(rows: { node: RoleNode }[], from: number, letters: string): number {
  const want = letters.toLocaleLowerCase()
  const start = letters.length > 1 ? 0 : 1
  for (let i = 0; i < rows.length; i++) {
    const at = (from + start + i) % rows.length
    const { node } = rows[at]!
    if ((node.name ?? node.prettyId).toLocaleLowerCase().startsWith(want)) return at
  }
  return from
}

/** Details that are a link (`ipfs://…`, `https://…`) or JSON are not a name: L2 reads no names from IPFS. */
const plainText = (details: string): string | null => {
  const t = details.trim()
  return t === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^[[{]/.test(t) ? null : t
}

/** The role tree a hats driver read gives (brief B6): each hat by its ref, its pretty id and level, its name when its
 *  details are plain text, its wearers a count from `supply` (with the one holder's address when there is one wearer),
 *  never names from members (rule 9). A hat whose admin is not in the read is a top of the tree. `yours` waits for L5;
 *  what a hat does is not read yet. */
export function roleTreeFrom(read: DriverRead): RoleNode[] {
  const hats = Array.isArray(read.facts.hats) ? (read.facts.hats as HatFact[]) : []
  const byId = new Map<string, RoleNode>()
  for (const h of hats) {
    byId.set(h.id, {
      id: h.id, prettyId: h.pretty, name: plainText(h.details), level: h.level, children: [], does: '',
      wearers: { count: h.supply, shown: null, ...(h.supply === 1 && h.holders?.[0] ? { address: h.holders[0] } : {}), complete: h.holdersComplete },
      yours: false, active: h.active,
    })
  }
  const tops: RoleNode[] = []
  for (const h of hats) {
    const node = byId.get(h.id)!
    const admin = h.admin === null ? undefined : byId.get(h.admin)
    if (admin && admin !== node) admin.children.push(node)
    else tops.push(node)
  }
  return tops
}
