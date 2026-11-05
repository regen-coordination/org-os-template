import { existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { lastCommit } from '../changed.ts'
import { instanceAttention } from '../attention.ts'
import { readYamlObject, instanceSlug, slug, str } from '../util.ts'
import type { Adapter, Edge, Resource } from '../types.ts'

/** A clone on this machine, or null: only a folder holding a git repository counts. */
const clone = (repo: string, ref: string | null): string | null => {
  if (!ref) return null
  const path = resolve(repo, ref)
  return existsSync(join(path, '.git')) ? path : null
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
      status: 'this instance', attention: null, changed: await lastCommit(ctx.repo, '.'),
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
    } else if (Array.isArray(fed.peers)) {
      for (const raw of fed.peers as Record<string, unknown>[]) {
        const ref = str(raw?.repo)
        const id = (ref ? basename(ref).replace(/\.git$/, '') : '') || slug(str(raw?.name) ?? '')
        if (!id || id === selfId) continue // a federation that lists this instance among its peers: its card is the self one
        const local = ref && ref.startsWith('.') ? clone(ctx.repo, ref) : null
        nodes.push({
          id: `instance:${id}`, kind: 'instance', board: 'systems', name: str(raw.name) ?? id,
          status: str(raw.relationship) ?? str(raw.trust), attention: null,
          changed: local ? await lastCommit(local, '.') : null,
          facts: { type: raw.type ?? null, repo: ref, url: raw.url ?? null, trust: raw.trust ?? null, relationship: raw.relationship ?? null, localPath: local },
          source: { path: 'federation.yaml', editable: false },
        })
        edges.push({ from: `instance:${id}`, to: self.id, kind: 'federation' })
      }
    }
    // No fleet declared still leaves this instance's own card: Sync and Share are its operations (0.6 P2 spec §3.10).
    return { nodes, edges }
  },
}
