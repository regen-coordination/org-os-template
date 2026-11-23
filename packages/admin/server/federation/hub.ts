// The hub's side of joining a network (network N2 Task 9): receive a request, apply this hub's own join policy, reply.
//
// - Receiving is an actor route (the caller holds the write lock): it reads the request, refuses what it can't read
//   and what it has received before, and decides under `join` as committed on the trunk. A refusal is recorded; an
//   acceptance (an invite, or a standing decision) is one commit of the peer and the record; anything else is a proposal
//   from outside the org (`origin`), or, where the importer may change identity alone, held for the operator.
// - The hub's change is built from the validated request fields only (`hubPeerOf`, R13), never from the text. The
//   peer's `did` comes from the node's own federation.json as last looked up, never from the request, and never fetched.
// - Received requests live in the hub's git, org-level facts only (R13, R27). Nothing here publishes on atproto: after
//   an acceptance lands on the trunk, publishing `hasMember` is the separate, confirmed `federation.publish-links`
//   (R16, R20, R25). A refused request publishes nothing, ever.
// - Polling and replying are confirmed network operations. They write only under stateDir (the inbox, the reply
//   receipts), never in git: an in-process operation has no actor and can't commit (R20).
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { HttpError } from '../errors.ts'
import { stateDir } from '../state.ts'
import { STRINGIFY } from '../splice.ts'
import { showFile } from '../git.ts'
import { actorTrailer, commitIdent, type KnownActor } from '../actor.ts'
import { createdText, entriesFromText, updatedText } from '../registry.ts'
import { registryDef } from '../registries.ts'
import { fileBase, fileText } from '../workspace/files.ts'
import { guardFiles } from '../changes/apply.ts'
import { classesOf, targetsOfOps } from '../changes/stage.ts'
import { newChangeId } from '../changes/store.ts'
import type { Change, FileOp } from '../changes/types.ts'
import { effectiveRule, readRuleContext, ruleIds } from '../governance/effective.ts'
import { propose, type ProposeDeps } from '../proposals/propose.ts'
import { readLedger } from '../proposals/ledger.ts'
import { runCommand } from '../resources/run.ts'
import { DID_PATTERN, readFederation } from '../../lib/federation/read.mjs'
import { hubPeerOf, parseRequest } from '../../lib/federation/request.mjs'
import type { FederationRequest } from '../../lib/federation/request.mjs'
import { intakeOutcome } from '../../lib/federation/intake.mjs'
import { JOIN_RULE } from '../../lib/federation/join-rule.mjs'
import type { Invite } from '../../lib/federation/invite.mjs'
import type { Proposal } from '../../lib/proposals.mjs'
import type { Resource, Runner } from '../resources/types.ts'
import type { InProcess, Operation, Variant } from '../operations/catalogue.ts'
import { writeHubFiles, type HubFile } from './ledger.ts'
import { readTrunkFederation } from './trunk.ts'
import { federationDoc, federationSeq, mapsIn, normUrl } from './node.ts'
import { remoteCache, wellKnownUrlOf } from './remote.ts'
import { transportOf, transports } from './transports/index.ts'

export const SENTENCES = {
  already: 'Already received.',
  publish: 'Publish the link so it shows as mutual on atproto.',
  reasonNeeded: 'Say why it is refused.',
  notHeld: "This request isn't waiting for your decision.",
  noRequest: 'No such request.',
  noWhere: 'Say where this hub takes requests first: join.where in federation.yaml.',
  noNetwork: 'This hub has no network by that name.',
  alreadyMember: 'This instance is already a member here.',
  otherRole: 'This instance is already listed here in another role, which a join request does not change.',
  notTaking: "This hub isn't taking requests now.",
} as const

const FED = 'federation.yaml'
const REQUESTS = 'data/federation-requests.yaml'
const INVITES = 'data/invites.yaml'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()
/** Text from a request as it may appear in a commit subject, a proposal title, a sentence or a reply: control and format
 *  characters (ESC, NUL, RLO and the other bidi marks) removed, one line, at most 100 characters. parseRequest already
 *  refuses them in the fields this names; this is the second wall, for every place untrusted text is shown. */
export function label(s: unknown, max = 100): string {
  const clean = oneLine(String(s ?? '').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' '))
  // by code points, so a character outside the BMP (an emoji) is never cut in half
  const points = Array.from(clean)
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : clean
}

// ── the records ────────────────────────────────────────────────────────────────────────────────────

/** One row of `data/federation-requests.yaml`: org-level facts only (R13). */
export interface RequestRecord {
  id: string; received: string; transport: string; ref: string | null
  from: { name: string; type: string; url: string }
  network: string; answers: Record<string, string>; invite: string | null
  outcome: 'refused' | 'accepted' | 'proposed' | 'held'
  reason?: string; proposal?: string; decision?: string
}

/** The requests this hub has received, from the working tree (empty when there is no ledger yet). */
export function readRecords(repo: string): RequestRecord[] {
  const text = fileText(repo, REQUESTS)
  if (text === null) return []
  try { return entriesFromText(text, 'federation-requests') as unknown as RequestRecord[] } catch { return [] }
}

/** What a request came to: a proposed request's outcome is its proposal's, derived, never stored twice. */
export interface HubRequest {
  record: RequestRecord
  outcome: RequestRecord['outcome']
  /** Accepted or refused: there is an answer to give. */
  final: boolean
  reason?: string
  decision?: string
  /** The hub's own sentence for it. */
  sentence: string
  /** When and where the asker was told, from the receipt under stateDir; null while they have not been. */
  replied: { at: string; ref: string } | null
}

const acceptedSentence = (r: RequestRecord, proposal?: string): string =>
  `Accepted ${label(r.from.name)} into ${label(r.network)}${proposal ? ` (proposal ${proposal})` : ''}. ${SENTENCES.publish}`

/** A record and the proposals ledger, read together. */
export function outcomeOf(record: RequestRecord, proposals: readonly Proposal[]): Omit<HubRequest, 'replied'> {
  const name = label(record.from.name)
  const network = label(record.network)
  if (record.outcome === 'proposed') {
    const p = proposals.find(x => String(x.id) === record.proposal)
    if (p?.state === 'ratified') {
      return { record, outcome: 'accepted', final: true, decision: `request ${record.id}`, sentence: acceptedSentence(record, record.proposal) }
    }
    if (p && ['rejected', 'expired', 'withdrawn'].includes(p.state)) {
      const reason = `The proposal ${record.proposal} was ${p.state}.`
      return { record, outcome: 'refused', final: true, reason, sentence: `Refused: ${reason}` }
    }
    return { record, outcome: 'proposed', final: false, sentence: `Proposed as ${record.proposal}: ${name} joins ${network} once it is ratified.` }
  }
  if (record.outcome === 'held') return { record, outcome: 'held', final: false, sentence: `Held for you to decide: ${name} asks to join ${network}.` }
  if (record.outcome === 'accepted') return { record, outcome: 'accepted', final: true, decision: record.decision, sentence: acceptedSentence(record) }
  return { record, outcome: 'refused', final: true, reason: record.reason, sentence: `Refused: ${record.reason ?? 'no reason was given.'}` }
}

/** Every received request with its outcome and whether the asker has been told. Never throws. */
export function hubRequests(repo: string): HubRequest[] {
  const proposals = readLedger(repo).entries
  return readRecords(repo).map(r => ({ ...outcomeOf(r, proposals), replied: readReplied(repo, r.id) }))
}

/** What the asker is told: a welcome, or the reason. One line; it goes after `Accepted: ` or `Refused: `. */
export function replySentence(h: Pick<HubRequest, 'outcome' | 'reason' | 'record'>): string {
  return h.outcome === 'accepted' ? `Welcome to ${label(h.record.network)}.` : label(h.reason ?? 'Refused.', 200)
}

/** The self card's `facts.toReply`: final outcomes not yet told, whose transport can reply. */
export function toReplyOf(repo: string): { id: string; from: string; outcome: 'accepted' | 'refused' }[] {
  return hubRequests(repo)
    .filter(h => h.final && h.replied === null && h.record.ref !== null && transportOf(h.record.transport)?.reply !== undefined)
    .map(h => ({ id: h.record.id, from: label(h.record.from.name), outcome: h.outcome as 'accepted' | 'refused' }))
}

// ── what is kept outside git: the inbox and the reply receipts ─────────────────────────────────────

export interface InboxItem { transport: string; ref: string; text: string }
const inboxDir = (repo: string): string => join(stateDir(repo), 'federation', 'inbox')
const repliedDir = (repo: string): string => join(stateDir(repo), 'federation', 'replied')
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

function writeAtomic(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
  renameSync(tmp, file)
}

/** Puts one polled request in the inbox, keyed by the sha256 of its ref (the same ref polled twice is one item). */
export function inboxPut(repo: string, item: InboxItem): void {
  writeAtomic(inboxDir(repo), `${sha256(item.ref)}.json`, { transport: item.transport, ref: item.ref, text: item.text })
}

/** The inbox, oldest name first. Items that can't be read are left out. */
export function listInbox(repo: string): (InboxItem & { file: string })[] {
  let names: string[] = []
  try { names = readdirSync(inboxDir(repo)).filter(n => /^[0-9a-f]{64}\.json$/.test(n)).sort() } catch { return [] }
  return names.flatMap(file => {
    try {
      const v = JSON.parse(readFileSync(join(inboxDir(repo), file), 'utf8')) as Partial<InboxItem>
      return typeof v.transport === 'string' && typeof v.ref === 'string' && typeof v.text === 'string' ? [{ file, transport: v.transport, ref: v.ref, text: v.text }] : []
    } catch { return [] }
  })
}

const inboxDrop = (repo: string, file: string): void => { if (/^[0-9a-f]{64}\.json$/.test(file)) rmSync(join(inboxDir(repo), file), { force: true }) }

export function readReplied(repo: string, id: string): { at: string; ref: string } | null {
  if (!UUID.test(id)) return null
  try {
    const v = JSON.parse(readFileSync(join(repliedDir(repo), `${id}.json`), 'utf8')) as { at?: unknown; ref?: unknown }
    return typeof v.at === 'string' && typeof v.ref === 'string' ? { at: v.at, ref: v.ref } : null
  } catch { return null }
}
const writeReplied = (repo: string, id: string, receipt: { at: string; ref: string }): void => writeAtomic(repliedDir(repo), `${id}.json`, receipt)

// ── the hub's edit of federation.yaml ─────────────────────────────────────────────────────────────

/** The node's DID as its own federation.json carried it at the last lookup; null when it was never looked up. Never fetches. */
export function cachedDid(repo: string, url: string): string | null {
  const wk = wellKnownUrlOf(url)
  const doc = wk === null ? null : remoteCache(repo).get(wk)?.doc
  return doc && typeof doc.did === 'string' && DID_PATTERN.test(doc.did) ? doc.did : null
}

/** federation.yaml with the node's one peer entry, built from validated fields (`hubPeerOf`). A node that is already a
 *  peer is not listed twice: its entry keeps its earliest `decision` (so a second network's acceptance never erases the
 *  meaning of the first; `relationOf` reads only that there is one) and gains a `did` only where it has none. */
export function memberText(text: string, request: FederationRequest, decision: string, did: string | null): string {
  const doc = federationDoc(text)
  const peers = federationSeq(doc, 'peers')
  const existing = mapsIn(peers).find(p => normUrl(p.get('url')) === normUrl(request.from.url))
  if (existing) {
    if (existing.get('decision') === undefined || existing.get('decision') === null) existing.set('decision', decision)
    if (did && existing.get('did') === undefined) existing.set('did', did)
  } else {
    if (peers.flow && peers.items.length === 0) peers.flow = false
    peers.items.push(doc.createNode(hubPeerOf(request, decision, did)))
  }
  return doc.toString(STRINGIFY)
}

// ── receiving ─────────────────────────────────────────────────────────────────────────────────────

export interface Received { ref: string | null; outcome: RequestRecord['outcome'] | 'already' | 'unreadable'; sentence: string; proposal?: string; commit?: string }
export interface HubDeps { startBranch?: string; build?: ProposeDeps['build'] }

/** The answers to this hub's asks, and only those: anything else the request carries stays out of git. */
function asked(request: FederationRequest, asks: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const ask of asks) if (Object.hasOwn(request.answers, ask) && typeof request.answers[ask] === 'string') out[ask] = request.answers[ask]
  return out
}

/** The text a data file holds now, or a new file with its top key. */
const ledgerText = (repo: string, rel: string, registry: string): string => fileText(repo, rel) ?? `${registryDef(registry).topKey}: []\n`

/** Invites as committed on the trunk (R14): a staged or uncommitted invite matches nothing. */
async function trunkInvites(repo: string, trunk: string): Promise<Invite[]> {
  try { return entriesFromText(await showFile(repo, `refs/heads/${trunk}`, INVITES), 'invites') as unknown as Invite[] } catch { return [] }
}

const fedOp = (repo: string, text: string): FileOp => ({ op: 'file', path: FED, text, base: fileBase(repo, FED) })
const ruleFor = (repo: string, actor: KnownActor, op: FileOp) => effectiveRule(readRuleContext(repo, actor), classesOf([op], repo), targetsOfOps([op], repo))

/** The record a proposal opened for request `id` stands for, rebuilt from the proposal alone (its staged peer and the
 *  hub's network), for when its record never landed. Null when the proposal stages no such peer. */
function recordOfProposal(p: Proposal, id: string, fed: { networks: { name: string; role?: string | null }[] }, base: RequestRecord): RequestRecord | null {
  const op = (p.ops as { op?: string; path?: string; text?: string | null }[]).find(o => o.op === 'file' && o.path === FED && typeof o.text === 'string')
  if (!op) return null
  let doc: unknown
  try { doc = parse(op.text as string) } catch { return null }
  const staged = (doc as { peers?: unknown } | null)?.peers
  const peer = Array.isArray(staged) ? staged.find(x => x && typeof x === 'object' && (x as Record<string, unknown>).decision === `request ${id}`) as Record<string, unknown> | undefined : undefined
  if (!peer || typeof peer.name !== 'string' || typeof peer.type !== 'string' || typeof peer.url !== 'string') return null
  const hubs = fed.networks.filter(n => n.role === 'hub')
  const network = hubs.length === 1 ? hubs[0].name : fed.networks.length === 1 ? fed.networks[0].name : null
  if (network === null) return null
  return { ...base, from: { name: peer.name, type: peer.type, url: peer.url }, network, answers: {}, outcome: 'proposed', proposal: String(p.id) }
}

/** Receives one request. The caller holds the write lock. A request that can't be read, or was received before, writes
 *  nothing; every other one is recorded in the hub's git under the outcome its join policy gives. Every commit names
 *  `Org-Rule: federation/join` (lib/federation/join-rule.mjs): the hub's policy is the authority, not the importer's rule. */
export async function receive(repo: string, actor: KnownActor, incoming: { transport: string; ref: string | null; text: string }, now: Date, deps: HubDeps = {}): Promise<Received> {
  const { request, problems } = parseRequest(incoming.text)
  if (!request) return { ref: incoming.ref, outcome: 'unreadable', sentence: `Not received: ${label(problems.join(' '))}` }
  const ref = incoming.ref ?? `file:${request.id}`
  const name = label(request.from.name)
  const network = label(request.network)
  const who = actorTrailer(actor)
  const ident = commitIdent(actor)
  const opts = { startBranch: deps.startBranch }
  const trailers = (decision?: string) => ({ actor: who, rule: JOIN_RULE, ...(decision ? { decision } : {}) })
  const recorded = (record: RequestRecord): HubFile => ({ rel: REQUESTS, text: createdText(ledgerText(repo, REQUESTS, 'federation-requests'), 'federation-requests', record as unknown as Record<string, unknown>) })

  // Once: by id and by where it came from. A proposal already opened for it whose record never landed (its commit failed
  // after the proposal's) gets that record now, instead of a second proposal.
  if (readRecords(repo).some(r => r.id === request.id || r.ref === ref)) return { ref, outcome: 'already', sentence: SENTENCES.already }
  const trunk = await readTrunkFederation(repo, deps.startBranch)
  if ('problem' in trunk) throw new HttpError(409, `Not received: ${trunk.problem}`)
  const join = trunk.fed.join
  const base: RequestRecord = {
    id: request.id, received: now.toISOString(), transport: incoming.transport, ref,
    from: { name: request.from.name, type: request.from.type, url: request.from.url },
    network: request.network, answers: asked(request, join?.asks ?? []), invite: null, outcome: 'refused',
  }
  const opened = readLedger(repo).entries.find(p => (p.origin as { request?: unknown } | undefined)?.request === request.id)
  if (opened) {
    const proposal = String(opened.id)
    // The record is the proposal's, not this text's: its asker is the peer the proposal stages (`decision: request <id>`),
    // and its network the hub's own. What this import says beyond its id and ref is not taken.
    const missing = recordOfProposal(opened, request.id, trunk.fed, base)
    if (!missing) throw new HttpError(409, `Not received: proposal ${proposal} is open for this request, but its record can't be rebuilt from it. Record it by hand.`)
    const { commit } = await writeHubFiles(repo, [recorded(missing)],
      `federation: ${name}'s request to join ${network} is proposed as ${proposal}`, trailers(), ident, opts)
    return { ref, outcome: 'proposed', sentence: `Proposed as ${proposal}: ${name} joins ${network} once it is ratified.`, proposal, commit }
  }

  const invites = await trunkInvites(repo, trunk.trunk)
  const policy = intakeOutcome(join, request, invites, now)
  const listed = trunk.fed.peers.find(p => normUrl(p.url) === normUrl(request.from.url))
  // What the policy can't see: a network this hub doesn't list (never echoed: it is the asker's text), and an instance
  // this hub already lists in another role (a request never turns a hub or a peer into a member).
  const outcome = policy.kind === 'refuse' ? policy
    : !trunk.fed.networks.some(n => n.name === request.network) ? { kind: 'refuse' as const, reason: SENTENCES.noNetwork }
    : listed && listed.relationship !== 'node' ? { kind: 'refuse' as const, reason: SENTENCES.otherRole }
    // Already a member, and nothing admits it again: proposing would propose an unchanged federation.yaml.
    : listed && listed.decision && policy.kind === 'propose' ? { kind: 'refuse' as const, reason: SENTENCES.alreadyMember }
    : policy

  if (outcome.kind === 'refuse') {
    const { commit } = await writeHubFiles(repo, [recorded({ ...base, outcome: 'refused', reason: outcome.reason })],
      `federation: refuse ${name}'s request to join ${network}`, trailers(), ident, opts)
    return { ref, outcome: 'refused', sentence: `Refused: ${outcome.reason}`, commit }
  }

  const did = cachedDid(repo, request.from.url)
  if (outcome.kind === 'accept') {
    const decision = outcome.by === 'invite' ? `invite ${outcome.invite.id}` : outcome.decision
    const files: HubFile[] = [
      { rel: FED, text: memberText(fileText(repo, FED) ?? '', request, decision, did) },
      recorded({ ...base, outcome: 'accepted', invite: outcome.by === 'invite' ? outcome.invite.id : null, decision }),
    ]
    if (outcome.by === 'invite') {
      files.push({ rel: INVITES, text: updatedText(ledgerText(repo, INVITES, 'invites'), 'invites', outcome.invite.id, { ...outcome.invite, used_by: request.id } as unknown as Record<string, unknown>) })
    }
    const { commit } = await writeHubFiles(repo, files, `federation: accept ${name} into ${network}`, trailers(decision), ident, opts)
    return { ref, outcome: 'accepted', sentence: acceptedSentence(base), commit }
  }

  // Proposed: the edit carries the decision a ratify makes true (R3), so the member is published once it is.
  await guardFiles(repo, [FED])
  const op = fedOp(repo, memberText(fileText(repo, FED) ?? '', request, `request ${request.id}`, did))
  if (ruleFor(repo, actor, op).direct) {
    // The importer may change identity alone, so a proposal would be refused as DIRECT: the operator decides it (R19).
    const { commit } = await writeHubFiles(repo, [recorded({ ...base, outcome: 'held' })],
      `federation: hold ${name}'s request to join ${network}`, trailers(), ident, opts)
    return { ref, outcome: 'held', sentence: `Held for you to decide: ${name} asks to join ${network}.`, commit }
  }
  const at = now.toISOString()
  // Its own change, not the importer's tray: nothing else they have staged rides along into the proposal.
  const change: Change = { id: newChangeId(), actor: actor.id, created: at, updated: at, ops: [op] }
  const result = await propose(repo, actor, change, {
    title: `Join request: ${name} → ${network}`,
    origin: { kind: 'federation-request', request: request.id, from: name },
  }, { now: () => now, startBranch: deps.startBranch, build: deps.build })
  const proposal = String(result.proposal.id)
  // No Org-Proposal trailer: that names a ratified proposal; this commit only records the open one.
  const { commit } = await writeHubFiles(repo, [recorded({ ...base, outcome: 'proposed', proposal })],
    `federation: ${name}'s request to join ${network} is proposed as ${proposal}`, trailers(), ident, opts)
  return { ref, outcome: 'proposed', sentence: `Proposed as ${proposal}: ${name} joins ${network} once it is ratified.`, proposal, commit }
}

/** The operator's decision on a held request: accept (one commit of the peer and the record) or refuse with a reason. Both
 *  are the operator's own act under their direct rule, checked again now, and the commit names that rule. Accepting also
 *  checks that the network is still listed and the hub still takes requests. The caller holds the write lock. */
export async function decide(repo: string, actor: KnownActor, id: string, choice: { accept: boolean; reason?: string }, deps: HubDeps = {}): Promise<Received> {
  const record = readRecords(repo).find(r => r.id === id)
  if (!record) throw new HttpError(404, SENTENCES.noRequest)
  if (record.outcome !== 'held') throw new HttpError(409, SENTENCES.notHeld)
  const name = label(record.from.name)
  const network = label(record.network)
  const ident = commitIdent(actor)
  const opts = { startBranch: deps.startBranch }
  const updated = (next: RequestRecord): HubFile => ({ rel: REQUESTS, text: updatedText(ledgerText(repo, REQUESTS, 'federation-requests'), 'federation-requests', id, next as unknown as Record<string, unknown>) })
  /** The operator's rule for a change of federation.yaml, now: direct, or refused in its words. */
  const direct = (op: FileOp, verb: string): string => {
    const ctx = readRuleContext(repo, actor)
    const classes = classesOf([op], repo)
    const targets = targetsOfOps([op], repo)
    const rule = effectiveRule(ctx, classes, targets)
    if (!rule.direct) throw new HttpError(409, `Not ${verb}: ${rule.sentence.replace(/\.$/, '')}. Nothing was written.`)
    return ruleIds(ctx, classes, targets).map(r => `${r}/direct`).join(',')
  }
  if (!choice.accept) {
    const reason = label(choice.reason ?? '', 200)
    if (reason === '') throw new HttpError(400, SENTENCES.reasonNeeded)
    const rule = direct(fedOp(repo, fileText(repo, FED) ?? ''), 'refused')
    const { commit } = await writeHubFiles(repo, [updated({ ...record, outcome: 'refused', reason })],
      `federation: refuse ${name}'s request to join ${network}`, { actor: actorTrailer(actor), rule }, ident, opts)
    return { ref: record.ref, outcome: 'refused', sentence: `Refused: ${reason}`, commit }
  }
  const trunk = await readTrunkFederation(repo, deps.startBranch)
  if ('problem' in trunk) throw new HttpError(409, `Not accepted: ${trunk.problem}`)
  if (!trunk.fed.join || trunk.fed.join.policy === 'closed') throw new HttpError(409, `Not accepted: ${SENTENCES.notTaking} Nothing was written.`)
  if (!trunk.fed.networks.some(n => n.name === record.network)) throw new HttpError(409, `Not accepted: ${SENTENCES.noNetwork} Nothing was written.`)
  // What may have changed since it was held: the instance listed in another role, or already a member another way.
  const listed = trunk.fed.peers.find(p => normUrl(p.url) === normUrl(record.from.url))
  if (listed && listed.relationship !== 'node') throw new HttpError(409, `Not accepted: ${SENTENCES.otherRole} Nothing was written.`)
  if (listed && listed.decision) throw new HttpError(409, `Not accepted: ${SENTENCES.alreadyMember} Nothing was written.`)
  const decision = `request ${id}`
  // The peer is built from the record's validated fields, as the request held them when it was received.
  const request = { from: record.from, created: record.received, network: record.network } as FederationRequest
  const text = memberText(fileText(repo, FED) ?? '', request, decision, cachedDid(repo, record.from.url))
  const rule = direct(fedOp(repo, text), 'accepted')
  const { commit } = await writeHubFiles(repo, [{ rel: FED, text }, updated({ ...record, outcome: 'accepted', decision })],
    `federation: accept ${name} into ${network}`, { actor: actorTrailer(actor), rule, decision }, ident, opts)
  return { ref: record.ref, outcome: 'accepted', sentence: acceptedSentence(record), commit }
}

/** Receives every inbox item, and drops each once its record has landed (or it can never be received: unreadable, or
 *  received before). An item whose receiving failed stays, with the failure as its sentence. */
export async function drainInbox(repo: string, actor: KnownActor, now: Date, deps: HubDeps = {}): Promise<(Received | { ref: string; outcome: 'failed'; sentence: string })[]> {
  const out: (Received | { ref: string; outcome: 'failed'; sentence: string })[] = []
  for (const item of listInbox(repo)) {
    try {
      const got = await receive(repo, actor, { transport: item.transport, ref: item.ref, text: item.text }, now, deps)
      inboxDrop(repo, item.file)
      out.push(got)
    } catch (err) {
      out.push({ ref: item.ref, outcome: 'failed', sentence: err instanceof Error ? err.message : String(err) })
    }
  }
  return out
}

// ── the confirmed operations ──────────────────────────────────────────────────────────────────────

export interface HubOpsDeps { run?: Runner; now?: () => Date; startBranch?: string }

const SEC = 1000
const ownCard = (r: Resource): string | null => (r.facts.self === true ? null : "offered on this instance's own card")

/** `join.where` as federation.yaml holds it now (synchronous, for `unavailable`); the plan reads the trunk's. */
function whereNow(repo: string): string | null {
  try { return readFederation(parse(readFileSync(join(repo, FED), 'utf8')) ?? {}).join?.where ?? null } catch { return null }
}

/** `federation.poll`: asks where this hub takes requests for the ones waiting, and puts each in the inbox under stateDir.
 *  It writes nothing in git and has no actor; receiving them is the Federation page's actor route. */
export function federationPollOperation(deps: HubOpsDeps = {}): Operation {
  const run = deps.run ?? runCommand
  return {
    id: 'federation.poll', kinds: ['instance'], label: () => 'Check for requests', effect: 'reads', network: true,
    timeoutMs: 120 * SEC, refreshes: 'fleet',
    params: { type: 'object', additionalProperties: false },
    unavailable: (r, repo) => ownCard(r) ?? (whereNow(repo) ? null : SENTENCES.noWhere),
    plan: async (_r, _params, repo, ctx): Promise<InProcess> => {
      const trunk = await readTrunkFederation(repo, ctx?.startBranch ?? deps.startBranch)
      if ('problem' in trunk) throw new HttpError(409, `Not run: ${trunk.problem}`)
      const where = trunk.fed.join?.where ?? null
      if (!where) throw new HttpError(409, `Not run: ${SENTENCES.noWhere}`)
      const transport = transports().find(t => t.poll !== undefined && t.unavailable(where, null) === null)
      if (!transport) throw new HttpError(409, `Not run: no way of receiving requests at ${where} is built yet.`)
      const notReady = await transport.ready({ run, repo })
      if (notReady) throw new HttpError(409, `Not run: ${notReady}`)
      return {
        summary: `List the requests waiting at ${where}: a lookup, it changes no file.`,
        inProcess: async (at, signal) => {
          const incoming = await transport.poll!(where, { run, repo: at, signal })
          const known = new Set(readRecords(at).flatMap(r => (r.ref ? [r.ref] : [])))
          for (const i of incoming) if (!known.has(i.ref)) inboxPut(at, { transport: transport.id, ref: i.ref, text: i.text })
          const n = listInbox(at).length
          return `${n} ${n === 1 ? 'request' : 'requests'} waiting. Receive them on the Federation page.\n`
        },
      }
    },
  }
}

const UUID_PARAM = { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' }

/** `federation.reply`: tells the asker the outcome, the way the request came, then keeps a receipt under stateDir. */
export function federationReplyOperation(deps: HubOpsDeps = {}): Operation {
  const run = deps.run ?? runCommand
  const now = deps.now ?? (() => new Date())
  return {
    id: 'federation.reply', kinds: ['instance'], label: () => 'Tell them the outcome', effect: 'changes', network: true,
    timeoutMs: 60 * SEC, refreshes: 'fleet',
    params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID_PARAM } },
    variants: (r): Variant[] => (Array.isArray(r.facts.toReply) ? r.facts.toReply as { id: string; from: string; outcome: string }[] : [])
      .map(t => ({ label: `Tell ${t.from}: ${t.outcome}`, params: { id: t.id }, unavailable: null })),
    unavailable: ownCard,
    plan: (_r, params, repo): InProcess => {
      const id = String(params.id)
      const h = hubRequests(repo).find(x => x.record.id === id)
      if (!h) throw new HttpError(409, `Not sent: ${SENTENCES.noRequest}`)
      if (!h.final) throw new HttpError(409, 'Not sent: this request has no outcome yet.')
      if (h.replied) throw new HttpError(409, 'Not sent: they have been told already.')
      const transport = transportOf(h.record.transport)
      const ref = h.record.ref
      if (!transport?.reply || ref === null) throw new HttpError(409, 'Not sent: this request came by a way that has no reply.')
      const kind = h.outcome === 'accepted' ? 'accepted' as const : 'refused' as const
      const sentence = replySentence(h)
      const word = kind === 'accepted' ? 'Accepted' : 'Refused'
      return {
        summary: `Answer ${label(h.record.from.name)} at ${ref}: "${word}: ${sentence}". It changes no file.`,
        inProcess: async (at, signal) => {
          await transport.reply!(ref, { kind, sentence }, { run, repo: at, signal })
          writeReplied(at, id, { at: now().toISOString(), ref })
          return `Told ${label(h.record.from.name)}: ${word}.\n`
        },
      }
    },
  }
}

export const federationHubOperations = (deps: HubOpsDeps = {}): Operation[] => [federationPollOperation(deps), federationReplyOperation(deps)]
