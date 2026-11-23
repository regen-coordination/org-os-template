// The node's routes (network N2 Task 8): look at a hub's cached answer, ask to join, withdraw, and record an
// acceptance. Every write is staged in the actor's change (or committed where the rule is direct) through
// `commitOrStage`, under the repository's write lock. Nothing here reaches the network, and nothing publishes on atproto.
// Migration (Task 12): list the public peers with the DID and relation a link record would carry, and set `did` and/or
// `link` on them in one staged federation.yaml edit. It publishes nothing (R28); `federation.publish-links` does, later.
// The hub's routes (Task 9): receive requests (an imported file, or the inbox a poll filled) and decide a held one. Their
// writes are the hub's own commits (`writeHubFiles`) or a proposal; nothing reaches the network or atproto here either.
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
import { JOIN_POLICIES, readFederation } from '../../lib/federation/read.mjs'
import { isPublicUrl } from '../../lib/federation/peers.mjs'
import { buildRequest, parseRequest, requestText } from '../../lib/federation/request.mjs'
import { intakeOutcome } from '../../lib/federation/intake.mjs'
import type { Runner } from '../resources/types.ts'
import { transports } from './transports/index.ts'
import { createInvite, decide, drainInbox, receive } from './hub.ts'
import { bindingView, migratedText, migrationOf, MIGRATION_SENTENCES, resolveSets } from './migrate.ts'
import {
  askedText, cachedHub, clearState, joinText, outgoingPath, readState, recordedText, savedRequestText, SENTENCES, trunkRequest, UUID,
  withdrawnText, writeState, type JoinEdit,
} from './node.ts'

export interface FederationDeps {
  repo: string
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  fetch?: unknown
  run?: Runner
  now?: () => Date
  notify?: (msg: { type: 'changes' }) => void
  /** Read the join requests board again: a received or decided request changes what the `federation` adapter shows, and a
   *  hub that started without data/federation-requests.yaml has no watcher on it. */
  invalidate?: () => void
  startBranch?: string
  /** Randomness for invites; tests give a fixed one. */
  random?: (n: number) => Uint8Array
}

const FED = 'federation.yaml'

async function body(c: Context): Promise<Record<string, unknown>> {
  let v: unknown
  try { v = await c.req.json() } catch { v = undefined }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'The request body must be a JSON object.')
  return v as Record<string, unknown>
}

const fedOp = (text: string, base: string | null): FileOp => ({ op: 'file', path: FED, text, base })

/** One line of the Join policy form: text, no control or format character, at most `max` long. */
const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/u
function formLine(v: unknown, what: string, max: number): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max || CONTROL.test(v)) throw new HttpError(400, `${what} must be one line of text, at most ${max} characters.`)
  return v.trim()
}
function formList(v: unknown, what: string): string[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.length > 20) throw new HttpError(400, `${what} must be a list of at most 20 lines.`)
  return v.map(x => formLine(x, what, 100))
}

/** The Join policy form's body, checked; a refusal is a sentence. */
function joinEditOf(raw: Record<string, unknown>): JoinEdit {
  if (typeof raw.policy !== 'string' || !JOIN_POLICIES.includes(raw.policy)) throw new HttpError(400, `Choose a policy: ${JOIN_POLICIES.join(', ')}.`)
  const edit: JoinEdit = { policy: raw.policy }
  if (raw.decision !== undefined) edit.decision = raw.decision === null || raw.decision === '' ? null : formLine(raw.decision, 'The decision', 200)
  const types = formList(raw.types, 'Who may ask')
  if (types) edit.types = types
  const asks = formList(raw.asks, 'What a request has to say')
  if (asks) edit.asks = asks
  if (raw.where !== undefined) {
    if (raw.where === null || raw.where === '') edit.where = null
    else {
      const where = formLine(raw.where, 'Where requests go', 2048)
      if (!isPublicUrl(where)) throw new HttpError(400, 'Where requests go must be a public https address, such as the hub\'s GitHub repo.')
      edit.where = where
    }
  }
  return edit
}

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
      // What the hub will refuse to read (a name too long, a control character) is said here, before anything is staged.
      const readable = parseRequest(requestText(request))
      if (!readable.request) throw new HttpError(400, readable.problems[0])
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
    if (!committed) throw new HttpError(state ? 409 : 404, state ? SENTENCES.notApplied : 'No such request.')
    if (!committed.request) throw new HttpError(409, `The request file on your trunk can't be read, so it can't be withdrawn here. Remove ${outgoingPath(id)} by hand.`)
    const network = committed.request.network
    const { text, base } = fedNow(repo, actor.id)
    const edited = withdrawnText(text, { id, hub: committed.request.hub.url, network, peerAdded: state?.peerAdded === true })
    const ops: FileOp[] = [
      ...(edited.removed > 0 ? [fedOp(edited.text, base)] : []),
      { op: 'file', path: outgoingPath(id), text: null, base: fileBase(repo, outgoingPath(id)) },
    ]
    const out = await commitOrStage(repo, actor, ops, `federation: withdraw the request to join ${network}`, deps.notify)
    writeState(repo, id, { ...(state ?? { network, hub: committed.request.hub.url }), withdrawn: true })
    return c.json({ id, leaving: edited.leaving, text: (edited.leaving ? SENTENCES.leaving(network) : `Withdrawn: ${network}.`) + (!state && edited.peerKept ? " The hub's peer entry was kept; remove it by hand if you no longer need it." : ''), ...out })
  }))

  // A request only the state folder knows (its staged ask was discarded): forget it. Git is not touched.
  app.post('/api/federation/outgoing/:id/clear', c => withLock(async () => {
    knownActorOf(c)
    const id = c.req.param('id')
    if (await trunkRequest(repo, id, deps.startBranch)) throw new HttpError(409, 'This request is on your trunk: withdraw it instead.')
    if (!readState(repo, id)) throw new HttpError(404, 'No such request.')
    if (new ChangeStore(repo).all().changes.some(ch => ch.ops.some(o => o.op === 'file' && o.path === outgoingPath(id)))) {
      throw new HttpError(409, 'This request is staged in a change that is not applied yet: discard that change first.')
    }
    clearState(repo, id)
    return c.json({ id, cleared: true })
  }))

  // The saved copy of an invited request a `file` send kept (Task 8): the Federation page offers it as a download, never
  // as text on the page. It holds the invite, so it is a member's only and is never cached.
  app.get('/api/federation/outgoing/:id/request-file', c => {
    knownActorOf(c)
    const id = c.req.param('id')
    const text = savedRequestText(repo, id)
    if (text === null) throw new HttpError(404, 'No saved request file for this request.')
    return c.body(text, 200, {
      'content-type': 'text/yaml; charset=utf-8', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="join-request-${id.slice(0, 8)}.yaml"`,
    })
  })

  // The hub's join policy (Task 13's Join policy form): one federation.yaml edit, class identity, staged in the actor's
  // change (or committed where their rule is direct). Nothing reaches the network.
  app.post('/api/federation/join', async c => {
    const edit = joinEditOf(await body(c))
    return withLock(async () => {
      const actor = knownActorOf(c)
      const { text, base } = fedNow(repo, actor.id)
      const next = joinText(text, edit)
      if (next === text) throw new HttpError(409, 'federation.yaml already says this, so nothing was changed.')
      const out = await commitOrStage(repo, actor, [fedOp(next, base)], `federation: join policy ${edit.policy}`, deps.notify)
      return c.json({ policy: edit.policy, ...out })
    })
  })

  // ── migration: existing peers onto atproto (Task 12) ──

  // The trunk's peers and the caches only: it never fetches. The page runs `federation.check-links` first.
  app.get('/api/federation/migration', async c => {
    const m = await migrationOf(repo, run, deps.startBranch, now())
    if ('problem' in m) return c.json({ problem: m.problem })
    return c.json({ rows: m.rows, kept: m.kept })
  })

  // One federation.yaml edit, class identity, staged in the actor's change (or committed where their rule is direct).
  app.post('/api/federation/migration', async c => {
    const raw = await body(c)
    return withLock(async () => {
      const actor = knownActorOf(c)
      const m = await migrationOf(repo, run, deps.startBranch, now())
      if ('problem' in m) throw new HttpError(409, m.problem)
      const sets = resolveSets(raw.set, m, bindingView(repo, now()))
      const { text, base } = fedNow(repo, actor.id)
      const edited = migratedText(text, sets)
      if (edited.changed === 0) throw new HttpError(409, MIGRATION_SENTENCES.unchanged)
      const n = sets.length
      const out = await commitOrStage(repo, actor, [fedOp(edited.text, base)], `federation: bring ${n} ${n === 1 ? 'peer' : 'peers'} onto atproto (DID and link)`, deps.notify)
      // A DID already in federation.yaml that this edit replaces is said by peer (only public peers reach here).
      const notes = sets.filter(s => s.did !== undefined && s.peer.did !== null && s.peer.did !== s.did)
        .map(s => `${s.peer.name}: ${MIGRATION_SENTENCES.replaces}`)
      return c.json({ set: sets.map(s => s.peer.index), ...(notes.length > 0 ? { notes } : {}), ...out })
    })
  })

  // ── the hub's side ──

  // What the hub received is read from the resources (adapter `federation`, board `federation-requests`), never from a route of
  // its own: the board is members-only and holds the held ids, the outcome and the received date.

  // With `text` (Import): that one request, as a file. Without: every request a poll put in the inbox.
  app.post('/api/federation/requests/receive', async c => {
    let raw: unknown
    try { raw = await c.req.json() } catch { raw = {} }
    const text = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).text : undefined
    if (text !== undefined && typeof text !== 'string') throw new HttpError(400, 'The request must be text.')
    return withLock(async () => {
      const actor = knownActorOf(c)
      const answers = typeof text === 'string'
        ? [await receive(repo, actor, { transport: 'file', ref: null, text }, now(), { startBranch: deps.startBranch })]
        : await drainInbox(repo, actor, now(), { startBranch: deps.startBranch })
      deps.invalidate?.()
      deps.notify?.({ type: 'changes' })
      return c.json(answers.map(a => ({ ref: a.ref, outcome: a.outcome, sentence: a.sentence, ...('proposal' in a && a.proposal ? { proposal: a.proposal } : {}) })))
    })
  })

  app.post('/api/federation/requests/:id/decide', async c => {
    const raw = await body(c)
    if (typeof raw.accept !== 'boolean') throw new HttpError(400, 'Say whether you accept it: accept true or false.')
    if (raw.reason !== undefined && typeof raw.reason !== 'string') throw new HttpError(400, 'The reason must be text.')
    return withLock(async () => {
      const actor = knownActorOf(c)
      const out = await decide(repo, actor, c.req.param('id'), { accept: raw.accept as boolean, reason: raw.reason as string | undefined }, { startBranch: deps.startBranch })
      deps.invalidate?.()
      deps.notify?.({ type: 'changes' })
      return c.json({ id: c.req.param('id'), outcome: out.outcome, sentence: out.sentence, commit: out.commit })
    })
  })

  // Make an invite (Task 11). The link in the answer is the only place its token ever is: the answer is not cacheable, the
  // record holds the token's hash, and nothing here logs, stores or echoes the token again.
  app.post('/api/federation/invites', async c => {
    const raw = await body(c)
    return withLock(async () => {
      const actor = knownActorOf(c)
      const out = await createInvite(repo, actor, raw, { now: now(), notify: deps.notify, startBranch: deps.startBranch, random: deps.random })
      deps.invalidate?.()
      return c.json(out, 201, { 'cache-control': 'no-store' })
    })
  })

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
