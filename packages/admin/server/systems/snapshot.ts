import { caip10, checksumAddress } from '../../lib/caip.mjs'
import type { ActionInput, ActionSpec, Driver, DriverContext, DriverRead, DriverSection, ForeignRef, OutcomeReading, OutcomeRef, PreparedAction } from './driver.ts'
import { isForeignRef } from './driver.ts'
import { graphql } from './wire.ts'
import { ago } from './safe.ts'

/** Snapshot's hub: GraphQL, read-only here (https://docs.snapshot.box/tools/api). */
export const SNAPSHOT_HUB = 'https://hub.snapshot.org/graphql'
export const SNAPSHOT_HOST = 'hub.snapshot.org'

const SPACE_ID = /^[a-z0-9][a-z0-9.-]*$/i

/** The space a system record names: `space`, else read from its address (snapshot.box/#/s:<id>[/…] or snapshot.org/#/<id>). Throws a sentence. */
export function spaceOf(system: Record<string, unknown>): string {
  const fromUrl = (): string | null => {
    if (typeof system.url !== 'string') return null
    let u: URL
    try { u = new URL(system.url) } catch { return null }
    if (u.protocol !== 'https:' || !['snapshot.box', 'snapshot.org'].includes(u.hostname)) return null
    const m = /^#\/(?:s:)?([^/?]+)/.exec(u.hash)
    return m ? m[1]! : null
  }
  const id = typeof system.space === 'string' ? system.space : fromUrl()
  if (id === null) throw new Error('a Snapshot system names its space: "space", or an address like https://snapshot.box/#/s:<space>')
  if (!SPACE_ID.test(id)) throw new Error(`${JSON.stringify(id)} is not a Snapshot space id (letters, digits, dots and hyphens)`)
  return id
}

/** https://snapshot.box/#/s:<space>[/proposal/<id>]; `create` is the editor route (`create/:key?`, sx-monorepo apps/ui/src/routes/common.ts @ 61e3ed2). */
export const snapshotLink = (space: string, proposal?: string): string =>
  `https://snapshot.box/#/s:${space}${proposal ? `/proposal/${proposal}` : ''}`

export const SNAPSHOT_ACTIONS: ActionSpec[] = [{
  id: 'draft-proposal', label: 'Draft a Snapshot vote', class: null, params: [
    { name: 'title', label: 'Title', type: 'string' },
    { name: 'body', label: 'Body', type: 'text' },
    { name: 'choices', label: 'Choices', type: 'strings', optional: true },
    { name: 'type', label: 'Voting type', type: 'string', optional: true },
    { name: 'start', label: 'Voting starts', type: 'datetime' },
    { name: 'end', label: 'Voting ends', type: 'datetime' },
    { name: 'discussion', label: 'Discussion link', type: 'string', optional: true },
  ],
}]

export interface SnapshotProposal {
  id: string; state: string; type: string; choices: string[]; scores: number[]; scores_total: number
  scores_state: string; quorum: number; created: number; end: number; privacy: string; space: { id: string }
}
interface ListedProposal extends SnapshotProposal { title: string; start: number; votes: number }
interface SpaceAnswer {
  space: { id: string; name?: string; network: string; admins?: string[]
    voting?: { delay?: number | null; period?: number | null; quorum?: number | null; type?: string | null; privacy?: string | null }
    strategies?: { name: string }[]; validation?: { name: string } | null } | null
  active: ListedProposal[]; pending: ListedProposal[]; closed: ListedProposal[]
}

const QUERY = `query Q($s: String!) {
  space(id: $s) { id name network symbol admins moderators members
    voting { delay period quorum type privacy } strategies { name network } validation { name } filters { minScore onlyMembers } }
  active: proposals(first: 20, where: { space: $s, state: "active" }, orderBy: "end", orderDirection: asc) { ...P }
  pending: proposals(first: 20, where: { space: $s, state: "pending" }, orderBy: "start", orderDirection: asc) { ...P }
  closed: proposals(first: 5, where: { space: $s, state: "closed" }, orderBy: "end", orderDirection: desc) { ...P }
}
fragment P on Proposal { id title type state start end choices scores scores_total scores_state quorum votes privacy author created link space { id } }`

const OUTCOME_QUERY = 'query O($id: String!) { proposal(id: $id) { id state type choices scores scores_total scores_state quorum created end privacy space { id } } }'

/** Types whose result is one winning choice by score. */
const READ_TYPES = ['single-choice', 'approval', 'basic', 'weighted', 'quadratic', 'ranked-choice']

const short = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max - 1)}…`
const iso = (seconds: number) => new Date(seconds * 1000).toISOString()
/** A length of time, short: "23 h", "3 d". */
const span = (seconds: number, now: Date) => ago(new Date(now.getTime() - seconds * 1000).toISOString(), now)
const duration = (s: number | null | undefined): string =>
  s === null || s === undefined ? 'any' : s === 0 ? '0' : s % 86_400 === 0 ? `${s / 86_400} days` : s % 3_600 === 0 ? `${s / 3_600} h` : `${s} s`

/** The strictly leading choice by score: its index, or 'tie' (top score shared), or 'none' (nothing scored). */
function leader(scores: number[]): number | 'tie' | 'none' {
  const top = Math.max(0, ...scores)
  if (!(top > 0)) return 'none'
  const at = scores.flatMap((s, i) => s === top ? [i] : [])
  return at.length === 1 ? at[0]! : 'tie'
}

/** A closed vote's result as Recent results shows it. Scores are read only once final: before that the hub's zeros (a
 *  shielded vote's) or partial counts would read as "no votes" or as a winner (Review Focus 4). */
function result(p: SnapshotProposal): string {
  if (p.scores_state !== 'final') return p.privacy === 'shutter' ? 'shielded until it closes' : 'counting'
  const w = leader(p.scores)
  return w === 'tie' ? 'tie' : w === 'none' ? 'no votes' : p.choices[w]!
}

/** The outcome of a vote for the choice a rule names. Pure. Q-L2-1 / ruling K2. */
export function snapshotOutcome(p: SnapshotProposal, ref: ForeignRef, space: string, opened: string): OutcomeReading {
  if (ref.payload.kind !== 'snapshot-proposal') return { ok: false, error: 'a Snapshot space reads snapshot-proposal refs' }
  if (p.space?.id !== space) return { ok: true, outcome: 'mismatch', detail: `this vote belongs to ${p.space?.id ?? 'another space'}, not ${space}` }
  const openedMs = Date.parse(opened)
  if (!Number.isNaN(openedMs) && p.created * 1000 < openedMs) return { ok: true, outcome: 'mismatch', detail: 'posted before the proposal opened' }
  const label = ref.payload.choice
  const index = p.choices.indexOf(label)
  if (index < 0) return { ok: true, outcome: 'mismatch', detail: `the vote has no choice "${label}"` }
  if (p.privacy === 'shutter' && p.state !== 'closed') return { ok: true, outcome: 'pending', detail: 'the vote is shielded until it closes' }
  if (p.state !== 'closed') return { ok: true, outcome: 'pending', detail: `the vote is ${p.state}` }
  if (p.scores_state !== 'final') return { ok: true, outcome: 'pending', detail: 'the scores are not final yet' }
  if (!READ_TYPES.includes(p.type)) return { ok: false, error: `a ${p.type} vote has no single result the platform reads as passed` }
  if (p.quorum > 0 && p.scores_total < p.quorum) return { ok: true, outcome: 'failed', detail: `quorum not met (${p.scores_total} of ${p.quorum})` }
  const winner = leader(p.scores)
  if (winner === 'tie') return { ok: true, outcome: 'failed', detail: 'a tie' }
  if (winner === 'none') return { ok: true, outcome: 'failed', detail: 'no votes' }
  return winner === index
    ? { ok: true, outcome: 'executed', detail: `"${label}" won` }
    : { ok: true, outcome: 'failed', detail: `"${p.choices[winner]}" won, not "${label}"` }
}

const PROPOSAL_ID = /^(0x[0-9a-fA-F]{64}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/

function checkRef(system: Record<string, unknown>, raw: unknown): { ok: true; ref: ForeignRef } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error })
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad('a Snapshot ref is {"system", "id", "payload"}')
  const r = raw as Record<string, unknown>
  if (r.system !== system.id) return bad(`"system" is ${JSON.stringify(r.system)}; this space is ${JSON.stringify(system.id)}`)
  if (typeof r.id !== 'string' || !PROPOSAL_ID.test(r.id)) return bad(`"id" is not a Snapshot proposal id (0x and 64 hex digits, or an IPFS id starting Qm): ${JSON.stringify(r.id)}`)
  const payload = typeof r.payload === 'object' && r.payload !== null && !Array.isArray(r.payload) ? (r.payload as Record<string, unknown>) : null
  if (payload === null || payload.kind !== 'snapshot-proposal') return bad('a Snapshot ref has a "payload": {"kind": "snapshot-proposal", "choice": <the label of the choice that must pass>}')
  if (typeof payload.choice !== 'string' || payload.choice === '') return bad('"choice" is the label of the choice that must pass, as text')
  return { ok: true, ref: { system: system.id as string, id: r.id.startsWith('0x') ? r.id.toLowerCase() : r.id, payload: { kind: 'snapshot-proposal', choice: payload.choice } } }
}

async function outcome(system: Record<string, unknown>, ref: OutcomeRef, ctx: DriverContext & { opened: string }): Promise<OutcomeReading> {
  if (!isForeignRef(ref) || ref.payload.kind !== 'snapshot-proposal') throw new Error('a Snapshot space reads snapshot-proposal refs, not a Safe transaction or another system\'s ref')
  const space = spaceOf(system)
  const data = await graphql<{ proposal: SnapshotProposal | null }>(ctx, SNAPSHOT_HUB, OUTCOME_QUERY, { id: ref.id })
  if (!data.proposal) return { ok: true, outcome: 'pending', submitted: false, detail: 'not on Snapshot yet: post the draft in Snapshot, then attach its id' }
  return snapshotOutcome(data.proposal, ref, space, ctx.opened)
}

async function prepareAction(system: Record<string, unknown>, input: ActionInput, ctx: DriverContext): Promise<PreparedAction> {
  if (input.action !== 'draft-proposal') return { ok: false, error: `the snapshot-space driver has no action "${input.action}" (its actions: draft-proposal)` }
  const space = spaceOf(system)
  const refuse = (error: string): PreparedAction => ({ ok: false, error })
  const p = input.params
  const title = String(p.title), body = String(p.body)
  const start = Number(p.start), end = Number(p.end)
  if (title.length > 256) return refuse(`"title" is ${title.length} characters; Snapshot takes at most 256`)
  const data = await graphql<SpaceAnswer>(ctx, SNAPSHOT_HUB, QUERY, { s: space })
  if (!data.space) throw new Error(`Snapshot has no space ${space}`)
  const voting = data.space.voting ?? {}
  const type = typeof p.type === 'string' ? p.type : voting.type ?? 'single-choice'
  if (voting.type && type !== voting.type) return refuse(`${space} fixes the type of its votes to ${voting.type}; a ${type} vote cannot be drafted`)
  let choices = Array.isArray(p.choices) ? (p.choices as string[]) : []
  if (type === 'basic') {
    if (choices.length === 0) choices = ['For', 'Against', 'Abstain']
    else if (choices.length !== 3 || choices.some((c, i) => c !== ['For', 'Against', 'Abstain'][i])) return refuse('a basic vote has exactly the choices For, Against, Abstain')
  } else if (choices.length < 2) return refuse(`a ${type} vote needs "choices": at least two`)
  if (end <= start) return refuse('the vote ends before it starts')
  const period = voting.period ?? 0
  if (period > 0 && end - start !== period) return refuse(`${space}'s voting period is ${duration(period)}; this vote runs ${duration(end - start)}`)
  const earliest = Math.floor(ctx.now().getTime() / 1000) + (voting.delay ?? 0)
  if (start < earliest) return refuse(`the vote starts before ${iso(earliest)}, the earliest ${space} allows (now plus a delay of ${duration(voting.delay ?? 0)})`)
  return {
    ok: true, action: 'draft-proposal', steps: [], attach: null, link: `${snapshotLink(space)}/create`,
    draft: { space, type, title, body, choices, start, end, discussion: typeof p.discussion === 'string' ? p.discussion : '' },
  }
}

export const snapshotSpace: Driver = {
  name: 'snapshot-space',
  hosts: [SNAPSHOT_HOST],
  minGapMs: 1000,
  actions: SNAPSHOT_ACTIONS,
  prepareAction,
  outcome,
  checkRef,
  async read(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead> {
    const space = spaceOf(system)
    const data = await graphql<SpaceAnswer>(ctx, SNAPSHOT_HUB, QUERY, { s: space })
    const s = data.space
    if (!s) throw new Error(`Snapshot has no space ${space}`)
    const now = ctx.now()
    const chain = `eip155:${s.network}`
    const v = s.voting ?? {}
    const admins = (s.admins ?? []).map(a => caip10(chain, checksumAddress(a)))
    const open = [...(data.active ?? []).map(p => ({ p, live: true })), ...(data.pending ?? []).map(p => ({ p, live: false }))]
    const facts = {
      space, name: s.name ?? '', chain, admins,
      voting: { type: v.type ?? null, period: v.period ?? null, delay: v.delay ?? null, quorum: v.quorum ?? null, privacy: v.privacy ?? null },
      strategies: (s.strategies ?? []).map(x => x.name), validation: s.validation?.name ?? null, open: open.length,
      proposals: [...(data.active ?? []), ...(data.pending ?? []), ...(data.closed ?? [])].map(p => ({ id: p.id, title: p.title, state: p.state, type: p.type, start: p.start, end: p.end, created: p.created })),
    }
    const leading = (p: ListedProposal): string => {
      if (p.privacy === 'shutter') return 'shielded until it closes'
      const w = leader(p.scores)
      if (w === 'tie') return 'tied'
      if (w === 'none') return 'no votes yet'
      return `${p.choices[w]} ${Math.round(p.scores[w]! / p.scores_total * 100)}%`
    }
    const sections: DriverSection[] = [
      { title: 'Open votes', rows: open.map(({ p, live }) => ({
        cells: [short(p.title, 60), p.type, live ? `ends in ${span(p.end - now.getTime() / 1000, now)}` : `starts in ${span(p.start - now.getTime() / 1000, now)}`, leading(p)],
        ...(live ? { attention: 'alert' as const } : {}), href: snapshotLink(space, p.id),
      })) },
      { title: 'Recent results', rows: (data.closed ?? []).map(p => ({
        cells: [short(p.title, 60), result(p), `${p.votes} votes`, ago(iso(p.end), now)], href: snapshotLink(space, p.id),
      })) },
      { title: 'Settings', rows: [
        ['Voting', v.type ?? 'any'], ['Period', duration(v.period)], ['Delay', duration(v.delay)], ['Quorum', v.quorum === null || v.quorum === undefined ? 'any' : String(v.quorum)],
        ['Strategies', facts.strategies.join(', ')], ['Validation', facts.validation ?? 'any'], ['Admins', String(admins.length)],
      ].map(cells => ({ cells })) },
    ]
    return { ok: true, readAt: now.toISOString(), facts, sections, open: { url: snapshotLink(space), embeddable: false } }
  },
}
