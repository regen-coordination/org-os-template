import { useEffect, useId, useRef } from 'react'
import { Link } from 'wouter'
import { useMachine } from '../machines.ts'
import { block, blockGuards } from '../machines/block.ts'
import { Note } from '../design/Note.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { announce } from '../parts/live.tsx'
import { useBlockCtx } from './context.ts'
import type { BlockCfg, BlockCtx, BlockData, BlockDef, BlockState, FrameView } from './types.ts'

/** The block machine's event that brings it to what the data says (interfaces P4-C4). */
export function eventFor(d: BlockData): { type: string; count?: number; error?: string } {
  switch (d.state) {
    case 'loading': return { type: 'RELOAD' }
    case 'error': return { type: 'FAILED', error: d.error }
    case 'notYet': return { type: 'NOT_YET' }
    case 'unavailable': return { type: 'UNAVAILABLE', error: d.error }
    default: return { type: 'LOADED', count: d.count ?? (d.state === 'empty' ? 0 : 1) }
  }
}

/** What a block says in place of its body (Rulings: the words P1 pinned). */
function noteText(def: BlockDef, view: FrameView, state: BlockState, data: BlockData): string {
  switch (state) {
    case 'loading': return 'Loading…'
    case 'empty': return view.empty ?? 'Nothing here yet.'
    case 'error': return data.error ?? 'This block could not be read.'
    case 'notYet': return def.needs ? `Arrives with ${def.needs}.` : 'Not yet.'
    default: return data.error ?? 'Not here.'
  }
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** A block from data and context given (spec §4.3; §14.2 "section head + body + foot inside a surface"): the section
 *  head (its title, the count beside it in faint, a note or a link at its end), the body (when ready) or the Note
 *  for its state, and the foot (its actions), in the block's raised surface. What is drawn is the data's own state,
 *  so the frame never lags the answer by a render (it never says "empty" before the data has said so). The block
 *  machine follows the data through `eventFor` and drives the announcements. Bare: no head, no region and no foot:
 *  the page owns them. The region is named by its head ("Needs you · 5"). */
export function BlockView({ def, cfg, id, data, bare = false, ctx }:
  { def: BlockDef; cfg: BlockCfg; id: string; data: BlockData; bare?: boolean; ctx: BlockCtx }) {
  const m = useMachine(block, { guards: blockGuards, context: null, initial: data.state })
  const key = `${data.state}|${data.count ?? ''}|${data.error ?? ''}`
  useEffect(() => { if (m.state !== data.state || data.state !== 'loading') m.send(eventFor(data)) }, [key])
  const state = data.state
  const view = (cfg.view ?? {}) as FrameView
  const title = def.title(cfg)
  const said = useRef<string | null>(null)
  // What is not here is announced here; an error is not: its Note says itself through the polite region (C11 I-1).
  useEffect(() => {
    if (m.state !== 'unavailable') { said.current = null; return }
    const text = `${title}: ${noteText(def, view, m.state as BlockState, data)}`
    if (said.current !== text) { said.current = text; announce(text) }
  }, [m.state, data.error])
  const labelId = useId()
  const count = state === 'ready' || state === 'empty' ? data.count : undefined
  const note = view.link ? <Link href={view.link.href}>{view.link.label}</Link>
    : view.note ?? (view.count === 'note' && count !== undefined ? <span className="sect-note">{plural(count, view.noun ?? 'record')}</span> : undefined)
  if (view.quiet && (state === 'loading' || state === 'empty' || state === 'notYet')) return null
  // a first load is skeleton rows, never the spinner and "Loading…" (§6.2; walk 2026-11-04)
  const inner = state === 'ready' ? <def.Body cfg={cfg} data={data.data} ctx={ctx} />
    : state === 'loading' ? <Skeleton rows={3} shape="row" label={title} />
    : state === 'empty' && def.Empty ? <def.Empty cfg={cfg} ctx={ctx} bare={bare} />
    : <Note state={state}>{noteText(def, view, state, data)}</Note>
  const body = def.Tools ? <def.Tools cfg={cfg} ctx={ctx} state={state} bare={bare}>{inner}</def.Tools> : inner
  const foot = def.Foot && state !== 'loading' && state !== 'notYet' && !bare ? <div className="bf-foot"><def.Foot cfg={cfg} ctx={ctx} /></div> : null
  if (bare) return <div className="bf-bare" data-block={id} data-type={def.type} data-state={state}>{body}</div>
  return (
    <section className="bf" role="region" aria-labelledby={labelId} data-block={id} data-type={def.type} data-state={state}>
      <div className="sect-h">
        <h2 className="sect-t" id={labelId}>{title}{view.count === 'title' && count !== undefined && <span className="sect-n"><span className="sr-only"> · </span>{count}</span>}</h2>
        {note !== undefined && <span className="sect-end">{typeof note === 'string' ? <span className="sect-note">{note}</span> : note}</span>}
      </div>
      <div className="bf-body">{body}</div>
      {foot}
    </section>
  )
}

/** A block read live: its type's data, the app's context. A type that needs a later track is not yet,
 *  whatever its data says; its data hook is still called, so the hooks keep their order. */
export function BlockFrame({ def, cfg, id, bare = false }: { def: BlockDef; cfg: BlockCfg; id: string; bare?: boolean }) {
  const ctx = useBlockCtx()
  const read = def.useData(cfg, ctx)
  const data: BlockData = def.needs ? { state: 'notYet' } : read
  return <BlockView def={def} cfg={cfg} id={id} data={data} bare={bare} ctx={ctx} />
}
