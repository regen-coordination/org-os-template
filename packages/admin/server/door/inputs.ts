// packages/admin/server/door/inputs.ts
//
// What the public door is built from (DAO-OS L9 spec §3.2), and the secrets its scan refuses (§3.4). Three things are
// read for content and nothing else: L8's public projection with the live standards, L5's public projection with the
// graph's public edges, and the renderer's own assets (Task 16). Beside them, for the scan only: L8's withheld strings,
// every string the private store holds, and every actor account the ledger records, the public strings taken out.
// Tasks 14 (releases, the publisher) and 15 (`doorModel`) consume `DoorInput` as it is: its fields are plain data.
import type { SystemReader } from '../systems/reader.ts'
import type { DriverRead } from '../systems/driver.ts'
import type { Graph } from '../resources/types.ts'
import type { PrivateStore } from '../private/store.ts'
import { readLedger } from '../proposals/ledger.ts'
import { resolveRev } from '../git.ts'
import { publicProjection, type PublicProjection } from '../visibility/gate.ts'
import { readsFor } from '../standards/reads.ts'
import { serverYaml } from '../standards/routes.ts'
import { loadStandardsInput } from '../../lib/standards/load.mjs'
import { buildStandards } from '../../lib/standards/index.mjs'
import { projectPublic, RESTRICTED_TITLE, VOCABULARY, type PublicInput, type Problem, type StandardsInput } from '../../lib/standards/project.mjs'
import { contractIdsOf } from '../../lib/standards/ids.mjs'
import { parseCaip10 } from '../../lib/caip.mjs'

/** L9 spec §10, "door, store unreadable" (§3.4 point 4): a configured store that cannot be read stops the build. */
export const DOOR_STORE_UNREADABLE =
  'The public door was not built: the private store could not be read, so the check for what must not be published is incomplete.'

/** The leak scan's floor (L8-C15): shorter strings are not secrets. */
const MIN_SECRET = 6

/** One System's last good read, as the door shows it (L9 spec §3.2): `ok` false is a failed read that kept an earlier
 *  good one, whose facts and `readAt` it carries ("balances read 3 h ago"). A System never read successfully has no
 *  entry: its section is left out, never shown as "0". */
export interface DoorRead {
  /** The System's id. */
  system: string
  /** When the facts were read (ISO 8601). */
  readAt: string
  /** Whether the latest read succeeded. */
  ok: boolean
  /** The read itself, as L8's projection kept it: a public System's, all of whose fields are public (C1). */
  read: DriverRead
}

/** Everything the door is built and scanned from. Plain data: nothing here reads anything again. */
export interface DoorInput {
  /** L8's public projection of the live input (identity, members, Systems, their public reads, proposals, decisions,
   *  governance, extras). */
  pub: PublicInput
  /** The live copy of the standards (`buildStandards(...).files`, with the reads): the door's `.well-known`. Empty
   *  when L8 refused (then `problems` holds an error). */
  standards: Record<string, unknown>
  /** The git copy of the standards (no reads), as `generate:schemas` would write them: Task 14's `publicDigest` reads
   *  it, so a System's new read alone does not rebuild the door. */
  gitStandards: Record<string, unknown>
  /** The Systems read, each with the time it was read, sorted by System id; a System never read is absent. */
  reads: DoorRead[]
  /** The loader's and the live build's problems. Any `level: 'error'` refuses the release (§3.4 point 1). */
  problems: Problem[]
  /** L5's public projection, with the graph's public edges (§3.2). */
  projection: PublicProjection
  /** What the scan refuses to find (§3.4 point 2): L8's withheld strings, the private store's strings and the ledger's
   *  actor accounts (with their bare addresses), every string that is also public taken out. */
  secrets: Set<string>
  /** Whether the private store's strings are in `secrets` ('read') or there is no store ('none'); the manifest says so. */
  store: 'read' | 'none'
  /** The commit the door is built from. */
  commit: string
  now: Date
  /** The door's own origin (`https://<door host>`); null when none is configured (the door is built, not served). The
   *  standards' `urls.proposal` is `<doorOrigin>/#decisions` until per-record pages exist (Q-L9-12). */
  doorOrigin: string | null
}

export interface DoorDeps {
  /** The System reader (its cache, its pacing): the live copy's reads. */
  reader: SystemReader
  /** The open private store; null when none is open. */
  store: PrivateStore | null
  /** Whether a private store is configured: a configured store that is null or cannot be read refuses (§3.4 point 4). */
  storeConfigured: boolean
  now?: Date
  /** The door's origin (HostedConfig's door origin, or none). */
  doorOrigin?: string | null
  /** The resources graph (the server's, when it asks); the default reads the repository's own. */
  graph?: () => Promise<Graph>
}

/** Every string of a value, nested, object keys left out. */
function eachString(value: unknown, take: (s: string) => void): void {
  if (typeof value === 'string') take(value)
  else if (Array.isArray(value)) for (const v of value) eachString(v, take)
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) eachString(v, take)
}

/** Every string the private store holds, of 6 characters or more (§3.4 point 2), read through its read-only
 *  connection. Throws when the store cannot be read. */
export function storeStrings(store: PrivateStore): Set<string> {
  return new Set([...store.allStrings()].filter(s => s.length >= MIN_SECRET))
}

/** Every actor account the ledger records (§3.4 point 2): `by` when it is CAIP-10, the account of `opened_as`, of each
 *  event's `as` and of `closed.as`, every `wearers` entry, and each `closed.checked` row's account. Each as written,
 *  and, when it parses, in CAIP-10's one form and as its bare address, so a page that prints the address without its
 *  chain is found too. A member id is no account. A ledger that cannot be read gives none (the public projection,
 *  which reads it too, fails then). */
export function ledgerAccounts(repo: string): Set<string> {
  const out = new Set<string>()
  const add = (v: unknown) => {
    if (typeof v !== 'string' || v === '') return
    out.add(v)
    const p = parseCaip10(v)
    if (p) { out.add(`${p.chain}:${p.address}`); out.add(p.address) }
  }
  const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
  const reading = (v: unknown) => {
    const r = obj(v)
    if (!r) return
    add(r.account)
    if (Array.isArray(r.wearers)) r.wearers.forEach(add)
  }
  for (const entry of readLedger(repo).entries as unknown[]) {
    const p = obj(entry)
    if (!p) continue
    if (parseCaip10(p.author)) add(p.author)
    reading(p.opened_as)
    for (const e of Array.isArray(p.events) ? p.events : []) {
      const ev = obj(e)
      if (!ev) continue
      if (parseCaip10(ev.by)) add(ev.by)
      reading(ev.as)
    }
    const closed = obj(p.closed)
    if (closed) {
      if (parseCaip10(closed.by)) add(closed.by)
      reading(closed.as)
      for (const row of Array.isArray(closed.checked) ? closed.checked : []) add(obj(row)?.account)
    }
  }
  return out
}

/** An ISO-8601 date, or date and time: builders write dates of their own (L8's R20). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/
const VOCABULARY_LOWER = new Set(VOCABULARY.map(w => w.toLowerCase()))

/** Every string, and object key, of a value, lower-cased and joined (NUL between): what `includes` reads as shown. */
function shownText(value: unknown): string {
  const parts: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') parts.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { parts.push(k); walk(x) }
  }
  walk(value)
  return parts.join('\u0000').toLowerCase()
}

/** What L8's `subtract` reads as shown: the projection, the contract ids built from public Systems, the kept reads'
 *  facts and open. */
const l8Shown = (pub: PublicInput) => shownText([
  RESTRICTED_TITLE, ...pub.systems.flatMap(s => contractIdsOf(s).map(c => c.id)),
  { ...pub, reads: {}, members: pub.members.map(({ id, record }) => ({ id, record })) },
  Object.values(pub.reads).map(r => [r?.facts, r?.open]),
])

/** An address, alone or in an account: only what L8 publishes clears it (a public System's contract, a public
 *  member's own record). L5's public projection does not: its proposals' events keep a CAIP-10 `by`, and the door
 *  never names an actor (§3.4 point 2). */
const ADDRESS = /0x[0-9a-f]{40}/i

/** The candidates (6+ characters) that are no public string, date or builder's word; one per spelling, any case.
 *  `shown`: L8's public side; `alsoShown`: L5's public projection, which clears any candidate but an address. */
function withoutPublic(candidates: Iterable<string>, shown: string, alsoShown: string, already: Set<string>): string[] {
  const out: string[] = []
  for (const s of candidates) {
    const lower = s.toLowerCase()
    if (s.length < MIN_SECRET || already.has(lower) || ISO_DATE.test(s) || VOCABULARY_LOWER.has(lower) || shown.includes(lower)) continue
    if (!ADDRESS.test(s) && alsoShown.includes(lower)) continue
    already.add(lower)
    out.push(s)
  }
  return out
}

/** `https://host[:port]`, from a configured origin; null when there is none or it is not an http(s) URL. */
function originOf(o: string | null | undefined): string | null {
  if (!o) return null
  try {
    const u = new URL(o)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch { return null }
}

/**
 * The door's inputs (L9 spec §3.2, §3.4). Refuses, with the sentence to show, when the private store is configured but
 * cannot be read (§3.4 point 4), when nothing public can be built (no daoURI), or when the repository has no commit.
 * Standards errors are not refused here: they are in `problems`, and the release refuses on them (Task 14).
 */
export async function collectDoorInput(repo: string, deps: DoorDeps): Promise<DoorInput | { refuse: string }> {
  const now = deps.now ?? new Date()
  const doorOrigin = originOf(deps.doorOrigin)

  // The store first: a scan that cannot be complete is not begun.
  let fromStore: Set<string> = new Set()
  let store: DoorInput['store'] = 'none'
  if (deps.store) {
    try { fromStore = storeStrings(deps.store) } catch { return { refuse: DOOR_STORE_UNREADABLE } }
    store = 'read'
  } else if (deps.storeConfigured) {
    return { refuse: DOOR_STORE_UNREADABLE }
  }

  const { input: loaded, problems: loadProblems } = loadStandardsInput(repo, { parseYaml: serverYaml })
  if (!loaded) {
    const why = loadProblems.map(p => `${p.file}: ${p.text}`).join('; ') || 'identity.daoURI is not set'
    return { refuse: `The public door was not built: ${why}.` }
  }
  const commit = await resolveRev(repo, 'HEAD')
  if (!commit) return { refuse: 'The public door was not built: the repository has no commit to build it from.' }

  const urls: StandardsInput['urls'] = doorOrigin ? { proposal: () => `${doorOrigin}/#decisions` } : undefined
  const live: StandardsInput = { ...loaded, reads: await readsFor(deps.reader, loaded), ...(urls ? { urls } : {}) }
  const built = buildStandards(live)
  const gitBuilt = buildStandards({ ...loaded, reads: null, ...(urls ? { urls } : {}) })
  const { pub, secrets: withheld } = projectPublic(live)
  const projection = await publicProjection(repo, { now, ...(deps.graph ? { graph: deps.graph } : {}) })

  const reads: DoorRead[] = Object.entries(pub.reads)
    .filter((e): e is [string, DriverRead] => typeof e[1]?.readAt === 'string' && e[1].readAt !== '')
    .map(([system, read]) => ({ system, readAt: read.readAt as string, ok: read.ok === true, read }))
    .sort((a, b) => (a.system < b.system ? -1 : a.system > b.system ? 1 : 0))

  // L8's set stands as L8 subtracted it. What L9 adds is subtracted the same way against L8's public side, and against
  // L5's public projection too unless it is an address (`withoutPublic`).
  const secrets = new Set<string>(withheld)
  const seen = new Set([...withheld].map(s => s.toLowerCase()))
  for (const s of withoutPublic([...fromStore, ...ledgerAccounts(repo)], l8Shown(pub), shownText(projection), seen)) secrets.add(s)

  return {
    pub, standards: built.files, gitStandards: gitBuilt.files, reads,
    problems: [...loadProblems, ...built.problems],
    projection, secrets, store, commit, now, doorOrigin,
  }
}
