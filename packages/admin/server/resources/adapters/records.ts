import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readRegistry, type Entity } from '../../registry.ts'
import { addressability } from '../../../lib/data-validate.mjs'
import { entityChanges } from '../changed.ts'
import { fundingAttention } from '../attention.ts'
import { absentCard, lostRegistryCard } from '../graph.ts'
import { str, list } from '../util.ts'
import type { Adapter, Changed, Edge, Kind, Resource } from '../types.ts'

const ME = { name: 'records', board: 'organization' as const, title: 'Records' }

export const records: Adapter = {
  ...ME,
  watch: ['data'],
  async read(ctx) {
    const nodes: Resource[] = []
    const edges: Edge[] = []
    let found = 0

    /** A registry's entries; null when the file is absent. A file that cannot be read becomes
     *  one card naming it, so the other registries still draw. */
    const entries = (registry: string): Entity[] | null => {
      if (!existsSync(join(ctx.repo, 'data', `${registry}.yaml`))) return null
      found++
      try {
        // An entry with no id (absent, null or "") is never a resource: the platform cannot address it.
        const all = readRegistry(ctx.repo, registry).entries ?? []
        const unaddressable = new Set(addressability(all).noId)
        return all.filter((_, i) => !unaddressable.has(i))
      } catch (err) {
        nodes.push(absentCard({ ...ME, title: `data/${registry}.yaml` },
          `cannot be read: ${err instanceof Error ? err.message : String(err)}`, `records:${registry}`))
        return null
      }
    }
    const node = (kind: Kind, registry: string, e: Entity, name: string, changes: Map<string, Changed>, facts: Record<string, unknown>): Resource => ({
      id: `${kind}:${String(e.id)}`, kind, board: 'organization', name, status: str(e.status),
      attention: null, changed: changes.get(String(e.id)) ?? null, facts,
      source: { path: `data/${registry}.yaml`, editable: true, registry, entityId: String(e.id) },
    })

    // A registry git tracks but the tree has lost is named, not passed over in silence.
    for (const registry of ['members', 'projects', 'funding-opportunities', 'relationships', 'ideas', 'knowledge-gaps']) {
      if (existsSync(join(ctx.repo, 'data', `${registry}.yaml`))) continue
      const lost = await lostRegistryCard(ME, ctx.repo, registry)
      if (lost) nodes.push(lost)
    }

    const members = entries('members')
    if (members) {
      const changes = await entityChanges(ctx.repo, 'members')
      for (const e of members) {
        nodes.push(node('person', 'members', e, str(e.name) ?? String(e.id), changes, { role: e.role ?? null, layer: e.layer ?? null, handles: e.handles ?? null }))
      }
    }

    const projects = entries('projects')
    if (projects) {
      const changes = await entityChanges(ctx.repo, 'projects')
      for (const e of projects) {
        const id = `project:${String(e.id)}`
        const lead = str(e.lead)
        // Real instances write `members` and `startDate`; DATA-MODEL.md writes `contributors`
        // and `started`. Both are read until the data model is ruled on (spec §4).
        const team = list(e.members ?? e.contributors)
        nodes.push(node('project', 'projects', e, str(e.name) ?? str(e.title) ?? String(e.id), changes, {
          lead, members: team, started: e.startDate ?? e.started ?? null, target: e.target_completion ?? null,
          description: e.description ?? null,
        }))
        if (lead) edges.push({ from: id, to: `person:${lead}`, kind: 'lead' })
        for (const m of team) if (m !== lead) edges.push({ from: id, to: `person:${m}`, kind: 'member' })
        for (const idea of list(e.related_ideas)) edges.push({ from: id, to: `idea:${idea}`, kind: 'works-on' })
        const fund = str(e.funding_source)
        if (fund) edges.push({ from: `funding:${fund}`, to: id, kind: 'funds' })
      }
    }

    const funding = entries('funding-opportunities')
    if (funding) {
      const changes = await entityChanges(ctx.repo, 'funding-opportunities')
      for (const e of funding) {
        const r = node('funding', 'funding-opportunities', e, str(e.title) ?? str(e.name) ?? String(e.id), changes, {
          deadline: e.deadline ?? null, fit: e.fit ?? null, next_action: e.next_action ?? null, org: e.org ?? null, url: e.url ?? null,
        })
        r.attention = fundingAttention(e.deadline, e.status, ctx.now())
        nodes.push(r)
        const owner = str(e.owner)
        if (owner) edges.push({ from: r.id, to: `person:${owner}`, kind: 'lead' })
      }
    }

    const partners = entries('relationships')
    if (partners) {
      const changes = await entityChanges(ctx.repo, 'relationships')
      for (const e of partners) {
        const r = node('partner', 'relationships', e, str(e.partner) ?? str(e.name) ?? String(e.id), changes, {
          type: e.type ?? null, since: e.since ?? null, contact: e.contact ?? null, description: e.description ?? null,
        })
        nodes.push(r)
        const contact = str(e.contact)
        if (contact) edges.push({ from: r.id, to: `person:${contact}`, kind: 'partners-with' })
      }
    }

    const ideas = entries('ideas')
    if (ideas) {
      const changes = await entityChanges(ctx.repo, 'ideas')
      for (const e of ideas) {
        const r = node('idea', 'ideas', e, str(e.title) ?? String(e.id), changes, { votes: e.votes ?? null, updated: e.updated ?? null, description: e.description ?? null })
        nodes.push(r)
        const by = str(e.submitted_by)
        if (by) edges.push({ from: r.id, to: `person:${by}`, kind: 'submitted' })
        for (const c of list(e.champions)) edges.push({ from: r.id, to: `person:${c}`, kind: 'champion' })
      }
    }

    // Hundreds of gaps would bury every other card, so they are one card, counted by kind.
    const gaps = entries('knowledge-gaps')
    if (gaps && gaps.length > 0) {
      const byKind: Record<string, number> = {}
      for (const g of gaps) { const k = str(g.kind) ?? 'unkinded'; byKind[k] = (byKind[k] ?? 0) + 1 }
      nodes.push({ id: 'knowledge-gaps:summary', kind: 'knowledge-gaps', board: 'organization',
        name: `${gaps.length} knowledge gap${gaps.length === 1 ? '' : 's'}`, status: null, attention: null, changed: null,
        facts: { total: gaps.length, byKind }, source: { path: 'data/knowledge-gaps.yaml', editable: false, registry: 'knowledge-gaps' } })
    }

    if (found === 0 && nodes.length === 0) return { absent: 'No records: none of members, projects, funding-opportunities, relationships, ideas is in data/' }
    return { nodes, edges }
  },
}
