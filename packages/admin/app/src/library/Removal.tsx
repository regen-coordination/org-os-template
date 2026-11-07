import { useEffect, useRef, useState, type Ref } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type RemovalPreview } from '../api.ts'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { announce } from '../parts/live.tsx'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { RecordList, RecordRow } from './EntryPreview.tsx'

type Rec = RemovalPreview['records'][number]

/** What removing does to each record, said on its row (§11.2): an edited record is the clay row. */
const STATE: Record<Rec['state'], string> = {
  'as added': 'as added',
  edited: 'edited since added — asks before taking it',
  gone: 'already gone: there is nothing to delete',
}

/** The question asked before a removal takes records edited since the add: it names every one of them. */
export const askSentence = (asks: string[]): string =>
  `${asks.length === 1 ? 'This record was' : 'These records were'} edited since it was added: ${asks.join(', ')}. ` +
  `Removing deletes ${asks.length === 1 ? 'it' : 'them'} with ${asks.length === 1 ? 'its' : 'their'} edits. Remove anyway?`

/** "a", "a and b", "a, b and c". */
const joined = (xs: string[]): string => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

/** What is said when the server answers 409 ASK: records were edited between opening this and pressing Remove. Said in
 *  plain words, never the API's sentence (which names the `take` field). */
export const editedSince = (records: string[]): string =>
  `Since you opened this, ${records.length === 0 ? 'its records changed' : `${joined(records)} ${records.length === 1 ? 'was' : 'were'} edited`}. Look again and remove, or go back.`

/** Why Remove cannot be used (E-22): a record it would delete is still named by another, which the engine refuses a
 *  delete over. Null when nothing holds it. */
export function heldBy(r: RemovalPreview): string | null {
  const held = r.records.filter(rec => rec.state !== 'gone' && rec.referrers.length > 0)
  if (held.length === 0) return null
  const refs = [...new Set(held.flatMap(rec => rec.referrers))]
  return `${held.map(rec => `${rec.record} is still named by ${joined(rec.referrers)}`).join('; ')}, so it cannot be deleted. Change ${joined(refs)} first.`
}

/** What removing a receipt would do, drawn (§11.2): **It would delete N records** in the preview's bordered list —
 *  each record the add created and what removing does to it, the ones edited since the add in clay — who decides, and
 *  Remove and Back. A receipt already removed says when, and offers no Remove; one whose records are still named
 *  elsewhere offers Remove unavailable, with the reason. `failed` is said in a clay note. */
export function RemovalView({ r, busy = false, failed = null, onRemove, onBack, headRef }: {
  r: RemovalPreview; busy?: boolean; failed?: string | null; onRemove: () => void; onBack: () => void; headRef?: Ref<HTMLHeadingElement>
}) {
  const title = r.title ?? r.entry
  const held = heldBy(r)
  // Previewing draws no write control (C6, C-23): what removing would do is shown, the Remove is not.
  const canWrite = useCanWrite()
  return (
    <section className="lib-rm" aria-label={`Remove ${title}`}>
      <h3 ref={headRef} tabIndex={-1} className="lib-h lib-rm-t">{`Remove ${title}`}</h3>
      {r.records.length > 0 && (
        <RecordList heading={`It would delete ${r.records.length === 1 ? '1 record' : `${r.records.length} records`}`} level={4}>
          {r.records.map(rec => (
            <RecordRow key={rec.record} record={rec.record} clay={rec.state === 'edited'}
              end={rec.referrers.length > 0 ? `${STATE[rec.state]} · still named by ${rec.referrers.join(', ')}, so it cannot be deleted` : STATE[rec.state]} />
          ))}
        </RecordList>
      )}
      {r.decided.length > 0 && <div className="lib-sec"><h4 className="lib-h">Who decides</h4>{r.decided.map(d => <p key={d.class} className="lib-p">{`${d.class}: ${d.sentence}`}</p>)}</div>}
      {r.refusal && <Note state="unavailable">{r.refusal}</Note>}
      <div className="lib-acts">
        {!r.refusal && canWrite && <Button primary onClick={onRemove} disabled={busy} unavailable={held ?? undefined}>Remove</Button>}
        <Button variant="ghost" onClick={onBack}>Back</Button>
      </div>
      {held && <p className="lib-p lib-held">{held}</p>}
      {failed && <Note state="error" quiet>{failed}</Note>}
    </section>
  )
}

/** What removing a receipt would do, read and acted on. Remove stages the deletes and the receipt's removal in the
 *  person's change; when records were edited since the add it first asks, naming them, and takes all of them or
 *  nothing. If records were edited after it opened, the server's 409 ASK is answered by looking again and naming them.
 *  `onClose` gets the sentence to announce, or null for Back. */
export function Removal({ receipt, onClose }: { receipt: string; onClose: (said: string | null) => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['library', 'removal', receipt], queryFn: () => api.libraryRemoval(receipt) })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  // A refused Remove is said once through the page's one polite region: the clay note is not an alert (§13, C10).
  useEffect(() => { if (failed) announce(failed) }, [failed])
  const head = useRef<HTMLHeadingElement>(null)
  const loaded = q.data !== undefined
  useEffect(() => { head.current?.focus() }, [loaded])

  const r = q.data
  const title = r ? r.title ?? r.entry : receipt
  const remove = async () => {
    if (!r || heldBy(r)) return
    if (r.asks.length > 0 && !window.confirm(askSentence(r.asks))) return
    setBusy(true); setFailed(null)
    try {
      await api.libraryRemove(receipt, r.asks)
      for (const queryKey of [['changes'], ['library']]) void qc.invalidateQueries({ queryKey })
      onClose(`The removal of ${title} is staged in the changes.`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ASK') {
        // The asks changed after this opened: look again, so the records and the question are the server's as they are
        // now, and say which records are new to it.
        const now = (await q.refetch()).data
        const fresh = now ? now.asks.filter(a => !r.asks.includes(a)) : []
        const sent = Array.isArray(err.body.asks) ? err.body.asks.map(String) : []
        const named = fresh.length > 0 ? fresh : now && now.asks.length > 0 ? now.asks : sent
        setFailed(editedSince(named))
      } else {
        setFailed(err instanceof ApiError && err.errors.length > 0 ? err.errors.map(e => e.message).join(' ') : err instanceof Error ? err.message : String(err))
      }
      setBusy(false)
    }
  }

  if (r) return <RemovalView r={r} busy={busy} failed={failed} onRemove={() => void remove()} onBack={() => onClose(null)} headRef={head} />
  return (
    <section className="lib-rm" aria-label={`Remove ${title}`}>
      <h3 ref={head} tabIndex={-1} className="lib-h lib-rm-t">{`Remove ${title}`}</h3>
      {q.error ? <Note state="error">{q.error.message}</Note> : <Note state="loading">Loading…</Note>}
    </section>
  )
}
