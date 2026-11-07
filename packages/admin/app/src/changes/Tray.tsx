import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'wouter'
import { api, type ChangeView, type StageError } from '../api.ts'
import { useActor } from '../actor.ts'
import { useChanges } from './useChanges.ts'
import { applyOutcome, fmt, opSummary, recordName, ruleWords, stagedWords, staleWords, trayRows, trunkNow, type ApplyOutcome, type TrayAction } from './rows.ts'
import { TrayOp } from './TrayOp.tsx'
import { Button } from '../design/Button.tsx'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { Empty } from '../design/Empty.tsx'
import { Scroll } from '../design/Scroll.tsx'
import { Spinner } from '../design/Spinner.tsx'
import { useFrame } from '../design/Shell.tsx'
import { countText } from '../frame/sections.ts'
import { OPEN_CHANGES } from '../keys/useHouseKeys.ts'
import { useMachine } from '../machines.ts'
import { tray } from '../machines/tray.ts'
import { announce } from '../parts/live.tsx'
import { closeDialog, usePanel, useSlot } from '../parts/panels.tsx'
import { Refusal } from '../parts/SyncParts.tsx'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { Skeleton } from '../design/Skeleton.tsx'

const NOTHING_TO_COMMIT = 'Nothing to commit: the files already hold these values.'
/** What the bar says while the tray machine is busy, by the action it runs (§5.6 "Applying…"). */
const DOING: Record<TrayAction | 'update', string> = {
  apply: 'Applying…', update: 'Updating the proposal…', discard: 'Discarding…', unstage: 'Removing…', rebase: 'Resolving…',
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The collapsed tray (§5.6): the moss count square (clay "!" when an op is stale, the reading ring while busy),
 *  "N staged changes" over a one-line `line` (the last op and its rule; the stale sentence; the rule while busy),
 *  then Review and the `primary`. Stale, Review is the only action and is primary; busy, there are none. On a
 *  phone it is the card: the count and "N staged" are a link to /changes (Review is a tap on the card), then the
 *  primary only; busy, the ring and the word alone. The bar takes focus (tabIndex -1) while a busy action has
 *  taken its buttons away, so a keyboard reader is not dropped to the page. */
export function TrayBar({ count, stale = 0, busy = null, line, primary = null, onReview, reviewRef, barRef, phone = false, staleId }: {
  count: number; stale?: number; busy?: string | null; line: ReactNode; primary?: ReactNode; onReview?(): void
  reviewRef?: Ref<HTMLButtonElement>; barRef?: Ref<HTMLDivElement>; phone?: boolean; staleId?: string
}) {
  const square = busy !== null
    ? <Spinner />
    : <span className={stale > 0 ? 'tray-cnt attn' : 'tray-cnt'} aria-hidden="true">{stale > 0 ? '!' : countText(count)}</span>
  const what = busy !== null
    ? <span className="tray-what"><b>{busy}</b>{!phone && <span className="tray-line">{line}</span>}</span>
    : phone
      ? <Link href="/changes" className="tray-what tray-go" aria-label={`Review ${stagedWords(count)}${stale > 0 ? `, ${staleWords(stale)}` : ''}`}><b>{count} staged</b></Link>
      : <span className="tray-what"><b>{stagedWords(count)}</b><span className="tray-line">{stale > 0 ? <span id={staleId}>{staleWords(stale)}</span> : line}</span></span>
  const acts = busy !== null ? null : stale > 0
    ? <Button primary ref={reviewRef} onClick={onReview}>Review</Button>
    : <>{!phone && <Button ref={reviewRef} onClick={onReview}>Review</Button>}{primary}</>
  return <div ref={barRef} className="tray-bar" tabIndex={-1}>{square}{what}{acts && <span className="tray-acts">{acts}</span>}</div>
}

/** The expanded tray (§5.6): the head ("Your change", "3 ops · 2 records", Discard all), `notice` (a refusal),
 *  the stale sentence, the ops as a list of blocks (TrayOp), the combined diff when Show diff is pressed, and the
 *  foot on --sunken: the rule's sentence, Show diff and the `primary`. A group named by its heading. */
export function TrayPanel({ view, primary, busy = false, notice = null, rowErrors = [], onRemove, onRebase, onDiscard, discardRef, headingRef, ruleId, staleId }: {
  view: ChangeView; primary: ReactNode; busy?: boolean; notice?: ReactNode; rowErrors?: StageError[]
  onRemove?(n: number): void; onRebase?(n: number, keep: 'mine' | 'theirs'): void; onDiscard?(): void
  discardRef?: Ref<HTMLButtonElement>; headingRef?: Ref<HTMLHeadingElement>; ruleId?: string; staleId?: string
}) {
  const headingId = useId()
  const [diff, setDiff] = useState(false)
  const records = new Set(view.ops.map(o => o.record)).size
  return (
    <div className="trayx" role="group" aria-labelledby={headingId}>
      <div className="trayx-h">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>Your change</h2>
        <span className="trayx-n">{plural(view.ops.length, 'op')} · {plural(records, 'record')}</span>
        <Button variant="ghost" small ref={discardRef} disabled={busy} onClick={onDiscard}>Discard all</Button>
      </div>
      {notice}
      {view.stale.length > 0 && <p className="trayx-why" id={staleId}>{staleWords(view.stale.length)}</p>}
      <div className="trayx-body">
        <ul className="trayx-ops" aria-label="Staged ops">
          {view.ops.map((op, n) => (
            <TrayOp key={`${n}:${op.record}`} op={op} record={recordName(op)} busy={busy}
              stale={view.stale.includes(n) ? { trunk: trunkNow(op, view.current[n] ?? null) } : undefined}
              errors={rowErrors.filter(e => e.record === op.record)}
              onRemove={() => onRemove?.(n)} onKeepMine={() => onRebase?.(n, 'mine')} onTakeTheirs={() => onRebase?.(n, 'theirs')} />
          ))}
        </ul>
        {diff && (
          <div className="trayx-diff">
            <Scroll label="Staged changes"><table className="rows" aria-label="Staged changes">
              <thead><tr><th scope="col">record</th><th scope="col">field</th><th scope="col">was</th><th scope="col">now</th></tr></thead>
              <tbody>
                {trayRows(view).map(row => (
                  <tr key={`${row.n}:${row.field}`}>
                    <td>{row.record}</td><td>{row.field}</td>
                    <td>{row.op !== 'create' && <s>{fmt(row.was)}</s>}</td><td>{row.op !== 'delete' && fmt(row.now)}</td>
                  </tr>
                ))}
              </tbody>
            </table></Scroll>
          </div>
        )}
      </div>
      <div className="trayx-foot">
        <span className="trayx-rule" id={ruleId}>{ruleWords(view.rule)}</span>
        <span className="trayx-end"><Button expanded={diff} onClick={() => setDiff(d => !d)}>Show diff</Button>{primary}</span>
      </div>
    </div>
  )
}

/** A refusal, kept with the change it is about (the query client's, not one tray's): the dock and /changes show
 *  the same one, so a phone that opens /changes after a refusal finds its marked rows there. */
interface Outcome { failure: Pick<ApplyOutcome, 'message' | 'lines'> | null; rowErrors: StageError[] }
const OUTCOME = ['tray-outcome'] as const
const NONE: Outcome = { failure: null, rowErrors: [] }
function useOutcome(): [Outcome, (o: Outcome) => void] {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: OUTCOME, queryFn: () => NONE, initialData: NONE, staleTime: Infinity, gcTime: Infinity })
  return [q.data, o => { qc.setQueryData(OUTCOME, o) }]
}

/** The Changes tray (spec §5.6, C-6), docked in the frame's `tray` area under the page, never over it. Hidden when
 *  nothing is staged, while previewing (write actions are not drawn, §5.9), and for an actor the server does not
 *  know (the read-only notice says why). Collapsed it is TrayBar; Review, `g c` (house:open-changes; the sidebar's
 *  Changes at ≥760) or a refusal that lands on an op opens TrayPanel upward over the page, at most 60% of the
 *  frame's height: a modal `<dialog>` over the scrim, so focus stays in it (§13), in the bottom panel slot, so Esc
 *  (or a press on the scrim) closes it and focus returns to Review, or to wherever `g c` was pressed — the slot's
 *  `shut` closes the dialog first (panels.tsx). Opening it closes the inspector, which its scrim would cover (one
 *  Escape stack); a route change closes it. On a phone the tray is a card above the bottom bar and expanding is the
 *  page `/changes`; `page` draws the tray as that page. Apply is one commit under the rule the server names; a
 *  failure keeps every op, and focus stays in the tray across the action. One action at a time: the tray machine.
 *  Discard all asks first, in the overlay slot. A count that moves is said politely. */
export default function Tray({ appliedMs = 4000, page = false }: { appliedMs?: number; page?: boolean }) {
  const { known, actor, error: actorError } = useActor()
  const canWrite = useCanWrite()
  const ch = useChanges()
  const phone = useFrame().mode === 'phone' && !page
  const [location, navigate] = useLocation()
  const uid = useId()
  const bottom = usePanel('bottom')
  const right = usePanel('right')
  const expanded = page || bottom.openId === 'tray'
  const open = useRef(expanded)
  open.current = expanded
  const section = useRef<HTMLElement>(null)
  const pop = useRef<HTMLDialogElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const reviewRef = useRef<HTMLButtonElement>(null)
  const barPrimary = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const discardRef = useRef<HTMLButtonElement>(null)
  const ask = useRef<HTMLDialogElement>(null)
  const askOpener = useRef<HTMLElement | null>(null)
  const [asking, setAsking] = useState(false)
  const [applied, setApplied] = useState<{ commit: string; text?: string } | null>(null)
  const [{ failure, rowErrors }, setOutcome] = useOutcome()
  const [doing, setDoing] = useState(DOING.apply)
  // One action at a time (apply, discard, unstage, rebase): the tray machine. Its send is
  // synchronous, so a second click or a ⌘K event in the same tick sends nothing (ruling 11).
  const t = useMachine(tray, { context: null })
  const busy = t.state === 'busy'
  const qc = useQueryClient()
  const view = ch.view
  const rows = view ? trayRows(view) : []
  const stale = view?.stale.length ?? 0
  const canApply = known && !!view && view.ops.length > 0 && view.rule.direct && stale === 0
  // Which primary action the change gets (spec 3.14): Update proposal when it revises one, Apply when this
  // actor may decide alone, Propose when a proposal may be opened, else Apply held with the rule's sentence.
  const revises = view?.revises
  const canPropose = known && !!view && view.ops.length > 0 && !view.rule.direct && view.rule.proposable === true
  const reread = () => void qc.invalidateQueries({ queryKey: ['changes'] })

  /** Opens the panel: on a phone the page /changes; here the bottom slot, handing focus back on close to `opener`
   *  (never the page's body or the bar: then Review). The inspector and block settings go first: the panel's scrim
   *  would cover them, and Esc would close the hidden one before the panel on top (§5.8). An opener inside one gives
   *  way to where its closing put focus. A Propose panel is never closed here: focus goes into it. */
  const expand = (opener: HTMLElement | null) => {
    if (page) { heading.current?.focus(); return }
    if (phone) { navigate('/changes'); return }
    if (open.current) { heading.current?.focus(); return }
    let back = opener && opener !== document.body && opener !== bar.current ? opener : null
    // A proposal being written stays: closing it would lose its typed title, rationale and statement without a word,
    // and the panel would be modal over it. Focus goes into it instead (L4a final review I-4).
    if (right.openId === 'propose') {
      const panel = document.querySelector<HTMLElement>('aside[aria-label="Propose"]')
      ;(panel?.querySelector<HTMLElement>('input, textarea, select') ?? panel?.querySelector<HTMLElement>('a[href], button'))?.focus()
      return
    }
    if (right.openId !== null) {
      const inside = back?.closest('aside') ?? null
      right.close()
      if (inside) { const at = document.activeElement; back = at instanceof HTMLElement && at !== document.body ? at : null }
    }
    bottom.open('tray', back ?? reviewRef.current, () => closeDialog(pop.current))
  }
  const collapse = () => { if (!page) bottom.close() }
  // The panel is modal: everything else is inert while it is open, and focus starts on its heading.
  useEffect(() => {
    if (!expanded || page) return
    const d = pop.current
    if (d && !d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '') }
    heading.current?.focus()
  }, [expanded, page])
  // A route change takes the panel with it: it belongs to the page it was opened over.
  const was = useRef(location)
  useEffect(() => {
    if (was.current === location) return
    was.current = location
    if (open.current && !page) bottom.close()
  }, [location])

  // An old refusal belongs to the change it was about: once that change is empty, forget it. (Only
  // then: a change event while an action is pending must not clear the outcome it is about to show.)
  const opCount = view?.ops.length ?? null
  const { can, send } = t // stable across renders (ruling 11): safe as effect dependencies, unlike `t` itself
  // The panel goes with the change, and with the tray itself (a preview, leaving for /changes): an open bottom slot
  // left behind would take the next Escape (M-1).
  const shown = known && canWrite && (opCount ?? 0) > 0
  useEffect(() => {
    if (opCount === 0) { if (failure || rowErrors.length > 0) setOutcome(NONE); if (can('CLEAR')) send('CLEAR') }
    if (!shown && open.current && !page) bottom.close()
  }, [opCount, shown, can, send])
  useEffect(() => () => { if (open.current && !page) bottom.close() }, [])
  // A count that moves is said once, politely (§5.6); the first read is not news.
  const said = useRef<number | null>(null)
  useEffect(() => {
    if (opCount === null) return
    const was = said.current
    said.current = opCount
    if (was !== null && was !== opCount && opCount > 0 && known && canWrite) announce(stagedWords(opCount))
  }, [opCount])
  // Focus across an action: busy takes the bar's buttons away, so focus that was in the tray waits on the bar (or
  // the panel's heading), then goes back to the primary — or Review, or the page once the change is gone.
  // A refusal that lands on an op opens the panel once the action is over and Review is drawn again (it is the
  // panel's opener; on a phone, /changes).
  const held = useRef(false)
  const reveal = useRef(false)
  useEffect(() => {
    const lost = () => { const a = document.activeElement; return !a || a === document.body || a === bar.current }
    if (busy) { if (held.current && lost()) (open.current ? heading.current : bar.current)?.focus(); return }
    if (reveal.current) { reveal.current = false; held.current = false; if (latest.current.has) latest.current.expand(null); return }
    if (!held.current) return
    held.current = false
    if (!lost()) return
    const target = open.current ? heading.current : barPrimary.current ?? reviewRef.current ?? document.getElementById('main')
    target?.focus()
  }, [busy])

  const act = async (action: TrayAction, fn: () => Promise<unknown>, done: 'DONE' | 'APPLIED' = 'DONE', word: string = DOING[action]) => {
    if (!t.send('ACT')) return
    held.current = !!section.current?.contains(document.activeElement)
    setDoing(word)
    setOutcome(NONE)
    try {
      await fn()
      t.send(done)
    } catch (err) {
      const o = applyOutcome(err, action, rows)
      setOutcome({ failure: { message: o.message, lines: o.lines }, rowErrors: o.rowErrors })
      // the marked rows are in the panel, or on a phone the page /changes (which reads the same outcome)
      if (o.rowErrors.length > 0) reveal.current = true
      t.send('FAIL')
      if (o.refresh) reread() // STALE, EMPTY, a 404 or 422 on unstage/rebase: the change as the server holds it
    } finally {
      t.send('FAIL') // only a machine still busy accepts it: whatever threw above, the tray never stays busy
    }
  }
  const apply = () => act('apply', async () => { const done = await ch.apply(); setApplied({ commit: done.commit.slice(0, 7) }); collapse() }, 'APPLIED')
  // Revise does not clear the change on the server (Propose does); the client does, as Apply's success does.
  const update = () => act('apply', async () => {
    if (!view || !revises) return
    await api.revise(revises, view.ops)
    await ch.discard()
    for (const queryKey of [['proposals'], ['resources'], ['graph'], ['generated']]) void qc.invalidateQueries({ queryKey })
    setApplied({ commit: '', text: `Proposal ${revises} updated.` })
    collapse()
  }, 'APPLIED', DOING.update)
  // Propose opens the proposal panel in the right slot; the open panel is modal over it, so the panel folds
  // first and the bar's Propose is where Esc in the proposal hands focus back.
  const propose = (from: HTMLElement) => {
    if (!page && open.current) { collapse(); right.open('propose', barPrimary.current ?? from) } else right.open('propose', from)
  }
  /** Discard all asks first (C-3): a confirmation in the overlay slot, naming what goes. */
  const discard = () => {
    if (!t.can('ACT')) return
    askOpener.current = discardRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setAsking(true)
  }
  // The slot shuts the dialog before it hands focus back to Discard all: while it is modal the panel is inert.
  useSlot('overlay', 'discard', asking, () => setAsking(false), () => askOpener.current, () => closeDialog(ask.current))
  /** × (§5.6): the op goes whole, stale or not — nothing is staged back over the trunk's value (C20). */
  const remove = (n: number) => act('unstage', () => ch.unstage(n))
  const rebase = (n: number, keep: 'mine' | 'theirs') => act('rebase', () => ch.rebase(n, keep))

  // ⌘K's Apply changes / Discard changes and `g c` land here, so their outcome shows in one place.
  const latest = useRef({ apply, discard, expand, canApply, has: false, live: false, page })
  latest.current = { apply, discard, expand, canApply, has: (opCount ?? 0) > 0, live: known && canWrite, page }
  useEffect(() => {
    const onApply = () => { if (latest.current.live && latest.current.canApply) void latest.current.apply() }
    const onDiscard = () => { if (latest.current.live && latest.current.has) latest.current.discard() }
    const onOpen = () => {
      const l = latest.current
      if (!l.live) return
      if (!l.has) { if (!l.page) navigate('/changes'); return }
      const at = document.activeElement
      l.expand(at instanceof HTMLElement ? at : null)
    }
    window.addEventListener('apply-changes', onApply)
    window.addEventListener('discard-changes', onDiscard)
    window.addEventListener(OPEN_CHANGES, onOpen)
    return () => {
      window.removeEventListener('apply-changes', onApply)
      window.removeEventListener('discard-changes', onDiscard)
      window.removeEventListener(OPEN_CHANGES, onOpen)
    }
  }, [])
  useEffect(() => {
    if (t.state !== 'applied') return
    const timer = setTimeout(() => { setApplied(null); send('TIMEOUT') }, appliedMs)
    return () => clearTimeout(timer)
  }, [t.state, send, appliedMs])

  // the page says nothing is staged only once it knows (walk 2026-11-04): while who you are, then your change, is read,
  // it is a skeleton of the change's rows
  const reading = <Skeleton rows={3} shape="row" label="Changes" />
  if (page && canWrite && actor === null && actorError === null) return reading
  // a failed read of who you are is said as that, never as "nothing is staged" (review minor 7)
  if (!known || !canWrite) return page ? <Empty>{!canWrite ? 'Your staged changes are not shown while previewing.'
    : actorError !== null ? 'Who you are couldn’t be read, so your staged changes are not shown.' : 'Nothing is staged.'}</Empty> : null
  if (t.state === 'applied' && applied) {
    // { commit: '' }: the staged values were already in the files; the server cleared the change (ruling C3).
    return (
      <section className={page ? 'tray tray-page' : 'tray'} aria-label="Changes">
        <div className="tray-bar" role="status">
          {applied.text
            ? <span className="tray-what">{applied.text}</span>
            : applied.commit
              ? <span className="tray-what"><b>Applied</b><span className="tray-line">commit {applied.commit}</span></span>
              : <span className="tray-what">{NOTHING_TO_COMMIT}</span>}
        </div>
      </section>
    )
  }
  if (!view) {
    if (!ch.error) return page ? reading : null
    // The tray's own read failed: a page-level sentence with no action, said once through the page's polite region
    // (E-58), not a bare paragraph beside the tray's two live regions (C11's sweep; fix wave B3).
    return <section className="tray" aria-label="Changes"><Refusal>{`Could not read your staged changes: ${ch.error}`}</Refusal></section>
  }
  if (view.ops.length === 0) return page ? <Empty>Nothing is staged.</Empty> : null

  const ids = { rule: `${uid}-rule`, stale: `${uid}-stale`, xrule: `${uid}-xrule`, xstale: `${uid}-xstale` }
  /** The primary action, in the bar or in the panel's foot: held while stale (described by the stale sentence) or,
   *  for Apply, while the rule needs more than the author (described by the rule's). */
  const primary = (where: 'bar' | 'foot') => {
    const why = stale > 0 ? (where === 'bar' ? ids.stale : ids.xstale) : undefined
    const ref = where === 'bar' ? barPrimary : undefined
    if (revises) return <Button primary ref={ref} disabled={busy || stale > 0} describedby={why} onClick={() => void update()}>Update proposal</Button>
    if (canPropose) return <Button primary ref={ref} disabled={busy || stale > 0} describedby={why} onClick={e => propose(e.currentTarget)}>Propose</Button>
    return <Button primary ref={ref} disabled={busy || !canApply} describedby={why ?? (view.rule.direct ? undefined : where === 'bar' ? ids.rule : ids.xrule)}
      onClick={() => void apply()}>Apply</Button>
  }
  const last = view.ops[view.ops.length - 1]!
  const notice = failure && (
    <div className="tray-why" role="alert">
      {[failure.message, ...failure.lines].map((line, i) => <p key={i} className="err">{line}</p>)}
    </div>
  )
  const panel = (
    <TrayPanel view={view} primary={primary('foot')} busy={busy} notice={notice} rowErrors={rowErrors} headingRef={heading}
      discardRef={discardRef} ruleId={ids.xrule} staleId={ids.xstale}
      onRemove={n => void remove(n)} onRebase={(n, keep) => void rebase(n, keep)} onDiscard={discard} />
  )
  return (
    <section ref={section} className={page ? 'tray tray-page' : 'tray'} aria-label="Changes" aria-busy={busy || undefined}>
      {!expanded && notice}
      {!page && (
        <TrayBar barRef={bar} reviewRef={reviewRef} count={view.ops.length} stale={stale} busy={busy ? doing : null} phone={phone}
          staleId={ids.stale} primary={primary('bar')} onReview={() => expand(reviewRef.current)}
          line={busy ? ruleWords(view.rule) : <>{opSummary(last)} · <span id={ids.rule}>{ruleWords(view.rule)}</span></>} />
      )}
      {page && <div className="tray-in">{panel}</div>}
      {!page && expanded && (
        // A press on the dialog itself is a press on its backdrop, the scrim: the panel fills the dialog.
        <dialog ref={pop} className="tray-pop" aria-label="Your change" onCancel={e => { e.preventDefault(); collapse() }}
          onClick={e => { if (e.target === e.currentTarget) collapse() }}>
          {panel}
        </dialog>
      )}
      {asking && (
        <ConfirmDialog ref={ask} title={`Discard ${plural(view.ops.length, 'staged op')}?`} cancel="Keep them" confirm="Discard"
          body="They exist only in your change. Nothing on the trunk is touched." onCancel={() => setAsking(false)}
          onConfirm={() => { setAsking(false); void act('discard', ch.discard) }} />
      )}
    </section>
  )
}
