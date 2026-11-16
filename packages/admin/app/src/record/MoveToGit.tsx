// DAO-OS L6 Task 20 (§12, §15): a private record of a git collection, or a private page, moved into the repository from
// its visibility control. The menu offers "Move into the repository…" after the levels; it asks who may read it there
// (the levels the server would accept: members, and public where nothing above it is stricter) and stages the move alone
// (R-L6-T11-1): `{ op: 'update', record, set: { visibility } }`, which the server stages as `move-to-git`, a publication
// (applied where the publication rule lets the member decide alone, proposed otherwise). While a move is in flight the
// menu names the proposal that holds it, with its state, instead.
import { useId, useState } from 'react'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { Choice } from '../design/inputs/Choice.tsx'
import type { MenuEntry } from '../design/Menu.tsx'
import type { InFlight } from './levelInFlight.ts'

/** The menu item (§15). */
export const MOVE_INTO_REPO = 'Move into the repository…'
/** The dialog's question and what staging it does. */
export const MOVE_TITLE = 'Move into the repository?'
export const MOVE_SAYS = 'It is staged in your changes as a publication, and moves as it is when it is applied or decided. ' +
  'From then on everyone at the level you choose can read it, in the repository and in its history.'
export const MOVE_CONFIRM = 'Stage the move'
/** Who may read it in the repository, as the dialog offers the levels. */
const WORDS: Record<'members' | 'public', { label: string; hint: string }> = {
  members: { label: 'Members', hint: 'Every member of the organization' },
  public: { label: 'Public', hint: 'Anyone, members or not' },
}
/** Walk W4, D3: "the DAO" only where a Hats tree is set (the visibility answer names its hats). */
const MEMBERS_OF_THE_DAO = 'Every member of the DAO'

/** The menu's entries for a move: the item that opens the dialog, while no move is in flight; else the open proposal that
 *  holds it, linked, with its state ("Proposal p-9 · Open"). Nothing while only staged: the tray holds it. */
export function moveEntries(o: { levels: readonly ('members' | 'public')[]; flight: InFlight | null; onMove(): void }): MenuEntry[] {
  const out: MenuEntry[] = []
  if (o.flight?.proposal) out.push(proposalEntry(o.flight.proposal))
  else if (!o.flight?.move && o.levels.length > 0) out.push({ type: 'item', label: MOVE_INTO_REPO, icon: 'branch', onSelect: o.onMove })
  return out
}

/** The open proposal holding a level in flight, as a menu link: its id and its state in words. */
export function proposalEntry(p: { id: string; derived: string }): MenuEntry {
  const word = p.derived.charAt(0).toUpperCase() + p.derived.slice(1)
  return { type: 'link', label: `Proposal ${p.id} · ${word}`, href: `/governance/proposals/${encodeURIComponent(p.id)}`, icon: 'branch' }
}

/** The dialog: who may read it in the repository, then Stage the move (Cancel stages nothing). */
export function MoveDialog({ levels, dao = false, onCancel, onMove }: { levels: readonly ('members' | 'public')[]; dao?: boolean; onCancel(): void; onMove(level: 'members' | 'public'): void }) {
  const [level, setLevel] = useState<'members' | 'public'>(levels[0]!)
  const name = useId()
  return (
    <ConfirmDialog title={MOVE_TITLE} confirm={MOVE_CONFIRM} onCancel={onCancel} onConfirm={() => onMove(level)}
      body={(
        <>
          <p>{MOVE_SAYS}</p>
          <div className="form-rows" role="radiogroup" aria-label="Who can read it there">
            {levels.map(l => <Choice key={l} type="card" name={name} checked={level === l} label={WORDS[l].label} hint={l === 'members' && dao ? MEMBERS_OF_THE_DAO : WORDS[l].hint} onChange={() => setLevel(l)} />)}
          </div>
        </>
      )} />
  )
}
