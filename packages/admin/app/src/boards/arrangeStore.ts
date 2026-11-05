// packages/admin/app/src/boards/arrangeStore.ts
import { useSyncExternalStore } from 'react'
import type { BoardDef, BoardRead } from '../api.ts'

/** The board being arranged, held outside React so the board (main column) and its block settings (the
 *  right panel, a sibling in the shell) edit one draft. Kept until Done or Cancel: a file change under it
 *  does not replace it (the tray's stale op says so after Done). */
export interface Draft { base: BoardRead; board: BoardDef; picked: string | null }
let draft: Draft | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

export const arrangeStore = {
  get: (): Draft | null => draft,
  start(base: BoardRead, board: BoardDef) { draft = { base, board, picked: null }; emit() },
  update(f: (b: BoardDef) => BoardDef) { if (draft) { draft = { ...draft, board: f(draft.board) }; emit() } },
  pick(id: string | null) { if (draft) { draft = { ...draft, picked: id }; emit() } },
  end() { draft = null; emit() },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
}

export const useArrangeDraft = (): Draft | null => useSyncExternalStore(arrangeStore.subscribe, arrangeStore.get, arrangeStore.get)
