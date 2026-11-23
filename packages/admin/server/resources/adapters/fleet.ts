import { existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { lastCommit } from '../changed.ts'
import { displayNames } from '../../session/names.ts'
import { instanceAttention } from '../attention.ts'
import { readFileSync } from 'node:fs'
import { stateDir } from '../../state.ts'
import { readYamlObject, instanceSlug, slug, str } from '../util.ts'
import { readFederation } from '../../../lib/federation/read.mjs'
import { linkStatesOf, selfAddressesOf, type PeerLinkState } from '../../federation/link-state.ts'
import { publishFacts } from '../../federation/atproto/publish.ts'
import { listOutgoing } from '../../federation/node.ts'
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
  requested: { status: 'requested', attention: null },
  left: { status: 'left', attention: { level: 'warn', text: 'They no longer list this instance.' } },
  'not-an-instance': { status: 'a repo, not an instance', attention: { level: 'warn', text: 'This is a repo, not an org-os instance. Map it as a System.' } },
  unknown: { status: 'not checked', attention: null },
}

const UNREAD: PeerLinkState = { relation: null, state: 'unknown', sources: { files: 'unknown', atproto: 'unknown', checked: null },
  drift: [], reason: "can't read their side from here", path: null, failed: false }

/** How a link reads on its card.
 *  - A record of ours that federation.yaml no longer allows is the urgent case: its words are the attention.
 *  - An `unknown` where a folder was looked at, or their records could not be read, says what was found. */
const shownLink = (link: PeerLinkState) => {
  const base = LINK_STATUS[link.state] ?? LINK_STATUS.unknown
  const looked = link.state === 'unknown' && link.reason && (link.path || link.failed)
  const shown = looked
    ? { status: "can't read their side", attention: { level: 'warn' as const, text: `${link.reason!.charAt(0).toUpperCase()}${link.reason!.slice(1)}`.replace(/\.?$/, '.') } }
    : base
  const urgent = link.drift.find(d => d.urgent)
  return urgent ? { status: shown.status, attention: { level: 'warn' as const, text: urgent.text } } : shown
}

/** The peers list readFederation reads: the top-level one, else one nested under `federation:` (the v3 shape). */
const peersOf = (fed: Record<string, unknown>): unknown => {
  if (fed.peers !== undefined) return fed.peers
  const nested = fed.federation
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>).peers : undefined
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
    // How the atproto cache reads each hub we asked: set where the link states are worked out (below).
    let theirsOf: (hub: string) => string = () => 'unknown'
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
    } else {
      // One state per link from every source (N2 Task 4): the local folder, their federation.json as last read and
      // both sides' atproto records as last read. federation.yaml governs our side; a record that disagrees is drift.
      const parsedFed = readFederation(fed)
      const links = linkStatesOf(ctx.repo, parsedFed, await selfAddressesOf(ctx.repo, ctx.run))
      const norm = (u: string | null) => (u ?? '').trim().replace(/\/+$/, '').toLowerCase()
      theirsOf = hub => {
        const peer = parsedFed.peers.find(p => p.url !== null && norm(p.url) === norm(hub))
        return (peer && links.peers.get(peer.index)?.sources.atproto) || 'unknown'
      }
      // Our records no peer accounts for: published, but federation.yaml no longer lists them. The urgent case.
      self.facts = { ...self.facts, did: links.selfDid, drift: links.unlisted }
      if (!self.attention && links.unlisted.length > 0) self.attention = { level: 'warn', text: links.unlisted[0].text }
      const raws = peersOf(fed)
      for (const [i, raw] of (Array.isArray(raws) ? raws as Record<string, unknown>[] : []).entries()) {
        const ref = str(raw?.repo)
        const id = (ref ? basename(ref).replace(/\.git$/, '') : '') || slug(str(raw?.name) ?? '')
        if (!id || id === selfId) continue // a federation that lists this instance among its peers: its card is the self one
        const local = ref && ref.startsWith('.') ? clone(ctx.repo, ref) : null
        const link = links.peers.get(i) ?? UNREAD
        const shown = shownLink(link)
        nodes.push({
          id: `instance:${id}`, kind: 'instance', board: 'systems', name: str(raw.name) ?? id,
          status: shown.status, attention: shown.attention,
          changed: local ? await lastCommit(local, '.') : null,
          facts: { type: raw.type ?? null, repo: ref, url: raw.url ?? null, trust: raw.trust ?? null, relationship: raw.relationship ?? null, localPath: local,
            link: link.state, linkReason: link.reason, checked: link.sources.checked, relation: link.relation, sources: link.sources, drift: link.drift },
          source: { path: 'federation.yaml', editable: false },
        })
        edges.push({ from: `instance:${id}`, to: self.id, kind: 'federation' })
      }
    }
    // Publishing this org's own link records (N2 Task 7): the last receipt, what the trunk's plan holds now, and the
    // first refusal of the plan's file-side steps (ruling R11), so Publish is unavailable with its sentence.
    self.facts = { ...self.facts, ...(await publishFacts(ctx.repo, { run: ctx.run, now: ctx.now(), startBranch: ctx.startBranch })) }
    // The node's side of asking to join (N2 Task 8): each request this instance asked, whether it is on the trunk yet,
    // where it was sent and what came back, and what the hub's atproto records say (from the cache; never fetched).
    self.facts = { ...self.facts, outgoing: (await listOutgoing(ctx.repo, { startBranch: ctx.startBranch })).map(o => ({ ...o, atproto: { theirs: theirsOf(o.hub) } })) }
    // No fleet declared still leaves this instance's own card: Sync and Share are its operations (0.6 P2 spec §3.10).
    return { nodes, edges }
  },
}
