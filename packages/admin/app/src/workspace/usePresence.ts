// Presence on a page or a record (DAO-OS L6 Task 18, spec §8.4): while it is open and shown the Hub beats `POST /api/presence`
// every PRESENCE_BEAT_MS, saying whether this tab is editing, and stops while the tab is hidden and when it is left (the server lets the entry lapse
// after PRESENCE_TTL_MS). Who else has it open is what the server answers — the beat's `people`, or
// `GET /api/presence?targets=` when a `presence` event for this target makes it stale (events.ts); the server never
// counts the asker, and an event for another target touches nothing here (rule 7: only what the server sent is shown).
import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Present } from '../api.ts'

/** How often an open page says it is still open (spec §8.4; server/workspace/presence.ts). */
export const PRESENCE_BEAT_MS = 20000

/** Who else has `target` open. `beat`: this tab is a known member's, so it says it is here; `editing`: in an editing
 *  session. `read`: the people are read at all (not for the public, who are never shown presence). */
export function usePresence(target: string, opts: { beat: boolean; editing: boolean; read?: boolean }): Present[] {
  const qc = useQueryClient()
  const read = opts.read ?? opts.beat
  const key = ['presence', target]
  const q = useQuery({ queryKey: key, queryFn: () => api.presence([target]), enabled: read, retry: false })
  const editing = useRef(opts.editing)
  editing.current = opts.editing
  /** What the last beat said (null: none yet), and how to beat now (while the page is open). */
  const said = useRef<boolean | null>(null)
  const beatNow = useRef<() => void>(() => {})

  useEffect(() => {
    if (!opts.beat) return
    let left = false
    const beat = () => {
      said.current = editing.current
      api.beat(target, editing.current)
        .then(r => { if (!left) qc.setQueryData(key, { [target]: r.people }) })
        .catch(() => { /* presence is a courtesy: a refused beat changes nothing on the page */ })
    }
    // Fix round 1: a hidden tab stops saying it is here (the server lets it lapse); shown again, it beats at once.
    let t: ReturnType<typeof setInterval> | null = null
    const start = () => { if (t !== null) return; beat(); t = setInterval(beat, PRESENCE_BEAT_MS) }
    const stop = () => { if (t !== null) { clearInterval(t); t = null } }
    const onVisibility = () => { if (document.hidden) stop(); else start() }
    beatNow.current = () => { if (t !== null) beat() }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { left = true; stop(); document.removeEventListener('visibilitychange', onVisibility); beatNow.current = () => {}; said.current = null }
  }, [target, opts.beat])

  // Starting or ending an editing session is said at once, not at the next beat.
  useEffect(() => { if (said.current !== null && said.current !== opts.editing) beatNow.current() }, [opts.editing])

  return q.data?.[target] ?? []
}
