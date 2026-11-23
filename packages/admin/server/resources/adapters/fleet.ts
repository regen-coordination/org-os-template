import { existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { lastCommit } from '../changed.ts'
import { displayNames } from '../../session/names.ts'
import { instanceAttention } from '../attention.ts'
import { readFileSync } from 'node:fs'
import { stateDir } from '../../state.ts'
import { readYamlObject, instanceSlug, slug, str } from '../util.ts'
import { readFederation } from '../../../lib/federation/read.mjs'
import { selfAddresses, linkState, addressOf, sameAddress } from '../../../lib/federation/peers.mjs'
import { nodePeerIO } from '../../federation-io.ts'
import { remoteCache, wellKnownUrlOf } from '../../federation/remote.ts'
import type { Adapter, Edge, Resource } from '../types.ts'

/** A clone on this machine, or null: only a folder holding a git repository counts. */
const clone = (repo: string, ref: string | null): string | null => {
  if (!ref) return null
  const path = resolve(repo, ref)
  return existsSync(join(path, '.git')) ? path : null
}

const LINK_STATUS: Record<string, { status: string; attention: Resource['attention'] }> = {
  mutual: { status: 'mutual', attention: null },
  claimed: { status: 'claimed', attention: { level: 'warn', text: 'Only this side lists the link. Ask them to add this instance.' } },
  'not-an-instance': { status: 'a repo, not an instance', attention: { level: 'warn', text: 'This is a repo, not an org-os instance. Map it as a System.' } },
  unknown: { status: 'not checked', attention: null },
}

/** How a link reads on its card. An `unknown` with a path means a folder was looked at: what was found there is said. */
const shownLink = (link: { state: string; path: string | null; reason: string | null }) => {
  if (link.state !== 'unknown' || !link.path || !link.reason) return LINK_STATUS[link.state]
  const text = `${link.reason.charAt(0).toUpperCase()}${link.reason.slice(1)}`.replace(/\.?$/, '.')
  return { status: "can't read their side", attention: { level: 'warn' as const, text } }
}

/** The peers list readFederation reads: the top-level one, else one nested under `federation:` (the v3 shape). */
const peersOf = (fed: Record<string, unknown>): unknown => {
  if (fed.peers !== undefined) return fed.peers
  const nested = fed.federation
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>).peers : undefined
}

/** The URL column of `git remote -v`, de-duplicated; none when git fails. */
const remoteUrls = async (ctx: Parameters<Adapter['read']>[0]): Promise<string[]> => {
  try {
    const r = await ctx.run('git', ['remote', '-v'], { cwd: ctx.repo, timeoutMs: 5000 })
    if (r.code !== 0) return []
    return [...new Set(r.stdout.split('\n').map(l => l.split(/\s+/)[1]).filter(Boolean))]
  } catch { return [] }
}

/** What the doctor found when the launcher opened this instance (`doctor.json` in its state folder), as attention; null when it found nothing or was never run. */
const doctorAttention = (repo: string): Resource['attention'] => {
  try {
    const d = JSON.parse(readFileSync(join(stateDir(repo), 'doctor.json'), 'utf8')) as { blockers?: number; warnings?: number; findings?: { level: string; message: string }[] }
    const blockers = Number(d.blockers) || 0
    const warnings = Number(d.warnings) || 0
    if (blockers === 0 && warnings === 0) return null
    const level = blockers > 0 ? 'BLOCKER' : 'WARN'
    const first = d.findings?.find(f => f.level === level)?.message ?? ''
    const what = blockers > 0 ? `${blockers} blocker(s)` : `${warnings} warning(s)`
    return { level: blockers > 0 ? 'alert' : 'warn', text: `The doctor found ${what} when this instance was opened${first ? `: ${first}` : '.'}` }
  } catch { return null }
}

export const fleet: Adapter = {
  name: 'fleet', board: 'systems', title: 'Fleet',
  watch: ['data/instances.yaml', 'federation.yaml'],
  async read(ctx) {
    const fed = readYamlObject(join(ctx.repo, 'federation.yaml'))
    const identity = (fed.identity ?? {}) as Record<string, unknown>
    const selfId = instanceSlug(ctx.repo)
    const self: Resource = {
      id: `instance:${selfId}`, kind: 'instance', board: 'systems', name: str(identity.name) ?? selfId,
      status: 'this instance', attention: doctorAttention(ctx.repo), changed: await lastCommit(ctx.repo, '.', displayNames(ctx.repo, ctx.membership ?? null)),
      facts: { self: true, type: identity.type ?? null, localPath: ctx.repo }, source: { path: 'federation.yaml', editable: false },
    }
    const nodes: Resource[] = [self]
    const edges: Edge[] = []

    // The framework keeps a registry of its instances; an instance knows only its peers.
    const listed = readYamlObject(join(ctx.repo, 'data', 'instances.yaml')).instances
    if (Array.isArray(listed)) {
      for (const raw of listed as Record<string, unknown>[]) {
        const id = str(raw?.id)
        if (!id || id === selfId) continue
        const local = clone(ctx.repo, str(raw.local_path))
        nodes.push({
          id: `instance:${id}`, kind: 'instance', board: 'systems', name: str(raw.name) ?? id, status: str(raw.maturity),
          attention: instanceAttention(raw.drift, raw.last_sync, ctx.now()),
          changed: local ? await lastCommit(local, '.') : null,
          facts: { type: raw.type ?? null, repo: raw.repo ?? null, localPath: local, last_sync: raw.last_sync ?? null,
            drift: Array.isArray(raw.drift) ? raw.drift : [], federation_role: raw.federation_role ?? null, notes: raw.notes ?? null },
          source: { path: 'data/instances.yaml', editable: false },
        })
        edges.push({ from: `instance:${id}`, to: self.id, kind: 'federation' })
      }
    } else if (Array.isArray(peersOf(fed))) {
      const self_ = selfAddresses(ctx.repo, await remoteUrls(ctx), nodePeerIO)
      const parsed = readFederation(fed).peers
      for (const [i, raw] of (peersOf(fed) as Record<string, unknown>[]).entries()) {
        const ref = str(raw?.repo)
        const id = (ref ? basename(ref).replace(/\.git$/, '') : '') || slug(str(raw?.name) ?? '')
        if (!id || id === selfId) continue // a federation that lists this instance among its peers: its card is the self one
        const local = ref && ref.startsWith('.') ? clone(ctx.repo, ref) : null
        const peer = parsed.find(p => p.index === i)
        let link: { state: string; path: string | null; reason: string | null } = peer ? linkState(peer, self_, ctx.repo, nodePeerIO) : { state: 'unknown' as const, path: null, reason: "can't read their side from here" }
        let checked: string | null = null
        // A peer with only a url: what its federation.json said when it was last read (N2 Task 2). Their claims, not a fact we hold.
        if (link.state === 'unknown' && link.path === null && local === null && peer?.url) {
          const key = wellKnownUrlOf(peer.url)
          const cached = key ? remoteCache(ctx.repo).get(key) : null
          if (cached) {
            const lists = readFederation(cached.doc).peers.some(p => [p.ref, p.url].some(r => {
              const a = r ? addressOf(r, ctx.repo, nodePeerIO) : null
              return a !== null && self_.some(s => sameAddress(s, a))
            }))
            checked = cached.fetched_at
            link = { state: lists ? 'mutual' : 'claimed', path: null, reason: `checked ${cached.fetched_at}` }
          }
        }
        const shown = shownLink(link)
        nodes.push({
          id: `instance:${id}`, kind: 'instance', board: 'systems', name: str(raw.name) ?? id,
          status: shown.status, attention: shown.attention,
          changed: local ? await lastCommit(local, '.') : null,
          facts: { type: raw.type ?? null, repo: ref, url: raw.url ?? null, trust: raw.trust ?? null, relationship: raw.relationship ?? null, localPath: local,
            link: link.state, linkReason: link.reason, checked },
          source: { path: 'federation.yaml', editable: false },
        })
        edges.push({ from: `instance:${id}`, to: self.id, kind: 'federation' })
      }
    }
    // No fleet declared still leaves this instance's own card: Sync and Share are its operations (0.6 P2 spec §3.10).
    return { nodes, edges }
  },
}
