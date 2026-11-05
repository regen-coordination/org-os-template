import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '../../design/Button.tsx'
import { Icon, type IconName } from '../../design/Icon.tsx'
import { NoteBlock } from '../../design/Note.tsx'
import { useViewer } from '../../viewAs/ViewAs.tsx'
import { DataList } from '../rows/DataList.tsx'
import { WEEK, addDays, addMonths, dayHeading, dayName, monthGrid, monthOf, monthTitle } from './calendar.ts'

/** How many events a day cell draws before "+N more". */
const SHOWN = 3

/** An event as a calendar pill (§10.2): 20px, its glyph and its title cut to the cell. An overdue task is clay and
 *  says "Overdue" to a screen reader (E-12: never colour alone); a staged one has the moss inline-start bar. */
export function CalEvent({ glyph, title, late = false, staged = false }: { glyph: IconName; title: string; late?: boolean; staged?: boolean }) {
  const cls = ['cal-ev', late && 'cal-ev-late', staged && 'cal-ev-staged'].filter(Boolean).join(' ')
  return (
    <span className={cls}>
      <Icon name={glyph} size="xs" />
      <span className="cal-ev-t">{title}</span>
      {late && <span className="sr-only">Overdue</span>}
      {staged && <span className="sr-only">Staged</span>}
    </span>
  )
}

export interface CalendarViewProps<T> {
  label: string
  /** The month first shown (1–12), and today (`YYYY-MM-DD`): the reader's day, read at the page's `now`. */
  year: number
  month: number
  today: string
  events: T[]
  /** An event's day, `YYYY-MM-DD`. */
  dateOf(e: T): string
  /** Its pill in the grid (`CalEvent`). */
  event(e: T): ReactNode
  /** Its data row in the agenda (a `DataRow`, keyed); without it the agenda lists the pills. */
  row?(e: T): ReactNode
  /** A day opened: Enter on its cell, or its "+N more". */
  onOpenDay(date: string): void
  /** The month turned, by its buttons or the keys. */
  onMonth?(year: number, month: number): void
  /** The agenda with nothing in the month, in the collection's own words (E-7). */
  empty?: { title: string; line?: string }
}

/** A collection on a month (spec §10.2): a grid of the month's weeks, Monday first (C-18), seven columns parted by
 *  1px rules; a day cell 96 at least with its date in a 22px circle, today an ink disc, the days outside the month
 *  on --sunken with a faint date; up to three event pills, then "+N more", which opens the day. Events the viewer may
 *  not see are not drawn (§6.3).
 *
 *  A `grid`: one tab stop, the arrows move by day (turning the month when they leave it), Page Up and Page Down by
 *  month, Enter opens the focused day. A day of the month before or after, focused by a click, turns the month to it
 *  as an arrow would, and says so through `onMonth`. Under 600px of its own width (the `cal` container) it is an agenda: a heading
 *  for each day that holds something ("Today · Thu 29 Oct" in ink), over its data rows. */
export function CalendarView<T>(p: CalendarViewProps<T>) {
  const { visible } = useViewer()
  const titleId = useId()
  const [focus, setFocus] = useState(() => {
    const t = monthOf(p.today)
    return t.year === p.year && t.month === p.month ? p.today : `${p.year}-${String(p.month).padStart(2, '0')}-01`
  })
  const table = useRef<HTMLTableElement>(null)
  const refocus = useRef(false)
  const { year, month } = monthOf(focus)

  useLayoutEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    table.current?.querySelector<HTMLElement>(`td[data-date="${focus}"]`)?.focus()
  })

  const byDay = new Map<string, T[]>()
  for (const e of visible(p.events)) {
    const d = p.dateOf(e)
    const into = byDay.get(d)
    if (into) into.push(e); else byDay.set(d, [e])
  }

  const go = (to: string, keys: boolean) => {
    const was = monthOf(focus), now = monthOf(to)
    refocus.current = keys
    setFocus(to)
    if (was.year !== now.year || was.month !== now.month) p.onMonth?.(now.year, now.month)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return
    if (!(e.target as HTMLElement).matches('td[data-date]')) return
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1), ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7), ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, -1), PageDown: () => addMonths(focus, 1),
    }
    if (e.key === 'Enter') { e.preventDefault(); p.onOpenDay(focus); return }
    const to = step[e.key]
    if (!to) return
    e.preventDefault()
    go(to(), true)
  }

  const weeks = monthGrid(year, month, p.today)
  const title = monthTitle(year, month)
  const agenda = [...byDay.keys()].filter(d => { const m = monthOf(d); return m.year === year && m.month === month }).sort()

  return (
    <div className="cal">
      <div className="cal-h">
        <h3 className="cal-t" id={titleId}>{title}</h3>
        <span className="cal-nav">
          <Button iconOnly icon="chevron-left" variant="ghost" label="Previous month" onClick={() => go(addMonths(focus, -1), false)} />
          <Button small onClick={() => go(p.today, false)}>Today</Button>
          <Button iconOnly icon="chevron-right" variant="ghost" label="Next month" onClick={() => go(addMonths(focus, 1), false)} />
        </span>
      </div>
      <div className="cal-box">
        <table ref={table} className="cal-grid" role="grid" aria-labelledby={titleId} onKeyDown={onKeyDown}
          onFocus={e => { const d = (e.target as HTMLElement).dataset.date; if (d && d !== focus) go(d, true) }}>
          <thead><tr>{WEEK.map(w => <th key={w} scope="col">{w}</th>)}</tr></thead>
          <tbody>
            {weeks.map(week => (
              <tr key={week[0]!.date}>
                {week.map(d => {
                  const events = byDay.get(d.date) ?? []
                  const more = events.length - SHOWN
                  const cls = ['cal-day', !d.inMonth && 'cal-out', d.today && 'cal-today'].filter(Boolean).join(' ')
                  return (
                    <td key={d.date} role="gridcell" className={cls} data-date={d.date} tabIndex={d.date === focus ? 0 : -1}
                      aria-current={d.today ? 'date' : undefined}>
                      <span className="cal-d" aria-hidden="true">{Number(d.date.slice(8, 10))}</span>
                      <span className="sr-only">{dayName(d.date)}{d.today ? ', today' : ''}</span>
                      {events.length > 0 && (
                        <ul className="cal-evs">
                          {events.slice(0, SHOWN).map((e, i) => <li key={i}>{p.event(e)}</li>)}
                          {more > 0 && (
                            <li><button type="button" className="cal-more" tabIndex={-1} onClick={() => p.onOpenDay(d.date)}>+{more} more</button></li>
                          )}
                        </ul>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cal-agenda">
        {agenda.length === 0
          ? <NoteBlock title={p.empty?.title ?? `Nothing in ${title}.`} line={p.empty?.line} />
          : agenda.map(date => {
              const heading = dayHeading(date, p.today)
              const events = byDay.get(date)!
              return (
                <div key={date} className="agenda-sec">
                  <h4 className={date === p.today ? 'agenda-day agenda-today' : 'agenda-day'}>{heading}</h4>
                  {p.row
                    ? <DataList label={heading}>{events.map(e => p.row!(e))}</DataList>
                    : <ul className="cal-evs" aria-label={heading}>{events.map((e, i) => <li key={i}>{p.event(e)}</li>)}</ul>}
                </div>
              )
            })}
      </div>
    </div>
  )
}
