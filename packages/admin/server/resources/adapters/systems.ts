import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { readRegistry, type Entity } from '../../registry.ts'
import { addressability } from '../../../lib/data-validate.mjs'
import { memberKind } from '../../../lib/members.mjs'
import { membershipTree } from '../../../lib/rules.mjs'
import { readGovernance } from '../../../lib/governance-read.mjs'
import { entityChanges } from '../changed.ts'
import { displayNames } from '../../session/names.ts'
import { absentCard, lostRegistryCard } from '../graph.ts'
import { instanceSlug, str } from '../util.ts'
import { SystemReader, systemAttention } from '../../systems/reader.ts'
import { httpAddress } from '../../systems/link.ts'
import { leadsOutside } from '../mount.ts'
import { parseStatusV2 } from '../../../lib/git-status-v2.mjs'
import type { Adapter, Board, Edge, Resource } from '../types.ts'
import type { PrivateAccess } from '../../private/ops.ts'
import { strictPrivateReads } from '../../private/reads.ts'
import { CHAIN_FIELDS } from '../../visibility/gate.ts'

const ME = { name: 'systems', board: 'systems' as const, title: 'Outside systems' }
/** Kinds whose system holds the org's money or voice, drawn as held by the org. */
const HELD = new Set(['safe', 'gardens-pool'])
const offline = new Map<string, SystemReader>()

/** `organization` for sections under organization/, else the Systems map. */
export const boardOfSystem = (section: unknown): Board => {
  const s = str(section)
  return s !== null && (s === 'organization' || s.startsWith('organization/')) ? 'organization' : 'systems'
}

/** The id of the org's membership tree (lib/rules.mjs `membershipTree`: governance.membership.tree, else the only
 *  deployed tree; never a composed one), so Roles draws the org's own tree (whole-platform walk I1); null when there is
 *  none or the governance cannot be read. */
const membershipOf = (repo: string, entries: Entity[]): string | null => {
  try {
    const path = join(repo, 'data', 'governance.yaml')
    const { governance } = readGovernance(existsSync(path) ? readFileSync(path, 'utf8') : null) as { governance: Record<string, unknown> | null }
    return membershipTree(governance, entries)?.id ?? null
  } catch { return null }
}

/** A repo System's `mount`, read from its clone (a read: it never fetches), or `cloned: false`. A mount that leaves the repo is never looked at. */
const mountFacts = async (ctx: Parameters<Adapter['read']>[0], mount: string) => {
  const abs = resolve(ctx.repo, mount)
  const rel = relative(ctx.repo, abs)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || leadsOutside(ctx.repo, mount) || !existsSync(join(abs, '.git'))) return { path: mount, cloned: false as const }
  try {
    const r = await ctx.run('git', ['--no-optional-locks', '-C', abs, 'status', '--porcelain=v2', '--branch'], { cwd: ctx.repo, timeoutMs: 5000 })
    if (r.code !== 0) return { path: mount, cloned: true as const, error: true as const }
    return { path: mount, cloned: true as const, ...parseStatusV2(r.stdout) }
  } catch { return { path: mount, cloned: true as const, error: true as const } }
}

/** The org's node: its member of kind organization, else this instance's fleet node. */
const holderOf = (members: Entity[], repo: string): string => {
  const org = members.find(m => memberKind(m) === 'organization' && str(m.id))
  return org ? `person:${String(org.id)}` : `instance:${instanceSlug(repo)}`
}

/** Walk fix wave 5 (wave 4's carry): each System with the chain fields (`CHAIN_FIELDS`: its address, deployment, …) the
 *  private store keeps for it laid over git's entry, read strictly, so a System whose deployment or address moved to the
 *  store is read from those values, not as deployed with no address. Only the chain fields: they are what the gate keeps,
 *  with the read made from them, from a member not admitted to them (`withoutChainRead`, PF-R256), and the public's
 *  Resource holds no fact its public record does not (`publicResource`). No store, or one that cannot answer: git's
 *  entries as they are (and the gate then keeps every System's read from everyone). */
function laidOver(access: PrivateAccess | undefined, entries: Entity[]): Entity[] {
  if (!access) return entries
  const reads = strictPrivateReads(access)
  try { return entries.map(e => withChainFields(e, reads.fields('systems', String(e.id)))) } catch { return entries }
}

/** A System's entry with the chain fields among `fields` (the store's, for it) laid over git's: the entry its read is made
 *  from, and so the one the reader's cache is asked by (the Sources page, the from mark). */
export function withChainFields<E extends Record<string, unknown>>(entry: E, fields: readonly { field: string; value: unknown }[]): E {
  const kept = fields.filter(f => (CHAIN_FIELDS as readonly string[]).includes(f.field))
  return kept.length === 0 ? entry : { ...entry, ...Object.fromEntries(kept.map(f => [f.field, f.value])) }
}

export const systems: Adapter = {
  ...ME,
  watch: ['data/systems.yaml', 'data/members.yaml', 'data/governance.yaml'],
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
    const changes = await entityChanges(ctx.repo, 'systems', displayNames(ctx.repo, ctx.membership ?? null))
    const holder = holderOf(members, ctx.repo)
    const membership = membershipOf(ctx.repo, entries)
    // Each System as the chain holds it: the chain fields the store keeps laid over git's (walk fix wave 5).
    const read = laidOver(ctx.privateStore, entries)
    // Side by side: one slow system holds the others back no longer than its own time limit. Systems
    // on one paced host (several Safes) take turns, and each read's limit starts with its own turn.
    const reads = await Promise.all(read.map(e => reader!.read(e, members)))
    const mounts = await Promise.all(entries.map(e => (e.kind === 'repo' && str(e.mount) ? mountFacts(ctx, str(e.mount)!) : null)))
    const nodes: Resource[] = []
    const edges: Edge[] = []
    entries.forEach((e, i) => {
      const id = String(e.id)
      const driver = { ...reads[i]!, state: reader!.stateOf(id) }
      // An entry's url is passed on only as an http(s) address (interfaces, "Opening outside systems").
      const url = httpAddress(read[i]!.url)
      nodes.push({
        id: `system:${id}`, kind: 'system', board: boardOfSystem(e.section), name: str(e.name) ?? id,
        status: str(e.kind), attention: systemAttention(driver), changed: changes.get(id) ?? null,
        facts: {
          kind: e.kind ?? null, chain: e.chain ?? null, address: read[i]!.address ?? null, ...(url ? { url } : {}),
          section: e.section ?? null, embeddable: e.embeddable === true, notes: e.notes ?? null, driver,
          ...(id === membership ? { membership: true } : {}),
          ...(mounts[i] ? { mount: mounts[i] } : {}),
        },
        source: { path: rel, editable: true, registry: 'systems', entityId: id },
      })
      if (HELD.has(String(e.kind))) edges.push({ from: `system:${id}`, to: holder, kind: 'held-by' })
    })
    return { nodes, edges }
  },
}
