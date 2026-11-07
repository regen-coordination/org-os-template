import type { Attention } from './types.ts'

const DAY = 86_400_000
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Whole calendar days from today (in the server's time zone) to a date written YYYY-MM-DD
 *  (anything after the date is ignored) or given as a Date; null when it cannot be read. */
export function daysUntil(date: unknown, now: Date): number | null {
  let y: number, m: number, d: number
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    y = date.getUTCFullYear(); m = date.getUTCMonth(); d = date.getUTCDate()
  } else if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    y = Number(date.slice(0, 4)); m = Number(date.slice(5, 7)) - 1; d = Number(date.slice(8, 10))
  } else return null
  const target = Date.UTC(y, m, d)
  if (Number.isNaN(target)) return null
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / DAY)
}

/** Statuses after which a deadline no longer asks anything of the operator. */
export const TERMINAL_FUNDING = new Set(['awarded', 'won', 'rejected', 'declined', 'lost', 'withdrawn', 'closed', 'archived', 'submitted', 'applied'])

export function fundingAttention(deadline: unknown, status: unknown, now: Date): Attention | null {
  if (typeof status === 'string' && TERMINAL_FUNDING.has(status.toLowerCase())) return null
  const days = daysUntil(deadline, now)
  if (days === null || days > 14) return null
  if (days < 0) return { level: 'alert', text: `deadline passed ${plural(-days, 'day')} ago` }
  if (days === 0) return { level: 'alert', text: 'deadline today' }
  return { level: days <= 3 ? 'alert' : 'warn', text: `deadline in ${plural(days, 'day')}` }
}

export function moduleAttention(failing: string[]): Attention | null {
  if (failing.length === 0) return null
  const more = failing.length > 1 ? ` (+${failing.length - 1} more)` : ''
  return { level: 'alert', text: `check fails: ${failing[0]}${more}` }
}

export interface SeatSignal { state: string | null; status: string; prompted?: unknown }

/** `state` is herdr's (idle, working, done, blocked), or null when no live agent holds the seat.
 *  A null state with status `reported` is a seat whose agent ended normally after reporting:
 *  that asks for a release, not an alarm. Any other null state means the agent vanished mid-seat. */
export function seatAttention(s: SeatSignal): Attention | null {
  if (s.state === null && s.status === 'reported') return { level: 'warn', text: 'reported; its agent has ended — release it' }
  if (s.state === null && s.status === 'failed') return { level: 'alert', text: 'seating failed — release it' }
  if (s.state === null) return { level: 'alert', text: 'agent gone while seated' }
  if (s.state === 'blocked') return { level: 'warn', text: 'waiting at a dialog' }
  if (s.prompted === false && s.state !== 'working' && s.state !== 'done') return { level: 'warn', text: 'first prompt not sent' }
  // Crew sends the first prompt and cannot always confirm it landed; its own board says so too.
  if (s.prompted === 'unconfirmed' && s.state !== 'working' && s.state !== 'done') return { level: 'warn', text: 'first prompt may not have arrived — look at its pane' }
  if (s.prompted === 'stalled') return { level: 'warn', text: 'first prompt not started' }
  if (s.status === 'reported') return { level: 'warn', text: 'a report waits for you' }
  return null
}

export function instanceAttention(drift: unknown, lastSync: unknown, now: Date): Attention | null {
  if (Array.isArray(drift) && drift.length > 0) return { level: 'warn', text: plural(drift.length, 'drift item') }
  const days = daysUntil(lastSync, now)
  if (days !== null && -days > 30) return { level: 'warn', text: `last synced ${plural(-days, 'day')} ago` }
  return null
}

export function connectorAttention(lastOk: string | null, now: Date): Attention | null {
  if (!lastOk) return null
  const days = Math.floor((now.getTime() - new Date(lastOk).getTime()) / DAY)
  return days > 14 ? { level: 'warn', text: `last ingest ${plural(days, 'day')} ago` } : null
}
