// The Federation page's words (network N2 Task 13): pure, so each sentence is tested on its own. Counts only for what is
// kept private; never a peer's name or DID here.
import type { JoinPolicy } from '../api.ts'
import { answerLine, verdictReason } from '../../../lib/federation/answer.mjs'

/** A link's state, as the fleet card carries it (lib/federation/state.mjs), and the outgoing request's answer. */
export function linkWords(state: string | null, refused?: { reason?: string } | null): string {
  if (refused) return verdictReason(refused.reason) ? answerLine('refused', refused.reason) : 'Refused: no reason given'
  switch (state) {
    case 'mutual': return 'Part of it'
    case 'requested': return 'Asked, waiting'
    case 'claimed': return 'Only this side lists it'
    case 'left': return 'Left'
    case 'not-an-instance': return 'A repo, not an instance'
    default: return 'Not checked yet'
  }
}

export interface Sources { files?: string; atproto?: string; checked?: string | null }

/** The date a failed atproto read happened, from the card's reason (`couldn't check their records (<date>)`). */
const failedAt = (reason: string | null | undefined): string | null => /couldn't check their records \(([^)]+)\)/.exec(reason ?? '')?.[1] ?? null
const day = (iso: string): string => iso.slice(0, 10)

/** The second line of a link: what their atproto records say. `left` from a deleted record says they withdrew it. */
export function atprotoLine(state: string | null, sources: Sources | null | undefined, reason?: string | null): string {
  const a = sources?.atproto ?? 'unknown'
  if (state === 'left' && a === 'silent') return 'They withdrew their record.'
  if (a === 'lists-us') return "On atproto: they've published it"
  if (a === 'silent') return 'On atproto: not yet'
  if (a === 'not-on-atproto') return "On atproto: they're not on atproto"
  const at = failedAt(reason) ?? sources?.checked ?? null
  return at ? `On atproto: couldn't check (${day(at)})` : "On atproto: couldn't check"
}

/** What a hub's policy means for the one asking. No join block, or an unknown policy, is closed. */
export function policySentence(policy: JoinPolicy | null | undefined): string {
  switch (policy) {
    case 'invite': return 'This network joins by invite.'
    case 'open-with-approval': return 'Anyone can ask. The hub decides under its own rules.'
    case 'open': return 'Anyone can join. The hub has agreed to accept requests.'
    default: return "This network isn't taking requests."
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The publish plan's counts, in one sentence. */
export function planCounts(p: { create: number; delete: number; profile: boolean }): string {
  if (p.create === 0 && p.delete === 0 && !p.profile) return 'Everything is published.'
  const parts = [`${plural(p.create, 'link', 'links')} to publish`, `${p.delete} to withdraw`]
  return `${parts.join(', ')}${p.profile ? ', and the profile to update' : ''}.`
}

/** Peers kept off atproto, counted, never named. */
export function keptLine(k: number): string | null {
  return k > 0 ? `${plural(k, 'peer is', 'peers are')} kept private and never published.` : null
}

/** Networks this page does not name, because their hub is kept private. */
export function hiddenNetworksLine(k: number): string | null {
  return k > 0 ? `${plural(k, 'network is', 'networks are')} kept private, so ${k === 1 ? 'it is' : 'they are'} not listed here.` : null
}

export interface Drift { side: 'ours' | 'theirs'; text: string; urgent?: boolean }

/** How a drift line is fixed: ours by publishing (confirmed), theirs only by asking them. */
export function driftFix(d: Drift): { publish: true } | { say: string } {
  if (d.side === 'ours') return { publish: true }
  if (/files list you/.test(d.text)) return { say: 'Ask them to publish their record.' }
  return { say: 'Ask them to list you in their federation.yaml.' }
}

/** Ours first, the urgent ones first among ours. */
export function driftOrder<T extends Drift>(lines: T[]): T[] {
  const rank = (d: Drift) => (d.side === 'ours' ? (d.urgent ? 0 : 1) : 2)
  return [...lines].sort((a, b) => rank(a) - rank(b))
}

/** The relation picker's choices: the four values a peer's `link` may take. */
export const RELATIONS: { value: string; label: string }[] = [
  { value: 'memberOf', label: 'Member of' },
  { value: 'hasMember', label: 'Has member' },
  { value: 'peerOf', label: 'Peer of' },
  { value: 'none', label: "Don't publish" },
]

/** The Join policy picker's four choices; `open-with-approval` is the one marked Recommended (R17). */
export const POLICIES: { value: JoinPolicy; label: string; hint?: string }[] = [
  { value: 'closed', label: 'Closed: no requests' },
  { value: 'invite', label: 'By invite only' },
  { value: 'open-with-approval', label: 'Anyone can ask; you decide under your rules', hint: 'Recommended' },
  { value: 'open', label: 'Anyone can join, under a standing decision' },
]

/** R17's fallback, said when `open` is chosen without a decision. */
export const OPEN_FALLBACK = 'Without a decision, this works as "anyone can ask, the hub decides".'

/** A comma- or line-separated list (instance types, which hold no commas), trimmed, empties dropped. */
export const listOf = (text: string): string[] => text.split(/[,\n]/).map(s => s.trim()).filter(Boolean)

/** One item per line, trimmed, empties dropped: an ask is a sentence and may hold commas. */
export const linesOf = (text: string): string[] => text.split('\n').map(s => s.trim()).filter(Boolean)
