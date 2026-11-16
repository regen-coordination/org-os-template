// The workspace's pages (DAO-OS L6 spec §15, `/workspace`): the root pages and, under each, its subpages, each a data row
// that opens the page and ends in who has it open (a 20px presence stack). The server answers only what the viewer may
// see (rule 7); previewing, each row is judged again by its level (`item`), so a page the preview may not see is absent,
// subpages and all. New page (a workspace write) is not drawn while previewing or for a viewer who may not write.
// Walk I9: a row the member may write (GET /api/pages?write) ends in its menu, More for <title>: Move to….
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useLocation } from 'wouter'
import { api, type PageNode } from '../api.ts'
import { useActor } from '../actor.ts'
import { Button } from '../design/Button.tsx'
import { Menu } from '../design/Menu.tsx'
import { Note } from '../design/Note.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { announce } from '../parts/live.tsx'
import { useCanWrite, useViewer } from '../viewAs/ViewAs.tsx'
import { levelItem, pageHref } from './share.ts'
import { MovePageDialog, MOVE_STAGED, WRITABLE_PAGES } from './MovePage.tsx'

/** Deepest indent a subpage row is drawn at; deeper ones stay there. */
const MAX_DEPTH = 3
/** A subpage's indent by its depth (pages.css), named whole so the house's sheet check reads each one (legacy.test.ts). */
const DEPTH_CLASS = ['pg-d1', 'pg-d2', 'pg-d3'] as const
export const NEW_PAGE_STAGED = 'The new page is staged in your change: it needs approval.'

/** The tree in reading order — each page, then its subpages — with each row's depth. A page whose parent is not in the
 *  list (the server marked it `stale`, or the preview hides the parent) is a root. */
export function treeRows(nodes: readonly PageNode[], seen: (n: PageNode) => boolean): { node: PageNode; depth: number }[] {
  const shown = nodes.filter(seen)
  const ids = new Set(shown.map(n => n.id))
  const kids = new Map<string | null, PageNode[]>()
  for (const n of shown) {
    const parent = n.parent !== null && ids.has(n.parent) ? n.parent : null
    kids.set(parent, [...(kids.get(parent) ?? []), n])
  }
  const out: { node: PageNode; depth: number }[] = []
  const done = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const n of kids.get(parent) ?? []) {
      if (done.has(n.id)) continue
      done.add(n.id)
      out.push({ node: n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  // A parent chain that loops on the client's copy (the server breaks loops): its pages are roots, never hidden.
  for (const n of shown) if (!done.has(n.id)) { done.add(n.id); out.push({ node: n, depth: 0 }); walk(n.id, 1) }
  return out
}

/** A subpage's "In <parent>" (walk I15, D1): where its parent shares its title with another page shown, it says where that
 *  parent is ("In Handbook, in Archive"; a root one "at the top"), so two pages of one name are told apart. */
export function parentLine(parent: string, shown: readonly PageNode[], titleOf: ReadonlyMap<string, string>): string {
  const title = titleOf.get(parent) ?? parent
  if (shown.filter(n => (n.title || n.id) === title).length < 2) return `In ${title}`
  const up = shown.find(n => n.id === parent)?.parent ?? null
  return up !== null && titleOf.has(up) ? `In ${title}, in ${titleOf.get(up)}` : `In ${title}, at the top`
}

export function PageTree() {
  const { sees, previewing } = useViewer()
  const canWrite = useCanWrite()
  const { known } = useActor()
  // A member who may write reads the list with their write under each page (walk I9); a preview, the list every reader is given.
  const writes = canWrite && known
  const q = useQuery({ queryKey: writes ? WRITABLE_PAGES : ['pages'], queryFn: writes ? api.writablePages : api.pages, retry: false })
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const [note, setNote] = useState<string | null>(null)
  const [moving, setMoving] = useState<PageNode | null>(null)
  const nodes = q.data ?? []
  const rows = treeRows(nodes, n => sees(levelItem(n.visibility)))
  const targets = rows.map(r => `page:${r.node.id}`)
  const presence = useQuery({ queryKey: ['presence', 'pages', ...targets], queryFn: () => api.presence(targets), enabled: targets.length > 0, retry: false }).data ?? {}
  const titleOf = new Map(nodes.map(n => [n.id, n.title || n.id]))
  const shownIds = new Set(rows.map(r => r.node.id))

  const create = async () => {
    setNote(null)
    try {
      const out = await api.createPage({ title: 'Untitled' })
      void qc.invalidateQueries({ queryKey: ['pages'] })
      if (out.staged) { setNote(NEW_PAGE_STAGED); announce(NEW_PAGE_STAGED) } else navigate(pageHref(out.id))
    } catch (err) { setNote(err instanceof Error ? err.message : String(err)) }
  }

  return (
    <section className="pg-tree" aria-labelledby="pg-tree-h">
      <div className="pg-tree-h">
        <h2 id="pg-tree-h" className="pg-tree-t">Pages</h2>
        {canWrite && known && <Button small icon="plus" onClick={() => void create()}>New page</Button>}
      </div>
      {note && <Note state="notYet">{note}</Note>}
      {q.isPending ? <DataList label="Pages" loading={3}>{null}</DataList>
        : q.error ? <Note state="error">{q.error.message}</Note>
        : rows.length === 0
          ? <Note state="empty">{previewing ? 'No page this preview may see.' : 'No page yet.'}</Note>
          : (
            <DataList label="Pages">
              {rows.map(({ node, depth }) => (
                <DataRow key={node.id} kind="page" title={node.title || node.id} href={pageHref(node.id)} marks={node.stale ? ['stale'] : []}
                  className={depth > 0 ? `pg-sub ${DEPTH_CLASS[Math.min(depth, MAX_DEPTH) - 1]}` : undefined}
                  second={depth > 0 && node.parent ? parentLine(node.parent, nodes.filter(n => shownIds.has(n.id)), titleOf) : node.stale ? 'Its parent page is missing.' : undefined}
                  presence={presence[`page:${node.id}`]}
                  action={writes && node.write !== undefined && node.write !== 'none'
                    ? <Menu label={`More for ${node.title || node.id}`} items={[{ type: 'item', label: 'Move to…', onSelect: () => { setNote(null); setMoving(node) } }]} />
                    : undefined} />
              ))}
            </DataList>
          )}
      {moving && (
        <MovePageDialog page={moving} onCancel={() => setMoving(null)}
          onMoved={out => { setMoving(null); if (out.staged) setNote(MOVE_STAGED) }} />
      )}
    </section>
  )
}
