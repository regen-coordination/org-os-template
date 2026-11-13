import type { StageOp, Op, ChangeView as ServerChangeView, GovernanceView, RecordError, RuleSummary } from '../../server/changes/types.ts'
import type { ProposalView, ProposalDetail } from '../../server/proposals/view.ts'
import type { ProposeInput } from '../../server/proposals/propose.ts'
import type { PrepareResult } from '../../server/proposals/prepare.ts'
import type { OutcomeReading } from '../../server/systems/driver.ts'
import type { EventInput } from '../../server/proposals/events.ts'
import type { Actor } from '../../server/actor.ts'
import type { BoardRead } from '../../server/boards/types.ts'
import type { InstanceBar } from '../../server/instanceBar.ts'
import type { LibraryList, LibraryPreview, Receipt, RemovalPreview } from '../../server/library/types.ts'
import type { DeployPlan } from '../../server/deploy/prepare.ts'
import type { ReadBackAnswer, Ran } from '../../server/deploy/readback.ts'
import type { VisibilityAnswer } from '../../server/visibility/routes.ts'
import type { NarrowResult, NarrowTarget } from '../../server/visibility/narrow.ts'
// --- DAO-OS L6 Task 16: the pages' and editing sessions' shapes, as the server answers them (spec §16) ---
import type { PageNode } from '../../server/workspace/pages.ts'
import type { Compare, SaveResult } from '../../server/workspace/sessions.ts'
import type { Mentionable as ServedMentionable } from '../../server/workspace/conversation.ts'
import type { CollectionView } from '../../server/workspace/collections.ts'
import type { Present } from '../../server/workspace/presence.ts'
// --- end L6 Task 16
import type { RecordOp as WorkspaceRecordOp } from '../../server/changes/types.ts' // DAO-OS L6 Task 17
// --- DAO-OS L6 Task 18: conversation as the server answers it (rulings log, Task 9 → Task 16/18)
import type { Comment as ServedComment, NotificationRow } from '../../server/workspace/conversation.ts'
export type { ServedComment, NotificationRow }
/** POST /api/comments/:id/task: the task made — committed, staged under a raised rule, or kept private at the target's level. */
export type TaskMade = { task: string; commit: string } | { task: string; staged: true } | { task: string; visibility: string }
// --- end L6 Task 18
// --- DAO-OS L6 Task 19: Sources, the from mark, the editor table and a governed file, as the server answers them (§10, §16)
import type { Source } from '../../server/workspace/sources.ts'
import type { FileView } from '../../server/workspace/files.ts'
import type { From } from './elements/atoms/from.ts'
export type { Source, FileView }
/** One row of GET /api/editors (§11.1): a pattern, the class a rule governs it by (null: none), and its editor. */
export interface EditorRowView { pattern: string; class: string | null; editor: string }
/** GET /api/registries/:name?from=1: the collection's from mark and each record's (`fromMark`), beside the record's own
 *  `from` (an import's mark, data). Only the marks are read from it: the record itself is read without them. */
export interface RegistryMarks { fromMark?: From; entries?: { id?: unknown; fromMark?: From }[] }
// --- end L6 Task 19
// Every type the interfaces contract names, re-exported for the client (this plan owns these lines).
// Type-only: esbuild erases them, so nothing from server/ or lib/ reaches the bundle.
export type { StageOp, Op, RecordOp, RecordStaged, FileOp, Change, RuleSummary, DecisionRow, GovernanceView, RecordError } from '../../server/changes/types.ts'
export type { ProposalView, ProposalDetail, BranchState } from '../../server/proposals/view.ts'
export type { ProposeInput } from '../../server/proposals/propose.ts'
export type { DeployPlan, DeployStep } from '../../server/deploy/prepare.ts'
export type { ReadBack, ReadBackAnswer, ReadBackSystem, Ran } from '../../server/deploy/readback.ts'
export type { PrepareResult } from '../../server/proposals/prepare.ts'
export type { EventInput as ProposalEventInput, EventKindHere as ProposalEventKind } from '../../server/proposals/events.ts'
export type { DriverRead, DriverSection, Driver, DriverContext } from '../../server/systems/driver.ts'
export type { Actor } from '../../server/actor.ts'
export type { Shelf, Maturity, Standing, Fits, ListedEntry, ShelfProblem, LibraryList, LibraryPreview, Receipt, ReceiptDecision, RemovalPreview } from '../../server/library/types.ts'
export type { InstanceBar, BarSite } from '../../server/instanceBar.ts'
import type { InstanceThemes } from '../../server/instanceThemes.ts'
import type { InstanceNav } from '../../server/instanceNav.ts'
export type { InstanceNav, NavGroup, NavItem, NavSection } from '../../server/instanceNav.ts'
export type { InstanceThemes, InstanceTheme } from '../../server/instanceThemes.ts'
export type { Layout, GridPlace, CanvasPlace, Place, BlockEntry, BoardDef, BoardRead } from '../../server/boards/types.ts'
export type { Kind as ResourceKind, EdgeKind } from '../../server/resources/types.ts'
export type { MemberKind } from '../../lib/members.mjs'
export type { GovernanceShape } from '../../lib/governance-read.mjs'
export type { TrailerValues } from '../../lib/trailers.mjs'
export type { WizardDef, WizardStep, WizardField, WizardDoor } from '../../lib/wizards.mjs'
export type { Problem } from '../../lib/data-validate.mjs'
export type {
  KnowledgeView, EntryView, CanonRow, Lane, KindRow, PeerRow, RunRow, CheckRow, RefRow, ProvenanceRow, FieldRow,
  PublicFace, Mark, LaneId, CanonFile, RuleView, DryRead, PublishPlan, PreparedEdit,
} from '../../server/knowledge/types.ts'

/** The actor's change. `revises` is the proposal it updates, when it was loaded from one by Revise (spec 3.4
 *  "Revising", POST /api/proposals/:id/load): it makes the tray's primary action Update proposal. */
export type ChangeView = ServerChangeView

export interface RegistrySummary { name: string; kind: 'collection' | 'document'; count: number | null }
/** `instanceWrites` is said only while the Hub's writes are off (Lane 3 Task 11). */
/** `mark`: the instance's mark for the org seal (server/instanceAssets.ts), absent when it carries none. */
export interface Status { org: string; mark?: string | null; branch: string; dirty: boolean; instanceWrites?: 'off' }
export type Entity = Record<string, unknown> & { id: string }
export interface RegistryRead {
  name: string; kind: 'collection' | 'document'; schemaVersion: string | null
  /** Walk M15: the file it is read from when that is not data/<name>.yaml; null for a collection the store keeps. */
  file?: string | null
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
  /** The kinds of entry this field belongs to (a System's L7 fields, DAO-OS L7 Task 17): an entry of another kind shows it
   *  only when it holds it. Empty: it belongs to no kind, and is shown where it is held. */
  'x-kinds'?: string[]
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
/** NO_HAT's counterpart for a person signed in by an emailed link who holds no Role (T2c minor 5): they read what the
 *  public reads, and are told why in the same place. */
export const NO_ROLE_YET = 'You are signed in, but you have no Role here yet.'

/** The session as last read (`api.session`): a refused read is said from it. */
let lastSession: SessionView | null = null

/** What a 401 SIGN_IN says to this session (L9-O1): signing in is no answer for one who is signed in. A session whose
 *  reading shows no hat hears `NO_HAT` (an emailed-link person with no Role, `NO_ROLE_YET`); one whose hats are not known
 *  (past the grace, §5.2, or not read yet: `unread`, final review I1) hears its band; anyone else the server's sentence. */
export function signInSentence(message: string, session: SessionView | null): string {
  if (!session?.signedIn) return message
  if (session.stale || session.unread) return session.band ?? message
  return noStandingSentence(session) ?? message
}

/** What a live session that reads as no member is told: a wallet wearing no hat, NO_HAT; a person signed in by an emailed
 *  link with no Role, NO_ROLE_YET; anyone else nothing. */
export function noStandingSentence(session: SessionView | null | undefined): string | undefined {
  if (isWalletSession(session)) return session.hats.length === 0 ? NO_HAT : undefined
  if (session?.signedIn && session.via === 'email') return session.person.roles.length === 0 ? NO_ROLE_YET : undefined
  return undefined
}

// The walk review's G1: View as at the server. While previewing, every read names the viewer it is for (`?as=`); the
// server answers what that viewer and you may both read. What stays yours: the session, who you are (GET /api/actor: the
// server never swaps the actor, only the viewer), and the tree's hats the control offers (GET /api/visibility). Writes
// never carry it (none is offered while previewing).
let previewAs: string | null = null
/** The viewer every read is previewed for, as `?as=` names it (`public`, `members`, `hat:<ref>`); null: you. Set by View as. */
export function setPreviewAs(as: string | null): void { previewAs = as }
const readAsYou = (path: string) => isSessionPath(path) || path === '/api/actor' || path === '/api/visibility'
/** `path` as a read sends it now: with `as` while previewing. */
function previewed(path: string): string {
  if (previewAs === null || readAsYou(path.split('?')[0]!)) return path
  return `${path}${path.includes('?') ? '&' : '?'}as=${encodeURIComponent(previewAs)}`
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const asked = (init?.method ?? 'GET').toUpperCase() === 'GET' ? previewed(path) : path
  const res = await fetch(asked, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const said = typeof body.error === 'string' ? body.error : typeof body.reason === 'string' ? body.reason : `HTTP ${res.status}`
    const message = res.status === 401 && body.code === 'SIGN_IN' ? signInSentence(said, lastSession) : said
    const error = new ApiError(res.status, Array.isArray(body.errors) ? (body.errors as StageError[]) : [], message, body)
    // A preview read refused as that viewer is refused (the public asking the members' side) sends nobody to sign in.
    if (res.status === 401 && !isSessionPath(path) && asked === path) for (const fn of [...unauthorized]) fn(path, error)
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
/** Where a map's edges leave for the other map: one link node on the canvas (0.6, §14.2). The wire keeps its 0.6
 *  names, `portals` and the id `portal:<board>` (a saved layout may hold that id; PF-R119). */
export interface BoardLink { id: string; toBoard: Board; text: string; targets: string[] }
export interface BoardView { board: Board; nodes: Resource[]; edges: GraphEdge[]; portals: BoardLink[] }
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
export type ProposalCheck = ProposalWrite & { reading: OutcomeReading | null; appended: boolean; attention?: { level: 'warn'; text: string; mismatch?: string } }
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
/** `portal` (0.6.2, L9 §5.2): the portal's origin when the Hub is hosted with ORG_OS_PORTAL_ORIGIN, null when hosted
 *  without it, absent on a local Hub. The Portal link is drawn only with it (D-5: `usePortalOrigin`). */
interface PortalField { portal?: string | null }
/** `methods` (0.6.1, Lane 3): the ways a Hub with the email method wired offers (`email`, `wallet`); absent otherwise. */
export interface SignedOutView extends PortalField {
  mode: SessionMode; signIn: { chainId: string; tree: string } | null; signedIn: false; methods?: ('email' | 'wallet')[]
}
export interface SignedInView extends PortalField {
  mode: SessionMode; signedIn: true; actor: string; account: string; hats: { hat: string; name: string }[]; expiresAt: string
  /** `stale`: past the grace (§5.2). `unread`: no reading kept yet (after a restart, for as long as the tree cannot be
   *  read; final review I1). Either way the hats are not known, and `band` says so; `hats: []` alone is a reading. */
  stale?: true; unread?: true; band?: string
  via?: 'siwe'
}
/** A person signed in by an emailed link (0.6.1, Lane 3): their person id as the actor, the person as the house names
 *  them (their member name when the members file holds their id), their Roles; no account, no hats. */
export interface PersonSessionView extends PortalField {
  mode: SessionMode; signedIn: true; via: 'email'; actor: string
  person: { id: string; name: string; roles: string[]; nodes: string[] }
  viewer: 'member' | 'public'; expiresAt: string
  stale?: undefined; unread?: undefined; band?: undefined
}
export type SessionView = SignedOutView | SignedInView | PersonSessionView
/** A session signed in with a wallet (it has an account and hats); an emailed-link session has neither. */
export const isWalletSession = (s: SessionView | null | undefined): s is SignedInView => s?.signedIn === true && s.via !== 'email'
/** POST /api/session: a session, or no hat in the tree (§4.3 step 5). */
export type SignInAnswer = SignedInView | { signedIn: false; notMember: true }
/** GET /api/visibility (L5 spec §11.2, §13): the tree's hats with their names and the hats above each, the hats worn, the
 *  levels this member may give a thing, the policy, and the collections they may write (Q77). */
export type VisibilityView = VisibilityAnswer
export type { NarrowTarget, NarrowResult }
const enc = encodeURIComponent

/** True when your git email matched a member. */
// --- DAO-OS L6 Task 16: pages and editing sessions (spec §16) ---
export type { PageNode, Compare, SaveResult, ServedMentionable, CollectionView, Present }
/** GET /api/pages/:id: the page, how this viewer's saves go (`write.mode`), and the pages that link to it (gated). */
export interface PageRead {
  page: {
    id: string; title: string; parent: string | null; path: string | null; visibility: string; markdown: string
    edited: { at: string; by: string } | null; from?: unknown; stale?: 'missing-parent'
    /** DAO-OS L6 Task 19: where the page was read from (§10), for a member who may read it; the public is given none. */
    fromMark?: import('./elements/atoms/from.ts').From
    /** DAO-OS L6 Task 20 review I2: for a git page that is not public, the git subpages a widening to public makes public
     *  with it (those that take its level), as the server counts them. */
    widens?: number
  }
  write: { mode: 'direct' | 'approval' | 'none'; rule: unknown }
  backlinks: PageNode[]
}
/** POST /api/pages/:id/sessions: the session, the version it started from, and the page's body then. */
export interface SessionOpen { session: string; base: string; markdown: string }
/** POST /api/sessions/:sid/close: committed (or nothing to commit), or staged under a raised tree. */
export type SessionClose = { commit: string | null } | { staged: true }
// --- end L6 Task 16
/** DAO-OS L6 Task 17: a collection's definition or saved view written: a commit, staged under a raised rule, or (a private
 *  collection's) kept in the store at its level. */
export interface CollectionWrite { id: string; commit?: string; staged?: true; visibility?: string }

export const isKnownActor = (a: Actor): a is Extract<Actor, { id: string }> => 'id' in a

export const api = {
  status: () => fetchJSON<Status>('/api/status'),
  registries: () => fetchJSON<RegistrySummary[]>('/api/registries'),
  registry: (name: string) => fetchJSON<RegistryRead>(`/api/registries/${enc(name)}`),
  /** Walk M5: the last commit of a record no adapter makes a Resource of (members only; 404 for one not held). */
  recordChanged: (name: string, id: string) => fetchJSON<{ changed: Resource['changed'] }>(`/api/registries/${enc(name)}/${enc(id)}/changed`),
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
  /** The instance's sites bar (server/instanceBar.ts): no sites when the instance carries none. */
  instanceBar: () => fetchJSON<InstanceBar>('/api/instance/bar'),
  /** The instance's themes (server/instanceThemes.ts): none when it offers none. */
  instanceThemes: () => fetchJSON<InstanceThemes>('/api/instance/themes'),
  /** The instance's sidebar groups (server/instanceNav.ts): none when it carries none. */
  instanceNav: () => fetchJSON<InstanceNav>('/api/instance/nav'),
  board: (id: string) => fetchJSON<BoardRead>(`/api/boards/${enc(id)}`),
  builtinBoard: (id: string) => fetchJSON<BoardRead>(`/api/boards/${enc(id)}/builtin`),
  // The library: its list, a preview that writes nothing, and Add and Remove, which stage into your change (the tray's).
  // The knowledge commons (spec §2): the canon as kms reads it, one entry, what the commons shows, the dry read, the
  // plan a run would make, and the canon's one write — a prepared edit and its apply (R-32). Reads write nothing.
  knowledge: () => fetchJSON<import('../../server/knowledge/types.ts').KnowledgeView>('/api/knowledge'),
  knowledgeEntry: (type: string, slug: string) =>
    fetchJSON<import('../../server/knowledge/types.ts').EntryView>(`/api/knowledge/entry/${enc(type)}/${enc(slug)}`),
  knowledgePreview: (type: string, slug: string) =>
    fetchJSON<{ entry: import('../../server/knowledge/types.ts').PublicFace; json: Record<string, unknown> | null }>(
      `/api/knowledge/entry/${enc(type)}/${enc(slug)}/preview`),
  knowledgeDryRead: () => fetchJSON<import('../../server/knowledge/types.ts').DryRead>('/api/knowledge/dry-read', json('POST', {})),
  knowledgePlan: () => fetchJSON<import('../../server/knowledge/types.ts').PublishPlan>('/api/knowledge/plan'),
  knowledgePrepare: (type: string, slug: string, fields: Record<string, unknown>) =>
    fetchJSON<import('../../server/knowledge/types.ts').PreparedEdit>(
      `/api/knowledge/entry/${enc(type)}/${enc(slug)}/prepare`, json('POST', { fields })),
  knowledgeApply: (type: string, slug: string, fields: Record<string, unknown>, base: string) =>
    fetchJSON<{ commit: string | null; changed: boolean; classes: string[]; sentence: string }>(
      `/api/knowledge/entry/${enc(type)}/${enc(slug)}/apply`, json('POST', { fields, base })),
  library: () => fetchJSON<LibraryList>('/api/library'),
  libraryPreview: (id: string) => fetchJSON<LibraryPreview>(`/api/library/${enc(id)}/preview`),
  /** Stages the entry's records and its receipt. 409 NOT_ADDABLE | TAKEN (with `nextFreeId`), 422 `config.<name>` errors. */
  libraryAdd: (id: string, config: Record<string, unknown>) => fetchJSON<ChangeView>(`/api/library/${enc(id)}/add`, json('POST', { config })),
  libraryReceipts: () => fetchJSON<Receipt[]>('/api/library/receipts'),
  libraryRemoval: (receipt: string) => fetchJSON<RemovalPreview>(`/api/library/receipts/${enc(receipt)}/removal`),
  /** Stages the deletes of what the add created, and the receipt's removal. `take` names every record edited since the
   *  add (the removal preview's `asks`), or it answers 409 ASK. */
  libraryRemove: (receipt: string, take: string[]) => fetchJSON<ChangeView>(`/api/library/receipts/${enc(receipt)}/remove`, json('POST', { take })),
  // Deploying (DAO-OS L7 §8): the committed composition's deployment, every ready step prepared for its signer. Reads
  // the chain, writes nothing. 409 NOTHING_COMPOSED | STAGED_ONLY | PART_HIDDEN (the viewer may read only part of the
  // composition), 502 READ_FAILED (the node's host only).
  getDeploy: () => fetchJSON<DeployPlan>('/api/deploy'),
  /** Reads the chain again and stages what it holds as live Systems in your change (Task 12; never applied here).
   *  `ran`: the steps run, with the predictions they were prepared on. 409 MISMATCH { readBack } (nothing staged), 409
   *  PART_HIDDEN (the viewer may read only part of the composition; nothing read), 409 CHANGE_EDITS { readBack } (your
   *  change sets a field the flip sets otherwise), 409 KEPT_PRIVATE { readBack } (the flip would copy a value kept above
   *  members into git, or write a field the store holds with no level in the policy), 409 NOT_ADMITTED { readBack } (it
   *  writes a field kept at a level you are not admitted to), 422 the change engine's errors (the lockout's among them),
   *  503 PRIVATE_STORE, 502 READ_FAILED. What the policy keeps above members is staged in the private store (PF-R226). */
  readBackDeploy: (ran?: Ran[]) => fetchJSON<ReadBackAnswer>('/api/deploy/read-back', json('POST', ran ? { ran } : {})),
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
    fetchJSON<ProposalWrite>(`/api/proposals/${enc(id)}/revise`, json('POST', { ops: ops.map(op => (op.op === 'file' ? op : (({ before: _before, ...rest }) => rest)(op))) })),
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
  // --- DAO-OS L6 Task 16: pages and their editing sessions (spec §6, §16). `keepalive` lets a session end as the tab goes.
  pages: () => fetchJSON<PageNode[]>('/api/pages'),
  /** Walk I9: the pages, each with how your write under it goes (`write`), for Move to…; never asked while previewing. */
  writablePages: () => fetchJSON<PageNode[]>('/api/pages?write'),
  movePage: (id: string, body: { parent: string | null; before?: string }) =>
    fetchJSON<{ id: string; commit?: string | null; staged?: true }>(`/api/pages/${enc(id)}/move`, json('POST', body)),
  page: (id: string) => fetchJSON<PageRead>(`/api/pages/${enc(id)}`),
  createPage: (input: { title: string; parent?: string | null; visibility?: string; markdown?: string }) =>
    fetchJSON<{ id: string; commit?: string | null; staged?: boolean }>('/api/pages', json('POST', input)),
  openSession: (page: string) => fetchJSON<SessionOpen>(`/api/pages/${enc(page)}/sessions`, json('POST', {})),
  saveSession: (sid: string, body: { markdown: string; title?: string }, keepalive = false) =>
    fetchJSON<SaveResult>(`/api/sessions/${enc(sid)}`, { ...json('PUT', body), keepalive }),
  closeSession: (sid: string, keepalive = false) => fetchJSON<SessionClose>(`/api/sessions/${enc(sid)}/close`, { ...json('POST', {}), keepalive }),
  resolveSession: (sid: string, keep: 'mine' | 'theirs') => fetchJSON<{ commit: string | null; staged?: true }>(`/api/sessions/${enc(sid)}/resolve`, json('POST', { keep })),
  compareSession: (sid: string) => fetchJSON<Compare>(`/api/sessions/${enc(sid)}/compare`),
  // DAO-OS L6 Task 16b (R-L6-SUGGEST): the session's text proposed as the page's edit; answered as Propose is (201).
  suggestSession: (sid: string, body: { markdown: string; title?: string; proposal: { title: string; rationale?: string } }) =>
    fetchJSON<ProposalWrite>(`/api/sessions/${enc(sid)}/suggest`, json('POST', body)),
  presence: (targets: string[]) => fetchJSON<Record<string, Present[]>>(`/api/presence?targets=${targets.map(enc).join(',')}`),
  /** T2e M4: in a reply, `parent` (the comment it answers), so who may be told is judged with the talk above it. */
  mentionables: (target: string, q: string, parent?: string) =>
    fetchJSON<ServedMentionable[]>(`/api/mentionables?target=${enc(target)}&q=${enc(q)}${parent ? `&parent=${enc(parent)}` : ''}`),
  collections: () => fetchJSON<{ collections: CollectionView[] }>('/api/collections'),
  // --- end L6 Task 16
  // --- DAO-OS L6 Task 17: collections, saved views, view state, batched record writes, Record a meeting (spec §16)
  createCollection: (def: { id: string; name?: string; fields?: unknown[]; views?: unknown[] }) =>
    fetchJSON<CollectionWrite>('/api/collections', json('POST', def)),
  saveView: (collection: string, view: string, body: Record<string, unknown>) =>
    fetchJSON<CollectionWrite & { view: string }>(`/api/collections/${enc(collection)}/views/${enc(view)}`, json('PUT', body)),
  viewState: (collection: string) => fetchJSON<{ collection: string; state: unknown }>(`/api/view-state/${enc(collection)}`),
  putViewState: (collection: string, state: unknown, keepalive = false) =>
    fetchJSON<{ collection: string; state: unknown }>(`/api/view-state/${enc(collection)}`, { ...json('PUT', { state }), keepalive }),
  workspaceRecords: (ops: WorkspaceRecordOp[]) => fetchJSON<{ save: 'direct' | 'staged' }>('/api/workspace/records', json('POST', { ops })),
  recordMeeting: (input: { title: string; date: string; type?: string }) =>
    fetchJSON<{ meeting: string; page: string; commit: string | null; staged?: true }>('/api/meetings', json('POST', input)),
  // --- end L6 Task 17
  // --- DAO-OS L6 Task 18: comments, mentions, notifications, reads and presence beats (spec §8, §16)
  comments: (target: string) => fetchJSON<ServedComment[]>(`/api/comments?target=${enc(target)}`),
  comment: (input: { target: string; body: string; parent?: string; anchor?: { exact: string; prefix?: string; suffix?: string } }) =>
    fetchJSON<{ comment: ServedComment; notTold: string[] }>('/api/comments', json('POST', input)),
  resolveComment: (id: string) => fetchJSON<{ comment: ServedComment }>(`/api/comments/${enc(id)}/resolve`, json('POST', {})),
  reopenComment: (id: string) => fetchJSON<{ comment: ServedComment }>(`/api/comments/${enc(id)}/reopen`, json('POST', {})),
  deleteComment: (id: string) => fetchJSON<{ comment: ServedComment }>(`/api/comments/${enc(id)}`, { method: 'DELETE' }),
  commentTask: (id: string) => fetchJSON<TaskMade>(`/api/comments/${enc(id)}/task`, json('POST', {})),
  notifications: () => fetchJSON<NotificationRow[]>('/api/notifications'),
  /** Opening a target marks its notifications read (§8.3). */
  markRead: (target: string) => fetchJSON<{ target: string; at: string; read: number }>('/api/reads', json('POST', { target })),
  beat: (target: string, editing: boolean) => fetchJSON<{ target: string; people: Present[] }>('/api/presence', json('POST', { target, editing })),
  // --- end L6 Task 18
  // --- DAO-OS L6 Task 19: Sources, the from marks, the editor table and the source editor's file (spec §10, §11, §16)
  sources: () => fetchJSON<Source[]>('/api/sources'),
  registryMarks: (name: string) => fetchJSON<RegistryMarks>(`/api/registries/${enc(name)}?from=1`),
  editors: () => fetchJSON<EditorRowView[]>('/api/editors'),
  file: (path: string) => fetchJSON<FileView>(`/api/files?path=${enc(path)}`),
  // --- end L6 Task 19
}
