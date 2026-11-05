import type { Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { viewerOf } from '../request.ts'
import { boardLevel, gateItems, Levels } from '../visibility/gate.ts'
import { boardsOf, builtinBoards } from './read.ts'
import type { BoardRead } from './types.ts'

/** Boards are read here and written only through /api/changes/ops (boards:<id>): there is no board
 *  write route (contract "P4c produces"). Each read is gated (L5 spec §9.5): a board's level is its audience. */
export function mountBoards(app: Hono, repo: string): void {
  const visible = (c: Parameters<typeof viewerOf>[0], boards: BoardRead[]) => {
    const levels = new Levels(repo)
    return gateItems(viewerOf(c), boards, b => boardLevel(levels, b))
  }
  app.get('/api/boards', c => c.json(visible(c, boardsOf(repo))))
  app.get('/api/boards/:id', c => {
    const id = c.req.param('id')
    const board = visible(c, boardsOf(repo)).find(b => b.id === id)
    if (!board) throw new HttpError(404, `No board "${id}". GET /api/boards lists the boards.`)
    return c.json(board)
  })
  // A built-in as it ships, overridden or not: what returns when a change deletes the instance's board of
  // its id, so the board page can preview it (final review M-3).
  app.get('/api/boards/:id/builtin', c => {
    const id = c.req.param('id')
    const builtin = builtinBoards().find(b => b.id === id)
    const board = builtin ? visible(c, [{ ...builtin, origin: 'builtin', overrides: false }])[0] : undefined
    if (!board) throw new HttpError(404, `No built-in board "${id}". GET /api/boards lists the boards.`)
    return c.json(board)
  })
}
