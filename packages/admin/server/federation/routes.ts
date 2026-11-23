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
import { ChangeStore } from '../changes/store.ts'
import type { FileOp } from '../changes/types.ts'
import { runCommand } from '../resources/run.ts'
import { readFederation } from '../../lib/federation/read.mjs'
import { isPublicUrl } from '../../lib/federation/peers.mjs'
import { buildRequest, requestText } from '../../lib/federation/request.mjs'
import { intakeOutcome } from '../../lib/federation/intake.mjs'
import type { Runner } from '../resources/types.ts'
import { transports } from './transports/index.ts'
import {
  askedText, cachedHub, clearState, outgoingPath, readState, recordedText, SENTENCES, trunkRequest, UUID, withdrawnText, writeState,
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

const fedOp = (text: string, base: string | null): FileOp => ({ op: 'file', path: FED, text, base })

/** federation.yaml as this actor's change would have it: their staged edit of it when there is one (so a second edit builds
 *  on the first and never replaces it), else the working tree. `base` is what the op is staged against. */
function fedNow(repo: string, actorId: string): { text: string; base: string | null } {
  const staged = new ChangeStore(repo).load(actorId)?.ops.find(o => o.op === 'file' && o.path === FED) as FileOp | undefined
  if (staged && staged.text !== null) return { text: staged.text, base: staged.base }
  return { text: fileText(repo, FED) ?? '', base: fileBase(repo, FED) }
}

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
      const { text, base } = fedNow(repo, actor.id)
      const parsed = parseDocument(text)
      if (parsed.errors.length > 0) throw new HttpError(409, "federation.yaml can't be read as YAML, so nothing was changed. Fix it first.")
      const own = readFederation(parsed.toJS() ?? {})
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

      const edit = askedText(text, { network, hub: hubAddress, hubName: hub.name, did: hub.did, id, since: now().toISOString().slice(0, 10), type: hub.type })
      const ops: FileOp[] = [
        fedOp(edit.text, base),
        // The invite is never in this file (R18): it is held in the state folder, outside git, and joined in at send time.
        { op: 'file', path: outgoingPath(id), text: requestText(request), base: null },
      ]
      const out = await commitOrStage(repo, actor, ops, `federation: ask to join ${network}`, deps.notify)
      writeState(repo, id, { network, hub: hubAddress, hubName: hub.name, peerAdded: edit.peerAdded, ...(invite ? { invite } : {}) })
      return c.json({ id, ...out })
    })
  })

  app.post('/api/federation/outgoing/:id/withdraw', c => withLock(async () => {
    const actor = knownActorOf(c)
    const id = c.req.param('id')
    // The trunk's request file is what a withdrawal needs; the state folder is a convenience that may be gone.
    const committed = await trunkRequest(repo, id, deps.startBranch)
    const state = readState(repo, id)
    if (!committed?.request) throw new HttpError(state ? 409 : 404, state ? SENTENCES.notApplied : 'No such request.')
    const network = committed.request.network
    const { text, base } = fedNow(repo, actor.id)
    const edited = withdrawnText(text, { id, hub: committed.request.hub.url, network, peerAdded: state?.peerAdded ?? true })
    const ops: FileOp[] = [
      ...(edited.removed > 0 ? [fedOp(edited.text, base)] : []),
      { op: 'file', path: outgoingPath(id), text: null, base: fileBase(repo, outgoingPath(id)) },
    ]
    const out = await commitOrStage(repo, actor, ops, `federation: withdraw the request to join ${network}`, deps.notify)
    writeState(repo, id, { ...(state ?? { network, hub: committed.request.hub.url }), withdrawn: true })
    return c.json({ id, leaving: edited.leaving, text: edited.leaving ? SENTENCES.leaving(network) : `Withdrawn: ${network}.`, ...out })
  }))

  // A request only the state folder knows (its staged ask was discarded): forget it. Git is not touched.
  app.post('/api/federation/outgoing/:id/clear', c => withLock(async () => {
    knownActorOf(c)
    const id = c.req.param('id')
    if (await trunkRequest(repo, id, deps.startBranch)) throw new HttpError(409, 'This request is on your trunk: withdraw it instead.')
    if (!readState(repo, id)) throw new HttpError(404, 'No such request.')
    clearState(repo, id)
    return c.json({ id, cleared: true })
  }))

  app.post('/api/federation/outgoing/:id/record', c => withLock(async () => {
    const actor = knownActorOf(c)
    const id = c.req.param('id')
    const state = readState(repo, id)
    if (!state) throw new HttpError(404, 'No such request.')
    if (state.status?.state !== 'accepted') throw new HttpError(409, SENTENCES.notAccepted)
    const decision = (state.status.reason ?? 'Accepted').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Accepted'
    const now_ = fedNow(repo, actor.id)
    const edited = recordedText(now_.text, id, decision)
    if (edited === null) throw new HttpError(409, SENTENCES.noRequest)
    const out = await commitOrStage(repo, actor, [fedOp(edited, now_.base)], `federation: record the acceptance into ${state.network}`, deps.notify)
    return c.json({ id, text: SENTENCES.recorded, ...out })
  }))
}
