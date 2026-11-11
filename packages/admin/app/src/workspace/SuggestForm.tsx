// Suggest an edit (DAO-OS L6 Task 16b, ruling R-L6-SUGGEST): the page's editing session proposed instead of saved, through
// the proposal machinery the tray's Propose uses. The form asks for the proposal's title (from the page's title) and a short
// note (its rationale), and says, as the Propose form does, that both are written to the repository. Offered by PagePage
// only where the effective rule makes the page's edits need approval, on a page in the repository.
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api.ts'
import { Button } from '../design/Button.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { TextInput } from '../design/inputs/index.ts'
import { Note } from '../design/Note.tsx'
import { announce } from '../parts/live.tsx'

/** The proposal's title the form starts from (server/workspace/sessions.ts `suggestTitle`; the server module cannot load
 *  here). */
export const suggestTitle = (pageTitle: string): string => `Suggested edit to ${pageTitle}`
/** What the form says under its fields: the Propose form's sentence (WRITTEN_TO_GIT), for a title and a note. */
export const SUGGEST_TO_GIT = 'The title and note are written to the repository with the proposal: every member can read them.'
/** What the page says once the suggestion is a proposal. */
export const SUGGESTED = (id: string): string => `Suggested as proposal ${id}. The page changes when it is approved.`
const NEEDS_TITLE = 'A suggestion needs a title.'
/** Said while the suggestion is sent; the page's editor is read-only meanwhile. */
export const SENDING = 'Sending the suggestion… The page cannot be edited until it is answered.'

export function SuggestForm({ pageTitle, onSuggest, onClose }: {
  pageTitle: string
  /** Sends the suggestion; resolves once it is a proposal, or throws the server's refusal. */
  onSuggest(proposal: { title: string; rationale?: string }): Promise<void>
  onClose(): void
}) {
  const [title, setTitle] = useState(() => suggestTitle(pageTitle))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLDivElement>(null)
  useEffect(() => { first.current?.querySelector<HTMLElement>('input, textarea')?.focus() }, [])

  const submit = async () => {
    if (title.trim() === '') { setError(NEEDS_TITLE); return }
    setBusy(true)
    setError(null)
    announce(SENDING) // said once through the page's one polite region (C11 I-2), and shown below the form
    try {
      await onSuggest({ title: title.trim(), ...(note.trim() !== '' ? { rationale: note.trim() } : {}) })
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <section className="pg-suggest" aria-label="Suggest this edit" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>
      <p className="pg-suggest-t">Your edit becomes a proposal. The page changes when it is approved under the org’s rules.</p>
      <div ref={first}>
        <FieldTable label="Suggestion">
          <FieldRow label="Title" htmlFor="sg-title">
            <TextInput common={{ id: 'sg-title' }} prose={false} readOnly={false} value={title} onChange={v => { setTitle(String(v ?? '')); setError(null) }} />
          </FieldRow>
          <FieldRow label="Note" htmlFor="sg-note">
            <TextInput common={{ id: 'sg-note' }} prose readOnly={false} value={note} onChange={v => setNote(String(v ?? ''))} />
          </FieldRow>
        </FieldTable>
      </div>
      <p className="meta">{SUGGEST_TO_GIT}</p>
      {busy && <p className="meta">{SENDING}</p>}
      {error && <Note state="error">{error}</Note>}
      <p className="pg-suggest-a">
        <Button small primary busy={busy ? 'Suggesting…' : undefined} onClick={() => void submit()}>Suggest</Button>
        <Button small variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
      </p>
    </section>
  )
}
