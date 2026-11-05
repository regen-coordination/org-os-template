import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { entityChanges } from '../changed.ts'
import { lostRegistryCard } from '../graph.ts'
import { readLedger } from '../../proposals/ledger.ts'
import { proposalContext } from '../../proposals/events.ts'
import { judge, viewContext } from '../../proposals/view.ts'
import { gitOpsOf, isPlaceholder, parseRecord } from '../../../lib/ops.mjs'
import { REGISTRY_OF_KIND } from '../../../lib/registries.mjs'
import { inWords } from '../../../lib/evaluate.mjs'
import type { Adapter, Attention, Edge, Resource } from '../types.ts'
import { RESTRICTED_SUBJECT } from '../../private/ops.ts'

// The proposals ledger as resources (0.6 P2 spec §3.14 "As resources"): one resource of kind `proposal` per entry, on
// the Organization map, with an edge `touches` to each record its ops name and `proposed-by` to its author. While open
// it asks for attention: `warn` with what it still needs, `alert` when it is stale or a window (or its expiry) closes
// within a day. A closed proposal asks nothing. The personal "needs you" depends on who asks, so it is not here: it is
// GET /api/proposals' `needsYou`.

const ME = { name: 'proposals', board: 'organization' as const, title: 'Proposals' }
const REL = 'data/proposals.yaml'
const DAY_MS = 86_400_000
const KIND_OF_REGISTRY: Record<string, string> = Object.fromEntries(Object.entries(REGISTRY_OF_KIND).map(([kind, registry]) => [registry, kind]))
/** Rules are judged for the org, not for whoever is looking. */
const ANYONE = { unknown: '' }

/** The resource an op's record is, when the map draws records of its registry. */
function resourceOf(record: string): string | null {
  try {
    const { registry, id } = parseRecord(record)
    const kind = KIND_OF_REGISTRY[registry]
    return kind ? `${kind}:${id}` : null
  } catch { return null }
}

export const proposals: Adapter = {
  ...ME,
  // The ledger, and every record an op names (whether it is stale), and the roles (who decides).
  watch: ['data'],
  async read(ctx) {
    // No ledger is the usual case before anyone proposes: nothing is drawn (a tracked file the tree lost is named).
    if (!existsSync(join(ctx.repo, REL))) {
      const lost = await lostRegistryCard(ME, ctx.repo, 'proposals')
      return { nodes: lost ? [lost] : [], edges: [] }
    }
    const read = readLedger(ctx.repo)
    if (read.problems.length > 0) return { absent: read.problems[0]!, failed: true }
    if (read.entries.length === 0) return { nodes: [], edges: [] }
    const now = ctx.now()
    const vc = viewContext(ctx.repo, ANYONE, now)
    const changes = await entityChanges(ctx.repo, 'proposals')
    const nodes: Resource[] = []
    const edges: Edge[] = []
    for (const entry of read.entries) {
      const id = String(entry.id)
      const { book, known } = judge(vc, entry)
      const { state, evaluation, stale } = proposalContext(ctx.repo, entry, now, book, known)
      let attention: Attention | null = null
      if (entry.state === 'open') {
        const closes = evaluation.closesAt === null ? null : Date.parse(evaluation.closesAt) - now.getTime()
        const missing = evaluation.missing || 'ready to ratify'
        if (stale.length > 0) attention = { level: 'alert', text: `stale: ${stale.length === 1 ? '1 op was' : `${stale.length} ops were`} staged against a record that has changed` }
        else if (closes !== null && closes <= DAY_MS) attention = { level: 'alert', text: `closes in ${inWords(Math.max(closes, 0))}: ${missing}` }
        else attention = { level: 'warn', text: `open: ${missing}` }
      }
      const restricted = (entry.ops ?? []).some(isPlaceholder)
      const node: Resource = {
        // A proposal on private data is named on the map by what rule 8 lets every member read (L5 §9.5): the map is drawn
        // once for every viewer, so it never carries what only some of them are admitted to.
        id: `proposal:${id}`, kind: 'proposal', board: 'organization', name: restricted ? RESTRICTED_SUBJECT : String(entry.title ?? id), status: state,
        attention, changed: changes.get(id) ?? null,
        facts: {
          author: entry.author, opened: entry.opened, classes: entry.classes ?? [], rules: (entry.rules ?? []).map(r => r.id),
          evaluation: evaluation.state, missing: evaluation.missing, closesAt: evaluation.closesAt, stale, ops: entry.ops.length,
        },
        source: { path: REL, editable: false, registry: 'proposals', entityId: id },
      }
      nodes.push(node)
      edges.push({ from: node.id, to: `person:${entry.author}`, kind: 'proposed-by' })
      for (const op of gitOpsOf(entry.ops ?? [])) {
        const to = resourceOf(String(op.record))
        if (to) edges.push({ from: node.id, to, kind: 'touches' })
      }
    }
    return { nodes, edges }
  },
}
