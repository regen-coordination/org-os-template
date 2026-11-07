/** Who may see what (CONTEXT "Visibility", spec §5.9, §6.3, L4-R7): *public*, *members*, or *a hat* — read by its
 *  wearers and the wearers of the hats above it. A client model with an injectable source: L4 reads an item's
 *  `facts.visibility` from the fixtures, else `members`; L5 passes its own source, not new components. */

export type Visibility = { level: 'public' } | { level: 'members' } | { level: 'hat'; hat: string; name: string }

/** Whose eyes the house is drawn for: you (the signed-in member: everything, in L4), or a preview. */
export type Viewer = { as: 'you' } | { as: 'public' } | { as: 'members' } | { as: 'hat'; hat: string; name: string }

export interface VisibilitySource {
  /** An item's level. */
  visibilityOf(item: unknown): Visibility
  /** The ids of the hats above this one, nearest first. */
  hatsAbove(hat: string): string[]
  /** Every hat in the tree, in the tree's order. */
  hats(): { hat: string; name: string }[]
  /** The hats the signed-in member wears: they may choose these for a thing, and any hat below them (§7.10). */
  worn(): string[]
}

const PUBLIC: Visibility = { level: 'public' }
const MEMBERS: Visibility = { level: 'members' }

/** The fixture tree: Top, and under it Council (with Ops under it) and Treasurer. The fixture member wears
 *  Council and Ops. Ids are placeholders; L5's source answers with the tree read from the chain. */
const TREE: { hat: string; name: string; above: string | null }[] = [
  { hat: 'top', name: 'Top', above: null },
  { hat: 'council', name: 'Council', above: 'top' },
  { hat: 'ops', name: 'Ops', above: 'council' },
  { hat: 'treasury', name: 'Treasurer', above: 'top' },
]

export const FIXTURE_SOURCE: VisibilitySource = {
  /** `facts.visibility` is `public`, `members` or `hat:<id>`; anything else, or nothing, is members. */
  visibilityOf(item) {
    const facts = item !== null && typeof item === 'object' ? (item as { facts?: unknown }).facts : undefined
    const v = facts !== null && typeof facts === 'object' ? (facts as { visibility?: unknown }).visibility : undefined
    if (v === 'public') return PUBLIC
    if (typeof v === 'string' && v.startsWith('hat:') && v.length > 'hat:'.length) {
      const hat = v.slice('hat:'.length)
      return { level: 'hat', hat, name: TREE.find(h => h.hat === hat)?.name ?? hat }
    }
    return MEMBERS
  },
  hatsAbove(hat) {
    const out: string[] = []
    for (let at = TREE.find(h => h.hat === hat)?.above ?? null; at !== null && !out.includes(at); at = TREE.find(h => h.hat === at)?.above ?? null) out.push(at)
    return out
  },
  hats: () => TREE.map(({ hat, name }) => ({ hat, name })),
  worn: () => ['council', 'ops'],
}

/** May this viewer see a thing at this level? You see everything; public sees public; members see public and
 *  members; a hat's wearer sees those and every hat level at or below their hat. */
export function canSee(viewer: Viewer, v: Visibility, src: VisibilitySource): boolean {
  switch (viewer.as) {
    case 'you': return true
    case 'public': return v.level === 'public'
    case 'members': return v.level !== 'hat'
    case 'hat': return v.level !== 'hat' || v.hat === viewer.hat || src.hatsAbove(v.hat).includes(viewer.hat)
  }
}

/** Is everyone who may read `inner` also a reader of `outer`? Moving a thing from `outer` to `inner` then lets
 *  nobody new read it — it narrows, and applies at once; otherwise it widens, which is a decision (CONTEXT). */
export function readersWithin(inner: Visibility, outer: Visibility, src: VisibilitySource): boolean {
  const as: Viewer = inner.level === 'hat' ? { as: 'hat', hat: inner.hat, name: inner.name } : { as: inner.level }
  return canSee(as, outer, src)
}

/** The level's word (§7.10): Public, Members, Hat: Ops. */
export function visibilityWord(v: Visibility): string {
  return v.level === 'public' ? 'Public' : v.level === 'members' ? 'Members' : `Hat: ${v.name}`
}

export function sameVisibility(a: Visibility, b: Visibility): boolean {
  return a.level === b.level && (a.level !== 'hat' || a.hat === (b as { hat: string }).hat)
}
