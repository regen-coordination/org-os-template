/** The workspace's fixture collection (spec §10.2, §17): a Tasks collection as the gallery's views draw it — tasks
 *  of the house's projects, owned by the placeholder roles, due around FIXED_NOW. Fixtures only until L6 keeps
 *  collections in git; no real person's name; dates are relative to FIXED_NOW, so /parts is shot the same way
 *  every time. */
import { FIXED_NOW } from '../parts.ts'
import type { Comment } from '../../../elements/workspace/CommentThread.tsx'
import type { Mentionable } from '../../../elements/workspace/mentions.ts'

export type TaskStatus = 'To do' | 'Doing' | 'Done'

export interface FixtureTask {
  id: string
  title: string
  project: string
  /** The owner's handle (people.ts), or null for a task nobody owns yet. */
  owner: string | null
  /** The due date, `YYYY-MM-DD`, or null. */
  due: string | null
  status: TaskStatus
  /** Where the visibility source reads its level (L4-R7): `public`, `members` or `hat:<id>`. */
  facts: { visibility?: string }
}

const DAY = 86_400_000
/** A date this many days from the fixtures' clock, as a task's due date holds it. */
export const dueIn = (days: number): string => new Date(FIXED_NOW.getTime() + days * DAY).toISOString().slice(0, 10)

export const TASKS: readonly FixtureTask[] = [
  { id: 'task-1', title: 'Draft the pool report for Q3', project: 'Node kit', owner: 'ops-lead', due: dueIn(1), status: 'Doing', facts: {} },
  { id: 'task-2', title: 'Collect signer confirmations', project: 'Treasury', owner: 'steward-a', due: dueIn(4), status: 'Doing', facts: {} },
  { id: 'task-3', title: 'Import the Notion meeting notes', project: 'Workspace', owner: 'treasury-steward', due: dueIn(8), status: 'Doing', facts: {} },
  { id: 'task-4', title: 'Write the onboarding page', project: 'Node kit', owner: null, due: dueIn(-2), status: 'To do', facts: {} },
  { id: 'task-5', title: 'Ask the Council about the pool', project: 'Treasury', owner: null, due: null, status: 'To do', facts: {} },
  { id: 'task-6', title: 'Read the Hats tree for the first time', project: 'Roles', owner: 'council-steward', due: dueIn(-5), status: 'Done', facts: {} },
  { id: 'task-7', title: 'Remove the old signer', project: 'Treasury', owner: 'steward-a', due: dueIn(-2), status: 'Done', facts: {} },
]

/** The fields a task is filtered and sorted by, as the header names them. */
export const TASK_FIELDS = [
  { id: 'title', label: 'Task' }, { id: 'project', label: 'Project' }, { id: 'owner', label: 'Owner' },
  { id: 'due', label: 'Due' }, { id: 'status', label: 'Status' },
] as const

/** A task's value for a field, as filters read it. */
export function readTask(t: FixtureTask, field: string): unknown {
  return Object.hasOwn(t, field) ? (t as unknown as Record<string, unknown>)[field] : undefined
}

/** Is a task overdue at `now`: due before today, and not done. */
export function overdue(t: FixtureTask, now: Date = FIXED_NOW): boolean {
  return t.due !== null && t.status !== 'Done' && t.due < now.toISOString().slice(0, 10)
}

/** The five views, then a saved one (E-3): it follows Map as a tab without an icon. */
export const TASK_VIEWS = [
  { id: 'table', label: 'Table' }, { id: 'board', label: 'Board' }, { id: 'calendar', label: 'Calendar' },
  { id: 'list', label: 'List' }, { id: 'map', label: 'Map' },
] as const
export const SAVED_VIEW = { id: 'saved:mine', label: 'My open tasks' } as const

/** The board's columns for the Tasks collection: one per status, with its mark (§10.2). */
export const TASK_COLUMNS = [
  { id: 'To do', name: 'To do', mark: 'open' }, { id: 'Doing', name: 'Doing', mark: 'open' }, { id: 'Done', name: 'Done', mark: 'done' },
] as const

/** Who has a task open (§7.12): the handles and roles presence draws on a board card. */
export const TASK_PRESENCE: Readonly<Record<string, readonly { handle: string; role: string; editing?: boolean }[]>> = {
  'task-1': [{ handle: 'ops-lead', role: 'Ops lead', editing: true }],
  'task-2': [{ handle: 'steward-a', role: 'Steward A' }],
}

export interface FixtureMeeting {
  id: string
  title: string
  /** The day, `YYYY-MM-DD`, and its time, `HH:MM` (UTC). */
  date: string
  time: string
  facts: { visibility?: string }
}

/** The meetings the calendar draws beside the tasks due: a day around FIXED_NOW holds five, so it shows three and
 *  "+2 more". */
export const MEETINGS: readonly FixtureMeeting[] = [
  { id: 'meeting-1', title: 'Council call', date: dueIn(-16), time: '17:00', facts: {} },
  { id: 'meeting-2', title: 'Council call', date: dueIn(-2), time: '17:00', facts: {} },
  { id: 'meeting-3', title: 'Ops sync', date: dueIn(0), time: '09:30', facts: {} },
  { id: 'meeting-4', title: 'Signer review', date: dueIn(0), time: '11:00', facts: {} },
  { id: 'meeting-5', title: 'Pool check-in', date: dueIn(0), time: '14:00', facts: {} },
  { id: 'meeting-6', title: 'Treasury hour', date: dueIn(0), time: '15:00', facts: {} },
  { id: 'meeting-7', title: 'Local nodes sync', date: dueIn(0), time: '18:00', facts: {} },
  { id: 'meeting-8', title: 'Local nodes sync', date: dueIn(5), time: '18:00', facts: {} },
  { id: 'meeting-9', title: 'Council call', date: dueIn(12), time: '17:00', facts: {} },
]

const MIN = 60_000
const HOUR = 3_600_000
/** A time this long before the fixtures' clock, as an ISO string. */
const before = (ms: number): string => new Date(FIXED_NOW.getTime() - ms).toISOString()

/** The page the editor draws (§10.1; the gallery's "How the treasury is run"): its path, meta line, who has it open,
 *  and its level (`hat:ops` — read by Ops and the hats above it, so the mention picker has members who may not see
 *  it, C-21). The anchor is the commented passage the first comment points at (E-15). */
export const PAGE = {
  path: [
    { label: 'Knowledge', href: '/workspace/knowledge' },
    { label: 'Treasury', href: '/workspace/knowledge/treasury' },
    { label: 'How the treasury is run', href: '/workspace/knowledge/treasury/how-the-treasury-is-run' },
  ],
  title: 'How the treasury is run',
  meta: 'Edited 4 min ago by Ops lead · Workspace write · saves directly · 3 backlinks',
  presence: [{ handle: 'ops-lead', role: 'Ops lead', editing: true }, { handle: 'steward-b', role: 'Steward B' }],
  facts: { visibility: 'hat:ops' },
  from: { file: 'knowledge/treasury/how-the-treasury-is-run.md', readAt: before(4 * MIN) },
  anchor: { id: 'season', text: 'the Council can ask for them back' },
} as const

/** Who writes in the fixtures' thread: the viewer is the Council steward. */
export const ME = 'council-steward'

/** The page's comment thread (§10.3): an anchored comment with a reply and the viewer's reply still sending; the
 *  viewer's comment that was not sent; and a resolved one with three replies. Two are open. */
export const COMMENTS: Comment[] = [
  {
    id: 'c-1', handle: 'steward-b', role: 'Steward B', at: before(2 * HOUR), state: 'sent', anchor: PAGE.anchor,
    body: 'Only after a season? Do we write the season down?',
    replies: [
      { id: 'c-1-1', handle: 'ops-lead', role: 'Ops lead', at: before(HOUR), state: 'sent', body: 'It is in the pool rules. I’ll link them.', replies: [] },
      { id: 'c-1-2', handle: 'council-steward', role: 'Council steward', at: before(MIN), state: 'sending', body: 'Thanks — linking is enough.', replies: [] },
    ],
  },
  { id: 'c-2', handle: 'council-steward', role: 'Council steward', at: before(2 * MIN), state: 'not-sent', body: 'Adding the season to the page now.', replies: [] },
  {
    id: 'c-3', handle: 'treasury-steward', role: 'Treasury steward', at: before(26 * HOUR), state: 'sent', resolved: { by: 'Ops lead' },
    body: 'Which chains does the Safe hold funds on?',
    replies: [
      { id: 'c-3-1', handle: 'ops-lead', role: 'Ops lead', at: before(25 * HOUR), state: 'sent', body: 'Seven, at the same address.', replies: [] },
      { id: 'c-3-2', handle: 'treasury-steward', role: 'Treasury steward', at: before(25 * HOUR), state: 'sent', body: 'Then the page should say so.', replies: [] },
      { id: 'c-3-3', handle: 'ops-lead', role: 'Ops lead', at: before(24 * HOUR), state: 'sent', body: 'It does now.', replies: [] },
    ],
  },
]

/** Who and what the mention picker may offer on this page (§10.4): the members who read Ops pages, the Ops role, a
 *  record; the Treasurer's wearers, who may not see the page (offered disabled, C-21); and a role and a page the
 *  author may not see, which are never offered. */
export const MENTIONABLES: Mentionable[] = [
  { kind: 'person', id: 'ops-lead', label: 'Ops lead', hat: 'Ops', canSee: true },
  { kind: 'person', id: 'council-steward', label: 'Council steward', hat: 'Council', canSee: true },
  { kind: 'role', id: 'ops', label: 'Ops', count: 3, canSee: true },
  { kind: 'person', id: 'treasury-steward', label: 'Treasury steward', hat: 'Treasurer', canSee: false },
  { kind: 'record', id: 'system:treasury', label: 'Treasury', canSee: true },
  { kind: 'person', id: 'steward-b', label: 'Steward B', hat: 'Council', canSee: true },
  { kind: 'role', id: 'treasury', label: 'Treasurer', count: 2, canSee: false },
  { kind: 'page', id: 'page:grants-draft', label: 'Grants draft', canSee: false },
]
