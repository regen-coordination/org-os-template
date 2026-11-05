import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'wouter'
import { api, ApiError, type ChangeView, type ProposeInput } from '../api.ts'
import { useChanges } from './useChanges.ts'
import { useMachine } from '../machines.ts'
import { firstMissing, propose, proposeGuards, type ProposeForm } from '../machines/propose.ts'
import { usePanel } from '../parts/panels.tsx'
import { Button } from '../design/Button.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Choice, TextInput } from '../design/inputs/index.ts'

/** The classes whose proposal must say why and is recorded as a decision (spec 3.14). */
const WEIGHTY = ['governance', 'identity']

/** What a title says when the author wrote none: the ops in a few words. */
export function summarize(ops: ChangeView['ops']): string {
  const verb = { update: 'Update', create: 'Add', delete: 'Remove', replace: 'Replace' } as const
  if (ops.length === 1) return `${verb[ops[0]!.op]} ${ops[0]!.record}`
  return `${ops.length} changes to ${new Set(ops.map(o => o.record)).size} records`
}

/** A 422's field, as the form names it: `rationale`, `title`, `statement.why` (a path from the ledger may
 *  carry a prefix, so only its last two segments count). */
const formField = (path: string): string | null => {
  const parts = path.split(/[./]/).filter(p => p !== '' && !/^\d+$/.test(p))
  const last = parts.at(-1) ?? ''
  if (parts.at(-2) === 'statement' && ['decision', 'why', 'scope'].includes(last)) return `statement.${last}`
  return last === 'title' && parts.at(-2) !== 'statement' || last === 'rationale' ? last : null
}

/** What the form says under its fields (E-48, L5 Task 15 M5): what it writes goes to git, where every member reads it. */
export const WRITTEN_TO_GIT = 'The title, rationale and statement are written to the repository with the proposal: every member can read them.'

/** The proposal panel, in the right slot (spec 3.14; §14.2 "the tray's foot step with title + rationale fields"):
 *  opened by the tray's Propose…, closed by Escape or Close, which returns focus to the button. It is `--w-panel-form`
 *  wide, so its field rows keep their two columns (E-55). A refused Propose stays an alert: the step is the tray's
 *  foot, and a failed apply is one of the two things §13 lets alert (E-58). */
export default function ProposePanel() {
  const right = usePanel('right')
  if (right.openId !== 'propose') return null
  return <Form onClose={right.close} />
}

function Form({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { view } = useChanges()
  const emptied = view !== null && view.ops.length === 0
  // What the change was when the panel opened: Propose clears it on the server, and the form outlives it.
  const [seen] = useState(() => ({
    classes: view?.classes ?? [], sentence: view?.rule.sentence ?? '', title: summarize(view?.ops ?? []),
  }))
  const weighty = seen.classes.some(c => WEIGHTY.includes(c))
  const [f, setF] = useState({ title: seen.title, rationale: '', recorded: false, decision: '', why: '', scope: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [openedId, setOpenedId] = useState<string | null>(null)
  const statementOn = weighty || f.recorded
  const ctx: ProposeForm = { title: f.title, rationale: f.rationale, needsRationale: weighty, statementOn, decision: f.decision, why: f.why, reason }
  const m = useMachine(propose, { guards: proposeGuards, context: ctx })

  const edit = (field: keyof typeof f, key = field as string) => (value: string | boolean) => {
    setF(prev => ({ ...prev, [field]: value }))
    setErrors(prev => { const { [key]: _gone, ...rest } = prev; return rest })
    if (m.can('EDIT')) m.send('EDIT')
  }

  const submit = async () => {
    if (!m.send('SUBMIT')) {
      // The guard's sentence belongs to its field, as a 422's does; focus goes to the first one.
      const miss = firstMissing(ctx)
      if (miss) {
        setErrors({ [miss.field]: miss.message })
        document.getElementById(`pp-${miss.field.replace('.', '-')}`)?.focus()
      }
      return
    }
    const input: ProposeInput = {
      title: f.title.trim(),
      ...(f.rationale.trim() !== '' ? { rationale: f.rationale.trim() } : {}),
      ...(statementOn ? { statement: { title: f.title.trim(), decision: f.decision.trim(), why: f.why.trim(), ...(f.scope.trim() !== '' ? { scope: f.scope.trim() } : {}) } } : {}),
    }
    try {
      const made = await api.propose(input)
      setOpenedId(String(made.id))
      m.send('OPENED')
      for (const queryKey of [['changes'], ['proposals'], ['resources'], ['graph'], ['generated']]) void qc.invalidateQueries({ queryKey })
    } catch (err) {
      const fields: Record<string, string> = {}
      const loose: string[] = []
      if (err instanceof ApiError && err.status === 422) {
        for (const e of err.errors) { const key = formField(e.field); if (key && !(key in fields)) fields[key] = e.message; else loose.push(e.message) }
      }
      setErrors(fields)
      setReason(err instanceof ApiError && err.status === 422
        ? (loose[0] ?? 'Not proposed: the marked fields say why.')
        : err instanceof Error ? err.message : String(err))
      m.send('REFUSE')
    }
  }

  // The input links its own error (design/inputs: `<id>-err`, aria-invalid), so a 422's field sentence sits under it.
  const common = (key: string) => ({ id: `pp-${key.replace('.', '-')}` })
  const sending = m.state === 'submitting'
  const news = useRef<HTMLParagraphElement>(null)
  const done = m.state === 'opened'
  // A change discarded or applied elsewhere leaves this form holding a snapshot of nothing.
  useEffect(() => { if (emptied && !done && !sending) onClose() }, [emptied, done, sending, onClose])
  useEffect(() => { if (done) news.current?.focus() }, [done])
  const said = m.state === 'refused' ? reason : null

  if (m.state === 'opened' && openedId) {
    return (
      <aside className="panel-right panel-form" aria-label="Propose">
        <header className="sect-h"><h2 className="sect-t">Proposal opened</h2><span className="sect-end"><Button onClick={() => { onClose(); document.getElementById('main')?.focus() }}>Close</Button></span></header>
        {/* The button that sent the form is gone: focus lands on the news, which is also announced. */}
        <p role="status" tabIndex={-1} ref={news}>Opened <Link href={`/governance/proposals/${encodeURIComponent(openedId)}`}>{openedId}</Link>. Your staged change moved into it.</p>
      </aside>
    )
  }
  // ⌘↵ (Ctrl+↵) anywhere in the form proposes, as the comment composer's ⌘↵ comments (§9.8): a keyboard path that does
  // not Tab past every field to the button (C11's keyboard walk)
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey && !sending) { e.preventDefault(); void submit() }
  }
  return (
    <aside className="panel-right panel-form" aria-label="Propose" onKeyDown={onKeyDown}>
      <header className="sect-h"><h2 className="sect-t">Propose</h2><span className="sect-end"><Button onClick={onClose}>Close</Button></span></header>
      <FieldTable label="Proposal">
        <FieldRow label="Title" htmlFor="pp-title">
          <TextInput common={common('title')} prose={false} readOnly={false} value={f.title} error={errors.title} onChange={v => edit('title')(String(v ?? ''))} />
        </FieldRow>
        <FieldRow label="Rationale" htmlFor="pp-rationale">
          <TextInput common={{ ...common('rationale'), ...(weighty ? { 'aria-required': true } : {}) }} prose readOnly={false} value={f.rationale} error={errors.rationale} onChange={v => edit('rationale')(String(v ?? ''))} />
        </FieldRow>
        <FieldRow label="Statement">
          <Choice type="checkbox" label="Record as a decision" checked={statementOn} disabled={weighty} onChange={() => edit('recorded')(!f.recorded)} />
          {weighty && <span className="meta"> Required for governance and identity changes.</span>}
        </FieldRow>
        {statementOn && <>
          <FieldRow label="Decision" htmlFor="pp-statement-decision">
            <TextInput common={common('statement.decision')} prose readOnly={false} value={f.decision} error={errors['statement.decision']} onChange={v => edit('decision', 'statement.decision')(String(v ?? ''))} />
          </FieldRow>
          <FieldRow label="Why" htmlFor="pp-statement-why">
            <TextInput common={common('statement.why')} prose readOnly={false} value={f.why} error={errors['statement.why']} onChange={v => edit('why', 'statement.why')(String(v ?? ''))} />
          </FieldRow>
          <FieldRow label="Scope" htmlFor="pp-statement-scope">
            <TextInput common={common('statement.scope')} prose={false} readOnly={false} value={f.scope} error={errors['statement.scope']} onChange={v => edit('scope', 'statement.scope')(String(v ?? ''))} />
          </FieldRow>
        </>}
      </FieldTable>
      <p className="pp-git meta">{WRITTEN_TO_GIT}</p>
      <h3 className="sect-t">Decided by</h3>
      <p>{seen.sentence}</p>
      {said && <p className="err" role="alert">{said}</p>}
      <p><Button primary disabled={sending} onClick={() => void submit()}>Propose</Button></p>
    </aside>
  )
}
