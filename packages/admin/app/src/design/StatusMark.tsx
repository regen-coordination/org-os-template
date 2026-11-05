import type { Mark } from '../machines.ts'

export type { Mark }

/** Each mark's word (spec §6.1, ruling L4-R12): what the shape means, said in sentence case — never colour
 *  alone. A caller with a more specific word ("Executed", "Withdrawn", "Reading…") passes it as `label`. */
export const MARK_WORD: Record<Mark, string> = {
  needs: 'Needs you', staged: 'Staged', stale: 'Changed since staged', draft: 'Not yet deployed', open: 'Open',
  ok: 'Up to date', done: 'Decided', running: 'Running', failed: 'Couldn’t read', closed: 'Closed', aged: 'Old read',
  selected: 'Selected', faint: 'not in this list',
}

/** A mark (§6.1, §7.8): the mark's 8px shape, hidden from a screen reader, then its word in the mark's colour
 *  (css/states.css). A running mark's shape is the reading ring itself. */
export function StatusMark({ mark, label }: { mark: Mark; label?: string }) {
  return (
    <span className={`smark smark-${mark}`}>
      <span className={mark === 'running' ? 'smark-shape spin' : 'smark-shape'} aria-hidden="true" />
      <span className="smark-word">{label ?? MARK_WORD[mark]}</span>
    </span>
  )
}
