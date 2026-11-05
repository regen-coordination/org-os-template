import { useEffect, useRef } from 'react'
import { Button } from '../../design/Button.tsx'
import { Icon } from '../../design/Icon.tsx'
import { Spinner } from '../../design/Spinner.tsx'
import { announce } from '../../parts/live.tsx'

/** Where a workspace write stands (§10.1, §10.6): saved directly, saving, staged for approval (the tree was raised
 *  to needs-approval, so the save went to the tray), someone saved a newer version, or offline. */
export type Save = 'direct' | 'saving' | 'staged' | 'conflict' | 'offline' | 'refused' | 'approval'

/** Each state's words (§10.1). */
export const SAVE_WORDS: Record<Save, string> = {
  direct: 'Saved · direct',
  saving: 'Saving…',
  staged: 'Staged · needs approval',
  conflict: 'Someone saved a newer version',
  offline: 'Offline · kept on this device',
  // DAO-OS L6 Task 16 (ruling R-16a): the server refused the save in words; the text stays in the editor, unsaved.
  refused: 'Not saved',
  // DAO-OS L6 Task 16b (R-L6-SUGGEST): the page's tree needs approval and nothing is staged yet: no edit saves directly.
  approval: 'Edits need approval',
}

/** The state's glyph, hidden from a screen reader (the words say it): a faint check, the reading ring, the moss
 *  staged mark, the clay alert. */
function Glyph({ state }: { state: Save }) {
  switch (state) {
    case 'direct': return <Icon name="check" size="xs" />
    case 'saving': return <Spinner />
    case 'staged': case 'approval': return <span className="smark smark-staged" aria-hidden="true"><span className="smark-shape" /></span>
    default: return <Icon name="alert" size="xs" />
  }
}

/** The save state (§10.1), 12, glyph and words: "Saved · direct" (check, faint) · "Saving…" (the ring) · "Staged ·
 *  needs approval" (moss) · "Someone saved a newer version" (clay, with Compare — 0.6's conflict path) · "Offline ·
 *  kept on this device" (clay). Only a workspace write has one: a conversation shows none (§10.6). A change of
 *  state is said once through the page's one polite region; the first draw says nothing. */
export function SaveState({ state, onCompare, reason }: { state: Save; onCompare?(): void
  /** L6 (R-16a): why a save was refused, the server's sentence — said with "Not saved" and kept as its description. */
  reason?: string }) {
  const said = useRef(state)
  useEffect(() => {
    if (said.current === state) return
    said.current = state
    announce(state === 'refused' && reason ? `${SAVE_WORDS[state]}. ${reason}` : SAVE_WORDS[state])
  }, [state])
  const bad = state === 'conflict' || state === 'offline' || state === 'refused'
  return (
    <span className="save-wrap">
      <span className={`save save-${state}${bad ? ' save-bad' : ''}`} title={state === 'refused' ? reason : undefined}><Glyph state={state} /><span className="save-w">{SAVE_WORDS[state]}</span>
        {state === 'refused' && reason && <span className="sr-only">: {reason}</span>}</span>
      {state === 'conflict' && onCompare && <Button small onClick={onCompare}>Compare</Button>}
    </span>
  )
}
