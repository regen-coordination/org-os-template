// The node's side of joining a network (network N2 Task 8): ask, send, follow the answer, then record it.
//
// - Asking stages two files in the actor's change and sends nothing: the node's own federation.yaml (a network and a
//   peer entry for the hub) and `federation/outgoing/<id>.yaml` (the request, without the invite). The invite token
//   goes only to `stateDir(repo)/federation/outgoing/<id>.json`, outside git (R18).
// - Sending and following the answer are confirmed network operations (`federation.send`, `federation.status`). They
//   write only under stateDir. Nothing here publishes on atproto: a node publishes its `memberOf` link only after the
//   hub accepted and the node recorded it, and only through the separate confirmed `federation.publish-links` (R16, R27).
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument, isMap, isSeq, type Document, type YAMLMap, type YAMLSeq } from 'yaml'
import { HttpError } from '../errors.ts'
import { stateDir } from '../state.ts'
import { STRINGIFY } from '../splice.ts'
import { showFile } from '../git.ts'
import { resolveTrunk } from '../proposals/ledger.ts'
import { runCommand } from '../resources/run.ts'
import { readFederation, DID_PATTERN } from '../../lib/federation/read.mjs'
import { parseRequest, requestText } from '../../lib/federation/request.mjs'
import type { FederationRequest } from '../../lib/federation/request.mjs'
import { wellKnownUrlOf, remoteCache } from './remote.ts'
import { transportOf, transports } from './transports/index.ts'
import type { Runner, Resource } from '../resources/types.ts'
import type { InProcess, Operation, Variant } from '../operations/catalogue.ts'
import type { Status } from './transports/types.ts'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const outgoingPath = (id: string): string => `federation/outgoing/${id}.yaml`
/** How long a looked-up federation.json answers a form without a new lookup. */
export const HUB_FRESH_MS = 10 * 60_000

export const SENTENCES = {
  applyFirst: 'Apply your own change first, then send.',
  lookFirst: 'Look it up first.',
  notAccepted: "The hub hasn't accepted yet. Check the answer first.",
  recorded: 'Recorded. Once this is on your trunk, publish the link so it shows as mutual on atproto.',
  leaving: (network: string) => `Leaving ${network}. The hub will see the link as left. Then publish, so your record is withdrawn.`,
  notApplied: "Your request isn't on your trunk yet, so there is nothing to withdraw: discard it from your changes.",
  noRequest: "This request isn't in federation.yaml (any more). Apply your own change first.",
} as const

// ── what is kept outside git ────────────────────────────────────────────────────────────────────

/** What the node keeps about one outgoing request, outside the repository. `invite` is the token (R18). */
export interface OutgoingState {
  network: string
  hub: string
  hubName?: string
  invite?: string
  sent?: { transport: string; ref: string; at: string }
  status?: { state: Status['state']; reason?: string; at: string }
  /** Staged for removal: the card keeps listing it only while its file is still on the trunk. */
  withdrawn?: true
  /** The ask created the hub's peer entry (so withdrawing may remove it); false when the peer was already listed. */
  peerAdded?: boolean
}

const stateFolder = (repo: string): string => join(stateDir(repo), 'federation', 'outgoing')
const stateFile = (repo: string, id: string): string => join(stateFolder(repo), `${id}.json`)

export function readState(repo: string, id: string): OutgoingState | null {
  if (!UUID.test(id)) return null
  try {
    const v = JSON.parse(readFileSync(stateFile(repo, id), 'utf8')) as Partial<OutgoingState>
    return typeof v.network === 'string' && typeof v.hub === 'string' ? v as OutgoingState : null
  } catch { return null }
}

export function writeState(repo: string, id: string, state: OutgoingState): void {
  mkdirSync(stateFolder(repo), { recursive: true })
  const tmp = `${stateFile(repo, id)}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
  renameSync(tmp, stateFile(repo, id))
}

/** The saved copy of a sent file, with the invite in it when there is one: kept outside git, for the operator to pass on. */
const copyPath = (repo: string, id: string): string => join(stateFolder(repo), `${id}.request.yaml`)

/** The saved copy of an invited request a `file` send kept (mode 0600), or null when there is none. The Federation page
 *  offers it as a download; its text holds the invite, so it is never printed or logged. */
export function savedRequestText(repo: string, id: string): string | null {
  if (!UUID.test(id)) return null
  try { return readFileSync(copyPath(repo, id), 'utf8') } catch { return null }
}

// ── the hub, as last looked up ───────────────────────────────────────────────────────────────────────

export interface HubView {
  name: string; type: string | null; url: string; did: string | null
  networks: string[]
  join: { policy: string; types: string[]; asks: string[]; where: string | null; decision: string | null } | null
}

/** The hub as the cache of a lookup holds it, and how old that is; null when it was never looked up. */
export function cachedHub(repo: string, address: string, now: Date = new Date()): { hub: HubView; fresh: boolean } | null {
  const url = wellKnownUrlOf(address)
  if (url === null) return null
  const got = remoteCache(repo).get(url)
  if (!got) return null
  const doc = got.doc
  const fed = readFederation(doc)
  const age = now.getTime() - new Date(got.fetched_at).getTime()
  return {
    fresh: Number.isFinite(age) && age < HUB_FRESH_MS,
    hub: {
      name: typeof doc.name === 'string' && doc.name !== '' ? doc.name : address,
      type: typeof doc.type === 'string' ? doc.type : null,
      url: address.trim(), did: typeof doc.did === 'string' && DID_PATTERN.test(doc.did) ? doc.did : null,
      networks: fed.networks.map(n => n.name), join: fed.join,
    },
  }
}

// ── the outgoing requests, for the self card and the operations ───────────────────────────────────────

export interface Outgoing {
  id: string; network: string; hub: string
  /** Its file is on the trunk (committed); until then sending is unavailable. */
  onTrunk: boolean
  sent: { transport: string; ref: string; at: string } | null
  status: { state: Status['state']; reason?: string; at: string } | null
  /** The hub's `join.where`, from the cache of the last lookup. */
  where: string | null
  /** The request carries an invite token (held outside git). */
  invited: boolean
}

/** The request file as committed on the trunk, or null. */
export async function trunkRequest(repo: string, id: string, startBranch?: string): Promise<{ text: string; request: FederationRequest | null } | null> {
  if (!UUID.test(id)) return null
  try {
    const trunk = await resolveTrunk(repo, startBranch)
    const text = await showFile(repo, `refs/heads/${trunk}`, outgoingPath(id))
    return { text, request: parseRequest(text).request }
  } catch { return null }
}

/** The ids of `federation/outgoing/*.yaml` as committed on the trunk. */
export async function trunkIds(repo: string, startBranch?: string): Promise<string[]> {
  try {
    const trunk = await resolveTrunk(repo, startBranch)
    const listing = await showFile(repo, `refs/heads/${trunk}`, 'federation/outgoing')
    return listing.split('\n').flatMap(l => { const m = /^([0-9a-f-]{36})\.yaml$/i.exec(l.trim()); return m && UUID.test(m[1]) ? [m[1]] : [] })
  } catch { return [] }
}

/** The outgoing requests of this instance: every `federation/outgoing/*.yaml` on the trunk, with what the state folder
 *  holds about each (sent, answered, the invite), plus requests only the state folder knows (staged, not applied: onTrunk
 *  false). Never fetches, never throws. */
export async function listOutgoing(repo: string, opts: { startBranch?: string } = {}): Promise<Outgoing[]> {
  const onTrunk = await trunkIds(repo, opts.startBranch)
  let names: string[] = []
  try { names = readdirSync(stateFolder(repo)) } catch { /* none kept */ }
  const stateIds = names.flatMap(n => { const m = /^([0-9a-f-]{36})\.json$/i.exec(n); return m && UUID.test(m[1]) ? [m[1]] : [] })
  const out: Outgoing[] = []
  for (const id of [...new Set([...onTrunk, ...stateIds])].sort()) {
    const state = readState(repo, id)
    const committed = onTrunk.includes(id) ? await trunkRequest(repo, id, opts.startBranch) : null
    if (!committed && (!state || state.withdrawn)) continue
    const network = committed?.request?.network ?? state?.network
    const hub = committed?.request?.hub.url ?? state?.hub
    if (!network || !hub) continue
    out.push({
      id, network, hub, onTrunk: committed !== null,
      sent: state?.sent ?? null, status: state?.status ?? null,
      where: cachedHub(repo, hub)?.hub.join?.where ?? null, invited: state?.invite !== undefined,
    })
  }
  return out
}

/** Forgets what the state folder holds about a request that is not on the trunk (its staged ask was discarded). Git is not touched. */
export function clearState(repo: string, id: string): void {
  if (UUID.test(id)) { try { rmSync(stateFile(repo, id), { force: true }); rmSync(copyPath(repo, id), { force: true }) } catch { /* gone */ } }
}

/** `facts.outgoing` of a self card, as the fleet adapter put it there. */
export function outgoingOf(r: Resource): (Outgoing & { atproto?: { theirs: string } })[] {
  const v = r.facts.outgoing
  return Array.isArray(v) ? v as Outgoing[] : []
}

// ── federation.yaml, edited with the YAML document API so comments survive ───────────────────────────

/** federation.yaml as a document; text that isn't YAML is a sentence, not a 500. */
function docOf(text: string): Document {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) throw new HttpError(409, "federation.yaml can't be read as YAML, so nothing was changed. Fix it first.")
  return doc
}

const norm = (u: unknown): string => (typeof u === 'string' ? u.trim().replace(/\/+$/, '').toLowerCase() : '')

function seqIn(doc: Document, key: string): YAMLSeq {
  const nested = doc.get('federation')
  if (doc.get(key) === undefined && isMap(nested) && nested.get(key) !== undefined) {
    throw new HttpError(409, `Move "${key}" to the top level of federation.yaml first: it sits under "federation:".`)
  }
  const node = doc.get(key)
  if (isSeq(node)) return node
  const seq = doc.createNode([]) as YAMLSeq
  doc.set(key, seq)
  return seq
}
const mapAt = (seq: YAMLSeq): YAMLMap[] => seq.items.filter(isMap) as YAMLMap[]
const field = (m: YAMLMap, key: string): unknown => m.get(key)
/** The one federation.yaml editor's parts (ruling R13), shared with the hub's side (Task 9). */
export { docOf as federationDoc, seqIn as federationSeq, mapAt as mapsIn, norm as normUrl }

/** A network entry's hub, as a string: `hub: <url>` or `hub: { url }`. */
const hubField = (m: YAMLMap): string => {
  const h = m.get('hub') ?? m.get('url')
  return typeof h === 'string' ? h : isMap(h) ? String(h.get('url') ?? h.get('repo') ?? '') : ''
}

export interface AskEdit { network: string; hub: string; hubName: string; did: string | null; id: string; since: string; type: string | null }

/** federation.yaml with the network and the hub's peer entry added (an existing entry is kept, and marked requested). */
export function askedText(text: string, a: AskEdit): { text: string; peerAdded: boolean } {
  const doc = docOf(text)
  const networks = seqIn(doc, 'networks')
  if (!mapAt(networks).some(n => field(n, 'name') === a.network && norm(hubField(n)) === norm(a.hub))) {
    networks.items.push(doc.createNode({ name: a.network, hub: a.hub, role: 'node' }))
  }
  const peers = seqIn(doc, 'peers')
  let peerAdded = true
  const existing = mapAt(peers).find(p => norm(field(p, 'url')) === norm(a.hub))
  if (existing) {
    if (field(existing, 'requested') !== undefined) throw new HttpError(409, 'You have a request to this hub waiting: withdraw it or wait for the answer.')
    existing.set('requested', a.id)
    if (a.did && field(existing, 'did') === undefined) existing.set('did', a.did)
    peerAdded = false
  } else {
    peers.items.push(doc.createNode({
      name: a.hubName, url: a.hub, ...(a.type ? { type: a.type } : {}), trust: 'read', relationship: 'hub',
      requested: a.id, since: a.since, ...(a.did ? { did: a.did } : {}),
    }))
  }
  return { text: doc.toString(STRINGIFY), peerAdded }
}

/** What the Federation page's Join policy form sets (network N2 Task 13). `decision` is the standing decision `open`
 *  needs (R17); `null` removes it. Left out, a key keeps what the file has. */
export interface JoinEdit { policy: string; decision?: string | null; types?: string[]; asks?: string[]; where?: string | null }

/** federation.yaml with its `join` block set from the form, comments kept. A `join` nested under `federation:` is moved
 *  up first by hand, as every other key is. The decision is set or removed only for `open`; another policy leaves it. */
export function joinText(text: string, j: JoinEdit): string {
  const doc = docOf(text)
  const nested = doc.get('federation')
  if (doc.get('join') === undefined && isMap(nested) && nested.get('join') !== undefined) {
    throw new HttpError(409, 'Move "join" to the top level of federation.yaml first: it sits under "federation:".')
  }
  let join = doc.get('join')
  if (!isMap(join)) { join = doc.createNode({}) as YAMLMap; doc.set('join', join) }
  const m = join as YAMLMap
  m.set('policy', j.policy)
  if (j.types !== undefined) { if (j.types.length > 0) m.set('types', doc.createNode(j.types)); else m.delete('types') }
  if (j.asks !== undefined) { if (j.asks.length > 0) m.set('asks', doc.createNode(j.asks)); else m.delete('asks') }
  if (j.where !== undefined) { if (j.where) m.set('where', j.where); else m.delete('where') }
  if (j.policy === 'open' && j.decision !== undefined) { if (j.decision) m.set('decision', j.decision); else m.delete('decision') }
  return doc.toString(STRINGIFY)
}

/** The peer entry that carries `requested: <id>`, from the text now, or null. */
export function requestedPeer(text: string, id: string): { name: string } | null {
  const doc = docOf(text)
  const peers = doc.get('peers')
  if (!isSeq(peers)) return null
  const found = mapAt(peers).find(p => field(p, 'requested') === id)
  return found ? { name: String(field(found, 'name') ?? '') } : null
}

/** federation.yaml with the peer's `decision` set and `requested` removed; null when no peer carries that request. */
export function recordedText(text: string, id: string, decision: string): string | null {
  const doc = docOf(text)
  const peers = doc.get('peers')
  const found = isSeq(peers) ? mapAt(peers).find(p => field(p, 'requested') === id) : undefined
  if (!found) return null
  found.set('decision', decision)
  found.delete('requested')
  return doc.toString(STRINGIFY)
}

/** What withdrawing a request undoes, and only that.
 *  - Before the acceptance is recorded (a peer still carries `requested: <id>`): the network entry of this request goes,
 *    and `requested` goes; the peer entry goes too only when the ask created it (`peerAdded`).
 *  - After (no peer carries it): this is leaving. Only this network's entry goes; the hub's peer entry stays while another
 *    network of the same hub is listed, and goes only when the ask created it.
 *  `leaving` is true only for the second case. */
export function withdrawnText(text: string, a: { id: string; hub: string; network: string; peerAdded: boolean }): { text: string; removed: number; leaving: boolean; peerKept: boolean } {
  const doc = docOf(text)
  let removed = 0
  const networks = doc.get('networks')
  if (isSeq(networks)) {
    const keep = networks.items.filter(n => !(isMap(n) && n.get('name') === a.network && norm(hubField(n)) === norm(a.hub)))
    removed += networks.items.length - keep.length
    networks.items = keep
  }
  const otherNetwork = isSeq(networks) && networks.items.some(n => isMap(n) && norm(hubField(n)) === norm(a.hub))
  const peers = doc.get('peers')
  const pending = isSeq(peers) ? mapAt(peers).find(p => p.get('requested') === a.id) : undefined
  const decided = isSeq(peers) && mapAt(peers).some(p => norm(p.get('url')) === norm(a.hub) && p.get('decision') !== undefined)
  if (isSeq(peers)) {
    const mine = pending ?? mapAt(peers).find(p => norm(p.get('url')) === norm(a.hub))
    if (mine) {
      if (pending) mine.delete('requested')
      if (a.peerAdded && !otherNetwork) { peers.items = peers.items.filter(p => p !== mine); removed += 1 }
      else if (pending) removed += 1
    }
  }
  const left = isSeq(doc.get('peers')) && mapAt(doc.get('peers') as YAMLSeq).some(p => norm(p.get('url')) === norm(a.hub))
  return { text: doc.toString(STRINGIFY), removed, leaving: pending === undefined && decided && removed > 0, peerKept: left }
}

// ── the confirmed operations ──────────────────────────────────────────────────────────────────────────

export interface NodeOpsDeps { run?: Runner; now?: () => Date; startBranch?: string }

const SEC = 1000
const ownCard = (r: Resource): string | null => (r.facts.self === true ? null : "offered on this instance's own card")
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** `federation.send`: one variant per outgoing request and way of sending. Its plan asks this machine whether the way
 *  is ready, before any nonce is issued; its job sends, and keeps where it went in the state folder, never in git. */
export function federationSendOperation(deps: NodeOpsDeps = {}): Operation {
  const run = deps.run ?? runCommand
  const now = deps.now ?? (() => new Date())
  return {
    id: 'federation.send', kinds: ['instance'], label: () => 'Send request', effect: 'changes', network: true,
    timeoutMs: 120 * SEC, refreshes: 'fleet',
    params: { type: 'object', additionalProperties: false, required: ['id', 'transport'], properties: {
      id: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' },
      transport: { type: 'string', maxLength: 64 },
    } },
    variants: (r): Variant[] => outgoingOf(r).flatMap(o => transports().map(t => {
      const request = { invite: o.invited ? '(held outside git)' : undefined } as FederationRequest
      const unavailable = !o.onTrunk ? SENTENCES.applyFirst : t.unavailable(o.where, request)
      return { label: `Send "${o.network}": ${t.label}`, params: { id: o.id, transport: t.id }, unavailable }
    })),
    unavailable: ownCard,
    plan: async (r, params, repo, ctx): Promise<InProcess> => {
      const id = String(params.id)
      const o = outgoingOf(r).find(x => x.id === id)
      if (!o) throw new HttpError(409, 'Not sent: no such request on this instance.')
      if (!o.onTrunk) throw new HttpError(409, `Not sent: ${SENTENCES.applyFirst}`)
      const transport = transportOf(String(params.transport))
      if (!transport) throw new HttpError(409, 'Not sent: no such way of sending.')
      const committed = await trunkRequest(repo, id, ctx?.startBranch ?? deps.startBranch)
      if (!committed?.request) throw new HttpError(409, `Not sent: ${SENTENCES.applyFirst}`)
      // The token joins the request here, from the state folder; it is in no file of the repository.
      const invite = readState(repo, id)?.invite
      const request: FederationRequest = invite ? { ...committed.request, invite } : committed.request
      const no = transport.unavailable(o.where, request)
      if (no) throw new HttpError(409, `Not sent: ${no}`)
      const notReady = await transport.ready({ run, repo })
      if (notReady) throw new HttpError(409, `Not sent: ${notReady}`)
      return {
        summary: `${transport.label}: your request to join ${o.network}, to ${committed.request.hub.name}. It changes no file of yours.`,
        inProcess: async (at, signal) => {
          const sent = await transport.send(request, o.where, { run, repo: at, signal })
          const state = readState(at, id) ?? { network: o.network, hub: o.hub }
          writeState(at, id, { ...state, sent: { transport: transport.id, ref: sent.ref, at: now().toISOString() } })
          if (sent.text === undefined) return `${sent.summary}\n`
          // A file: the text is the result. An invited one holds the token, so it is kept beside, not printed in the log.
          if (invite) {
            mkdirSync(stateFolder(at), { recursive: true })
            writeFileSync(copyPath(at, id), requestText(request), { mode: 0o600 })
            return `${sent.summary}\nIt holds your invite, so it is saved at ${copyPath(at, id)} for you to pass on privately.\n`
          }
          return `${sent.summary}\n\n${sent.text}`
        },
      }
    },
  }
}

/** `federation.status`: asks the way a request went what became of it, and keeps the answer in the state folder. */
export function federationStatusOperation(deps: NodeOpsDeps = {}): Operation {
  const run = deps.run ?? runCommand
  const now = deps.now ?? (() => new Date())
  return {
    id: 'federation.status', kinds: ['instance'], label: () => 'Check the answer', effect: 'reads', network: true,
    timeoutMs: 60 * SEC, refreshes: 'fleet',
    params: { type: 'object', additionalProperties: false, required: ['id'], properties: {
      id: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' },
    } },
    variants: (r): Variant[] => outgoingOf(r).filter(o => o.sent && transportOf(o.sent.transport)?.status)
      .map(o => ({ label: `Check the answer: "${o.network}"`, params: { id: o.id }, unavailable: null })),
    unavailable: ownCard,
    plan: (r, params): InProcess => {
      const id = String(params.id)
      const o = outgoingOf(r).find(x => x.id === id)
      if (!o) throw new HttpError(409, 'Not run: no such request on this instance.')
      const transport = o.sent ? transportOf(o.sent.transport) : null
      if (!o.sent || !transport?.status) throw new HttpError(409, 'Not run: this request went by a way that has no answer to follow.')
      const sent = o.sent
      return {
        summary: `Ask where "${o.network}" was sent (${transport.label}) whether it was answered: a lookup, it changes no file.`,
        inProcess: async (at, signal) => {
          const answer = await transport.status!(sent.ref, { run, repo: at, signal })
          const state = readState(at, id) ?? { network: o.network, hub: o.hub }
          writeState(at, id, { ...state, status: { state: answer.state, ...(answer.reason ? { reason: oneLine(answer.reason) } : {}), at: now().toISOString() } })
          if (answer.state === 'accepted') return `Accepted${answer.reason ? `: ${oneLine(answer.reason)}` : '.'}\nRecord it, then publish the link once it is on your trunk.\n`
          if (answer.state === 'refused') return `Refused${answer.reason ? `: ${oneLine(answer.reason)}` : '.'}\n`
          return 'Still waiting for an answer.\n'
        },
      }
    },
  }
}

export const federationNodeOperations = (deps: NodeOpsDeps = {}): Operation[] => [federationSendOperation(deps), federationStatusOperation(deps)]
