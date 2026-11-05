import { useEffect, type ReactNode } from 'react'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { Icon } from '../design/Icon.tsx'
import { Mark } from '../design/Mark.tsx'
import { Note } from '../design/Note.tsx'
import { announce } from './live.tsx'

/** What the last fetch says, as the tray's foot says its rule (§14.1): one line on --sunken, the sync glyph, the
 *  sentence, and the actions at its end (Sync, Share). */
export function SyncLine({ sentence, children }: { sentence: string; children?: ReactNode }) {
  return (
    <div className="sync-foot">
      <span className="sync-line"><Icon name="refresh" size="sm" /><span>{sentence}</span></span>
      {children && <span className="sync-acts">{children}</span>}
    </div>
  )
}

/** Sync's confirmation, a modal confirm dialog (§14.1): what the fetch will do (the plan's own words), then Fetch and
 *  sync, or Cancel. Escape cancels; the caller removes it, and focus goes back to Sync. `inline`: drawn open in place,
 *  a /parts specimen. */
export function SyncConfirmation({ summary, onConfirm, onCancel, inline = false }: { summary: string; onConfirm: () => void; onCancel: () => void; inline?: boolean }) {
  return (
    <ConfirmDialog title="Sync" confirm="Fetch and sync" onConfirm={onConfirm} onCancel={onCancel} inline={inline}
      body={<p>{summary.replace(/\.$/, '')}. Then, if the trunk is behind, it is brought in: a fast-forward, or one merge commit. A conflict is refused and nothing is changed.</p>} />
  )
}

/** A refusal, as the sentence the server gave (E-58): an error note (§6.2), said once through the page's one polite
 *  region, not an alert. */
export function Refusal({ children }: { children: string }) {
  useEffect(() => { announce(children) }, [children])
  return <Note state="error" quiet>{children}</Note>
}

/** Sync's and Share's refusal (0.6's name). */
export const SyncRefusal = Refusal

/** After a ratify that changed what `.well-known/` is generated from: a line, no button (regeneration is not an operation here). */
export function GeneratedBehind() {
  return <p className="problem"><Mark level="warn">Generated files are behind the data: run npm run generate:schemas and commit .well-known/.</Mark></p>
}
