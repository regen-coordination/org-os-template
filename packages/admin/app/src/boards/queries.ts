import { useQuery } from '@tanstack/react-query'
import { api, type BoardDef, type BoardRead, type ChangeView } from '../api.ts'
import { useChanges } from '../changes/useChanges.ts'

export const useBoards = () => useQuery({ queryKey: ['boards'], queryFn: api.boards })

const LAYOUTS = ['grid', 'canvas', 'flow']
/** A staged value as a board, with the defaults a hand-written one may leave out (as the server reads it). */
function asDef(v: Record<string, unknown>, id: string): BoardDef {
  return {
    id,
    name: typeof v.name === 'string' && v.name !== '' ? v.name : id,
    audience: typeof v.audience === 'string' && v.audience !== '' ? v.audience : 'members',
    layout: (LAYOUTS.includes(v.layout as string) ? v.layout : 'flow') as BoardDef['layout'],
    blocks: Array.isArray(v.blocks) ? (v.blocks as BoardDef['blocks']) : [],
  }
}

const stagedOps = (id: string, change: ChangeView | null) => change?.ops.filter(o => o.record === `boards:${id}`) ?? []
/** Whether your change ends by deleting an instance board that overrides a built-in: the built-in returns. */
const deletesOverride = (id: string, read: BoardRead | undefined, change: ChangeView | null) =>
  read?.overrides === true && stagedOps(id, change).at(-1)?.op === 'delete'

/** The board as you will see it after Apply: the staged ops on boards:<id> folded in order onto the file
 *  (Review Focus 5), so a second edit builds on the first and never forks the version on file. A staged
 *  copy of a built-in shows as the instance's, overriding it; a staged delete of that copy shows the
 *  built-in it brings back (`builtin`, when it has arrived), with `restores` (final review M-3). */
export function stagedBoard(id: string, read: BoardRead | undefined, change: ChangeView | null, builtin?: BoardRead):
  { board: BoardRead | null; staged: boolean; restores?: true } {
  const ops = stagedOps(id, change)
  if (ops.length === 0) return { board: read ?? null, staged: false }
  if (builtin && deletesOverride(id, read, change)) return { board: builtin, staged: true, restores: true }
  const overrides = read ? read.origin === 'builtin' || read.overrides : false
  let board: BoardRead | null = read ?? null
  for (const op of ops) {
    if (op.op === 'delete') board = null
    else if (op.op === 'update') board = board ? { ...board, ...asDef({ ...board, ...op.set }, id), origin: 'instance', overrides: board.overrides } : null
    else board = { ...asDef(op.value, id), origin: 'instance', overrides }
  }
  return { board, staged: true }
}

/** One board, staged ops included. Pending while the list is; a board that is in neither the list nor the
 *  change is null once the list has arrived. */
export function useBoard(id: string): { board: BoardRead | null; staged: boolean; restores: boolean; isPending: boolean; error: Error | null } {
  const boards = useBoards()
  const { view } = useChanges()
  const read = boards.data?.find(b => b.id === id)
  const restoring = deletesOverride(id, read, view)
  const builtin = useQuery({ queryKey: ['boards', id, 'builtin'], queryFn: () => api.builtinBoard(id), enabled: restoring })
  const { board, staged, restores } = stagedBoard(id, read, view, builtin.data)
  return { board, staged, restores: restores === true, isPending: (boards.isPending && !staged) || (restoring && builtin.isPending), error: boards.error }
}
