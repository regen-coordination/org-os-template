import { useEffect, useRef, useState } from 'react'
import { ApiError, type StageError, type StageOp } from '../api.ts'
import { same, unchanged, type Value } from './fields.ts'
import { enabled } from '../../../lib/machines/run.mjs'
import { useMachine } from '../machines.ts'
import { editor, editorGuards, settleEditor, type EditorFacts } from '../machines/editor.ts'

const withoutProto = (v: Value): Value => Object.fromEntries(Object.entries(v).filter(([k]) => k !== '__proto__'))

/** A create carries what was filled in: a field typed and then cleared is not sent as null. */
const withoutEmpty = (v: Value): Value => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined))

/** A staging refusal as the errors the page shows (contract, "Refusals"): a 422's entries for this
 *  record go under their fields (one with field '' sits above them); a 403 shows its `reason`; any
 *  other refusal, such as a 409 with no code, shows the server's sentence as written (C7). */
export function refusalErrors(err: unknown, record: string): StageError[] {
  if (err instanceof ApiError && err.errors.length > 0) {
    const mine = err.errors.filter(e => !e.record || e.record === record)
    return mine.length > 0 ? mine : err.errors
  }
  if (err instanceof ApiError && err.status === 403 && typeof err.body.reason === 'string') return [{ field: '', message: err.body.reason }]
  return [{ field: '', message: err instanceof Error ? err.message : String(err) }]
}

/** The fields whose value differs between what editing started from and the draft. A field the
 *  draft no longer holds is staged as null: the contract has no unset op. A field the base did not
 *  hold and the draft leaves empty is no change (`unchanged`). */
export function diffSet(base: Value, draft: Value): Value {
  const set: Value = {}
  for (const k of new Set([...Object.keys(base), ...Object.keys(draft)])) {
    const before = Object.hasOwn(base, k) ? base[k] : undefined
    if (k !== '__proto__' && !unchanged(before, draft[k])) set[k] = draft[k] === undefined ? null : draft[k]
  }
  return set
}

export interface Editor {
  editing: boolean
  draft: Value
  errors: StageError[]            // the server's stage-time refusals
  problems: Record<string, string> // the client's own (a date that is not one, YAML that does not parse)
  busy: boolean
  stale: boolean                  // the entry moved under the open editor
  gone: boolean                   // the entry left the file
  differing: string[]
  heldProto: boolean
  canSave: boolean
  /** Bumped whenever the draft is set from outside the inputs (start, Take theirs): an editor body
   *  keyed on it remounts, so inputs that hold their own text (YAML, source, dates) show the new draft. */
  epoch: number
  start(): void
  cancel(): void
  set(key: string, value: unknown): void
  problem(key: string, problem: string | null): void
  replaceDraft(value: Value): void
  keepMine(): void
  takeTheirs(): void
  /** Stages the edits; resolves to the record's id, or null when nothing was staged. */
  save(): Promise<string | null>
}

/** Editing one record. `latest` is the record as it reads now, staged ops included; editing starts
 *  from it, and a later change to it while editing shows as the stale card (the stock-take's D8). */
export function useEditor(o: { registry: string | null; entityId: string; latest: Value | null; creating: boolean; stage: (ops: StageOp[]) => Promise<unknown> }): Editor {
  const [draft, setDraft] = useState<Value>(() => (o.creating ? { id: '' } : {}))
  const [base, setBase] = useState<Value | null>(null)
  const [heldProto, setHeldProto] = useState(false)
  const [whole, setWhole] = useState(false)
  const [errors, setErrors] = useState<StageError[]>([])
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [epoch, setEpoch] = useState(0)

  const problem = (key: string, p: string | null) => setProblems(ps => {
    const next = { ...ps }
    if (p) next[key] = p
    else delete next[key]
    return next
  })
  // Only viewing, editing and saving are stored; the rest is what the record says now (ruling 4).
  // The facts are the machine's context, so a guard asked through m.can() reads them too.
  // They are computed from the machine's own state, so the context is a ref filled just below.
  const factsRef = useRef<EditorFacts>({ gone: false, stale: false, blocked: false })
  const [context] = useState<EditorFacts>(() => ({
    get gone() { return factsRef.current.gone }, get stale() { return factsRef.current.stale }, get blocked() { return factsRef.current.blocked },
  }))
  const m = useMachine(editor, { guards: editorGuards, context, initial: o.creating ? 'editing' : 'viewing' })
  const editing = m.state !== 'viewing'
  const gone = editing && !o.creating && o.latest === null
  const stale = editing && !o.creating && o.latest !== null && base !== null && !same(o.latest, base)
  const differing = stale
    ? [...new Set([...Object.keys(o.latest!), ...Object.keys(draft)])].filter(k => k !== '__proto__' && !same(o.latest![k], draft[k]))
    : []
  const blocked = Object.keys(problems).length > 0 || errors.some(e => e.field !== '')
  const facts: EditorFacts = { gone, stale, blocked }
  factsRef.current = facts
  const shown = settleEditor(m.state, facts)
  const busy = shown === 'saving'
  const canSave = enabled(editor, editorGuards, shown, facts).has('SAVE')

  return {
    editing, draft, errors, problems, busy, stale, gone, differing, heldProto, canSave, epoch,
    start() {
      if (!o.latest) return
      setBase(o.latest)
      setDraft(withoutProto(o.latest))
      setHeldProto(Object.hasOwn(o.latest, '__proto__'))
      setWhole(false); setErrors([]); setProblems({}); m.send('START'); setEpoch(n => n + 1)
    },
    cancel() { m.send('CANCEL'); setErrors([]); setProblems({}); setWhole(false) },
    set(key, value) {
      setDraft(d => ({ ...d, [key]: value }))
      setErrors(es => es.filter(e => e.field !== key && !e.field.startsWith(`${key}.`)))
      problem(key, null)
    },
    problem,
    // The whole entry is restaged and the server validates it again, so what was said about single
    // fields no longer holds; a refusal about the entry as a whole (field '') stays.
    replaceDraft(value) {
      setDraft(withoutProto(value)); setWhole(true)
      setProblems(ps => { const kept: Record<string, string> = {}; if (ps.source) kept.source = ps.source; return kept })
      setErrors(es => es.filter(e => e.field === ''))
    },
    keepMine() { if (o.latest) setBase(o.latest) },
    takeTheirs() {
      if (!o.latest) return
      // Their entry replaces the draft, so what the server said about the draft no longer holds.
      setDraft(withoutProto(o.latest)); setBase(o.latest); setWhole(false); setErrors([]); setProblems({}); setEpoch(n => n + 1)
    },
    async save() {
      if (!o.registry || !canSave) return null
      let ops: StageOp[]
      let savedId = o.entityId
      if (o.creating) {
        const id = String(draft.id ?? '').trim()
        if (!id) { problem('id', 'a new record needs an id'); return null }
        // `#3` names the third entry of a file that has no id (contract), so an id may not look like one (C14).
        if (id.startsWith('#')) { problem('id', 'ids beginning with # are read as positions; choose another'); return null }
        savedId = id
        ops = [{ op: 'create', record: `${o.registry}:${id}`, value: { ...withoutEmpty(draft), id } }]
      } else if (whole || heldProto) {
        ops = [{ op: 'replace', record: `${o.registry}:${o.entityId}`, value: draft }]
      } else {
        const set = diffSet(base ?? {}, draft)
        if (Object.keys(set).length === 0) { m.send('CLOSE'); return savedId }
        ops = [{ op: 'update', record: `${o.registry}:${o.entityId}`, set }]
      }
      if (!m.send('SAVE')) return null // a second save in the same tick
      setErrors([])
      try {
        await o.stage(ops)
        m.send('STAGED'); setWhole(false)
        return savedId
      } catch (err) {
        // A cancel during the save has already closed the editor: REFUSED is then refused by the
        // machine and the errors stay unseen, as before.
        if (m.send('REFUSED')) setErrors(refusalErrors(err, ops[0]!.record))
        return null
      }
    },
  }
}

/** Typing in a field must never trigger a page key (Review Focus 1). */
export const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable === true || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

/** `e` starts editing; ⌘S saves; Esc cancels. An event someone already handled (⌘K's or the
 *  inspector's Escape) is left alone, and the editor marks each key it acts on as handled
 *  (`preventDefault`), so no other Escape listener, the inspector's among them, acts on it too. */
export function useEditKeys(ed: Editor, o: { canStart: boolean; onSave: () => void; onCancel: () => void }): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (!ed.editing) {
        if (o.canStart && e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) { e.preventDefault(); ed.start() }
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (ed.canSave) o.onSave() }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); o.onCancel() } // the inspector's bubble listener never sees it
    }
    // On the document in the capture phase: after ⌘K's (window, capture, so an open palette takes the
    // Escape first) and before the inspector's (window, bubble).
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })
}
