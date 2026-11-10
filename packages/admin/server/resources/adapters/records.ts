import { existsSync, readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { join } from 'node:path'
import { readRegistry, type Entity } from '../../registry.ts'
import { addressability } from '../../../lib/data-validate.mjs'
import { entityChanges } from '../changed.ts'
import { displayNames } from '../../session/names.ts'
import { fundingAttention } from '../attention.ts'
import { absentCard, lostRegistryCard } from '../graph.ts'
import { str, list } from '../util.ts'
import type { Adapter, Changed, Edge, Kind, Resource } from '../types.ts'

/** How many items a list field holds, whatever they are (decisions and actions are often objects). */
const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0)

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
      const changes = await entityChanges(ctx.repo, 'members', displayNames(ctx.repo, ctx.membership ?? null))
      for (const e of members) {
        nodes.push(node('person', 'members', e, str(e.name) ?? String(e.id), changes, { role: e.role ?? null, layer: e.layer ?? null, handles: e.handles ?? null }))
      }
    }

    const projects = entries('projects')
    if (projects) {
      const changes = await entityChanges(ctx.repo, 'projects', displayNames(ctx.repo, ctx.membership ?? null))
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
      const changes = await entityChanges(ctx.repo, 'funding-opportunities', displayNames(ctx.repo, ctx.membership ?? null))
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
      const changes = await entityChanges(ctx.repo, 'relationships', displayNames(ctx.repo, ctx.membership ?? null))
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
      const changes = await entityChanges(ctx.repo, 'ideas', displayNames(ctx.repo, ctx.membership ?? null))
      for (const e of ideas) {
        const r = node('idea', 'ideas', e, str(e.title) ?? String(e.id), changes, { votes: e.votes ?? null, updated: e.updated ?? null, description: e.description ?? null })
        nodes.push(r)
        const by = str(e.submitted_by)
        if (by) edges.push({ from: r.id, to: `person:${by}`, kind: 'submitted' })
        for (const c of list(e.champions)) edges.push({ from: r.id, to: `person:${c}`, kind: 'champion' })
      }
    }

    // Meetings that happened: what each was, and what came of it. A recording's link is carried only when the record
    // says it may be shared (`recording_shared: true`); otherwise the Hub says only that there is one. Transcripts, raw
    // archives and private notes stay where they are: none of their paths becomes a fact.
    const meetings = entries('meetings')
    if (meetings) {
      const changes = await entityChanges(ctx.repo, 'meetings')
      for (const e of meetings) {
        const shared = e.recording_shared === true
        const link = str(e.recording_url)
        nodes.push(node('meeting', 'meetings', e, str(e.title) ?? String(e.id), changes, {
          date: e.date == null ? null : String(e.date), type: str(e.type) ?? str(e.kind), session: e.session_number ?? null,
          recorded: Boolean(e.recording || link), recording: shared && link && /^https:\/\//.test(link) ? link : null,
          agenda: str(e.agenda_ref), summary: str(e.summary),
          decisions: count(e.decisions ?? e.keyDecisions), actions: count(e.action_items ?? e.actionItems),
          project: str(e.project_id) ?? str(e.related_project),
        }))
      }
    }

    // Events to come (and past ones the calendar keeps): sessions, calls, gatherings. `start` is the date with its time
    // when one is given, so a board can sort them and ask for what comes after now.
    const events = entries('events')
    if (events) {
      const changes = await entityChanges(ctx.repo, 'events')
      for (const e of events) {
        const date = e.date == null ? null : String(e.date)
        const time = str(e.time)
        nodes.push(node('event', 'events', e, str(e.title) ?? String(e.id), changes, {
          date, start: date && time && /^\d\d:\d\d/.test(time) && /^\d{4}-\d\d-\d\d$/.test(date) ? `${date}T${time.slice(0, 5)}` : date,
          end: e.end_date == null ? null : String(e.end_date), type: str(e.type), session: e.session_number ?? null,
          location: str(e.location), agenda: str(e.agenda_ref) ?? str(e.agenda_doc), recurrence: str(e.recurrence),
          project: str(e.related_project),
        }))
      }
    }

    // An instance's own task list (DATA-MODEL "Extension Pattern": `tasks.yaml` is the first example), when it keeps
    // one: what is to be done, by whom and by when. `audience: stewards` marks an ask of the Council. Read-only, and
    // its notes stay in the file: only the fields a list needs become facts.
    const tasksPath = join(ctx.repo, 'data', 'tasks.yaml')
    if (existsSync(tasksPath)) {
      try {
        const doc = parseYaml(readFileSync(tasksPath, 'utf8')) as { tasks?: unknown } | unknown[] | null
        const all = Array.isArray(doc) ? doc : Array.isArray((doc as { tasks?: unknown } | null)?.tasks) ? (doc as { tasks: unknown[] }).tasks : []
        for (const t of all) {
          if (!t || typeof t !== 'object') continue
          const e = t as Record<string, unknown>
          const id = str(e.id)
          if (!id) continue
          nodes.push({
            id: `task:${id}`, kind: 'task', board: 'organization', name: str(e.title) ?? id, status: str(e.status),
            attention: null, changed: null,
            facts: { owner: str(e.owner), due: e.due == null ? null : String(e.due), priority: str(e.priority), audience: str(e.audience),
              meeting: str(e.meeting_ref), project: str(e.related_project) },
            source: { path: 'data/tasks.yaml', editable: false, entityId: id },
          })
        }
      } catch (err) {
        nodes.push(absentCard({ ...ME, title: 'data/tasks.yaml' },
          `cannot be read: ${err instanceof Error ? err.message : String(err)}`, 'records:tasks'))
      }
    }

    // The organizations the knowledge store knows (data/kb/organization.yaml, org-os-kms): Local Nodes and the like,
    // with their stage, place and where they belong. Read-only here: the knowledge store has its own pipeline.
    const kbPath = join(ctx.repo, 'data', 'kb', 'organization.yaml')
    if (existsSync(kbPath)) {
      try {
        const doc = parseYaml(readFileSync(kbPath, 'utf8')) as { entries?: Record<string, Record<string, unknown>> } | null
        for (const [slug, e] of Object.entries(doc?.entries ?? {})) {
          if (!e || typeof e !== 'object') continue
          const coords = Array.isArray(e.coords) && e.coords.length === 2 && e.coords.every(n => typeof n === 'number') ? e.coords : null
          nodes.push({
            id: `organization:${slug}`, kind: 'organization', board: 'organization', name: str(e.title) ?? slug,
            status: str(e.status), attention: null, changed: null,
            facts: { org_type: str(e.org_type), stage: str(e.stage), place: str(e.place), url: str(e.url), part_of: str(e.part_of), scale: str(e.scale), coords },
            source: { path: 'data/kb/organization.yaml', editable: false, entityId: slug },
          })
        }
      } catch (err) {
        nodes.push(absentCard({ ...ME, title: 'data/kb/organization.yaml' },
          `cannot be read: ${err instanceof Error ? err.message : String(err)}`, 'records:kb-organization'))
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
