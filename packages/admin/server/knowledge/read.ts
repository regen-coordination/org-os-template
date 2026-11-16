/** Reading the canon: the one place a request meets kms. Everything it answers is derived from kms's own functions —
 *  the adapter's list, `selectPublic`, `buildCommons`, `readReads`, `readManifest` — so the app can never show
 *  something `publish` would not (spec §4.1, K-7). Reads only: nothing here writes a file (that is `write.ts`, T3). */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { HttpError } from '../errors.ts'
import { kms, kmsPresence } from './kms.ts'
import { checksOf, daysSince, fieldRows, groupLanes, laneCounts, laneOf, provenanceOf, readState, refRow } from './model.ts'
import type { CanonFile, CanonRow, EntryView, FieldRow, KindRow, KnowledgeView, Lane, Mark, PeerRow, PublicFace, RefRow, RunRow } from './types.ts'

const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v
    : typeof v === 'number' ? String(v)
      : v instanceof Date ? v.toISOString().slice(0, 10)
        : null

/** The empty answer: this repository has no commons. One sentence, and nothing else invented. */
export function unconfigured(reason: string): KnowledgeView {
  return {
    configured: false, reason, instance: null, did: null, sentence: null,
    counts: { entries: 0, kinds: 0, sources: 0, peers: 0, published: 0, awaiting: 0, internal: 0, draft: 0 },
    lanes: [], kinds: [], peers: [], runs: [], files: [],
    rule: { module: null, sentence: 'There is no canon here, so nothing decides and nothing is published.' },
    plane: { dir: 'public', pages: false, static: true, atproto: false, lastRun: null },
  }
}

/** The entry's id as L6 names it: `<type>/<slug>` (§7.5). */
export const recordId = (schema: string, slug: string): string => `${schema}/${slug}`

/** Everything one request needs from the canon, read once. */
interface CanonRead {
  config: any
  target: string
  all: any[]
  items: any[]
  rejected: { slug: string; reason: string }[]
  gateRan: boolean
  gateError: string | null
  reads: Record<string, any>
  manifest: any
  knowledge: any
  preview: any
  published: any
  now: string
}

async function readCanon(repo: string, now: string): Promise<CanonRead> {
  const loaded = await kms(repo)
  if (!loaded.ok) throw new NotConfigured(loaded.reason)
  const k = loaded.kms
  let config: any
  try {
    config = k.loadKmsConfig(repo)
  } catch (err) {
    throw new NotConfigured(`the canon's kms.yaml cannot be read: ${err instanceof Error ? err.message : String(err)}`)
  }
  const target = join(repo, String(config.target ?? '.'))
  const adapter = k.getAdapter(config.adapter)
  const all = adapter.list(target) as any[]

  // The gate: kms's floor, then the instance's own rule. A gate module that throws is reported, not hidden: a steward
  // whose rule is broken must see that nothing is selected because of it.
  let items: any[] = []
  let rejected: { slug: string; reason: string }[] = []
  let gateRan = false
  let gateError: string | null = null
  try {
    const sel = await k.selectPublic({ dir: repo, config, all })
    items = sel.candidates ?? []
    rejected = (sel.rejected ?? []).map((r: any) => ({ slug: String(r.slug), reason: String(r.reason) }))
    gateRan = sel.gated === true
  } catch (err) {
    gateError = err instanceof Error ? err.message : String(err)
    // Without a working gate nothing may be called published: the floor alone is *not* the answer here.
    items = []
  }

  // Ids are minted in memory only — the preview never writes to the canon (kms's own `writePreview` does the same).
  const withId = new Map(items.map((i: any) => [i.ref, i]))
  const allItems = all.map((i: any) => withId.get(i.ref) ?? i)
  let reads: Record<string, any> = {}
  try { reads = k.readReads(repo) } catch { reads = {} }
  const manifest = k.readManifest(repo)
  const knowledge = readKnowledgeManifest(repo)
  const base = { items, allItems, manifest, config, knowledge, reads, now }
  return {
    config, target, all, items, rejected, gateRan, gateError, reads, manifest, knowledge,
    preview: k.buildCommons({ ...base, mode: 'preview' }),
    published: k.buildCommons({ ...base, mode: 'public' }),
    now,
  }
}

/** `.well-known/knowledge.json`, which kms writes and the pages describe themselves from. Absent: null. */
function readKnowledgeManifest(repo: string): unknown {
  const path = join(repo, '.well-known', 'knowledge.json')
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

/** Thrown when this repository has no canon: the routes turn it into `configured: false` and one sentence. */
export class NotConfigured extends Error {}

/* ─────────────────────────────────────────────────── the collection ─────────────────────────────────────────── */

/** Whether the gate's selection holds this canon item: by its ref, which names the file and the entry. */
const isSelected = (c: { items: any[] }, it: any): boolean => c.items.some((i: any) => i.ref === it.ref)

/** One canon object as a row: the lane, the reason, the mark, the dates. */
function rowOf(it: any, c: CanonRead, k: Awaited<ReturnType<typeof kms>> & { ok: true }): CanonRow {
  const o = asObject(it.object)
  const schema = String(it.schema)
  const slug = k.kms.slugFromRef(it.ref)
  const types = k.kms.publishableTypes(c.config)
  const publishable = k.kms.isPublishable(o, { schema, types })
  // By the entry's ref, never its slug: a slug is unique within a kind only, and a namesake in another kind must not
  // borrow a published entry's lane (review fix). The gate's reasons carry a slug, so they are read only for an entry
  // the floor passed and the selection does not hold — the entries the gate can have rejected.
  const selected = isSelected(c, it)
  const facts = {
    publicUse: str(o.public_use), maturity: str(o.maturity),
    awaiting: k.kms.isAwaitingReview(o),
    aiAssisted: o.ai_assisted === true,
    publishable,
    selected,
    rejected: publishable && !selected ? c.rejected.find(r => r.slug === slug)?.reason ?? null : null,
    optedIn: types.includes(schema),
  }
  const { lane, why } = laneOf(facts)
  const previewEntry = c.preview.entries.find((e: any) => e.slug === slug && e.schema === schema)
  const publicEntry = c.published.entries.find((e: any) => e.slug === slug && e.schema === schema)
  const updated = str(o.updated) ?? str(o.last_reviewed)
  const mark = k.kms.maturityMark(facts.maturity ?? '') as Mark | null
  const origin = previewEntry?.origin ?? null
  // The commons' record only for an entry the commons publishes: the manifest can still name one an earlier run minted
  // for an entry that is internal now (walk M8), and the preview would carry it.
  const atUri = publicEntry && !publicEntry.origin ? publicEntry.atUri ?? null : null
  return {
    type: schema, slug, id: recordId(schema, slug), title: str(o.title) ?? slug,
    lane, why, mark: mark ?? null, maturity: facts.maturity, publicUse: facts.publicUse,
    updated, updatedDays: daysSince(updated, c.now),
    summary: String(previewEntry?.summary ?? ''),
    // "Internal only" is a decision (the lane), not kms's word for "not in the selection": an entry awaiting review
    // is out of the selection too, and calling it internal would be wrong on the row.
    internal: lane === 'internal',
    awaiting: facts.awaiting,
    peer: origin?.peer ?? null,
    readAge: origin?.readAge ?? null,
    readFailed: Boolean(origin?.failed),
    deprecated: previewEntry?.deprecated ? (previewEntry.deprecated.byTitle ?? 'deprecated') : null,
    pageHref: publicEntry && !publicEntry.origin ? publicEntry.href : null,
    apiHref: publicEntry && !publicEntry.origin ? publicEntry.apiHref : null,
    atUri,
  }
}

/** The kinds, with the glyph kms gives each (KI §4-7). */
function kindsOf(c: CanonRead, k: { glyphFor: (s: string) => string; kindLabel: (s: string) => string }): KindRow[] {
  const count = new Map<string, number>()
  for (const it of c.all) count.set(String(it.schema), (count.get(String(it.schema)) ?? 0) + 1)
  return [...count].map(([schema, n]) => ({ schema, label: k.kindLabel(schema), glyph: k.glyphFor(schema), count: n }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** The peers and connectors a steward watches, with their read states (spec §4.5). */
export function peerRows(c: { config: any; reads: Record<string, any>; now: string }): PeerRow[] {
  const rows: PeerRow[] = []
  const connectors = Array.isArray(c.config.connectors) ? c.config.connectors : []
  for (const decl of connectors) {
    const name = str(asObject(decl).name)
    if (!name) continue
    const read = readState(c.reads[name], c.now)
    const peers = (asObject(asObject(decl).config).peers as unknown[]) ?? []
    const names = peers.map(p => str(p)).filter(Boolean)
    rows.push({
      id: `connector:${name}`, name, relation: 'connector',
      detail: names.length ? `${names.join(', ')}` : `no peer named in its config`,
      ...read,
    })
  }
  const peers = asObject(c.config.peers)
  for (const [slug, ref] of Object.entries(peers)) {
    const read = readState(c.reads[slug] ?? c.reads[String(ref)], c.now)
    rows.push({ id: `peer:${slug}`, name: slug, relation: 'knowledge peer', detail: String(ref), ...read })
  }
  return rows
}

/** The canon's own files, as a steward would walk them. Reads only; the state is what a file says about itself. */
export function canonFiles(repo: string, c: { config: any; reads: Record<string, any>; now: string; manifest: any }): CanonFile[] {
  const out: CanonFile[] = []
  const ago = (path: string): string => {
    try { return `${daysSince(statSync(join(repo, path)).mtime.toISOString(), c.now) ?? 0} d ago` } catch { return 'not here' }
  }
  const exists = (path: string) => existsSync(join(repo, path))
  out.push({ path: 'kms.yaml', what: `adapter ${str(c.config.adapter) ?? '—'} · target ${str(c.config.target) ?? '.'}`, state: exists('kms.yaml') ? `edited ${ago('kms.yaml')}` : 'not here' })
  const kbDir = join(repo, 'data', 'kb')
  const files = existsSync(kbDir) ? readdirSync(kbDir).filter(f => f.endsWith('.yaml')) : []
  out.push({ path: 'data/kb/', what: `${files.length} ${files.length === 1 ? 'file' : 'files'}`, state: files.length ? `edited ${ago('data/kb')}` : 'nothing in the canon yet' })
  const failures = Object.values(c.reads).filter(r => asObject(r).error).length
  out.push({ path: 'data/kms-reads.json', what: failures ? `${failures} ${failures === 1 ? 'failure' : 'failures'} recorded` : 'no failure recorded', state: exists('data/kms-reads.json') ? `written ${ago('data/kms-reads.json')}` : 'no read yet' })
  out.push({ path: 'data/kms-cursors.json', what: 'where each connector reads next', state: exists('data/kms-cursors.json') ? `written ${ago('data/kms-cursors.json')}` : 'no ingest yet' })
  const plane = publicPlane(repo, c.config).dir
  out.push({ path: `${plane}/`, what: 'the public plane — written by a run, never here', state: exists(`${plane}/.well-known/knowledge.json`) ? `written ${ago(`${plane}/.well-known/knowledge.json`)}` : 'not written yet' })
  return out
}

/** Where the public plane is written, and the kms.yaml that says how. An instance with no planes publishes itself: its
 *  own `publish.static_dir`. A canon publishes nothing itself (kms `planes/role.mjs`): its plane is the instance it names
 *  in `planes.public`, at `planes.public.dir` or `repos/<instance>` (kms `planes/paths.mjs`), and that plane's own
 *  kms.yaml decides its static dir, its pages and its identity. `dir` is relative to the canon. */
export function publicPlane(repo: string, config: any): { dir: string; config: any } {
  const own = asObject(config?.planes).public
  const instance = str(asObject(own).instance)
  if (instance === null) return { dir: str(asObject(config?.publish).static_dir) ?? 'public', config }
  const root = str(asObject(own).dir) ?? `repos/${instance}`
  let planeConfig: any = {}
  try { planeConfig = asObject(parse(readFileSync(join(repo, root, 'kms.yaml'), 'utf8'))) } catch { planeConfig = {} }
  return { dir: `${root.replace(/\/+$/, '')}/${str(asObject(planeConfig.publish).static_dir) ?? 'public'}`, config: planeConfig }
}

/** The collection: lanes, counts, kinds, peers, files, and what decides. `runs` comes from the app's own job records. */
export async function readKnowledge(repo: string, opts: { now?: string; runs?: RunRow[] } = {}): Promise<KnowledgeView> {
  const now = opts.now ?? new Date().toISOString()
  if (!kmsPresence(repo).ok) return unconfigured((kmsPresence(repo) as { reason: string }).reason)
  let c: CanonRead
  try { c = await readCanon(repo, now) } catch (err) {
    if (err instanceof NotConfigured) return unconfigured(err.message)
    throw err
  }
  const loaded = await kms(repo)
  if (!loaded.ok) return unconfigured(loaded.reason)
  const k = loaded.kms
  const rows = c.all.map(it => rowOf(it, c, loaded as { ok: true; kms: typeof k }))
  const lanes: Lane[] = groupLanes(rows)
  const counts = laneCounts(lanes)
  const kinds = kindsOf(c, k)
  const peers = peerRows(c)
  const gate = str(asObject(c.config.publish).gate)
  const sources = Array.isArray(c.knowledge?.sources) ? c.knowledge.sources.length : kinds.find(x => x.schema === 'source-system')?.count ?? 0
  return {
    configured: true, reason: null,
    instance: str(c.config.instance), did: str(asObject(c.config.atproto).did) ?? str(asObject(c.knowledge).did),
    sentence: str(asObject(c.knowledge).description) ?? str(asObject(c.knowledge).about),
    counts: { entries: rows.length, kinds: kinds.length, sources, peers: peers.length, ...counts },
    lanes, kinds, peers,
    runs: opts.runs ?? [],
    files: canonFiles(repo, c),
    rule: {
      module: gate,
      sentence: c.gateError
        ? `Your rule could not be read (${c.gateError}), so nothing is selected: fix publish.gate in kms.yaml.`
        : gate
          ? `Your rule decides what is: ${gate}. The floor decides what may be; the rule can only narrow it.`
          : 'Your rule decides nothing here: publish.gate is unset, so the floor decides what may be public, and a run writes it.',
    },
    plane: planeView(repo, c.config, now),
  }
}

/** The plate's public plane: where it is written, what it writes, and when it was last written. */
function planeView(repo: string, config: any, now: string): KnowledgeView['plane'] {
  const plane = publicPlane(repo, config)
  const publish = asObject(plane.config.publish)
  const atproto = asObject(plane.config.atproto)
  const manifest = join(repo, plane.dir, '.well-known', 'knowledge.json')
  return {
    dir: plane.dir,
    pages: publish.pages === true,
    static: publish.static !== false,
    atproto: Boolean(str(atproto.did) && str(atproto.pds) && str(atproto.nsid_authority)),
    lastRun: existsSync(manifest) ? `${daysSince(statSync(manifest).mtime.toISOString(), now) ?? 0} d ago` : null,
  }
}

/* ─────────────────────────────────────────────────── one entry ─────────────────────────────────────────────── */

/** The header fields the record shows above the body, in the order the page reads them (spec §4.2). */
const HEADER_FIELDS = ['title', 'page_type', 'maturity', 'public_use', 'currentness', 'audience', 'steward', 'updated'] as const

/** One entry, with its checks, references, provenance, the paths it goes to, and its public face. */
export async function readEntry(repo: string, type: string, slug: string, opts: { now?: string } = {}): Promise<EntryView> {
  const now = opts.now ?? new Date().toISOString()
  const loaded = await kms(repo)
  if (!loaded.ok) throw new HttpError(404, loaded.reason)
  const k = loaded.kms
  let c: CanonRead
  try { c = await readCanon(repo, now) } catch (err) {
    if (err instanceof NotConfigured) throw new HttpError(404, err.message)
    throw err
  }
  const it = c.all.find((i: any) => String(i.schema) === type && k.slugFromRef(i.ref) === slug)
  if (!it) throw new HttpError(404, `No entry ${type}/${slug} in this canon. The collection lists every entry it holds.`)
  const row = rowOf(it, c, loaded as { ok: true; kms: typeof k })
  const o = asObject(it.object)
  const previewEntry = c.preview.entries.find((e: any) => e.slug === slug && e.schema === type)
  const publicEntry = c.published.entries.find((e: any) => e.slug === slug && e.schema === type) ?? null

  // Schema validity, split into the two checks that read it: a missing required field is its own row.
  let schemaErrors: string[] = []
  try {
    const v = k.validateObject(type, o)
    schemaErrors = Array.isArray(v?.errors) ? v.errors : []
  } catch { schemaErrors = [] }
  const missing = schemaErrors.filter(e => e.startsWith('missing required field:')).map(e => e.slice('missing required field: '.length))
  const otherErrors = schemaErrors.filter(e => !e.startsWith('missing required field:'))

  const related: any[] = Array.isArray(previewEntry?.related) ? previewEntry.related : []
  const broken: any[] = Array.isArray(previewEntry?.broken) ? previewEntry.broken : []
  const references: RefRow[] = [
    ...related.map(r => refRow({ ...r, internal: r.internal === true })),
    ...broken.map(b => refRow({ slug: b.slug, title: b.slug, kindLabel: 'No entry', glyphType: 'link', href: null, peer: null, mark: null, broken: true })),
  ]

  const types = k.publishableTypes(c.config)
  const selected = isSelected(c, it)
  const publishable = k.isPublishable(o, { schema: type, types })
  const rejected = publishable && !selected ? c.rejected.find(r => r.slug === slug)?.reason ?? null : null
  const checks = checksOf({
    validating: { ok: otherErrors.length === 0, errors: otherErrors },
    requiredFields: { missing },
    references: { resolved: related.length, total: related.length + broken.length },
    publicUse: str(o.public_use),
    publishable,
    selected,
    rejected,
    id: row.atUri ? recordId(type, slug) : null,
    atUri: row.atUri,
    gated: c.gateRan,
    optedIn: types.includes(type),
  })

  const labels = Object.fromEntries(HEADER_FIELDS.map(f => [f, k.labelFor(f, { config: c.config })]))
  const fields = fieldRows(
    HEADER_FIELDS.map(f => [f, str(o[f]) ?? ''] as [string, string]).filter(([, v]) => v !== ''),
    labels,
  )
  const extra: FieldRow[] = (previewEntry?.extra ?? []).map((x: any) => ({ field: String(x.label).toLowerCase(), label: String(x.label), value: String(x.value), kind: 'text' }))

  const file = join('data', 'kb', `${type}.yaml`)
  const publicFace: PublicFace = publicEntry
    ? {
        published: true, title: String(publicEntry.title), lead: String(publicEntry.lead ?? ''),
        body: publicEntry.body ?? [], related: (publicEntry.related ?? []).map((r: any) => refRow(r)),
        about: publicEntry.about ?? [], atUri: publicEntry.atUri ?? null, cite: publicEntry.cite ?? null, reason: null,
      }
    // Not in the commons: no face at all — only the title, and why. The preview's words are the Record face's; under
    // the "this is what the commons shows" band (and in View as Public) they would be a face the world never sees.
    : {
        published: false, title: row.title, lead: '', body: [],
        related: [], about: [], atUri: null, cite: null,
        reason: row.why === 'public use: internal only'
          ? 'This entry is internal: the commons will not show it, and references to it are dropped.'
          : `This entry is not in the commons yet (${row.why}). A run publishes it once its public use and your rule allow it.`,
      }

  return {
    row, checks,
    fields: [...fields, ...extra],
    body: previewEntry?.body ?? [],
    references,
    provenance: provenanceOf(o, k.privateFields),
    goes: [
      { label: 'page', value: row.pageHref ? `${str(asObject(c.config.publish).static_dir) ?? 'public'}/${row.pageHref}` : 'not published' },
      { label: 'API', value: row.apiHref ? `${str(asObject(c.config.publish).static_dir) ?? 'public'}/${row.apiHref}` : 'not published' },
      { label: 'AT Proto', value: row.atUri ?? 'not published' },
      { label: 'standard.site', value: asObject(asObject(c.config.atproto).standard_site).enabled === true ? 'on' : 'off — this instance writes JSON and pages only' },
    ],
    publicFace,
    file,
    base: '',
  }
}
