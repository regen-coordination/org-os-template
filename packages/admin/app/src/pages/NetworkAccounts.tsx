import { useEffect, useId, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHead } from '../design/PageHead.tsx'
import { Section } from '../design/Section.tsx'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { useStatus } from '../queries.ts'

// /network-accounts (refi-dao-os network app spec §5.4, §5.6; B6): the stewards' two lists of the ReFi DAO Network's
// node accounts. New: the live ones, each with Remove (asks a reason, kept privately). Waiting: the pending ones, with
// Confirm (asks which channel on the node's record the steward used) and Decline (asks a reason). The Hub refuses
// anyone who is no steward; the page shows its sentence.

interface Live { id: string; node: string; title: string; handle: string; added: string; check: string; why: string | null }
interface Waiting { id: string; node: string; title: string; handle: string; added: string; note: string | null; channels: { key: string; url: string }[] }
interface Board { new: Live[]; waiting: Waiting[] }
type Acting = { id: string; kind: 'remove' | 'confirm' | 'decline' } | null

const KEY = ['network', 'entries'] as const
const ABOUT = 'The node accounts on the ReFi DAO Network. A node\'s own account goes live when it matches the node; any other '
  + 'waits here until a steward confirms it with the node through a channel already on its record. Waiting accounts drop after 30 days.'
const WHY: Record<string, string> = { domain: 'its own domain', record: 'named on its record', steward: 'confirmed by a steward' }
const ACTION = { remove: 'Remove', confirm: 'Confirm', decline: 'Decline' } as const

async function answer<T>(res: Response): Promise<T> {
  const read = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof read.error === 'string' ? read.error : `HTTP ${res.status}`)
  return read as T
}
const readBoard = async (): Promise<Board> => answer<Board>(await fetch('/api/network/entries'))
async function act(id: string, kind: NonNullable<Acting>['kind'], body: Record<string, string>): Promise<void> {
  const res = await fetch(`/api/network/entries/${encodeURIComponent(id)}/${kind}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) await answer(res)
}
const day = (iso: string) => iso.slice(0, 10)

/** The inline form under a row: a reason (Remove, Decline) or the channel used (Confirm). */
function ActForm({ acting, channels, onDone, onCancel }: { acting: NonNullable<Acting>; channels: Waiting['channels']; onDone(): void; onCancel(): void }) {
  const fieldId = useId()
  const [value, setValue] = useState(acting.kind === 'confirm' ? channels[0]?.key ?? '' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim() === '' || busy) return
    setBusy(true); setError(null)
    act(acting.id, acting.kind, acting.kind === 'confirm' ? { channel: value } : { reason: value.trim() })
      .then(onDone, (err: unknown) => setError(err instanceof Error ? err.message : 'It could not be done.'))
      .finally(() => setBusy(false))
  }
  return (
    <form className="signin-form" onSubmit={submit}>
      {acting.kind === 'confirm' ? <>
        <label className="signin-label" htmlFor={fieldId}>Confirmed with the node through</label>
        <select className="input" id={fieldId} value={value} onChange={e => setValue(e.target.value)}>
          {channels.map(ch => <option key={ch.key} value={ch.key}>{`${ch.key} · ${ch.url}`}</option>)}
        </select>
      </> : <>
        <label className="signin-label" htmlFor={fieldId}>Why (kept privately)</label>
        <input className="input" id={fieldId} value={value} maxLength={500} onChange={e => setValue(e.target.value)} />
      </>}
      <div className="signin-go">
        <Button type="submit" primary={acting.kind === 'confirm'} {...(busy ? { busy: 'Saving…' } : {})}>{ACTION[acting.kind]}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
      {error && <Note state="error">{error}</Note>}
    </form>
  )
}

export default function NetworkAccounts() {
  const org = useStatus().data?.org ?? 'org-os'
  const qc = useQueryClient()
  const read = useQuery({ queryKey: KEY, queryFn: readBoard, retry: false })
  const [acting, setActing] = useState<Acting>(null)
  useEffect(() => { document.title = `Node accounts · ${org}` }, [org])

  const done = () => { setActing(null); void qc.invalidateQueries({ queryKey: KEY }) }
  const open = (id: string, kind: NonNullable<Acting>['kind']) => setActing({ id, kind })
  const form = (id: string, channels: Waiting['channels'] = []) =>
    acting?.id === id ? <ActForm acting={acting} channels={channels} onDone={done} onCancel={() => setActing(null)} /> : null

  return (
    <div className="network-accounts">
      <PageHead title="Node accounts" about={ABOUT} />
      {read.error && <Note state="unavailable">{read.error.message}</Note>}
      {read.data && <>
        <Section label="New" count={read.data.new.length}>
          {read.data.new.length === 0 ? <p className="signin-p">No node account is live yet.</p> : (
            <ul className="network-accounts-list">
              {read.data.new.map(e => (
                <li key={e.id}>
                  <div className="network-accounts-row">
                    <div className="network-accounts-who">
                      <span className="who-t">{e.handle}</span>
                      <span className="network-accounts-meta">
                        {[e.title, day(e.added), e.check === 'pass' ? 'checked both ways' : 'check failed', e.why ? WHY[e.why] ?? e.why : null].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <Button small onClick={() => open(e.id, 'remove')} label={`Remove ${e.handle}`}>Remove</Button>
                  </div>
                  {form(e.id)}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section label="Waiting" count={read.data.waiting.length}>
          {read.data.waiting.length === 0 ? <p className="signin-p">Nothing is waiting.</p> : (
            <ul className="network-accounts-list">
              {read.data.waiting.map(e => (
                <li key={e.id}>
                  <div className="network-accounts-row">
                    <div className="network-accounts-who">
                      <span className="who-t">{e.handle}</span>
                      <span className="network-accounts-meta">{[e.title, day(e.added), e.note].filter(Boolean).join(' · ')}</span>
                    </div>
                    <span className="signin-go">
                      <Button small onClick={() => open(e.id, 'confirm')} label={`Confirm ${e.handle}`}>Confirm</Button>
                      <Button small onClick={() => open(e.id, 'decline')} label={`Decline ${e.handle}`}>Decline</Button>
                    </span>
                  </div>
                  {form(e.id, e.channels)}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </>}
    </div>
  )
}
