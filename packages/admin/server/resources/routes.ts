import { existsSync } from 'node:fs'
import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { boardView, isBoard } from './graph.ts'
import type { ResourceStore } from './index.ts'
import { readLayout, writeLayout, clearLayout, layoutFile, validPositions } from '../state.ts'
import { knownActorOf, viewerOf } from '../request.ts'
import { actorTrailer } from '../actor.ts'
import { actorKey } from '../hosted/writes.ts'
import { attentionLevel, gateGraph, Levels } from '../visibility/gate.ts'
import { readConfig } from '../visibility/config.ts'

/** `hosted`: the server's mode, which says who its own attention is for (visibility/gate.ts `attentionLevel`). */
export function mountResources(app: Hono, store: ResourceStore, repo: string, opts: { hosted?: boolean } = {}): void {
  /** The graph as the one who asks may see it (L5 spec §9.5): never a node, a count or an edge for what they may not. */
  const seen = async (c: Context) => gateGraph(viewerOf(c), await store.graph(), new Levels(repo, readConfig(repo), attentionLevel(opts.hosted)))

  app.get('/api/resources', async c => {
    const { board, kind } = c.req.query()
    if (board !== undefined && !isBoard(board)) {
      throw new HttpError(400, `board must be "organization" or "systems", not "${board}".`)
    }
    const graph = await seen(c)
    return c.json(graph.nodes.filter(n => (!board || n.board === board) && (!kind || n.kind === kind)))
  })

  // `{.+}` lets an id hold a `/` even if a client sends it unencoded.
  app.get('/api/resources/:id{.+}', async c => {
    const id = c.req.param('id')
    const graph = await seen(c)
    const resource = graph.nodes.find(n => n.id === id)
    if (!resource) throw new HttpError(404, `No resource "${id}". GET /api/resources lists them.`)
    const edges = graph.edges.filter(e => e.from === id || e.to === id)
    const near = new Set(edges.flatMap(e => [e.from, e.to]))
    near.delete(id)
    return c.json({ resource, edges, neighbours: graph.nodes.filter(n => near.has(n.id)) })
  })

  app.get('/api/graph/:board', async c => {
    const board = c.req.param('board')
    if (!isBoard(board)) throw new HttpError(404, `No board "${board}": the boards are organization and systems.`)
    return c.json(boardView(await seen(c), board))
  })

  const boardParam = (board: string) => {
    if (!isBoard(board)) throw new HttpError(404, `No board "${board}": the boards are organization and systems.`)
    return board
  }
  /** Hosted, the key of the asking member's own layout (L9 §5.4, Q-L9-4); locally, none: one shared layout, as before. */
  const ownKey = (c: Context): string | undefined => opts.hosted ? actorKey(actorTrailer(knownActorOf(c))) : undefined
  // No place of a card the one who asks may not see: the public is given only the places of the cards it sees; a member,
  // every place but those of cards hidden from them (a place kept for a card that has gone is still theirs to move).
  // Hosted, a member reads their own layout when they have one, else the shared one; the public, the shared one.
  app.get('/api/layout/:board', async c => {
    const board = boardParam(c.req.param('board'))
    const key = viewerOf(c).kind === 'public' ? undefined : ownKey(c)
    const positions = key !== undefined && existsSync(layoutFile(repo, board, key)) ? readLayout(repo, board, key) : readLayout(repo, board)
    const here = new Set((await seen(c)).nodes.map(n => n.id))
    const all = viewerOf(c).kind === 'public' ? null : new Set((await store.graph()).nodes.map(n => n.id))
    return c.json(Object.fromEntries(Object.entries(positions).filter(([id]) => here.has(id) || (all !== null && !all.has(id)))))
  })
  app.put('/api/layout/:board', async c => {
    const board = boardParam(c.req.param('board'))
    let body: unknown
    try { body = await c.req.json() } catch { body = undefined }
    const valid = validPositions(body)
    if (typeof valid === 'string') throw new HttpError(400, valid)
    // Hosted, the member's own file, holding only the places of cards they see.
    const key = ownKey(c)
    let positions = valid
    if (key !== undefined) {
      const here = new Set((await seen(c)).nodes.map(n => n.id))
      positions = Object.fromEntries(Object.entries(valid).filter(([id]) => here.has(id)))
    }
    writeLayout(repo, board, positions, key)
    return c.json(positions)
  })
  // Hosted, only the member's own layout is cleared; the shared one stays.
  app.delete('/api/layout/:board', c => {
    clearLayout(repo, boardParam(c.req.param('board')), ownKey(c))
    return c.json({ cleared: true })
  })
}
