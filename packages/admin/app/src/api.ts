import type { StageOp, Op, ChangeView as ServerChangeView, GovernanceView, RecordError, RuleSummary } from '../../server/changes/types.ts'
import type { ProposalView, ProposalDetail } from '../../server/proposals/view.ts'
import type { ProposeInput } from '../../server/proposals/propose.ts'
import type { PrepareResult } from '../../server/proposals/prepare.ts'
import type { OutcomeReading } from '../../server/systems/driver.ts'
import type { EventInput } from '../../server/proposals/events.ts'
import type { Actor } from '../../server/actor.ts'
import type { BoardRead } from '../../server/boards/types.ts'
import type { LibraryList, LibraryPreview, Receipt, RemovalPreview } from '../../server/library/types.ts'
import type { VisibilityAnswer } from '../../server/visibility/routes.ts'
import type { NarrowResult, NarrowTarget } from '../../server/visibility/narrow.ts'
// Every type the interfaces contract names, re-exported for the client (this plan owns these lines).
// Type-only: esbuild erases them, so nothing from server/ or lib/ reaches the bundle.
export type { StageOp, Op, Change, RuleSummary, DecisionRow, GovernanceView, RecordError } from '../../server/changes/types.ts'
export type { ProposalView, ProposalDetail, BranchState } from '../../server/proposals/view.ts'
export type { ProposeInput } from '../../server/proposals/propose.ts'
export type { PrepareResult } from '../../server/proposals/prepare.ts'
export type { EventInput as ProposalEventInput, EventKindHere as ProposalEventKind } from '../../server/proposals/events.ts'
export type { DriverRead, DriverSection, Driver, DriverContext } from '../../server/systems/driver.ts'
export type { Actor } from '../../server/actor.ts'
export type { Shelf, Maturity, Standing, Fits, ListedEntry, ShelfProblem, LibraryList, LibraryPreview, Receipt, ReceiptDecision, RemovalPreview } from '../../server/library/types.ts'
export type { Layout, GridPlace, CanvasPlace, Place, BlockEntry, BoardDef, BoardRead } from '../../server/boards/types.ts'
export type { Kind as ResourceKind, EdgeKind } from '../../server/resources/types.ts'
export type { MemberKind } from '../../lib/members.mjs'
export type { GovernanceShape } from '../../lib/governance-read.mjs'
export type { TrailerValues } from '../../lib/trailers.mjs'
export type { WizardDef, WizardStep, WizardField, WizardDoor } from '../../lib/wizards.mjs'
export type { Problem } from '../../lib/data-validate.mjs'

/** The actor's change. `revises` is the proposal it updates, when it was loaded from one by Revise (spec 3.4
 *  "Revising", POST /api/proposals/:id/load): it makes the tray's primary action Update proposal. */
export type ChangeView = ServerChangeView

export interface RegistrySummary { name: string; kind: 'collection' | 'document'; count: number | null }
/** `instanceWrites` is said only while the Hub's writes are off (Lane 3 Task 11). */
export interface Status { org: string; branch: string; dirty: boolean; instanceWrites?: 'off' }
export type Entity = Record<string, unknown> & { id: string }
export interface RegistryRead {
  name: string; kind: 'collection' | 'document'; schemaVersion: string | null
  entries?: Entity[]; document?: Record<string, unknown>
}
export interface FieldError { field: string; message: string }
/** A 422 entry: the change engine's carry their record (contract `RecordError`); the old routes' do not. */
export type StageError = FieldError & { record?: string }
/** The refusal codes clients branch on (contract, "Refusals and driver context"). */
export type RefusalCode = 'DIRTY' | 'STALE' | 'EMPTY'
/** One property of a registry schema, as the client reads it: its type, its choices, and the words a form shows (`title`,
 *  `description`). A list of objects names its items' properties; `x-format` is a form's hint where `format` would
 *  validate (an object list's date). */
export interface JsonProp {
  type?: string | string[]; enum?: unknown[]; examples?: unknown[]; format?: string; 'x-format'?: string
  /** `examples`: the examples are the choices a form offers first (a kind the framework knows), the values in use after. */
  'x-choices'?: 'examples'
  items?: { type?: string | string[]; title?: string; properties?: Record<string, JsonProp> }; title?: string; description?: string
}
export interface JsonSchema {
  properties?: Record<string, JsonProp>
  required?: string[]
  'x-order'?: string[]
  /** The new-record form's groups, in order (spec 2026-11-04 §3); `optional` marks a group a person may skip. */
  'x-groups'?: { label: string; fields: string[]; optional?: boolean }[]
}

/** A refusal from the server: its sentence as the message (`error`, else `reason`), field errors when
 *  there are any, its `code` when it has one, and the whole body for what else it carries
 *  (409 STALE `stale`, 409 DIRTY `paths`, 403 `reason`). */
export class ApiError extends Error {
  public code: string | null
  constructor(public status: number, public errors: StageError[], message: string, public body: Record<string, unknown> = {}) {
    super(message)
    this.code = typeof body.code === 'string' ? body.code : null
  }
}

/** Who is told of a 401 (L5 spec §11.1: in hosted mode it sends the person to sign in). */
type Unauthorized = (path: string, error: ApiError) => void
const unauthorized = new Set<Unauthorized>()

/** Be told of every 401 the server answers, but sign-in's own (/api/session: a refused signature is said on the
 *  sign-in page, where the person already is). Returns the way to stop. */
export function onUnauthorized(fn: Unauthorized): () => void {
  unauthorized.add(fn)
  return () => { unauthorized.delete(fn) }
}
const isSessionPath = (path: string) => path === '/api/session' || path.startsWith('/api/session/')

/** A signed-in member who wears no hat now (coordinator ruling L9-O1), said in place of a refused read's SIGN_IN sentence. */
export const NO_HAT = 'You are signed in, but you wear no hat in this DAO now.'

/** The session as last read (`api.session`): a refused read is said from it. */
let lastSession: SessionView | null = null

/** What a 401 SIGN_IN says to this session (L9-O1): signing in is no answer for one who is signed in. A session whose
 *  reading shows no hat hears `NO_HAT`; one whose hats are not known (past the grace, §5.2, or not read yet: `unread`,
 *  final review I1) hears its band; anyone else the server's sentence. */
export function signInSentence(message: string, session: SessionView | null): string {
  if (!session?.signedIn) return message
  if (session.stale || session.unread) return session.band ?? message
  return session.hats.length === 0 ? NO_HAT : message
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const said = typeof body.error === 'string' ? body.error : typeof body.reason === 'string' ? body.reason : `HTTP ${res.status}`
    const message = res.status === 401 && body.code === 'SIGN_IN' ? signInSentence(said, lastSession) : said
    const error = new ApiError(res.status, Array.isArray(body.errors) ? (body.errors as StageError[]) : [], message, body)
    if (res.status === 401 && !isSessionPath(path)) for (const fn of [...unauthorized]) fn(path, error)
    throw error
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const json = (method: string, body: unknown): RequestInit => ({
  method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})

export type Board = 'organization' | 'systems'
export interface Attention { level: 'warn' | 'alert'; text: string }
export interface Resource {
  id: string; kind: string; board: Board; name: string; status: string | null
  attention: Attention | null; changed: { at: string; by: string } | null
  facts: Record<string, unknown>
  source: { path: string; editable: boolean; registry?: string; entityId?: string } | null
}
export interface GraphEdge { from: string; to: string; kind: string; crosses?: boolean }
export interface Portal { id: string; toBoard: Board; text: string; targets: string[] }
export interface BoardView { board: Board; nodes: Resource[]; edges: GraphEdge[]; portals: Portal[] }
export interface ResourceDetail { resource: Resource; edges: GraphEdge[]; neighbours: Resource[] }
export interface ParamsSchema {
  type: 'object'; required?: string[]
  properties?: Record<string, { type?: string; enum?: string[]; minLength?: number; maxLength?: number; pattern?: string }>
}
export interface OperationInfo {
  id: string; label: string; effect: 'reads' | 'changes'; network: boolean; confirm: boolean
  params: ParamsSchema; preset: Record<string, unknown> | null; unavailable: string | null
}
export interface OperationPair { op: string; label: string; resource: string; resourceName: string; board: Board; confirm: boolean; preset: Record<string, unknown> | null }
export interface PlanReply { op: string; resource: string; inProcess: boolean; cmd: string | null; args: string[]; writes: string[]; timeoutMs: number; confirm: boolean; nonce: string | null; summary?: string }
export type JobStatus = 'queued' | 'running' | 'ok' | 'failed' | 'timed-out' | 'cancelled' | 'finished-with-surprises' | 'interrupted'
export const FINAL_STATUSES: JobStatus[] = ['ok', 'failed', 'timed-out', 'cancelled', 'finished-with-surprises', 'interrupted']
export interface JobRecord {
  id: string; op: string; resource: string; label: string; cmd: string | null; args: string[]; writes: string[]
  status: JobStatus; created: string; started: string | null; ended: string | null
  exitCode: number | null; changed: string[]; surprises: string[]; sentence: string | null
}
export type Positions = Record<string, { x: number; y: number }>
/** W2a (wizards spec §5.4a). */
export interface ClaimStatus {
  available: boolean; refusal: string | null; address: string | null
  candidates: { id: string; name: string }[]; canCreate: boolean; rule: string
}
export type ClaimTarget = { member: string } | { create: { name: string } }
export interface ClaimPlan {
  nonce: string; expiresInMs: number
  review: {
    address: string; file: string; lines: string[]; member: { id: string; name: string; created: boolean }
    commit: { message: string; trailers: Record<string, string> }; note: string
    cmd: string; args: string[]; writes: string[]; timeoutMs: number; network: boolean
  }
}
export interface ClaimDone { ok: true; commit: string; member: { id: string }; changed: string[]; trailers: Record<string, string> }
export interface WizardDraft { index: number; answers: Record<string, unknown>; saved: string }
/** What a write on a proposal answers: the view, and what the write said beside it. */
export type ProposalWrite = ProposalView & { commit?: string; note?: string; decision?: unknown }
/** What POST …/check answers beside the view: the reading, whether a `system` event was appended, and attention when
 *  the read failed (shown, never stored). */
export type ProposalCheck = ProposalWrite & { reading: OutcomeReading | null; appended: boolean; attention?: { level: 'warn'; text: string } }
/** The transaction `prepare` reads against the Safe (spec 3.11). */
export interface TxInput { to: string; value: string; data?: string; operation: 0 | 1 }
export type SyncState = 'up-to-date' | 'fast-forwarded' | 'merged' | 'refused'
/** GET /api/sync: the last fetch, read with no network. */
export interface SyncRead { remote: string | null; ahead: number; behind: number; trunk: string; state: string; fetchedAt: string | null; sentence: string }
export interface SyncDone { state: SyncState; remote: string | null; trunk: string; ahead: number; behind: number; sentence?: string; job?: string }
/** GET /api/session (L5 spec §13). `mode` is the server's (§3); `signIn` says how to sign in here, null when the org
 *  names no Hats tree. A signed-in session carries the account (CAIP-10), the actor id it acts as, and the hats worn
 *  by name; `stale` (with the `band` sentence) when its last reading is past the grace: the session lives on, no hats,
 *  and it reads as public until a reading succeeds (§5.2). */
export type SessionMode = 'local' | 'hosted'
export interface SignedOutView { mode: SessionMode; signIn: { chainId: string; tree: string } | null; signedIn: false }
export interface SignedInView {
  mode: SessionMode; signedIn: true; actor: string; account: string; hats: { hat: string; name: string }[]; expiresAt: string
  /** `stale`: past the grace (§5.2). `unread`: no reading kept yet (after a restart, for as long as the tree cannot be
   *  read; final review I1). Either way the hats are not known, and `band` says so; `hats: []` alone is a reading. */
  stale?: true; unread?: true; band?: string
}
export type SessionView = SignedOutView | SignedInView
/** POST /api/session: a session, or no hat in the tree (§4.3 step 5). */
export type SignInAnswer = SignedInView | { signedIn: false; notMember: true }
/** GET /api/visibility (L5 spec §11.2, §13): the tree's hats with their names and the hats above each, the hats worn, the
 *  levels this member may give a thing, the policy, and the collections they may write (Q77). */
export type VisibilityView = VisibilityAnswer
export type { NarrowTarget, NarrowResult }
const enc = encodeURIComponent

/** True when your git email matched a member. */
export const isKnownActor = (a: Actor): a is Extract<Actor, { id: string }> => 'id' in a

export const api = {
  status: () => fetchJSON<Status>('/api/status'),
  registries: () => fetchJSON<RegistrySummary[]>('/api/registries'),
  registry: (name: string) => fetchJSON<RegistryRead>(`/api/registries/${enc(name)}`),
  schema: (name: string) => fetchJSON<JsonSchema>(`/api/schemas/${enc(name)}`),
  save: (name: string, id: string, entity: Entity) =>
    fetchJSON<Entity>(`/api/registries/${name}/${id}`, json('PUT', entity)),
  create: (name: string, entity: Entity) =>
    fetchJSON<Entity>(`/api/registries/${name}`, json('POST', entity)),
  remove: (name: string, id: string) =>
    fetchJSON<{ deleted: string }>(`/api/registries/${name}/${id}`, { method: 'DELETE' }),
  graph: (board: Board) => fetchJSON<BoardView>(`/api/graph/${board}`),
  resources: () => fetchJSON<Resource[]>('/api/resources'),
  resource: (id: string) => fetchJSON<ResourceDetail>(`/api/resources/${enc(id)}`),
  operations: (id: string) => fetchJSON<OperationInfo[]>(`/api/operations?resource=${enc(id)}`),
  allOperations: () => fetchJSON<OperationPair[]>('/api/operations'),
  plan: (op: string, resource: string, params: Record<string, unknown>) =>
    fetchJSON<PlanReply>(`/api/operations/${enc(op)}/plan`, json('POST', { resource, params })),
  runJob: (body: { nonce: string } | { op: string; resource: string; params?: Record<string, unknown> }) =>
    fetchJSON<JobRecord>('/api/jobs', json('POST', body)),
  jobs: (resource?: string) => fetchJSON<JobRecord[]>(resource ? `/api/jobs?resource=${enc(resource)}` : '/api/jobs'),
  job: (id: string) => fetchJSON<{ job: JobRecord; log: string }>(`/api/jobs/${enc(id)}`),
  cancelJob: (id: string) => fetchJSON<{ cancelled: true }>(`/api/jobs/${enc(id)}`, { method: 'DELETE' }),
  layout: (board: Board) => fetchJSON<Positions>(`/api/layout/${board}`),
  saveLayout: (board: Board, positions: Positions) => fetchJSON<Positions>(`/api/layout/${board}`, json('PUT', positions)),
  resetLayout: (board: Board) => fetchJSON<{ cleared: true }>(`/api/layout/${board}`, { method: 'DELETE' }),
  // P1: the change engine, governance and who you are (contract, "P1-server produces").
  changes: () => fetchJSON<ChangeView>('/api/changes'),
  stage: (ops: StageOp[]) => fetchJSON<ChangeView>('/api/changes/ops', json('POST', { ops })),
  /** The rule your change would fall under with these ops added; nothing is staged (the new-record form's line). */
  wouldRule: (ops: StageOp[]) => fetchJSON<RuleSummary>('/api/changes/rule', json('POST', { ops })),
  unstage: (n: number) => fetchJSON<ChangeView>(`/api/changes/ops/${n}`, { method: 'DELETE' }),
  rebase: (n: number, keep: 'mine' | 'theirs') => fetchJSON<ChangeView>(`/api/changes/ops/${n}/rebase`, json('POST', { keep })),
  discard: () => fetchJSON<void>('/api/changes', { method: 'DELETE' }),
  apply: () => fetchJSON<{ commit: string }>('/api/changes/apply', json('POST', {})),
  governance: () => fetchJSON<GovernanceView>('/api/governance'),
  decision: (anchor: string) => fetchJSON<{ markdown: string }>(`/api/governance/decisions/${enc(anchor)}`),
  actor: () => fetchJSON<Actor>('/api/actor'),
  // P4c: boards (contract "P4c produces"). Written only through stage().
  boards: () => fetchJSON<BoardRead[]>('/api/boards'),
  board: (id: string) => fetchJSON<BoardRead>(`/api/boards/${enc(id)}`),
  builtinBoard: (id: string) => fetchJSON<BoardRead>(`/api/boards/${enc(id)}/builtin`),
  // The library: its list, a preview that writes nothing, and Add and Remove, which stage into your change (the tray's).
  library: () => fetchJSON<LibraryList>('/api/library'),
  libraryPreview: (id: string) => fetchJSON<LibraryPreview>(`/api/library/${enc(id)}/preview`),
  /** Stages the entry's records and its receipt. 409 NOT_ADDABLE | TAKEN (with `nextFreeId`), 422 `config.<name>` errors. */
  libraryAdd: (id: string, config: Record<string, unknown>) => fetchJSON<ChangeView>(`/api/library/${enc(id)}/add`, json('POST', { config })),
  libraryReceipts: () => fetchJSON<Receipt[]>('/api/library/receipts'),
  libraryRemoval: (receipt: string) => fetchJSON<RemovalPreview>(`/api/library/receipts/${enc(receipt)}/removal`),
  /** Stages the deletes of what the add created, and the receipt's removal. `take` names every record edited since the
   *  add (the removal preview's `asks`), or it answers 409 ASK. */
  libraryRemove: (receipt: string, take: string[]) => fetchJSON<ChangeView>(`/api/library/receipts/${enc(receipt)}/remove`, json('POST', { take })),
  // Wizards: data run by the wizard machine; a draft is kept outside the repository (wizards spec §5.3).
  wizard: (id: string) => fetchJSON<import('../../lib/wizards.mjs').WizardDef>(`/api/wizards/${enc(id)}`),
  wizardDraft: (id: string) => fetchJSON<WizardDraft | null>(`/api/wizards/${enc(id)}/draft`),
  saveWizardDraft: (id: string, draft: { index: number; answers: Record<string, unknown> }) =>
    fetchJSON<WizardDraft>(`/api/wizards/${enc(id)}/draft`, json('PUT', draft)),
  discardWizardDraft: (id: string) => fetchJSON<{ discarded: true }>(`/api/wizards/${enc(id)}/draft`, { method: 'DELETE' }),
  // W2a: the bootstrap claim. The server reads the address itself; none is ever sent from here.
  claimStatus: () => fetchJSON<ClaimStatus>('/api/bootstrap/claim'),
  claimPlan: (target: ClaimTarget) => fetchJSON<ClaimPlan>('/api/bootstrap/claim/plan', json('POST', target)),
  claimConfirm: (nonce: string) => fetchJSON<ClaimDone>('/api/bootstrap/claim/confirm', json('POST', { nonce })),
  // P2: proposals. Every route answers the ProposalView; the machine's refusal is a 409 with code REFUSED.
  proposals: () => fetchJSON<ProposalView[]>('/api/proposals'),
  proposal: (id: string) => fetchJSON<ProposalDetail>(`/api/proposals/${enc(id)}`),
  propose: (input: ProposeInput) => fetchJSON<ProposalWrite>('/api/proposals', json('POST', input)),
  proposalEvent: (id: string, input: EventInput) => fetchJSON<ProposalWrite>(`/api/proposals/${enc(id)}/events`, json('POST', input)),
  /** The page's Revise: the proposal's ops into the author's tray, marked `revises`. Answers the tray's change. */
  loadProposal: (id: string) => fetchJSON<ChangeView>(`/api/proposals/${enc(id)}/load`, json('POST', {})),
  /** The tray's Update proposal. `before` is the tray's own, and the ledger does not keep it. */
  revise: (id: string, ops: Op[]) =>
    fetchJSON<ProposalWrite>(`/api/proposals/${enc(id)}/revise`, json('POST', { ops: ops.map(({ before: _before, ...op }) => op) })),
  replay: (id: string, choose?: 'mine' | 'theirs') =>
    fetchJSON<ProposalWrite>(`/api/proposals/${enc(id)}/replay`, json('POST', choose ? { choose } : {})),
  ratify: (id: string) => fetchJSON<ProposalWrite>(`/api/proposals/${enc(id)}/ratify`, json('POST', {})),
  closeProposal: (id: string, outcome: 'rejected' | 'expired' | 'withdrawn') =>
    fetchJSON<ProposalWrite>(`/api/proposals/${enc(id)}/close`, json('POST', { outcome })),
  checkProposal: (id: string) => fetchJSON<ProposalCheck>(`/api/proposals/${enc(id)}/check`, json('POST', {})),
  prepareProposal: (id: string, tx: TxInput) => fetchJSON<PrepareResult>(`/api/proposals/${enc(id)}/prepare`, json('POST', tx)),
  // Sync (spec 3.12): the read touches no network; the write needs the nonce of the `fetch` operation's plan.
  /** Whether `.well-known/` lags the data it is generated from (a ratify does not regenerate it, P2-R20). */
  generated: () => fetchJSON<{ behind: boolean; since?: string }>('/api/generated'),
  syncRead: () => fetchJSON<SyncRead>('/api/sync'),
  sync: (nonce: string) => fetchJSON<SyncDone>('/api/sync', json('POST', { nonce })),
  // L5: sign-in with Ethereum. The server writes the message; the wallet signs it; nothing else is sent.
  session: async () => (lastSession = await fetchJSON<SessionView>('/api/session')),
  sessionNonce: (address: string) => fetchJSON<{ nonce: string; message: string }>('/api/session/nonce', json('POST', { address })),
  signIn: async (nonce: string, signature: string) => {
    const answer = await fetchJSON<SignInAnswer>('/api/session', json('POST', { nonce, signature }))
    if (answer.signedIn) lastSession = answer
    return answer
  },
  signOut: async () => { await fetchJSON<void>('/api/session', { method: 'DELETE' }); lastSession = null },
  // L5 §11.2, §11.4: what the Hub's visibility source is built from, and a narrowing (applied at once).
  visibility: () => fetchJSON<VisibilityView>('/api/visibility'),
  narrow: (target: NarrowTarget, level: string) => fetchJSON<NarrowResult>('/api/visibility/narrow', json('POST', { target, level })),
}
