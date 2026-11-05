import { useState } from 'react'
import { StatusMark } from '../../design/StatusMark.tsx'
import { ViewHeader } from '../../elements/views/ViewHeader.tsx'
import { TableView, type Column } from '../../elements/views/TableView.tsx'
import { ListView } from '../../elements/views/ListView.tsx'
import { BoardCard, BoardView } from '../../elements/views/BoardView.tsx'
import { CalEvent, CalendarView } from '../../elements/views/CalendarView.tsx'
import { DataRow } from '../../elements/rows/DataRow.tsx'
import { applyFilters, type Filter } from '../../elements/views/filters.ts'
import { FromMark } from '../../elements/atoms/FromMark.tsx'
import { PEOPLE } from '../../test/fixtures/house/people.ts'
import { MEETINGS, SAVED_VIEW, TASKS, TASK_COLUMNS, TASK_FIELDS, TASK_PRESENCE, TASK_VIEWS, overdue, readTask, type FixtureTask } from '../../test/fixtures/house/workspace.ts'
import { TREASURY_SYSTEM } from '../../test/fixtures/house/systems.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { driverOf } from '../../systems/DriverView.tsx'
import type { DriverRead } from '../../api.ts'
import { Card, State } from './spec.tsx'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** A due date as a table cell says it: "18 Oct". */
export function dueText(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** An owner's monogram, their role named for a screen reader; nobody's is a faint dash. */
function Owner({ handle }: { handle: string | null }) {
  const p = handle === null ? undefined : PEOPLE.find(x => x.handle === handle)
  if (!p) return <span className="faint">—</span>
  return <span className="pres"><span className="av" aria-hidden="true">{p.monogram}</span><span className="sr-only">{p.name}</span></span>
}

/** A task's status as a mark: done is done, the rest are open, with the task's own word. */
const statusMark = (t: FixtureTask) => <StatusMark mark={t.status === 'Done' ? 'done' : 'open'} label={t.status} />

/** The Tasks table's columns (the gallery's): the task (editable in place), its project, owner, due date (clay and
 *  "overdue" once past) and status. */
export function taskColumns(now: Date = FIXED_NOW): Column<FixtureTask>[] {
  return [
    { key: 'title', label: 'Task', sort: t => t.title.toLowerCase(), cell: t => t.title, edit: t => t.title },
    { key: 'project', label: 'Project', sort: t => t.project, cell: t => t.project },
    { key: 'owner', label: 'Owner', cell: t => <Owner handle={t.owner} /> },
    { key: 'due', label: 'Due', mono: true, right: true, sort: t => t.due ?? '9999', cell: t => dueText(t.due), late: t => overdue(t, now) },
    { key: 'status', label: 'Status', card: 'status', cell: statusMark },
  ]
}

/** What the calendar draws: the tasks that have a due date and the meetings, each with the day it falls on. */
export interface CalItem {
  id: string
  kind: 'task' | 'meeting'
  title: string
  date: string
  late: boolean
  staged: boolean
  /** The agenda row's second line: "Meeting · 17:00", "Task · Node kit", "Task · overdue". */
  second: string
  facts: { visibility?: string }
}

/** The fixture calendar (a meeting's day first, then the tasks due on it); task-3's new due date is staged. */
export function calendarItems(now: Date = FIXED_NOW): CalItem[] {
  const meetings: CalItem[] = MEETINGS.map(m => ({ id: m.id, kind: 'meeting', title: m.title, date: m.date, late: false, staged: false,
    second: `Meeting · ${m.time}`, facts: m.facts }))
  const tasks: CalItem[] = TASKS.flatMap(t => (t.due === null ? [] : [{ id: t.id, kind: 'task' as const, title: t.title, date: t.due,
    late: overdue(t, now), staged: t.id === 'task-3', second: overdue(t, now) ? 'Task · overdue' : `Task · ${t.project}`, facts: t.facts }]))
  return [...meetings, ...tasks]
}
/** A calendar item as its pill, and as the agenda's data row. */
export const calEvent = (e: CalItem) => <CalEvent glyph={e.kind === 'meeting' ? 'people' : 'check'} title={e.title} late={e.late} staged={e.staged} />
export const calRow = (e: CalItem) => (
  <DataRow key={e.id} kind={e.kind} title={e.title} second={e.second} marks={e.staged ? ['staged'] : []} tone={e.late ? 'attn' : undefined} item={e} />
)

/** A task as a board card: its title, its due date and project, who has it open. */
const taskCard = (t: FixtureTask) => <BoardCard title={t.title} facts={[dueText(t.due), t.project]} presence={[...(TASK_PRESENCE[t.id] ?? [])]} />
const moved = async () => true as const

const noop = () => {}
const EMPTY = { title: 'No tasks yet.', line: 'Tasks link to projects, meetings and proposals.' }
const NOT_DONE: Filter = { field: 'status', op: 'is-not', value: 'Done' }

/** The view header at work: the tabs, the chips and + Filter, the sort, New task; its filters filter the table. */
function TasksView() {
  const [view, setView] = useState('table')
  const [filters, setFilters] = useState<Filter[]>([NOT_DONE, { field: 'project', op: 'is', value: 'Node kit' }])
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({ field: 'title', dir: 'asc' })
  const rows = applyFilters([...TASKS], filters, readTask)
  return (
    <>
      <ViewHeader label="Tasks" views={[...TASK_VIEWS]} value={view} onView={setView} filters={filters} onFilters={setFilters}
        fields={TASK_FIELDS} sort={sort} onSort={setSort} primary={{ label: 'New task', onClick: noop }}
        from={{ file: 'data/tasks.yaml', readAt: new Date(FIXED_NOW.getTime() - 120_000).toISOString() }} now={FIXED_NOW} />
      <TableView label="Tasks" rows={rows} columns={taskColumns()} rowKey={t => t.id} empty={EMPTY} filtered={filters.length > 0}
        onClearFilters={() => setFilters([])} sort={sort} onSort={s => setSort(s ?? { field: 'title', dir: 'asc' })} />
    </>
  )
}

/** A lift, drawn still (the gallery's): "Collect signer confirmations" taken from Doing towards Done — its ghost in
 *  Doing, the moss slot in Done, the card itself popped and tilted above it. The classes are BoardView's own. */
function LiftedBoard() {
  const card = (t: FixtureTask) => <BoardCard title={t.title} facts={[dueText(t.due), t.project]} presence={[...(TASK_PRESENCE[t.id] ?? [])]} />
  const [lifted, other] = [TASKS[1]!, TASKS[0]!]
  return (
    <div className="kb">
      <div className="kb-cols">
        <div className="kcol">
          <div className="kcol-h"><span className="smark smark-open" aria-hidden="true"><span className="smark-shape" /></span><span className="kcol-n">Doing</span><span className="kcol-c">3</span></div>
          <ul className="kcol-l" aria-label="Doing, a card lifted">
            <li className="kcard">{card(other)}</li>
            <li className="kcard kcard-ghost" aria-hidden="true" inert>{card(lifted)}</li>
          </ul>
        </div>
        <div className="kcol">
          <div className="kcol-h"><span className="smark smark-done" aria-hidden="true"><span className="smark-shape" /></span><span className="kcol-n">Done</span><span className="kcol-c">2</span></div>
          <ul className="kcol-l" aria-label="Done, the drop target">
            <li className="kdrop" aria-hidden="true" />
            <li className="kcard kcard-lift">{card(lifted)}</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

/** /parts/views (§10.2; the gallery's "views" section): the view header with its tabs (and a saved view), its chips
 *  and + Filter, the sort and the one primary; the Tasks table grouped by status — a staged cell, a write in flight,
 *  an overdue date, a picked row — and the same table in its narrow card form; the list view; the board (a staged
 *  move, a lift drawn still, its grouped-list form) and the calendar (a month, and its agenda); then the states every
 *  view shares (loading, empty, filtered-empty, error) and the from mark in its four forms. Fixtures, read against
 *  FIXED_NOW. */
export default function Views() {
  const doing = TASKS.filter(t => t.status !== 'Done')
  const staged = (t: FixtureTask, col: string) => (t.id === 'task-3' && col === 'due' ? 'saving' : t.id === 'task-1' && col === 'project' ? 'staged' : null)
  const failed: DriverRead = { ...driverOf(TREASURY_SYSTEM)!, ok: false, state: 'failed', readAt: new Date(FIXED_NOW.getTime() - 2 * 3_600_000).toISOString() }
  return (
    <div className="pg">
      <p className="pg-lede">A collection is seen through table, board, calendar, list or map. Views never change records: an edit in a view stages, and the cell says so. Under 600 px of view width the table becomes cards, never a sideways scroll.</p>
      <Card cap="View header · tabs, a saved view, filters, sort, New task">
        <ViewHeader label="Tasks, with a saved view" views={[...TASK_VIEWS, SAVED_VIEW]} value="table" onView={noop} filters={[NOT_DONE]} onFilters={noop}
          fields={TASK_FIELDS} sort={{ field: 'due', dir: 'asc' }} onSort={noop} primary={{ label: 'New task', onClick: noop }} />
        <TasksView />
      </Card>
      <Card cap="Table · grouped by status, inline edit, staged and saving cells, overdue">
        <TableView label="Tasks by status" rows={doing} columns={taskColumns()} rowKey={t => t.id} groupBy={t => t.status} selectable
          staged={staged} onEdit={noop} empty={EMPTY} />
      </Card>
      <div className="pg-grid pg-two">
        <Card cap={`Table · under 600\u00a0px of view, cards`}>
          <div className="pg-narrow">
            <TableView label="Tasks, narrow" rows={doing} columns={taskColumns()} rowKey={t => t.id} staged={staged} empty={EMPTY} />
          </div>
        </Card>
        <Card cap="List · data rows">
          <ListView label="Tasks as a list" rows={doing} empty={EMPTY} row={t => (
            <DataRow key={t.id} kind="task" title={t.title} second={`${t.project} · ${dueText(t.due)}`} marks={overdue(t) ? ['needs'] : []} item={t} />
          )} />
        </Card>
      </div>
      <Card cap="Board · by status: a staged move, presence, + New and Move to… on every card">
        <BoardView label="Tasks by status" columns={[...TASK_COLUMNS]} cards={[...TASKS]} cardKey={t => t.id} cardName={t => t.title}
          columnOf={t => t.status} card={taskCard} staged={t => t.id === 'task-6'} onMove={moved} onNew={noop} />
      </Card>
      <Card cap="Board · a card lifted: its ghost, the drop target">
        <LiftedBoard />
      </Card>
      <Card cap="Calendar · weeks start Monday, today in ink, an overdue task, a staged date, +2 more">
        <CalendarView label="Tasks and meetings" year={2026} month={10} today={FIXED_NOW.toISOString().slice(0, 10)} events={calendarItems()}
          dateOf={e => e.date} event={calEvent} row={calRow} onOpenDay={noop} />
      </Card>
      <div className="pg-grid pg-two">
        <Card cap={`Board · under 600\u00a0px of view, a grouped list`}>
          <div className="pg-narrow">
            <BoardView label="Tasks by status, narrow" columns={[...TASK_COLUMNS]} cards={TASKS.filter(t => t.status !== 'Done')} cardKey={t => t.id}
              cardName={t => t.title} columnOf={t => t.status} card={taskCard} staged={t => t.id === 'task-2'} onMove={moved} />
          </div>
        </Card>
        <Card cap={`Calendar · under 600\u00a0px of view, the agenda`}>
          <div className="pg-narrow">
            <CalendarView label="Tasks and meetings, narrow" year={2026} month={10} today={FIXED_NOW.toISOString().slice(0, 10)}
              events={calendarItems().filter(e => e.date >= '2026-10-15' && e.date <= '2026-10-18')} dateOf={e => e.date} event={calEvent} row={calRow} onOpenDay={noop} />
          </div>
        </Card>
      </div>
      <Card cap="From mark · a file, a repository, a System, an import">
        <State name="file"><FromMark from={{ file: 'data/projects.yaml', readAt: new Date(FIXED_NOW.getTime() - 120_000).toISOString() }} now={FIXED_NOW} /></State>
        <State name="repository"><FromMark from={{ repo: 'org-os', file: 'data/meetings.yaml', readAt: new Date(FIXED_NOW.getTime() - 3_600_000).toISOString() }} now={FIXED_NOW} /></State>
        <State name="System, a failed read"><FromMark from={{ system: TREASURY_SYSTEM.name, read: failed }} now={FIXED_NOW} /></State>
        <State name="import"><FromMark from={{ import: 'Notion', exportedAt: '2026-08-12T09:00:00Z' }} now={FIXED_NOW} /></State>
      </Card>
      <div className="pg-grid pg-two">
        <Card cap="View states · loading">
          <TableView label="Tasks" rows={[]} columns={taskColumns()} rowKey={t => t.id} empty={EMPTY} loading={3} />
        </Card>
        <Card cap="View states · empty collection">
          <TableView label="Tasks" rows={[]} columns={taskColumns()} rowKey={t => t.id} empty={EMPTY} />
        </Card>
        <Card cap="View states · empty after filter">
          <TableView label="Tasks" rows={[]} columns={taskColumns()} rowKey={t => t.id} empty={EMPTY} filtered onClearFilters={noop} />
        </Card>
        <Card cap="View states · error">
          <TableView label="Tasks" rows={[]} columns={taskColumns()} rowKey={t => t.id} empty={EMPTY} error="the server didn’t answer." onRetry={noop} />
        </Card>
      </div>
    </div>
  )
}
