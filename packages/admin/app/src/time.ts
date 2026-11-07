import { useEffect, useState } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NBSP = '\u00a0'

/** An age as the house says it (C-28, spec §7.9): "just now" under a minute, "4 min ago" and "2 h ago" under
 *  24 hours (a no-break space before the unit), then the local date, "28 Oct", with its year only when that is
 *  not this one ("28 Oct 2025"). "" for a date that cannot be read; a moment ahead of `now` is "just now". */
export function ageText(iso: string, now: Date): string {
  const d = new Date(iso)
  const t = d.getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.floor((now.getTime() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}${NBSP}min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}${NBSP}h ago`
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return d.getFullYear() === now.getFullYear() ? date : `${date} ${d.getFullYear()}`
}

/** 0.6's name for an age, kept for its callers (ruling L4-R4): the same words as `ageText`. */
export function ago(iso: string, now = new Date()): string {
  return ageText(iso, now)
}

export const seconds = (iso: string, now = new Date()): number =>
  Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000))

/** The current time, renewed every second while `active`. A running job's "running N s" is
 *  computed from it, so it needs to move without anything else changing. */
export function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!active) return
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "22:14": an instant in local wall-clock time; "" for one that cannot be read. */
export function clock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "2026-10-16 22:14", in local time; "" for one that cannot be read. */
export function stamp(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(iso)}`
}
