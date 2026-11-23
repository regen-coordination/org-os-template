import { readLedger } from '../../proposals/ledger.ts'
import { hubRequests, label, toReplyOf, type HubRequest } from '../../federation/hub.ts'
import type { Adapter, Resource } from '../types.ts'

// The join requests this hub received, as resources (network N2 Task 10): one `federation-request` per record of
// data/federation-requests.yaml, on the Organization map. The request records are org-level facts and the answers a
// node gave are free text from outside, so everything shown here is read through `label` (control and format
// characters removed, one line, capped), and the resource is members-only: it has no registry, so the visibility gate
// never admits it to the public (gate.ts `resource`). The reply receipts live under stateDir, which no watcher sees:
// `federation.poll`, `federation.reply` and a decision re-read this adapter through `refreshes: 'federation'`.

const ME = { name: 'federation', board: 'organization' as const, title: 'Join requests' }
const REL = 'data/federation-requests.yaml'

/** At most this many answers are carried, each key and value capped, so a request cannot make a card unbounded. */
const ANSWERS_MAX = 20
const KEY_MAX = 60
const VALUE_MAX = 200

/** What a request's answers are as the board shows them: strings only, stripped of control and format characters,
 *  one line, capped. Anything else a forged record holds is dropped. */
export function shownAnswers(answers: unknown): Record<string, string> {
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(answers as Record<string, unknown>).slice(0, ANSWERS_MAX)) {
    if (typeof v !== 'string') continue
    out[label(k, KEY_MAX)] = label(v, VALUE_MAX)
  }
  return out
}

/** The board's column for a request: held and proposed are under decision, accepted is mutual (accepted by the hub),
 *  refused is refused; a proposed record whose proposal the ledger does not hold (yet) is only requested. */
export function statusOf(h: Pick<HubRequest, 'outcome'>, proposalKnown: boolean): 'requested' | 'under-decision' | 'mutual' | 'refused' {
  if (h.outcome === 'accepted') return 'mutual'
  if (h.outcome === 'refused') return 'refused'
  if (h.outcome === 'held') return 'under-decision'
  return proposalKnown ? 'under-decision' : 'requested'
}

export const federation: Adapter = {
  ...ME,
  // The records and the proposals their outcome comes from.
  watch: [REL, 'data/proposals.yaml'],
  async read(ctx) {
    const requests = hubRequests(ctx.repo)
    if (requests.length === 0) return { nodes: [], edges: [] }
    const ledgerIds = new Set(readLedger(ctx.repo).entries.map(p => String(p.id)))
    const toReply = new Set(toReplyOf(ctx.repo).map(r => r.id))
    const nodes: Resource[] = requests.map(h => {
      const r = h.record
      const proposed = r.outcome === 'proposed'
      // `outcomeOf` leaves a proposed record at `proposed` while its proposal is open (or absent); a closed one has become
      // accepted or refused already, so an unsettled proposed record is under decision only when the ledger holds the proposal it names.
      const status = statusOf(h, proposed && ledgerIds.has(String(r.proposal)))
      return {
        id: `federation-request:${r.id}`, kind: 'federation-request', board: 'organization', name: label(r.from.name), status,
        attention: h.outcome === 'held' ? { level: 'warn', text: 'Decide it.' }
          : toReply.has(r.id) ? { level: 'warn', text: 'Tell them the outcome.' } : null,
        changed: null,
        facts: {
          from: label(r.from.name), network: label(r.network), transport: label(r.transport, 40), ref: r.ref === null ? null : label(r.ref, 200),
          received: label(r.received, 40), outcome: h.outcome, sentence: h.sentence,
          ...(r.proposal ? { proposal: label(r.proposal, 60) } : {}),
          replied: h.replied === null ? null : { at: label(h.replied.at, 40), ref: label(h.replied.ref, 200) },
          answers: shownAnswers(r.answers),
        },
        // No registry: the visibility gate gives such a resource to members only, whatever data/visibility.yaml says.
        source: { path: REL, editable: false },
      } satisfies Resource
    })
    return { nodes, edges: [] }
  },
}
