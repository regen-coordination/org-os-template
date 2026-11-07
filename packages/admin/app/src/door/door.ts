/** The public door's model (spec §12): what the door draws, built from *public* records only (rule 6). The door is
 *  the org's website: L4c draws it from fixtures at `/door`; L9 builds the real one from L8's files and renders
 *  `DoorPage` with this model on the server.
 *
 *  Where L9 fills each field from (Interfaces "L8 produces › For L9"; L9 spec §3.1). Every source is public by
 *  construction; L9 still passes the result through `publicOnly(model, publicRecords)`, with the records it read, and
 *  an entry whose record is not among them goes (fail closed):
 *
 *  | `DoorModel` field   | L8 output (or other public source)                                                     |
 *  |---------------------|----------------------------------------------------------------------------------------|
 *  | `org`               | `federation.yaml` `identity` (name, tagline, phrase, since, description; `mark` its seal) |
 *  | `facts`             | `doorFacts(model)`: computed from `treasury` and `pools` below, never written by hand  |
 *  | `map`               | L5's `publicProjection(repo).resources` and its public `edges`; each node's `href` is the |
 *  |                     | anchor of the section that shows it (`#who`, `#fund`, `#treasury`, `#decisions`)        |
 *  | `hats`              | the public `hats-tree` System's read: names, levels, wearer counts; never a wearer      |
 *  | `pools`, `openNote` | `grant-pools.json` (DAOIP-5) and the pools' public reads; the note from a public open  |
 *  |                     | proposal that attaches a pool                                                          |
 *  | `treasury`          | `contracts.json` (live copy: `org-os.threshold`, `org-os.signers`, the chains); a count of |
 *  |                     | signers, never the owners; `readAt` the Safe's public read                             |
 *  | `decisions`         | `proposals.json` and L8's `PublicDecision`; a restricted one titled "A change to a      |
 *  |                     | restricted collection" (rule 8)                                                        |
 *  | `writing`           | published pages (L9 spec §3.6)                                                         |
 *  | `also`              | the public `link` Systems                                                              |
 *  | `daoUri`            | `dao.json` (`identity.daoURI`); absent without one                                     |
 *  | `membersOrigin`     | the Hub's origin, so Members goes to `<origin>/sign-in`; absent on a door-only site    |
 *
 *  Copy is the org's: `sectionNames` and `leads` rename and rewrite a section; the defaults below are DAO-OS's. */
import type { OrgMark } from '../frame/sections.ts'
import type { MapNodeData } from '../map/HouseNode.tsx'
import type { MapLink } from '../map/layers.ts'
import { FIXTURE_SOURCE, canSee, type VisibilitySource } from '../viewAs/visibility.ts'

export type DoorSectionId = 'who' | 'fund' | 'treasury' | 'decisions' | 'writing'

export interface DoorModel {
  /** The org: its mark and name, the tagline the hero's H1 is (with `phrase`, a part of it, in moss italic), the
   *  year it began, a sentence about it; `kind` leads the eyebrow ("A network society · since 2022"). */
  org: OrgMark & { tagline: string; phrase: string; since: string; description: string; kind?: string }
  /** The hero's facts, figure over label: `doorFacts(model)`. `publicOnly` computes them again from what it keeps. */
  facts: { figure: string; label: string }[]
  /** The DAO map (§8), read at `readAt`: public nodes, each a link to the section that shows it. */
  map: { items: MapNodeData[]; links: MapLink[]; readAt: string }
  /** The hats, flat in the tree's order: name, level (indent), one line ("8 wear it · elected by vote"), and `open`
   *  for a hat nobody wears. Never a wearer. `id` names the record it was read from, for `publicOnly`. */
  hats: { name: string; level: number; line: string; open: boolean; id?: string }[]
  /** Grant pools: `chain` CAIP-2, `balance` the exact decimal (drawn rounded), `unit` the token's symbol. */
  pools: { name: string; chain: string; balance: string; unit: string; purpose: string; address: string; id?: string }[]
  /** One sentence about an open decision touching the pools, and that decision's id. */
  openNote?: { text: string; id: string }
  /** The Safe: any `threshold` of `signers` (a count) move funds; the same `address` on `chains` (CAIP-2). */
  treasury?: { threshold: number; signers: number; address: string; chains: string[]; readAt: string }
  /** The decisions ledger: `route` is who decided and how ("Council · route T3"), `date` ISO. */
  decisions: { id: string; title: string; route: string; date: string; state: 'open' | 'executed' | 'decided' }[]
  writing: { title: string; date: string; href: string; id?: string }[]
  also: { name: string; href: string }[]
  daoUri?: string
  /** The Hub's origin ("" for the same one): Members links to `<origin>/sign-in`. Absent, there is no Members button. */
  membersOrigin?: string | null
  /** The org's names for its sections, over the defaults (§12: "section names may be renamed per org"). */
  sectionNames?: Partial<Record<DoorSectionId, string>>
  /** The org's leads for its sections, over the ones `doorLead` writes from the records. */
  leads?: Partial<Record<DoorSectionId, string>>
}

/** DAO-OS's section names, in the door's order. */
export const DEFAULT_SECTION_NAMES: Readonly<Record<DoorSectionId, string>> = {
  who: 'Who holds what', fund: 'What we fund', treasury: 'Treasury', decisions: 'Decisions', writing: 'Writing',
}
const ORDER: readonly DoorSectionId[] = ['who', 'fund', 'treasury', 'decisions', 'writing']

/** Is there public content for a section? A section without any is absent. */
function present(model: DoorModel, id: DoorSectionId): boolean {
  switch (id) {
    case 'who': return model.hats.length > 0
    case 'fund': return model.pools.length > 0
    case 'treasury': return model.treasury !== undefined
    case 'decisions': return model.decisions.length > 0
    case 'writing': return model.writing.length > 0
  }
}

/** The sections the door draws, in order, each only if it has public content, numbered 01, 02… without gaps; named by
 *  the org where it renamed them, else by DAO-OS's defaults. */
export function doorSections(model: DoorModel): { no: string; id: DoorSectionId; name: string }[] {
  return ORDER.filter(id => present(model, id)).map((id, i) => ({
    no: String(i + 1).padStart(2, '0'), id, name: model.sectionNames?.[id]?.trim() || DEFAULT_SECTION_NAMES[id],
  }))
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** The hero's facts (§12.2), each computed from the model: who moves funds (the treasury's threshold of its signers),
 *  how many chains the one treasury is on, how many grant pools are public. A fact whose source is absent is left
 *  out; none is ever "0". */
export function doorFacts(model: DoorModel): { figure: string; label: string }[] {
  const out: { figure: string; label: string }[] = []
  const t = model.treasury
  if (t && t.signers > 0 && t.threshold > 0) out.push({ figure: `${t.threshold} of ${t.signers}`, label: 'signers move funds' })
  if (t && t.chains.length > 0) out.push({ figure: String(t.chains.length), label: `${plural(t.chains.length, 'chain', 'chains')}, one treasury` })
  if (model.pools.length > 0) out.push({ figure: String(model.pools.length), label: plural(model.pools.length, 'grant pool', 'grant pools') })
  return out
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n)

/** A section's lead, in Fraunces under its name: the org's own when it wrote one, else a sentence written from the
 *  records, true of what the section shows and nothing more. */
export function doorLead(model: DoorModel, id: DoorSectionId): string {
  const own = model.leads?.[id]?.trim()
  if (own) return own
  switch (id) {
    case 'who': return 'Roles are hats in one tree. Whoever wears a hat holds its role; the list names the hats, never the people who wear them.'
    case 'fund': {
      const n = model.pools.length
      return `${countWord(n)} grant ${plural(n, 'pool', 'pools')}, each with what it funds and the address its funds are held at.`
    }
    case 'treasury': {
      const t = model.treasury!
      const where = t.chains.length > 1 ? 'One Safe, the same address on every chain the DAO uses.' : 'One Safe holds the DAO’s funds.'
      return t.threshold > 1 ? `${where} No single person can move its funds.` : where
    }
    case 'decisions': return 'Every decision is recorded with its route and outcome, and published with the rest of the DAO’s records.'
    case 'writing': return 'What the DAO has published, newest first.'
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A door date, "28 Sep 2026" (C-28, with its year: the door is read long after); the text as given when it is not
 *  a date. Read as a calendar day, the same on the server and in any time zone. */
export function doorDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso
}

const PUBLIC = { as: 'public' } as const

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object'

/** May the public see it? The one reader decides (`source.visibilityOf`, CC-14): `facts.visibility` for the fixtures;
 *  L5's source reads the item's own `visibility` first. Unknown is members (L4-R7), so unknown is not public. */
const isPublic = (thing: unknown, source: VisibilitySource) => canSee(PUBLIC, source.visibilityOf(thing), source)

/** A map node's item laid over its record: whatever mark the item carries (its own `visibility`, its `facts`') takes
 *  the record's place; an item with no mark leaves the record's. Read through the same source, this is the node's
 *  own say; the record's is the other. */
function overlay(record: unknown, item: unknown): unknown {
  if (!isObject(record) || !isObject(item)) return record
  const facts = isObject(record.facts) || isObject(item.facts) ? { ...(isObject(record.facts) ? record.facts : {}), ...(isObject(item.facts) ? item.facts : {}) } : undefined
  return { ...record, ...item, ...(facts ? { facts } : {}) }
}

/** Drops everything not public (rule 6) from a door model. It fails closed: `raw` are the records the model was read
 *  from, and an entry that names a record (its `id`; a map node by its item's id; the open-decisions note by its
 *  decision's) is kept only when `raw` holds that record and the record is public. An id that `raw` does not hold is
 *  unknown visibility, so the entry goes. A map node is judged twice, by its record and by any mark it carries
 *  itself, and the stricter wins: it stays only when both say public. Entries with no `id` are not records — hats and
 *  signer counts read from the chain, a published page listed without one — and are kept as given. Then the map loses
 *  every link that touches a dropped node, the note goes with its decision, and the facts are computed again from
 *  what is left, so no count says that something was dropped. L9 passes the public records it built the model from. */
export function publicOnly(model: DoorModel, raw: unknown[], source: VisibilitySource = FIXTURE_SOURCE): DoorModel {
  const records = new Map<string, unknown>()
  for (const r of raw) if (isObject(r) && typeof r.id === 'string') records.set(r.id, r)
  const keeps = (id: string | undefined): boolean => {
    if (id === undefined) return true // not a record
    return records.has(id) && isPublic(records.get(id), source)
  }
  const keepsNode = (d: MapNodeData): boolean => keeps(d.item.id) && isPublic(overlay(records.get(d.item.id), d.item), source)

  const items = model.map.items.filter(keepsNode)
  const shown = new Set(items.map(d => d.item.id))
  const decisions = model.decisions.filter(d => keeps(d.id))
  const kept = new Set(decisions.map(d => d.id))
  const known = new Set(model.decisions.map(d => d.id))
  const note = model.openNote
  const noteKept = note !== undefined && keeps(note.id) && (!known.has(note.id) || kept.has(note.id))

  const out: DoorModel = {
    ...model,
    map: { ...model.map, items, links: model.map.links.filter(k => shown.has(k.from) && shown.has(k.to)) },
    hats: model.hats.filter(h => keeps(h.id)),
    pools: model.pools.filter(p => keeps(p.id)),
    decisions,
    writing: model.writing.filter(w => keeps(w.id)),
  }
  if (!noteKept) delete out.openNote
  out.facts = doorFacts(out)
  return out
}
