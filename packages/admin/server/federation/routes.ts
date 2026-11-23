// The node's routes (network N2 Task 8): look at a hub's cached answer, ask to join, withdraw, and record an
// acceptance. Every write is staged in the actor's change (or committed where the rule is direct) through
// `commitOrStage`, under the repository's write lock. Nothing here reaches the network, and nothing publishes on atproto.
import { randomUUID } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { parseDocument } from 'yaml'
import { HttpError } from '../errors.ts'
import { knownActorOf } from '../request.ts'
import { commitOrStage } from '../workspace/pages.ts'
import { fileBase, fileText } from '../workspace/files.ts'
import type { FileOp } from '../changes/types.ts'
import { runCommand } from '../resources/run.ts'
import { readFederation } from '../../lib/federation/read.mjs'
import { isPublicUrl } from '../../lib/federation/peers.mjs'
import { buildRequest, requestText } from '../../lib/federation/request.mjs'
import { intakeOutcome } from '../../lib/federation/intake.mjs'
import type { Runner } from '../resources/types.ts'
import { transports } from './transports/index.ts'
import {
  askedText, cachedHub, outgoingPath, readState, recordedText, SENTENCES, trunkRequest, UUID, withdrawnText, writeState,
} from './node.ts'

export interface FederationDeps {
  repo: string
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  fetch?: unknown
  run?: Runner
  now?: () => Date
  notify?: (msg: { type: 'changes' }) => void
  startBranch?: string
}

const FED = 'federation.yaml'

async function body(c: Context): Promise<Record<string, unknown>> {
  let v: unknown
  try { v = await c.req.json() } catch { v = undefined }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'The request body must be a JSON object.')
  return v as Record<string, unknown>
}

const fedOp = (repo: string, text: string): FileOp => ({ op: 'file', path: FED, text, base: fileBase(repo, FED) })

export function mountFederation(app: Hono, deps: FederationDeps): void {
  const { repo, withLock } = deps
  const run = deps.run ?? runCommand
  const now = deps.now ?? (() => new Date())

  app.get('/api/federation/hub', c => {
    const address = c.req.query('address') ?? ''
    const got = cachedHub(repo, address, now())
    if (!got || !got.fresh) return c.json({ problem: SENTENCES.lookFirst })
    const { did: _did, ...hub } = got.hub
    return c.json({ hub })
  })

  app.get('/api/federation/transports', async c => {
    const hub = c.req.query('hub') ?? ''
    const id = c.req.query('id') ?? ''
    const where = cachedHub(repo, hub, now())?.hub.join?.where ?? null
    const committed = UUID.test(id) ? await trunkRequest(repo, id, deps.startBranch) : null
    const invited = UUID.test(id) && readState(repo, id)?.invite !== undefined
    const request = committed?.request ? (invited ? { ...committed.request, invite: '(held outside git)' } : committed.request) : null
    const rows = []
    for (const t of transports()) {
      const no = t.unavailable(where, request)
      rows.push({ id: t.id, label: t.label, unavailable: no ?? await t.ready({ run, repo }) })
    }
    return c.json(rows)
  })

  app.post('/api/federation/ask', async c => {
    const raw = await body(c)
    const hubAddress = typeof raw.hub === 'string' ? raw.hub.trim() : ''
    const network = typeof raw.network === 'string' ? raw.network.trim() : ''
    const asked = raw.answers ?? {}
    if (hubAddress === '' || network === '') throw new HttpError(400, 'Say which hub and which network.')
    if (typeof asked !== 'object' || asked === null || Array.isArray(asked) || !Object.values(asked).every(v => typeof v === 'string')) {
      throw new HttpError(400, 'Answers must be text, by ask.')
    }
    const answers = asked as Record<string, string>
    const invite = typeof raw.invite === 'string' && raw.invite.trim() !== '' ? raw.invite.trim() : undefined
    return withLock(async () => {
      const actor = knownActorOf(c)
      // Asking never fetches (R16): the hub must have been looked up.
      const got = cachedHub(repo, hubAddress, now())
      if (!got) throw new HttpError(400, SENTENCES.lookFirst)
      const hub = got.hub
      if (!hub.networks.includes(network)) throw new HttpError(400, `"${network}" isn't a network of ${hub.name}.`)
      const text = fileText(repo, FED) ?? ''
      const own = readFederation(parseDocument(text).toJS() ?? {})
      const identity = own.identity
      const ownUrl = [identity.url, identity.daoURI].find(u => typeof u === 'string' && isPublicUrl(u)) as string | undefined
      const ownName = typeof identity.name === 'string' && identity.name.trim() !== '' ? identity.name : null
      const ownType = typeof identity.type === 'string' && identity.type.trim() !== '' ? identity.type : null
      if (!ownName || !ownType) throw new HttpError(400, 'Give this instance a name and a type in federation.yaml (identity) first.')
      if (!ownUrl) throw new HttpError(400, 'Give this instance its public https address in federation.yaml (identity.url) first, so the hub can find you.')
      if (own.networks.some(n => n.name === network && n.hub !== null && n.hub.replace(/\/+$/, '').toLowerCase() === hubAddress.replace(/\/+$/, '').toLowerCase())) {
        throw new HttpError(409, `You already list "${network}" under this hub.`)
      }
      const id = randomUUID()
      const request = buildRequest({ id, from: { name: ownName, type: ownType, url: ownUrl }, hub: { name: hub.name, url: hubAddress }, network, answers, now: now() })
      // The policy's own checks, early, so the node is told before sending. An invite can't be checked here: the hub does.
      const join = hub.join
      const checkable = join && join.policy === 'invite' ? { ...join, policy: 'open-with-approval' } : join
      const outcome = intakeOutcome(checkable, { ...request, ...(invite ? { invite } : {}) }, [], now())
      if (outcome.kind === 'refuse') throw new HttpError(400, outcome.reason)
      if (join?.policy === 'invite' && !invite) throw new HttpError(400, 'This network joins by invite. Add your invite.')

      const ops: FileOp[] = [
        fedOp(repo, askedText(text, { network, hub: hubAddress, hubName: hub.name, did: hub.did, id, since: now().toISOString().slice(0, 10), type: hub.type })),
        // The invite is never in this file (R18): it is held in the state folder, outside git, and joined in at send time.
        { op: 'file', path: outgoingPath(id), text: requestText(request), base: null },
      ]
      const out = await commitOrStage(repo, actor, ops, `federation: ask to join ${network}`, deps.notify)
      writeState(repo, id, { network, hub: hubAddress, hubName: hub.name, ...(invite ? { invite } : {}) })
      return c.json({ id, ...out })
    })
  })

  app.post('/api/federation/outgoing/:id/withdraw', c => withLock(async () => {
    const actor = knownActorOf(c)
    const id = c.req.param('id')
    const state = readState(repo, id)
    if (!state) throw new HttpError(404, 'No such request.')
    const committed = await trunkRequest(repo, id, deps.startBranch)
    if (!committed) throw new HttpError(409, SENTENCES.notApplied)
    const text = fileText(repo, FED) ?? ''
    const edited = withdrawnText(text, committed.request?.hub.url ?? state.hub, committed.request?.network ?? state.network)
    const ops: FileOp[] = [
      ...(edited.removed > 0 ? [fedOp(repo, edited.text)] : []),
      { op: 'file', path: outgoingPath(id), text: null, base: fileBase(repo, outgoingPath(id)) },
    ]
    const network = committed.request?.network ?? state.network
    const out = await commitOrStage(repo, actor, ops, `federation: withdraw the request to join ${network}`, deps.notify)
    writeState(repo, id, { ...state, withdrawn: true })
    return c.json({ id, leaving: edited.decided, text: edited.decided ? SENTENCES.leaving(network) : `Withdrawn: ${network}.`, ...out })
  }))

  app.post('/api/federation/outgoing/:id/record', c => withLock(async () => {
    const actor = knownActorOf(c)
    const id = c.req.param('id')
    const state = readState(repo, id)
    if (!state) throw new HttpError(404, 'No such request.')
    if (state.status?.state !== 'accepted') throw new HttpError(409, SENTENCES.notAccepted)
    const decision = (state.status.reason ?? 'Accepted').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Accepted'
    const edited = recordedText(fileText(repo, FED) ?? '', id, decision)
    if (edited === null) throw new HttpError(409, SENTENCES.noRequest)
    const out = await commitOrStage(repo, actor, [fedOp(repo, edited)], `federation: record the acceptance into ${state.network}`, deps.notify)
    return c.json({ id, text: SENTENCES.recorded, ...out })
  }))
}
