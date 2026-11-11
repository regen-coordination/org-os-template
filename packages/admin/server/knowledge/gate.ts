/** The gate, read-only: what the commons will show for one entry, what a dry run of the selection finds, and the
 *  publication a run would make. Nothing here writes a file — the tests take a snapshot of the instance before and
 *  after every call (spec §4.3, §4.4, K-1: the app plans, the CLI writes). */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HttpError } from '../errors.ts'
import { kms } from './kms.ts'
import { readKnowledge } from './read.ts'
import type { DryRead, PublishPlan, PublicFace, RefRow } from './types.ts'

const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : typeof v === 'number' ? String(v) : null)

/** A kms instance's facts, read once, for the three read-only answers below. */
async function inputs(repo: string, now: string) {
  const loaded = await kms(repo)
  if (!loaded.ok) throw new HttpError(404, loaded.reason)
  const k = loaded.kms
  let config: any
  try { config = k.loadKmsConfig(repo) } catch (err) {
    throw new HttpError(404, `the canon's kms.yaml cannot be read: ${err instanceof Error ? err.message : String(err)}`)
  }
  const target = join(repo, String(config.target ?? '.'))
  const all = k.getAdapter(config.adapter).list(target) as any[]
  let items: any[] = []
  let rejected: { slug: string; reason: string }[] = []
  let gated = false
  try {
    const sel = await k.selectPublic({ dir: repo, config, all })
    items = sel.candidates ?? []
    rejected = (sel.rejected ?? []).map((r: any) => ({ slug: String(r.slug), reason: String(r.reason) }))
    gated = sel.gated === true
  } catch (err) {
    throw new HttpError(409, `Your rule (publish.gate) could not be read: ${err instanceof Error ? err.message : String(err)}. Nothing is selected until it is fixed.`)
  }
  const withId = new Map(items.map((i: any) => [i.ref, i]))
  const allItems = all.map((i: any) => withId.get(i.ref) ?? i)
  const reads = (() => { try { return k.readReads(repo) } catch { return {} } })()
  const manifest = k.readManifest(repo)
  const knowledge = (() => {
    const path = join(repo, '.well-known', 'knowledge.json')
    if (!existsSync(path)) return null
    try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
  })()
  const commons = (mode: 'public' | 'preview') => k.buildCommons({ items, allItems, manifest, config, knowledge, reads, now, mode })
  return { k, config, all, items, rejected, gated, manifest, commons }
}

/** The public face of one entry — the projected object, exactly as the commons renders it (K-7, K-13). */
export async function previewEntry(repo: string, type: string, slug: string, opts: { now?: string } = {}): Promise<{ entry: PublicFace; json: Record<string, unknown> | null }> {
  const now = opts.now ?? new Date().toISOString()
  const { commons, k, all } = await inputs(repo, now)
  const pub = commons('public')
  const entry = pub.entries.find((e: any) => e.schema === type && e.slug === slug)
  if (!entry) {
    throw new HttpError(404, `No published entry ${type}/${slug}. The commons shows only what the gate selected, so an internal or withheld entry has no public face.`)
  }
  const face: PublicFace = {
    published: true, title: String(entry.title), lead: String(entry.lead ?? ''), body: entry.body ?? [],
    related: (entry.related ?? []).map((r: any) => ({ slug: r.slug, title: r.title, kind: r.kindLabel, glyph: r.glyphType, href: r.href, peer: r.peer, mark: r.mark ?? null, internal: false, broken: false })) as RefRow[],
    about: entry.about ?? [], atUri: entry.atUri ?? null, cite: entry.cite ?? null, reason: null,
  }
  // The API twin: kms's own projection of the canon's object, which is what `public/api/<schema>/<id>.json` carries.
  const raw = all.find((i: any) => String(i.schema) === type && k.slugFromRef(i.ref) === slug)
  const projected = raw ? k.publicView(asObject(raw.object)) : null
  return { entry: face, json: projected }
}

/** The dry read: the real selection, run in memory, and every reason it found (spec §4.4, N4). */
export async function dryRead(repo: string, opts: { now?: string } = {}): Promise<DryRead> {
  const now = opts.now ?? new Date().toISOString()
  const { k, all, items, rejected, commons } = await inputs(repo, now)
  const selected = new Set(items.map((i: any) => i.ref))
  const withheld = rejected
  let internal = 0
  let awaiting = 0
  const broken: DryRead['broken'] = []
  const preview = commons('preview')
  for (const it of all) {
    const o = asObject(it.object)
    const slug = k.slugFromRef(it.ref)
    const publicUse = str(o.public_use)
    const maturity = str(o.maturity)
    if (k.isAwaitingReview(o)) awaiting += 1
    if (!selected.has(it.ref) && (publicUse === 'internal-only' || maturity === 'held')) internal += 1
    const entry = preview.entries.find((e: any) => e.slug === slug && e.schema === it.schema)
    for (const b of entry?.broken ?? []) broken.push({ slug: b.slug, type: String(it.schema), entry: slug, fix: String(b.fix) })
  }
  const kinds = (() => {
    const count = new Map<string, number>()
    for (const it of items) count.set(String(it.schema), (count.get(String(it.schema)) ?? 0) + 1)
    return [...count].map(([schema, n]) => ({ schema, label: k.kindLabel(schema), writes: n })).sort((a, b) => a.label.localeCompare(b.label))
  })()
  const view = await readKnowledge(repo, { now })
  return {
    counts: { canon: all.length, selected: items.length, internal, awaiting, withheld: withheld.length },
    withheld: withheld.map(r => {
      const it = all.find((i: any) => k.slugFromRef(i.ref) === r.slug)
      return { slug: r.slug, type: String(it?.schema ?? ''), title: String(asObject(it?.object).title ?? r.slug), reason: r.reason }
    }),
    broken, kinds,
    peers: view.peers.map(p => ({ name: p.name, state: p.state })),
    writes: 'Nothing has been written. This is the same selection `publish` uses.',
  }
}

/** The publication a run would make: what joins, what stays, what leaves, and what the run would report back. The app
 *  never executes it (K-1) — the command is named, and the CLI is what writes. */
export async function publishPlan(repo: string, opts: { now?: string } = {}): Promise<PublishPlan> {
  const now = opts.now ?? new Date().toISOString()
  const { k, config, all, items, rejected, manifest, commons } = await inputs(repo, now)
  const plane = str(asObject(config.publish).static_dir) ?? 'public'
  const role = k.planeRole(config)
  const objects = asObject(manifest.objects)
  const manifestSlugs = new Map<string, unknown[]>()
  for (const [id, rec] of Object.entries(objects)) {
    const slug = str(asObject(rec).slug)
    if (!slug) continue
    manifestSlugs.set(slug, [...(manifestSlugs.get(slug) ?? []), id])
  }
  const selectedSlugs = new Set(items.map((i: any) => k.slugFromRef(i.ref)))
  const joins = [...selectedSlugs].filter(s => !manifestSlugs.has(s)).length
  const unchanged = [...selectedSlugs].filter(s => manifestSlugs.has(s)).length
  const leaves = [...manifestSlugs.keys()].filter(s => !selectedSlugs.has(s)).length
  const refused = role === 'canon'
    ? `this instance is a canon: it publishes nothing itself. Run \`export\` here, then \`publish\` in its public plane (${str(asObject(asObject(config.planes).public).instance) ?? 'its public plane'}).`
    : null
  const calls = [
    { n: 1, what: 'One index, and a page per kind', where: `${plane}/index.html · ${plane}/k/` },
    { n: 2, what: 'A page and an API object per selected entry', where: `${plane}/k/ · ${plane}/api/` },
    { n: 3, what: 'The records peers read', where: str(asObject(config.atproto).did) ? `at://${str(asObject(config.atproto).did)}` : 'no AT Proto identity' },
    { n: 4, what: 'The knowledge manifest and the search index', where: `${plane}/.well-known/knowledge.json · ${plane}/_kms/search.json` },
  ]
  const entries = commons('public').entries
  return {
    ok: refused === null,
    refused,
    command: 'org-os-kms publish --apply',
    plane,
    classes: selectedSlugs.size === 0 ? [] : ['publication'],
    counts: {
      joins, unchanged, leaves, withheld: rejected.length,
      // The canon's standing withdrawals, which a run leaves untouched (spec §4.3's sum).
      internal: all.filter((i: any) => str(asObject(i.object).public_use) === 'internal-only' || str(asObject(i.object).maturity) === 'held').length,
      // Selected entries still in the review queue: the floor does not read it, so the run publishes them as they are.
      awaiting: items.filter((i: any) => k.isAwaitingReview(asObject(i.object))).length,
    },
    calls,
    report: {
      gate: { passed: items.length, rejected: rejected.length, gated: rejected.length > 0 },
      atproto: { status: str(asObject(config.atproto).did) ? 'planned' : 'not-configured', created: joins, updated: unchanged, deleted: leaves },
      static: { status: asObject(config.publish).static === false ? 'disabled' : 'planned', dir: plane },
      minted: entries.filter((e: any) => !e.atUri).length,
    },
    from: [
      'kms selectPublic: the framework floor, then this instance’s own rule',
      'the manifest at data/kms-published.json',
      `the public plane: ${plane}/`,
    ],
  }
}
