import { useEffect, useRef } from 'react'
import type { LedgerEvent } from '../../../lib/proposals.mjs'
import { Empty } from '../design/Empty.tsx'
import { Icon } from '../design/Icon.tsx'
import { monogram } from '../elements/atoms/Presence.tsx'
import { ago } from '../time.ts'
import { announce } from './live.tsx'

/** A revise event of an earlier version whose ops hold restricted data (placeholders): no store row is kept for a version
 *  no longer proposed, so members cannot read it here; a value a narrowing took out of git stays in the repository's
 *  history, which members could already read (R-L5-final.2, C-14). */
export const EARLIER_RESTRICTED = "its restricted part is not kept for an earlier version; a value narrowed out of the repository stays in its history"
const holdsRestricted = (e: LedgerEvent) => Array.isArray(e.ops) && e.ops.some(op => typeof op === 'object' && op !== null && (op as { op?: unknown }).op === 'private')

const NOUN: Record<string, string> = { object: 'objection', approve: 'approval', vote: 'vote', comment: 'comment' }

/** An event in words (spec §3.14): what was done, and the text that goes with it (an objection's argument,
 *  a comment, a system's detail). `events` lets a retract name what it took back. */
export function eventWords(e: LedgerEvent, events: readonly LedgerEvent[]): { lead: string; detail: string } {
  const by = e.by
  const text = typeof e.text === 'string' ? e.text : ''
  const ref = e.ref as { system?: string; id?: string } | undefined
  switch (e.kind) {
    case 'approve': return { lead: `${by} approved`, detail: '' }
    case 'object': return { lead: `${by} objected`, detail: text }
    case 'vote': return { lead: e.vote === 'abstain' ? `${by} abstained` : `${by} voted ${String(e.vote)}`, detail: '' }
    case 'comment': return { lead: `${by} commented`, detail: text }
    case 'retract': {
      const target = events.find(x => x.id === e.of)
      const whose = !target ? 'an' : target.by === by ? 'their' : `${target.by}'s`
      return { lead: `${by} took back ${whose} ${(target && NOUN[target.kind]) ?? 'event'}`, detail: '' }
    }
    case 'revise': return { lead: `${by} revised the proposal`, detail: '' }
    case 'replay': return { lead: 'the proposal was re-based on the trunk', detail: '' }
    case 'attach': return { lead: `${by} attached transaction ${ref?.id ?? '(unnamed)'} on ${ref?.system ?? 'a system'}`, detail: '' }
    case 'system': return { lead: `${ref?.system ?? by.replace(/^system:/, '')} reported ${String(e.outcome ?? 'a reading')}`, detail: text }
    case 'ratify': return { lead: `${by} ratified it`, detail: '' }
    case 'withdraw': return { lead: `${by} withdrew it`, detail: text }
    case 'reject': return { lead: `${by} rejected it`, detail: '' }
    case 'expire': return { lead: 'it expired', detail: '' }
    default: return { lead: `${by} wrote a ${e.kind} event`, detail: text }
  }
}

const said = (e: LedgerEvent, events: readonly LedgerEvent[]) => { const w = eventWords(e, events); return w.detail ? `${w.lead}: ${w.detail}` : w.lead }

/** Who wrote an event, as its thread draws them: a member's monogram, or the System's glyph for what the server read
 *  from one (`system:<id>`) and for the clock's own events (an expiry, a re-base). */
function Who({ e }: { e: LedgerEvent }) {
  const machine = e.kind === 'system' || e.kind === 'expire' || e.kind === 'replay' || String(e.by ?? '').startsWith('system:')
  return machine
    ? <span className="av av-lg evt-sys" aria-hidden="true"><Icon name="systems" size="sm" /></span>
    : <span className="av av-lg" aria-hidden="true">{monogram(String(e.by ?? ''))}</span>
}

/** The events of a proposal, oldest first, each in words, drawn as a comment thread is (§14.1, C3's `.thread` and
 *  `.cmt`): who (a monogram), what was done and when, and an argument, a comment or a system's detail under it. An
 *  objection of an earlier version says it no longer holds, one taken back says so; an event that arrives while the log
 *  is open is announced once through the page's live region. `rev` is the proposal's current rev. It writes nothing:
 *  Comment… is the page's action, not the thread's. */
export function EventLog({ events, rev, now = new Date() }: { events: readonly LedgerEvent[]; rev: string; now?: Date }) {
  const seen = useRef<Set<string>>(new Set(events.map(e => String(e.id))))
  useEffect(() => {
    const fresh = events.filter(e => !seen.current.has(String(e.id)))
    if (fresh.length === 0) return
    for (const e of fresh) seen.current.add(String(e.id))
    announce(fresh.map(e => said(e, events)).join('; '))
  }, [events])
  if (events.length === 0) return <Empty>No events yet.</Empty>
  const taken = new Set(events.filter(e => e.kind === 'retract').map(e => e.of))
  return (
    <div className="thread evs-w">
      <ol className="thread-l" aria-label="Events">
        {events.map(e => {
          const { lead, detail } = eventWords(e, events)
          const notes = [
            e.kind === 'object' && e.rev !== rev ? 'about an earlier version, answered' : '',
            e.kind === 'revise' && e.rev !== rev && holdsRestricted(e) ? EARLIER_RESTRICTED : '',
            taken.has(e.id) ? 'taken back' : '',
          ].filter(Boolean)
          return (
            <li key={String(e.id)} className={`thread-i evt evt-${e.kind}`} data-event={String(e.id)}>
              <div className="cmt">
                <Who e={e} />
                <div className="cmt-main">
                  <p className="cmt-h evt-h"><span className="cmt-who">{lead}</span> <time className="cmt-at evt-at" dateTime={e.at}>{ago(e.at, now)}</time>
                    {notes.length > 0 && <span className="evt-notes"> ({notes.join('; ')})</span>}</p>
                  {detail && <p className="cmt-b evt-d">{detail}</p>}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
