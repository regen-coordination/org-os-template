import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'wouter'
import { ApiError, type ListedEntry, type LibraryPreview, type Receipt } from '../api.ts'
import { Note } from '../design/Note.tsx'
import { Button, buttonClass } from '../design/Button.tsx'
import { Icon, type IconName } from '../design/Icon.tsx'
import { StatusMark } from '../design/StatusMark.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { TextInput } from '../design/inputs/index.ts'
import { announce } from '../parts/live.tsx'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { shelfKind, versionText, type ShelfName } from './EntryCard.tsx'

/** The promise every addable preview makes (§11.2). */
export const PROMISE = 'Adding stages one change. The org’s rules decide it. Nothing is written by this preview.'

/** The glyph of a record's registry, in a "would create" row. */
const GLYPH: Record<string, IconName> = { systems: 'systems', boards: 'board', governance: 'doc', members: 'members', library: 'library', proposals: 'proposal' }
export const registryGlyph = (record: string): IconName => GLYPH[record.slice(0, record.indexOf(':'))] ?? 'file'

/** One row of a bordered record list (§11.2): the registry's glyph, the record's name, `registry:id` in Mono, and
 *  the row's end (the change class and who decides, faint). `clay` is the row a person must look at: an id already
 *  taken, a record edited since it was added. */
export function RecordRow({ record, name, end, clay = false }: { record: string; name?: string; end: ReactNode; clay?: boolean }) {
  return (
    <li className={clay ? 'lib-row lib-row-clay' : 'lib-row'}>
      <Icon name={clay ? 'alert' : registryGlyph(record)} size="sm" />
      {name !== undefined && <span className="lib-row-n">{name}</span>}
      <span className="mono">{record}</span>
      <span className="lib-row-c">{end}</span>
    </li>
  )
}

/** A heading and the bordered list it names. */
export function RecordList({ heading, level = 3, children }: { heading: string; level?: 3 | 4; children: ReactNode }) {
  const H = level === 3 ? 'h3' : 'h4'
  return <div className="lib-sec"><H className="lib-h">{heading}</H><ul className="lib-rows" aria-label={heading}>{children}</ul></div>
}

/** One part of the preview's side (§11.2): a heading and what it holds. */
const Side = ({ heading, children }: { heading: string; children: ReactNode }) => <div className="lib-sec"><h3 className="lib-h">{heading}</h3>{children}</div>

/** The way out of a preview: Close, a link back to the list, named for what it closes. */
export const CloseLink = () => <Link href="/library" className={buttonClass({ variant: 'ghost' })} aria-label="Close preview">Close</Link>

/** The preview's frame (§11.2): a region named "<title> preview", two columns — the main one with the head (the
 *  eyebrow "<kind> · preview" and `id@version` in Mono, the title, then what the caller draws), and the `side` on
 *  --sunken — that become one under 680px of its own width. It holds the preview, or the line that says why there is
 *  none yet, so a person can always close it: `actions` end the main column, Close last; `null` when the caller draws
 *  its own row (a form's). A region, not an inspector: the inspector is the record panel and stays the only
 *  complementary. The heading takes focus (`tabIndex -1`) when a preview opens. */
export function PreviewFrame({ entry, side, actions, children }: { entry: ListedEntry; side?: ReactNode; actions?: ReactNode | null; children: ReactNode }) {
  const at = /^\d/.test(entry.version) ? `${entry.id}@${entry.version}` : entry.id
  return (
    <section className="lib-prev" aria-label={`${entry.title} preview`}>
      <div className={side ? 'lib-prev-in' : 'lib-prev-in lib-prev-one'}>
        <div className="lib-prev-m">
          <div className="lib-prev-head">
            <p className="lib-prev-top"><span className="lib-prev-k">{`${shelfKind(entry.shelf as ShelfName)} · preview`}</span><span className="lib-prev-id mono">{at}</span></p>
            <h2 tabIndex={-1} className="lib-prev-t">{entry.title}</h2>
          </div>
          {children}
          {actions !== null && <div className="lib-acts">{actions}<CloseLink /></div>}
        </div>
        {side && <div className="lib-prev-s">{side}</div>}
      </div>
    </section>
  )
}

type Field = LibraryPreview['fields'][number]
type ReceiptLine = LibraryPreview['receipts'][number]

/** What a field starts as: its default, or, for `id` when the entry's id is taken, the next free one. */
const initial = (f: Field, p: LibraryPreview): string =>
  f.name === 'id' && p.refusal ? p.refusal.nextFreeId : f.default == null ? '' : String(f.default)
/** A typed value back in its default's type (a number stays a number); an empty field is left out. */
const typed = (f: Field, v: string): unknown =>
  typeof f.default === 'number' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v)
    : typeof f.default === 'boolean' && (v === 'true' || v === 'false') ? v === 'true' : v
const fieldId = (name: string) => `lib-cfg-${name}`
const records = (n: number) => (n === 1 ? '1 record' : `${n} records`)

/** The receipt line (L1, §11.2): "Added by <who decided> on <date> · created N records". Who decided is the
 *  proposal that ratified the add, or the member who applied it; while data/library.yaml's receipts are not read,
 *  the line says what the preview has. */
export function addedLine(r: ReceiptLine, detail?: Receipt): string {
  const who = detail?.decision && 'proposal' in detail.decision ? detail.decision.proposal : detail?.by ?? r.by
  const head = ['Added', who && `by ${who}`, (detail?.at ?? r.at) && `on ${detail?.at ?? r.at}`].filter(Boolean).join(' ')
  return detail ? `${head} · created ${records(detail.created.length)}` : head
}

/** The row a taken id falls on: the record whose id the next free one is numbered from (`<id>-<n>`); when records of
 *  several registries share that id, the one the sentence names ("A board with the id …" is `boards:`). */
function takenRecord(p: LibraryPreview): string | null {
  if (!p.refusal) return null
  const base = p.refusal.nextFreeId.replace(/-\d+$/, '')
  const hits = p.adds.map(a => a.record).filter(r => r.slice(r.indexOf(':') + 1) === base)
  const noun = /^An? (\w+) with the id/.exec(p.refusal.sentence)?.[1]
  return hits.find(r => noun !== undefined && r.startsWith(`${noun}s:`)) ?? hits[0] ?? null
}

/** What adding an entry would change, said before anything is added (§11.2; design 4.5: preview is prepare). The main
 *  column says what it is, the promise, the machine's sentence, **It would create N records** (the taken id's row in
 *  clay, "id taken · would be <next>"), what it holds, and the receipts still in force; the side says what it needs
 *  (missing in clay, with its word), the hosts it would read and who decides. Add — stage a change stages the entry,
 *  with what it asks for, in the person's change, and the rule in force decides it when the change is applied or
 *  proposed. When it cannot be added the button is disabled, with the library's sentence beside it; a built-in, or an
 *  entry that adds nothing, offers no add; an entry whose add is already in the person's change (`staged`) says so
 *  instead. Each receipt says who added it and when, and opens its removal (`onRemove`), or says its removal is staged
 *  (`removals`). `onAdd` rejects with the server's refusal — 422 `config.<name>` errors are said beside their fields,
 *  anything else in a clay note under the button — or resolves with `{ nextFreeId }` after a 409 TAKEN, which the id
 *  field takes, with the keyboard. */
export function EntryPreview({ entry, preview, machine, onAdd, onRemove, staged = false, removals = [], receipts }: {
  entry: ListedEntry; preview: LibraryPreview; machine: { state: string; text: string }
  onAdd: (config: Record<string, unknown>) => Promise<void | { nextFreeId: string }>; onRemove: (receipt: string) => void
  staged?: boolean; removals?: string[]; receipts?: Receipt[]
}) {
  const p = preview
  const source = [p.source.name, versionText(p.source.version), `${p.source.standing}${p.source.as_of ? ` ${p.source.as_of}` : ''}`].join(' · ')
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(p.fields.map(f => [f.name, initial(f, p)])))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState<string | null>(null)
  // A refused Add is said once through the page's one polite region: the clay note is not an alert (§13, C10).
  useEffect(() => { if (failed) announce(failed) }, [failed])
  const [busy, setBusy] = useState(false)
  const [moved, setMoved] = useState(0)
  // After a refusal on fields, the keyboard goes to the first field that failed (its error is its description); after
  // a taken id, to the id field, which now holds the next free one.
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus() }, [errors])
  useEffect(() => { if (moved > 0) form.current?.querySelector<HTMLElement>(`#${fieldId('id')}`)?.focus() }, [moved])
  const canWrite = useCanWrite()
  // Previewing draws no write control anywhere (C6, C-23): no add form, no disabled Add, and no receipt's Remove —
  // what a preview offers is the preview itself, and Close, which ends it.
  const offers = entry.installable && !entry.builtin && !staged && canWrite
  const promise = entry.installable && !entry.builtin
  // A reason already said on the page (the machine's refusal, the preview's note) is not said again beside the button.
  const why = p.cannotAdd !== null && p.cannotAdd !== p.refusal?.sentence && p.cannotAdd !== p.note && p.cannotAdd !== machine.text ? p.cannotAdd : null
  const taken = staged ? null : takenRecord(p)
  const decides = (cls: string) => p.decided.find(d => d.class === cls)?.sentence

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const config = Object.fromEntries(p.fields.filter(f => (values[f.name] ?? '') !== '').map(f => [f.name, typed(f, values[f.name]!)]))
    setBusy(true); setErrors({}); setFailed(null)
    try {
      const out = await onAdd(config)
      if (out && p.fields.some(f => f.name === 'id')) { setValues(vs => ({ ...vs, id: out.nextFreeId })); setMoved(n => n + 1) }
    } catch (err) {
      const byField: Record<string, string> = {}, rest: string[] = []
      for (const fe of err instanceof ApiError ? err.errors : []) {
        const name = fe.field.startsWith('config.') ? fe.field.slice('config.'.length) : null
        if (name !== null && p.fields.some(f => f.name === name)) byField[name] = byField[name] ? `${byField[name]} ${fe.message}` : fe.message
        else rest.push(fe.message)
      }
      setErrors(byField)
      setFailed(rest.length > 0 ? rest.join(' ') : Object.keys(byField).length > 0 ? null : err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const side = (
    <>
      {p.needs.length > 0 && (
        <Side heading="Needs">
          <ul className="lib-check">
            {p.needs.map(n => (
              <li key={n.text} className={n.met ? undefined : 'miss'}>
                <Icon name={n.met ? 'check' : 'alert'} size="sm" /><span>{n.text}</span><span className="sr-only">{n.met ? ', present' : ', missing'}</span>
              </li>
            ))}
          </ul>
        </Side>
      )}
      {p.reaches.length > 0 && <Side heading="Would reach, read only"><div className="lib-hosts">{p.reaches.map(r => <span key={r.host} className="mono">{r.host}</span>)}</div></Side>}
      {p.decided.length > 0 && <Side heading="Who decides">{p.decided.map(d => <p key={d.class} className="lib-p">{`${d.class}: ${d.sentence}`}</p>)}</Side>}
      {p.asks.length > 0 && !(offers && p.cannotAdd === null && p.fields.length > 0) && <Side heading="Asks for"><p className="lib-p">{p.asks.join(', ')}</p></Side>}
      <Side heading="Source">
        <p className="lib-p">{source}</p>
        {entry.maturity && <p className="lib-p">{entry.maturity}</p>}
      </Side>
    </>
  )

  const fields = p.fields.length > 0 && (
    <FieldTable label="What it asks for">
      {p.fields.map(f => {
        const id = fieldId(f.name), hint = f.description ? `${id}-hint` : null, err = errors[f.name] ? `${id}-err` : null
        return (
          <FieldRow key={f.name} label={f.name} htmlFor={id} error={errors[f.name]}>
            <TextInput common={{ id, 'aria-invalid': err ? true : undefined, 'aria-describedby': [hint, err].filter(Boolean).join(' ') || undefined }}
              prose={false} readOnly={false} value={values[f.name] ?? ''} onChange={v => setValues(vs => ({ ...vs, [f.name]: v == null ? '' : String(v) }))} />
            {hint && <span className="lib-hint" id={hint}>{f.description}{f.required ? '' : ' Optional.'}</span>}
          </FieldRow>
        )
      })}
    </FieldTable>
  )

  return (
    <PreviewFrame entry={entry} side={side} actions={offers ? null : undefined}>
      <div className="lib-lede">
        <p className="lib-p lib-sum">{entry.summary}</p>
        {promise && <p className="lib-p">{PROMISE}</p>}
        <p className="lib-state">{machine.state === 'refused' ? <StatusMark mark="failed" label={machine.text} /> : machine.text}</p>
      </div>
      {p.adds.length > 0 && (
        <RecordList heading={`It would create ${records(p.adds.length)}`}>
          {p.adds.map(a => a.record === taken
            ? <RecordRow key={a.record} record={a.record} name={a.summary} clay end={`id taken · would be ${p.refusal!.nextFreeId}`} />
            : <RecordRow key={a.record} record={a.record} name={a.summary} end={[a.class, decides(a.class)].filter(Boolean).join(' · ')} />)}
        </RecordList>
      )}
      {p.blocks.length > 0 && <div className="lib-sec"><h3 className="lib-h">Blocks</h3><ul className="lib-ul">{p.blocks.map(b => <li key={b.id}>{`${b.title ?? b.id} (${b.type})`}</li>)}</ul></div>}
      {p.roles.length > 0 && <div className="lib-sec"><h3 className="lib-h">Roles</h3><ul className="lib-ul">{p.roles.map(r => <li key={r.id}>{r.sentence}</li>)}</ul></div>}
      {p.rules.length > 0 && <div className="lib-sec"><h3 className="lib-h">Rules</h3><ul className="lib-ul">{p.rules.map(r => <li key={r.id}>{r.sentence}</li>)}</ul></div>}
      {p.note && <Note state={entry.builtin ? 'empty' : 'unavailable'}>{p.note}</Note>}
      {staged && <p className="lib-rcpt"><StatusMark mark="staged" label="Staged in your changes" /></p>}
      {p.receipts.length > 0 && (
        <ul className="lib-rcpts">
          {p.receipts.map(r => removals.includes(r.id)
            ? <li key={r.id} className="lib-rcpt"><StatusMark mark="staged" label="Removal staged" /></li>
            : (
              <li key={r.id} className="lib-rcpt">
                <span id={`lib-rcpt-${r.id}`}>{addedLine(r, receipts?.find(x => x.id === r.id))}</span>
                {canWrite && <>
                  <span aria-hidden="true"> · </span>
                  <Button variant="ghost" small describedby={`lib-rcpt-${r.id}`} onClick={() => onRemove(r.id)}>Remove</Button>
                </>}
              </li>
            ))}
        </ul>
      )}
      {offers && p.cannotAdd !== null && (
        <>
          <div className="lib-acts"><Button primary disabled title={p.cannotAdd}>Add — stage a change</Button><CloseLink /></div>
          {why && <Note state="unavailable">{why}</Note>}
        </>
      )}
      {offers && p.cannotAdd === null && (
        <form ref={form} className="lib-form" onSubmit={e => void submit(e)} aria-label={`Add ${entry.title}`} noValidate>
          {fields}
          <div className="lib-acts"><Button type="submit" primary disabled={busy}>Add — stage a change</Button><CloseLink /></div>
          {failed && <Note state="error" quiet>{failed}</Note>}
        </form>
      )}
    </PreviewFrame>
  )
}
