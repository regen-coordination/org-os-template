import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readRegistry, type Entity } from '../../registry.ts'
import { connectorAttention } from '../attention.ts'
import { absentCard, lostRegistryCard } from '../graph.ts'
import { readYamlObject, str } from '../util.ts'
import type { Adapter, Resource } from '../types.ts'
import type { RefreshState } from '../../hosted/refresh.ts'

const ME = { name: 'sources', board: 'systems' as const, title: 'Sources & channels' }

/** The id of the row that says how a read-only Hub follows its remote. */
export const REFRESH_ROW = 'refresh:instance'

const REFRESH_STATUS: Record<RefreshState['state'], string> = {
  starting: 'starting', following: 'following the remote', retrying: 'retrying', stopped: 'stopped',
}

/** The row for the Refresher's state: members only (it is drawn from no registry), its warning or stop as attention. */
export function refreshRow(r: RefreshState): Resource {
  const minutes = Math.round(r.everyMs / 60_000)
  return {
    id: REFRESH_ROW, kind: 'source', board: 'systems', name: 'This Hub\'s copy of the instance', status: REFRESH_STATUS[r.state],
    attention: r.sentence === null ? null : { level: r.state === 'stopped' ? 'alert' : 'warn', text: r.sentence },
    changed: r.lastRefresh ? { at: r.lastRefresh, by: 'last refresh' } : null,
    facts: { trunk: r.trunk, every: minutes >= 1 ? `${minutes} min` : `${Math.round(r.everyMs / 1000)} s`, lastRefresh: r.lastRefresh, commit: r.commit ? r.commit.slice(0, 12) : null },
    source: null,
  }
}

export const sources: Adapter = {
  ...ME,
  watch: ['data/sources.yaml', 'data/channels.yaml', 'kms.yaml', 'data/kms-cursors.json'],
  async read(ctx) {
    const nodes: Resource[] = []
    let found = false
    const refresh = ctx.refresh?.() ?? null
    if (refresh) { nodes.push(refreshRow(refresh)); found = true }
    for (const [registry, kind] of [['sources', 'source'], ['channels', 'channel']] as const) {
      if (!existsSync(join(ctx.repo, 'data', `${registry}.yaml`))) {
        const lost = await lostRegistryCard(ME, ctx.repo, registry)
        if (lost) nodes.push(lost)
        continue
      }
      found = true
      let entries: Entity[]
      try { entries = readRegistry(ctx.repo, registry).entries ?? [] } catch (err) {
        nodes.push(absentCard({ ...ME, title: `data/${registry}.yaml` }, `cannot be read: ${err instanceof Error ? err.message : String(err)}`, `sources:${registry}`))
        continue
      }
      for (const e of entries) {
        if (e.id === undefined || e.id === null) continue
        nodes.push({
          id: `${kind}:${String(e.id)}`, kind, board: 'systems', name: str(e.name) ?? String(e.id), status: str(e.status),
          attention: null, changed: null,
          facts: kind === 'source'
            ? { type: e.type ?? null, platform: e.platform ?? null, url: e.url ?? null, doc_count: e.doc_count ?? e.content_count ?? null, last_synced: e.last_synced ?? null }
            : { platform: e.platform ?? e.type ?? null, url: e.url ?? null, purpose: e.purpose ?? null },
          source: { path: `data/${registry}.yaml`, editable: true, registry, entityId: String(e.id) },
        })
      }
    }

    // KMS connectors are what `org-os-kms ingest` pulls from (spec §12.3). The cursor file holds
    // no time, so freshness is the platform's own record of the last ingest that ended ok.
    if (existsSync(join(ctx.repo, 'kms.yaml'))) {
      found = true
      const kms = readYamlObject(join(ctx.repo, 'kms.yaml'))
      const target = str(kms.target) ?? '.'
      for (const c of Array.isArray(kms.connectors) ? (kms.connectors as unknown[]) : []) {
        const name = c && typeof c === 'object' ? str((c as Record<string, unknown>).name) : null
        if (!name) continue
        const id = `connector:${name}`
        const lastIngest = ctx.lastOk('connector.ingest', id)
        nodes.push({
          id, kind: 'connector', board: 'systems', name, status: 'declared',
          attention: connectorAttention(lastIngest, ctx.now()),
          changed: lastIngest ? { at: lastIngest, by: 'last ingest' } : null,
          facts: { target, lastIngest }, source: { path: 'kms.yaml', editable: false },
        })
      }
    }
    if (!found && nodes.length === 0) return { absent: 'No sources, channels or KMS connectors declared here' }
    return { nodes, edges: [] }
  },
}
