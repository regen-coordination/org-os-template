/** The commons as the resource store sees it: **attention only**. A queue that waits on a person arrives where the
 *  house puts everything that does (spec §4.3, R-34) — one resource per waiting thing, so Home's Needs you block and
 *  the sidebar's clay count read them with no second feed.
 *
 *  The canon's entries are not resources: they are a collection, drawn by their own page. That keeps the organization
 *  board from filling with one node per entry. */
import { kmsPresence } from '../../knowledge/kms.ts'
import { readKnowledge } from '../../knowledge/read.ts'
import type { Adapter, Resource } from '../types.ts'

const ME = { name: 'knowledge', board: 'organization' as const, title: 'Knowledge commons' }

const waiting = (id: string, name: string, text: string, facts: Record<string, unknown>, level: 'warn' | 'alert' = 'warn'): Resource => ({
  id: `knowledge:${id}`, kind: 'knowledge', board: 'organization', name, status: null,
  attention: { level, text }, changed: null, facts,
  source: { path: 'data/kb', editable: false },
})

export const knowledge: Adapter = {
  ...ME,
  watch: ['kms.yaml', 'data/kb', 'data/kms-reads.json', 'data/kms-cursors.json'],
  async read(ctx) {
    const presence = kmsPresence(ctx.repo)
    // Not this instance's source at all: the quiet card, which asks nothing of the person (graph.ts's `quiet`).
    if (!presence.ok) return { absent: presence.reason }
    const view = await readKnowledge(ctx.repo, { now: ctx.now().toISOString() })
    if (!view.configured) return { absent: view.reason ?? 'the commons cannot be read here' }
    // The commons is one place: one row for it, so the sidebar lists the collection whether or not anything waits.
    const nodes: Resource[] = [{
      id: 'knowledge:commons', kind: 'knowledge', board: 'organization',
      name: view.instance ?? 'Knowledge commons', status: `${view.counts.published} published`,
      attention: null, changed: null,
      facts: { entries: view.counts.entries, published: view.counts.published, awaiting: view.counts.awaiting, kinds: view.counts.kinds },
      source: { path: 'data/kb', editable: false },
    }]
    for (const lane of view.lanes) {
      for (const row of lane.rows) {
        // A person's turn is clay; a rule's withholding is clay too, and says so in the row's own words.
        if (row.lane === 'awaiting') nodes.push(waiting(row.id, row.title, row.why, { type: row.type, slug: row.slug, lane: row.lane, updated: row.updated }))
        else if (row.why.startsWith('your rule:')) nodes.push(waiting(row.id, row.title, row.why, { type: row.type, slug: row.slug, lane: row.lane }, 'alert'))
      }
    }
    for (const peer of view.peers) {
      if (peer.state !== 'failed') continue
      nodes.push(waiting(`peer:${peer.id}`, `${peer.name} couldn’t be read`, `last good read ${peer.ageDays ?? '—'} d ago`, { peer: peer.id, relation: peer.relation, error: peer.error }, 'alert'))
    }
    // Nothing waiting is an empty graph, not an absence: the commons is here and simply has nothing for you.
    return { nodes, edges: [] }
  },
}
