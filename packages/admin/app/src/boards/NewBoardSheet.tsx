import { useId, useState, type Ref } from 'react'
import { useLocation } from 'wouter'
import type { BoardRead, Layout } from '../api.ts'
import { useChanges } from '../changes/useChanges.ts'
import { refusalErrors } from '../record/useEditor.ts'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Icon } from '../design/Icon.tsx'
import { Note } from '../design/Note.tsx'
import { Seg } from '../design/Seg.tsx'
import { TextInput } from '../design/inputs/index.ts'
import { slug } from '../slug.ts'
import { BoardThumb, LAYOUT_WORDS, SAMPLE } from './BoardThumb.tsx'
import { boardTitle } from './Board.tsx'
import { convert } from './layout.ts'

const LAYOUTS: Layout[] = ['grid', 'canvas', 'flow']
type From = 'blank' | 'copy'

/** New board (spec 2026-11-04 §2): the house's sheet, not a form at the page's foot. Three layout tiles, each with
 *  what it is for; the name, with the id that follows it (checked against every board and what is staged); where to
 *  start from — blank, or a copy of a built-in's blocks laid out anew. There is no recipe source in the framework, so
 *  *A recipe* is not drawn (DP-20). *Create board* stages the create and opens it in Arrange, as before. */
export function NewBoardSheet({ boards, org, onDone, dialogRef }:
  { boards: BoardRead[]; org: string | undefined; onDone: () => void; dialogRef?: Ref<HTMLDialogElement> }) {
  const ch = useChanges()
  const [, navigate] = useLocation()
  const [layout, setLayout] = useState<Layout>('grid')
  const [name, setName] = useState('')
  const [from, setFrom] = useState<From>('blank')
  const builtins = boards.filter(b => b.origin === 'builtin')
  const [copyOf, setCopyOf] = useState(builtins[0]?.id ?? '')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const uid = useId()
  const id = slug(name)
  const staged = new Set((ch.view?.ops ?? []).filter(o => o.record.startsWith('boards:')).map(o => o.record.slice('boards:'.length)))
  const taken = id !== '' && (boards.some(b => b.id === id) || staged.has(id))
  const source = from === 'copy' ? builtins.find(b => b.id === copyOf) : undefined
  const ready = id !== '' && !taken && (from === 'blank' || source !== undefined)

  const create = async () => {
    if (!ready || busy) return
    const record = `boards:${id}`
    const blocks = source ? convert(source.blocks, source.layout, layout) : []
    setBusy(true)
    try {
      await ch.stage([{ op: 'create', record, value: { id, name: name.trim(), audience: 'members', layout, blocks } }])
      onDone()
      navigate(`/b/${encodeURIComponent(id)}?arrange=1`)
    } catch (err) {
      setErrors(refusalErrors(err, record).map(e => e.message))
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog ref={dialogRef} wide title="New board" confirm="Create board" disabled={!ready} busy={busy ? 'Creating…' : undefined}
      onCancel={onDone} onConfirm={() => void create()} note={<>Saved to <code>data/boards.yaml</code> as a staged change</>}
      body={
        <form className="nb" aria-label="New board" onSubmit={e => { e.preventDefault(); void create() }}>
          <p className="nb-l">A board shows records from any section, arranged the way you choose. It’s saved as a staged change, so you can still change your mind.</p>
          <fieldset className="nb-lay">
            <legend className="nb-legend">Layout</legend>
            {LAYOUTS.map(l => (
              <label key={l} className="nb-tile">
                <input className="nb-radio" type="radio" name={`${uid}-layout`} value={l} checked={layout === l} onChange={() => setLayout(l)} />
                <BoardThumb boxes={SAMPLE[l]} size="tile" />
                <span className="nb-tx">
                  <span className="nb-tn">{LAYOUT_WORDS[l].name}{layout === l && <Icon name="check" size="sm" />}</span>
                  <span className="nb-tl">{LAYOUT_WORDS[l].line}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <FieldTable label="New board">
            <FieldRow label="Name" htmlFor={`${uid}-name`} error={taken ? `A board called ${id} is already here: pick another name.` : undefined}>
              <TextInput common={{ id: `${uid}-name`, 'aria-required': true, 'aria-invalid': taken || undefined, placeholder: 'e.g. Grants pipeline',
                'aria-describedby': taken ? `${uid}-name-err ${uid}-id` : `${uid}-id` }} prose={false} readOnly={false} value={name}
                onChange={v => { setName(typeof v === 'string' ? v : ''); setErrors([]) }} />
              <span className="nb-id" id={`${uid}-id`}>{id ? <>Id <code>{id}</code></> : 'The id follows the name.'}</span>
            </FieldRow>
            <FieldRow label="Start from">
              <span className="nb-from">
                <Seg<From> label="Start from" value={from} onChange={setFrom}
                  options={[{ value: 'blank', label: 'Blank' }, ...(builtins.length > 0 ? [{ value: 'copy' as const, label: 'Copy a built-in' }] : [])]} />
                {from === 'copy' && (
                  <label className="nb-copy" htmlFor={`${uid}-copy`}><span className="sr-only">Built-in to copy</span>
                    <select id={`${uid}-copy`} className="input" value={copyOf} onChange={e => setCopyOf(e.target.value)}>
                      {builtins.map(b => <option key={b.id} value={b.id}>{boardTitle(b, org)}</option>)}
                    </select>
                  </label>
                )}
              </span>
            </FieldRow>
          </FieldTable>
          {errors.map(e => <Note key={e} state="error">{e}</Note>)}
        </form>
      } />
  )
}
