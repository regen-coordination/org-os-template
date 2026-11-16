// A page's editing session, from the browser (DAO-OS L6 spec §6, §16; rulings log "Task 8 → Task 16"). Opening the page
// to edit opens a session; the editor's whole Markdown is sent DRAFT_DEBOUNCE_MS after the last change; the server's
// answer is the save state — "Saved · direct", or "Staged · needs approval" where the tree was raised. A save the server
// does not acknowledge stays in this tab's sessionStorage and is sent again ("Offline · kept on this device"); a newer
// version is "Someone saved a newer version" with Compare (Keep mine, Take theirs); a save the server refuses in words is
// "Not saved" with its sentence (ruling R-16a): the text stays pending in the editor and is not sent again until it is
// edited. Leaving the page ends the session.
//
// One request at a time: a change made while one is in flight waits for it, then the latest text goes. A save answered
// `{ session }` landed in the session that followed (PAGE_MAX_MS), which every later request uses. A session the server no
// longer holds (404 NO_SESSION: it restarted) is opened again and the text sent to it. A draft this tab kept (a reload
// before the answer) is sent again when the page is still the version it was written on; on a newer version it is
// Compare, here, with what the draft started from as the base. A draft the server refused is never sent again on its
// own: it is offered ("Put it back?"). An open that fails leaves the page readable, with the reason and a Retry.
//
// Suggest (DAO-OS L6 Task 16b, R-L6-SUGGEST): the editor's text goes once more, with the proposal's title and rationale,
// to POST /api/sessions/:sid/suggest, after the save in flight has answered and with none sent beside it. Answered, the
// session is over on the server (its edit is the proposal now): a new one opens on the page as the repository holds it.
// Task 16c (R-L6-SUGGEST-2) fix round 2, review I4: on a page saved directly, the server commits a session's draft
// PAGE_IDLE_MS after its last save, so while the Suggest form is open the session is held (`hold`): its last text goes
// again every SUGGEST_HOLD_MS, quietly, and the edit being suggested is never committed while its title is written.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Compare, type PageNode, type ProposalWrite } from '../api.ts'
import type { Save } from '../elements/workspace/SaveState.tsx'
import { announce } from '../parts/live.tsx'

/** The client mirrors the server's (server/workspace/sessions.ts): the whole Markdown goes after this long without typing. */
export const DRAFT_DEBOUNCE_MS = 800
/** How long an unacknowledged save waits before it is sent again (and at once when the browser is back online). */
export const RETRY_MS = 5000
/** While the Suggest form is open on a page saved directly, the session's last text goes again this often: a third of the
 *  server's PAGE_IDLE_MS (60000, server/workspace/sessions.ts), so its idle end never comes (Task 16c review I4). */
export const SUGGEST_HOLD_MS = 20000
/** Said when the member leaves a page whose last text the server refused (R-16a). */
export const LEFT_UNSAVED = 'This page has changes that were not saved.'

/** What this tab keeps of an unacknowledged save: the session's version, the text it started from, the draft, and the
 *  server's sentence when it refused it. Keyed by page and version (one kept per page). */
export interface Kept { base: string; was: string; markdown: string; title?: string; refused?: string }
const PREFIX = 'org-os-admin.page-draft.'
const keyOf = (page: string, base: string) => `${PREFIX}${page}@${base}`
const keysOf = (page: string): string[] => {
  const out: string[] = []
  try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k?.startsWith(`${PREFIX}${page}@`)) out.push(k) } } catch { /* refused */ }
  return out
}

export function keptDraft(page: string): Kept | null {
  for (const key of keysOf(page)) {
    try {
      const v: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
      if (typeof v !== 'object' || v === null) continue
      const k = v as Record<string, unknown>
      if (typeof k.base !== 'string' || typeof k.was !== 'string' || typeof k.markdown !== 'string') continue
      return { base: k.base, was: k.was, markdown: k.markdown, ...(typeof k.title === 'string' ? { title: k.title } : {}),
        ...(typeof k.refused === 'string' ? { refused: k.refused } : {}) }
    } catch { /* unreadable: skipped */ }
  }
  return null
}
function forget(page: string): void {
  for (const key of keysOf(page)) try { sessionStorage.removeItem(key) } catch { /* refused */ }
}
function keep(page: string, k: Kept): void {
  forget(page)
  try { sessionStorage.setItem(keyOf(page, k.base), JSON.stringify(k)) } catch { /* storage refused: the server's answer is all there is */ }
}

const isNetwork = (err: unknown) => !(err instanceof ApiError)
const sentenceOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export interface PageSession {
  /** The save state (§10.1; "Not saved" is R-16a's). */
  state: Save
  /** The body the editor starts from; null until the session is open. */
  markdown: string | null
  /** Bumped whenever the editor must start again from `markdown` (a resolve, a draft this tab kept). */
  version: number
  /** The editor's whole Markdown (and its title, when the member changed it): sent after DRAFT_DEBOUNCE_MS. */
  save(markdown: string, title?: string): void
  /** Compare's three texts once a newer version was met; null before. */
  compare: Compare | null
  /** Reads Compare from the session (the 409 already carries it; this reads it again). */
  openCompare(): Promise<void>
  /** Keep mine commits the draft over theirs; Take theirs drops it. Either starts a new session on the result. */
  keep(k: 'mine' | 'theirs'): Promise<void>
  /** A sentence the server said: a refused save (with "Not saved"), the store's, a resolve's GONE; null for none. */
  error: string | null
  /** The session could not be opened: why, in words. The page is then read-only until `retry` opens one. */
  openError: string | null
  retry(): void
  /** A draft the server refused, kept from last time and not sent again: offered to be put back or discarded. */
  offer: Kept | null
  putBack(): void
  discard(): void
  /** R-L6-SUGGEST: the editor's whole text (and its title, when changed) proposed as the page's edit; answers the proposal,
   *  or throws the server's refusal (a newer version is Compare, as a save meets it). */
  suggest(markdown: string, title: string | undefined, proposal: { title: string; rationale?: string }): Promise<ProposalWrite>
  /** R-L6-SUGGEST-2 (Task 16c review I4): `true` holds the session open (its last text sent again every SUGGEST_HOLD_MS,
   *  without moving the save state) until `false`; for a page saved directly while the Suggest form is open. */
  hold(on: boolean): void
  /** DAO-OS L6 Task 20: the session ended now — its last text saved, then closed (a git page's one commit) — before a
   *  change to the page's level takes it out of the repository or moves it in, so nothing typed is left in a session on a
   *  file that is gone; `retry` opens the next. Throws, the session kept, when its text was refused (LEFT_UNSAVED) or its
   *  end met a newer version (Compare, as a save meets it). Nothing to end: it resolves at once. */
  end(): Promise<void>
  /** DAO-OS L6 Task 20 review I3: whether the session holds text it has not committed (typed since it opened, saved to its
   *  draft or not yet sent): what `end` would commit first. False with no session. */
  uncommitted(): boolean
  /** Task 20 review M5: `end` is running or has ended the session (its last text saved, the session closed), until the
   *  next session opens: the editor holds still, so no keystroke lands after the text `end` sent. */
  ending: boolean
}

interface Machine {
  sid: string | null
  base: string
  was: string
  pending: { markdown: string; title?: string } | null
  inflight: boolean
  timer: ReturnType<typeof setTimeout> | null
  retry: ReturnType<typeof setTimeout> | null
  /** Compare came from a draft this tab kept, not from the server: resolved here. */
  local: boolean
  /** The server refused the pending text in these words: it waits for an edit (R-16a). */
  refused: string | null
  over: boolean
  /** The save in flight, answered (R-L6-SUGGEST waits for it); `suggesting`: no save is sent while a Suggest is. */
  flight: Promise<void> | null
  suggesting: boolean
  /** The last text the server acknowledged: what `hold` sends again (Task 16c review I4). */
  last: { markdown: string; title?: string } | null
}
const fresh = (): Machine => ({ sid: null, base: '', was: '', pending: null, inflight: false, timer: null, retry: null, local: false, refused: null, over: false,
  flight: null, suggesting: false, last: null })

/** The session of `page` while `enabled` (a member who may write it, not previewing). `idle` is the state before any
 *  save: "Saved · direct", or "Staged · needs approval" when the member's change already holds this page. */
export function useSession(page: string, enabled: boolean, idle: Save = 'direct'): PageSession {
  const qc = useQueryClient()
  const [state, setState] = useState<Save>(idle)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [compare, setCompare] = useState<Compare | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [offer, setOffer] = useState<Kept | null>(null)
  const [attempt, setAttempt] = useState(0)
  // M5: from `end` until the next session opens (or `end` is refused), the editor holds still.
  const [ending, setEnding] = useState(false)
  const m = useRef<Machine>(fresh())
  const stateRef = useRef(state)
  stateRef.current = state
  // The resting states follow `idle` (R-L6-SUGGEST: "Edits need approval" is one of them).
  useEffect(() => { if (stateRef.current === 'direct' || stateRef.current === 'staged' || stateRef.current === 'approval') setState(idle) }, [idle])

  /** The pending text into this tab's storage (debounced with the save, and at leaving). */
  const persist = useCallback((mm: Machine) => {
    if (!mm.pending || mm.local) return
    keep(page, { base: mm.base, was: mm.was, ...mm.pending, ...(mm.refused ? { refused: mm.refused } : {}) })
  }, [page])

  const send = useCallback(async (mm: Machine): Promise<void> => {
    if (mm.over || mm.inflight || mm.local || mm.refused || mm.suggesting || !mm.pending || !mm.sid) return
    const body = mm.pending
    mm.pending = null
    mm.inflight = true
    let answered!: () => void
    mm.flight = new Promise<void>(r => { answered = r })
    if (mm.retry) { clearTimeout(mm.retry); mm.retry = null }
    setState(s => (s === 'conflict' ? s : 'saving'))
    try {
      const r = await api.saveSession(mm.sid, body)
      if (mm.over) return
      if (r.session) mm.sid = r.session
      mm.last = body
      if (!mm.pending) forget(page)
      setError(null)
      setCompare(null)
      setState(r.save === 'staged' ? 'staged' : 'direct')
      if (r.save === 'staged') void qc.invalidateQueries({ queryKey: ['changes'] })
      // A saved title names the page in the top bar's path and the tree (walk M3). The pages read is the trunk's, which
      // holds the old title until the session commits (the close reads the pages again), so the saved one is put in.
      if (body.title !== undefined) {
        const title = body.title
        qc.setQueryData<PageNode[]>(['pages'], old => (Array.isArray(old) ? old.map(n => (n.id === page ? { ...n, title } : n)) : old))
      }
    } catch (err) {
      if (mm.over) return
      const newer = mm.pending !== null
      mm.pending ??= body
      if (err instanceof ApiError && err.status === 409 && err.code === 'CONFLICT') {
        // The server kept the draft (Compare's "mine"); this tab keeps it too, until it is resolved.
        if (!newer) mm.pending = null
        setCompare((err.body.compare as Compare | undefined) ?? null)
        setState('conflict')
      } else if (err instanceof ApiError && err.code === 'NO_SESSION') {
        // The server no longer holds the session (it restarted, and committed it): open the next and send it the text.
        try {
          const o = await api.openSession(page)
          if (mm.over) { void api.closeSession(o.session).catch(() => {}); return }
          mm.sid = o.session
          mm.base = o.base
          mm.was = o.markdown
        } catch (again) {
          setError(sentenceOf(again))
          setState('offline')
          mm.retry = setTimeout(() => { mm.retry = null; void send(mm) }, RETRY_MS)
        }
      } else if (isNetwork(err) || (err instanceof ApiError && err.status >= 500)) {
        if (err instanceof ApiError) setError(err.message)
        setState('offline')
        persist(mm)
        mm.retry = setTimeout(() => { mm.retry = null; void send(mm) }, RETRY_MS)
      } else {
        // R-16a: refused in words (UNREADABLE_FRONT, a size, a link, a rule). Nothing was written: "Not saved", the
        // sentence beside it; the text stays pending, and is not sent again until it is edited (a newer edit still goes).
        if (!newer) mm.refused = sentenceOf(err)
        setError(sentenceOf(err))
        setState('refused')
        persist(mm)
      }
    } finally {
      mm.inflight = false
      mm.flight = null
      answered()
      if (!mm.over && mm.pending && !mm.retry && !mm.timer && !mm.refused) void send(mm)
    }
  }, [page, qc, persist])

  // Open on arrival (and on Retry), end on leaving. A session that answers after the page was left is ended at once.
  useEffect(() => {
    if (!enabled) return
    const mm = fresh()
    m.current = mm
    setEnding(false)
    setCompare(null)
    setError(null)
    setOpenError(null)
    setOffer(null)
    setMarkdown(null)
    setState(idle)
    void (async () => {
      try {
        const o = await api.openSession(page)
        if (mm.over) { void api.closeSession(o.session).catch(() => {}); return }
        mm.sid = o.session
        mm.base = o.base
        mm.was = o.markdown
        const kept = keptDraft(page)
        setMarkdown(o.markdown)
        if (kept && kept.markdown === o.markdown) forget(page)
        else if (kept?.refused) setOffer(kept) // refused last time: offered, never sent on its own (R-16a)
        else if (kept && kept.base === o.base) {
          // The page is the version the draft was written on: the draft goes on from here.
          setMarkdown(kept.markdown)
          mm.pending = { markdown: kept.markdown, ...(kept.title !== undefined ? { title: kept.title } : {}) }
          void send(mm)
        } else if (kept) {
          mm.local = true
          setCompare({ base: kept.was, theirs: o.markdown, mine: kept.markdown })
          setState('conflict')
        }
        setVersion(v => v + 1)
      } catch (err) {
        if (mm.over) return
        setOpenError(sentenceOf(err))
      }
    })()
    const online = () => { if (mm.pending) void send(mm) }
    // The tab going away: the last text goes (the session then ends on the server's idle timer), else the session ends.
    // `keepalive` only here: an SPA route change sends without it (keepalive bodies are capped at 64 KiB).
    const hide = () => {
      if (!mm.sid || mm.local) return
      persist(mm)
      if (mm.pending && !mm.refused) void api.saveSession(mm.sid, mm.pending, true).catch(() => {})
      else void api.closeSession(mm.sid, true).catch(() => {})
    }
    const unload = (e: BeforeUnloadEvent) => { if (mm.refused && mm.pending) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('online', online)
    window.addEventListener('pagehide', hide)
    window.addEventListener('beforeunload', unload)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('beforeunload', unload)
      mm.over = true
      if (mm.timer) clearTimeout(mm.timer)
      if (mm.retry) clearTimeout(mm.retry)
      const sid = mm.sid
      if (!sid || mm.local) return
      // R-16a: text the server refused is kept on this device and offered next time; leaving says so.
      if (mm.refused && mm.pending) { persist(mm); announce(LEFT_UNSAVED) }
      const last = mm.refused ? null : mm.pending
      // Leaving the page (§6): the last text is saved, then the session ends and becomes one commit.
      void (async () => {
        try {
          if (last) { persist(mm); await api.saveSession(sid, last); forget(page) }
          await api.closeSession(sid)
          void qc.invalidateQueries({ queryKey: ['pages'] })
          void qc.invalidateQueries({ queryKey: ['page', page] })
        } catch (err) {
          // A newer version met at the end: the draft is kept on this device, for Compare when the page is opened again.
          if (err instanceof ApiError && err.code === 'CONFLICT') {
            const c = (err.body.conflict ?? err.body.compare) as Compare | undefined
            if (c) keep(page, { base: mm.base, was: c.base, markdown: c.mine })
          }
        }
      })()
    }
  }, [page, enabled, attempt])

  const save = useCallback((md: string, title?: string) => {
    const mm = m.current
    if (mm.over) return
    mm.pending = { markdown: md, ...(title !== undefined ? { title } : {}) }
    mm.refused = null // an edit: worth sending again
    if (mm.timer) clearTimeout(mm.timer)
    mm.timer = setTimeout(() => { mm.timer = null; persist(mm); void send(mm) }, DRAFT_DEBOUNCE_MS)
  }, [send, persist])

  const openCompare = useCallback(async () => {
    const mm = m.current
    if (mm.local || !mm.sid) return
    try { setCompare(await api.compareSession(mm.sid)) } catch (err) { setError(sentenceOf(err)) }
  }, [])

  const resolve = useCallback(async (k: 'mine' | 'theirs') => {
    const mm = m.current
    if (mm.local) {
      const c = compare
      mm.local = false
      setCompare(null)
      if (k === 'theirs' || !c) { forget(page); setState(idle); return }
      setMarkdown(c.mine)
      setVersion(v => v + 1)
      mm.pending = { markdown: c.mine }
      void send(mm)
      return
    }
    if (!mm.sid) return
    if (mm.timer) { clearTimeout(mm.timer); mm.timer = null }
    try {
      // The text typed since the last answer is the draft Keep mine writes; Take theirs drops it with the rest.
      if (k === 'mine' && mm.pending) {
        const last = mm.pending
        mm.pending = null
        try { await api.saveSession(mm.sid, last) } catch (err) { if (!(err instanceof ApiError && err.code === 'CONFLICT')) throw err }
      }
      mm.pending = null
      const r = await api.resolveSession(mm.sid, k)
      forget(page)
      const o = await api.openSession(page)
      if (mm.over) { void api.closeSession(o.session).catch(() => {}); return }
      mm.sid = o.session
      mm.base = o.base
      mm.was = o.markdown
      setCompare(null)
      setError(null)
      setMarkdown(o.markdown)
      setVersion(v => v + 1)
      setState(r.staged ? 'staged' : 'direct')
      void qc.invalidateQueries({ queryKey: ['page', page] })
      void qc.invalidateQueries({ queryKey: ['pages'] })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') { setCompare((err.body.compare as Compare | undefined) ?? null); setState('conflict'); return }
      setError(sentenceOf(err))
    }
  }, [page, compare, idle, qc, send])

  const retry = useCallback(() => setAttempt(a => a + 1), [])

  const putBack = useCallback(() => {
    const mm = m.current
    const k = offer
    setOffer(null)
    if (!k) return
    forget(page)
    if (k.base !== mm.base) {
      // Written on an older version: Compare, as any draft this tab kept on a newer one.
      mm.local = true
      setCompare({ base: k.was, theirs: mm.was, mine: k.markdown })
      setState('conflict')
      return
    }
    setMarkdown(k.markdown)
    setVersion(v => v + 1)
    mm.pending = { markdown: k.markdown, ...(k.title !== undefined ? { title: k.title } : {}) }
    void send(mm)
  }, [offer, page, send])

  const discard = useCallback(() => { forget(page); setOffer(null) }, [page])

  // Task 16c review I4: the session held while the Suggest form is open on a page saved directly. Each beat reads the
  // session as it is then (a Retry opens a new one); text not yet sent goes as a save would, else the last acknowledged
  // text goes again, quietly: an answer moves nothing but the session's id, and a refusal is left for Suggest to meet.
  const holding = useRef<ReturnType<typeof setInterval> | null>(null)
  const hold = useCallback((on: boolean) => {
    if (holding.current) { clearInterval(holding.current); holding.current = null }
    if (!on) return
    holding.current = setInterval(() => {
      const mm = m.current
      if (mm.over || mm.suggesting || mm.local || mm.inflight || !mm.sid) return
      if (mm.pending) { if (!mm.timer && !mm.retry && !mm.refused) void send(mm); return }
      if (!mm.last) return
      void api.saveSession(mm.sid, mm.last).then(r => { if (!mm.over && r.session) mm.sid = r.session }).catch(() => {})
    }, SUGGEST_HOLD_MS)
  }, [send])
  useEffect(() => () => { if (holding.current) clearInterval(holding.current) }, [])

  const suggest = useCallback(async (md: string, title: string | undefined, proposal: { title: string; rationale?: string }): Promise<ProposalWrite> => {
    const mm = m.current
    if (mm.over || !mm.sid) throw new Error('This page is not open for writing yet.')
    mm.suggesting = true
    if (mm.timer) { clearTimeout(mm.timer); mm.timer = null }
    if (mm.retry) { clearTimeout(mm.retry); mm.retry = null }
    try {
      while (mm.flight) await mm.flight
      const made = await api.suggestSession(mm.sid, { markdown: md, ...(title !== undefined ? { title } : {}), proposal })
      // The edit is the proposal now: nothing of it is kept here, the ended session is not closed again, and a new session
      // opens on the page as it is.
      mm.pending = null
      mm.sid = null
      forget(page)
      for (const queryKey of [['changes'], ['proposals'], ['page', page], ['pages']]) void qc.invalidateQueries({ queryKey })
      setError(null)
      setAttempt(a => a + 1)
      return made
    } catch (err) {
      mm.suggesting = false
      if (err instanceof ApiError && err.status === 409 && err.code === 'CONFLICT') {
        setCompare((err.body.compare as Compare | undefined) ?? null)
        setState('conflict')
      } else {
        // Not proposed: the text goes on as a save would (staged again where it already was: the same op).
        mm.pending ??= { markdown: md, ...(title !== undefined ? { title } : {}) }
        void send(mm)
      }
      throw err
    }
  }, [page, qc, send])

  const end = useCallback(async (): Promise<void> => {
    const mm = m.current
    if (mm.over || mm.local || !mm.sid) return
    if (mm.refused && mm.pending) throw new Error(LEFT_UNSAVED)
    mm.suggesting = true // no save goes while it ends
    setEnding(true)
    if (mm.timer) { clearTimeout(mm.timer); mm.timer = null }
    if (mm.retry) { clearTimeout(mm.retry); mm.retry = null }
    try {
      while (mm.flight) await mm.flight
      if (mm.pending) {
        const last = mm.pending
        const r = await api.saveSession(mm.sid, last)
        if (r.session) mm.sid = r.session
        mm.pending = null
      }
      await api.closeSession(mm.sid)
      mm.sid = null
      mm.over = true
      forget(page)
      void qc.invalidateQueries({ queryKey: ['pages'] })
      void qc.invalidateQueries({ queryKey: ['page', page] })
    } catch (err) {
      mm.suggesting = false
      if (err instanceof ApiError && err.status === 409 && err.code === 'CONFLICT') {
        setCompare(((err.body.conflict ?? err.body.compare) as Compare | undefined) ?? null)
        setState('conflict')
      }
      setEnding(false)
      throw err
    }
  }, [page, qc])

  const uncommitted = useCallback((): boolean => {
    const mm = m.current
    if (mm.over || !mm.sid) return false
    const latest = mm.pending ?? mm.last
    return latest !== null && (latest.markdown !== mm.was || latest.title !== undefined)
  }, [])

  return { state, markdown, version, save, compare, openCompare, keep: resolve, error, openError, retry, offer, putBack, discard, suggest, hold, end, uncommitted, ending }
}
