/** The calendar view's arithmetic (§10.2, C-18): a month as weeks that start on Monday, and the dates around it. Dates
 *  are `YYYY-MM-DD` strings read on the UTC day, as the house pins every date (en-US, UTC); months are 1–12. */

export interface Day { date: string; inMonth: boolean; today: boolean }

const DAY = 86_400_000
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** The column heads, Monday first. */
export const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const at = (date: string) => Date.parse(`${date}T00:00:00Z`)

/** The month a date falls in. */
export function monthOf(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) }
}

export function addDays(date: string, n: number): string {
  return iso(at(date) + n * DAY)
}

/** The same day `n` months on; the month's last day where that month is shorter. */
export function addMonths(date: string, n: number): string {
  const { year, month } = monthOf(date)
  const first = new Date(Date.UTC(year, month - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return iso(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(Number(date.slice(8, 10)), last)))
}

/** "October 2026". */
export function monthTitle(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

/** A day's heading in the agenda: "Thu 29 Oct", and "Today · Thu 29 Oct" on today. */
export function dayHeading(date: string, today: string): string {
  const d = new Date(at(date))
  const words = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`
  return date === today ? `Today · ${words}` : words
}

/** A day as a screen reader hears it in the grid: "Saturday 17 October 2026". */
export function dayName(date: string): string {
  const d = new Date(at(date))
  const long = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]
  return `${long} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** The month's weeks, Monday first: the days of the months before and after that fill its first and last weeks are
 *  drawn outside the month, and it has only the rows it needs (four to six). */
export function monthGrid(year: number, month: number, today: string): Day[][] {
  const first = Date.UTC(year, month - 1, 1)
  const lead = (new Date(first).getUTCDay() + 6) % 7 // days from Monday to the 1st
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const weeks: Day[][] = []
  for (let w = 0; w < Math.ceil((lead + length) / 7); w++) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const date = iso(first + (w * 7 + i - lead) * DAY)
      return { date, inMonth: monthOf(date).month === month, today: date === today }
    }))
  }
  return weeks
}
