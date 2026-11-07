import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readRegistry, type Entity } from '../../registry.ts'
import { addressability } from '../../../lib/data-validate.mjs'
import { memberKind } from '../../../lib/members.mjs'
import { entityChanges } from '../changed.ts'
import { absentCard, lostRegistryCard } from '../graph.ts'
import { instanceSlug, str } from '../util.ts'
import { SystemReader, systemAttention } from '../../systems/reader.ts'
import { httpAddress } from '../../systems/link.ts'
import type { Adapter, Board, Edge, Resource } from '../types.ts'

const ME = { name: 'systems', board: 'systems' as const, title: 'Outside systems' }
/** Kinds whose system holds the org's money or voice, drawn as held by the org. */
const HELD = new Set(['safe', 'gardens-pool'])
const offline = new Map<string, SystemReader>()

/** `organization` for sections under organization/, else the Systems map. */
export const boardOfSystem = (section: unknown): Board => {
  const s = str(section)
  return s !== null && (s === 'organization' || s.startsWith('organization/')) ? 'organization' : 'systems'
}

/** The org's node: its member of kind organization, else this instance's fleet node. */
const holderOf = (members: Entity[], repo: string): string => {
  const org = members.find(m => memberKind(m) === 'organization' && str(m.id))
  return org ? `person:${String(org.id)}` : `instance:${instanceSlug(repo)}`
}

export const systems: Adapter = {
  ...ME,
  watch: ['data/systems.yaml', 'data/members.yaml'],
  async read(ctx) {
    const rel = 'data/systems.yaml'
    // No file is the usual case, not a gap: nothing is drawn (a tracked file the tree lost is named).
    if (!existsSync(join(ctx.repo, rel))) {
      const lost = await lostRegistryCard(ME, ctx.repo, 'systems')
      return { nodes: lost ? [lost] : [], edges: [] }
    }
    let entries: Entity[]
    try {
      // Only entries the platform can address become resources: those with no id, and those whose
      // id several entries share, are left out (validate:data names them).
      const all = readRegistry(ctx.repo, 'systems').entries ?? []
      const { noId, shared } = addressability(all)
      entries = all.filter((e, i) => !noId.includes(i) && !shared.has(String(e.id)))
    } catch (err) {
      return { nodes: [absentCard({ ...ME, title: rel }, `cannot be read: ${err instanceof Error ? err.message : String(err)}`, 'systems:systems')], edges: [] }
    }
    let members: Entity[] = []
    try {
      if (existsSync(join(ctx.repo, 'data', 'members.yaml'))) members = readRegistry(ctx.repo, 'members').entries ?? []
    } catch { /* signers then show without names */ }
    let reader = ctx.systems
    if (!reader) {
      reader = offline.get(ctx.repo) ?? new SystemReader({ repo: ctx.repo, now: ctx.now })
      offline.set(ctx.repo, reader)
    }
    const changes = await entityChanges(ctx.repo, 'systems')
    const holder = holderOf(members, ctx.repo)
    // Side by side: one slow system holds the others back no longer than its own time limit. Systems
    // on one paced host (several Safes) take turns, and each read's limit starts with its own turn.
    const reads = await Promise.all(entries.map(e => reader!.read(e, members)))
    const nodes: Resource[] = []
    const edges: Edge[] = []
    entries.forEach((e, i) => {
      const id = String(e.id)
      const driver = { ...reads[i]!, state: reader!.stateOf(id) }
      // An entry's url is passed on only as an http(s) address (interfaces, "Opening outside systems").
      const url = httpAddress(e.url)
      nodes.push({
        id: `system:${id}`, kind: 'system', board: boardOfSystem(e.section), name: str(e.name) ?? id,
        status: str(e.kind), attention: systemAttention(driver), changed: changes.get(id) ?? null,
        facts: {
          kind: e.kind ?? null, chain: e.chain ?? null, address: e.address ?? null, ...(url ? { url } : {}),
          section: e.section ?? null, embeddable: e.embeddable === true, notes: e.notes ?? null, driver,
        },
        source: { path: rel, editable: true, registry: 'systems', entityId: id },
      })
      if (HELD.has(String(e.kind))) edges.push({ from: `system:${id}`, to: holder, kind: 'held-by' })
    })
    return { nodes, edges }
  },
}
