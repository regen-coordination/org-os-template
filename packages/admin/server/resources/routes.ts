import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { boardView, isBoard } from './graph.ts'
import type { ResourceStore } from './index.ts'
import { readLayout, writeLayout, clearLayout, validPositions } from '../state.ts'
import { viewerOf } from '../request.ts'
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
  // No place of a card the one who asks may not see: the public is given only the places of the cards it sees; a member,
  // every place but those of cards hidden from them (a place kept for a card that has gone is still theirs to move).
  app.get('/api/layout/:board', async c => {
    const positions = readLayout(repo, boardParam(c.req.param('board')))
    const here = new Set((await seen(c)).nodes.map(n => n.id))
    const all = viewerOf(c).kind === 'public' ? null : new Set((await store.graph()).nodes.map(n => n.id))
    return c.json(Object.fromEntries(Object.entries(positions).filter(([id]) => here.has(id) || (all !== null && !all.has(id)))))
  })
  app.put('/api/layout/:board', async c => {
    const board = boardParam(c.req.param('board'))
    let body: unknown
    try { body = await c.req.json() } catch { body = undefined }
    const positions = validPositions(body)
    if (typeof positions === 'string') throw new HttpError(400, positions)
    writeLayout(repo, board, positions)
    return c.json(positions)
  })
  app.delete('/api/layout/:board', c => {
    clearLayout(repo, boardParam(c.req.param('board')))
    return c.json({ cleared: true })
  })
}
