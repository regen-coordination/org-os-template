// /p/:id — a page of the workspace (DAO-OS L6 spec §15): L4c's EditorBar (path, save state, presence, the level, comments)
// and PageBody holding Task 6's editor, with L4c's SelectionToolbar, SlashMenu and MentionPicker floated over it; the
// session's saves (useSession) drive the save state. Previewing, or for a viewer the server gives no write (`write.mode`
// 'none'), the editor is read-only and no write control is drawn (L4 §5.9, C-23). Where the effective rule makes the page's
// edits need approval (`write.mode` 'approval', Q77's predicate: proposable, not direct), the bar offers Suggest instead of a
// direct save (Task 16b, R-L6-SUGGEST): the session becomes a proposal. Where the page is saved directly, Suggest is
// offered beside the save (Task 16c, R-L6-SUGGEST-2): the org's maintainers decide it. Beside the bar: Copy link (the page's
// Hub address) and who can see the page. The thread (Task 18) takes the `thread` slot beside the editor; Task 16 draws
// none. Task 18: the page beats its presence while open (usePresence), marks its notifications read, holds its
// conversation for the slot (useConversation: the toggle's count, the commented passages marked in the editor, Show the
// passage), and the selection toolbar's Comment hands the selected passage to the thread's composer.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'wouter'
import { api, ApiError, type PageNode, type PageRead, type ServedMentionable } from '../api.ts'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { Icon } from '../design/Icon.tsx'
import { EditorBar } from '../elements/workspace/EditorBar.tsx'
import { PageBody } from '../elements/workspace/PageBody.tsx'
import { SelectionToolbar, type FormatMark } from '../elements/workspace/SelectionToolbar.tsx'
import { SlashMenu, type InsertKind } from '../elements/workspace/SlashMenu.tsx'
import { MentionPicker } from '../elements/workspace/MentionPicker.tsx'
import { Listbox } from '../elements/workspace/Listbox.tsx'
import { mentionables, type Mentionable } from '../elements/workspace/mentions.ts'
import type { Save } from '../elements/workspace/SaveState.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { useChanges } from '../changes/useChanges.ts'
import { useResources } from '../queries.ts'
import { announce } from '../parts/live.tsx'
import { useCanWrite, useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { ageText, useNow } from '../time.ts'
import NotFound from '../pages/NotFound.tsx'
import type { HubEditor } from '../editor/view.ts'
import { EditorHost, type Caret } from './EditorHost.tsx'
import { useSession } from './useSession.tsx'
import { NEW_PAGE_STAGED } from './PageTree.tsx'
import { MovePageDialog, MOVE_STAGED } from './MovePage.tsx' // walk fix wave 6b, I9
import { SUGGESTED, SuggestForm } from './SuggestForm.tsx'
import { usePageMark } from './fromMarks.ts' // DAO-OS L6 Task 19
import { levelItem, pageAddress, pageHref, whoCanSee } from './share.ts'
import { usePageVisibility } from './pageVisibility.tsx' // DAO-OS L6 Task 20
// --- DAO-OS L6 Task 18
import type { Visibility } from '../viewAs/visibility.ts'
import { useActor } from '../actor.ts'
import { anchorOf, findPassage, textIndex, type Anchor, type ShownAnchor } from './passage.ts'
import { useConversation, useMarkRead, type Conversation } from './useConversation.ts'
import { usePresence } from './usePresence.ts'
// --- end L6 Task 18

/** The missing parent's words (§4.2): the page is shown at the root, never hidden. */
export const PARENT_MISSING = 'Its parent page is missing.'
export const LINK_COPIED = 'Link copied.'
/** R-16a: a draft the server refused last time, kept on this device and offered, never sent on its own. */
export const OFFER_KEPT = 'Your unsaved text from last time is kept here. Put it back?'
/** The session could not be opened: the page is shown read-only, with the reason and Retry. */
export const OPEN_FAILED = 'This page is read-only for now: it could not be opened for writing.'

/** The page's ancestors, nearest last, from the tree the viewer may see; a chain that loops stops where it would. */
export function ancestorsOf(id: string, parent: string | null, nodes: readonly PageNode[]): PageNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const out: PageNode[] = []
  const seen = new Set([id])
  for (let at = parent; at !== null && !seen.has(at); ) {
    const n = byId.get(at)
    if (!n) break
    seen.add(at)
    out.unshift(n)
    at = n.parent
  }
  return out
}

/** The thread's place beside the editor (Task 18): given whether it is open, how to close it, and its id. Task 18 adds the
 *  page's level, its conversation, the passage the next comment will be on (and how to drop it), how to show a passage
 *  in the editor, and who the viewer is. */
export type ThreadSlot = (p: {
  open: boolean; close(): void; id: string; target: string
  visibility: Visibility; conversation: Conversation; quote: Anchor | null; dropQuote(): void; showPassage(a: ShownAnchor): void; me?: string; meName?: string
}) => ReactNode

export default function PagePage({ id, thread }: { id: string; thread?: ThreadSlot }) {
  const q = useQuery({ queryKey: ['page', id], queryFn: () => api.page(id), retry: false })
  const { sees } = useViewer()
  if (q.isPending) return <Note state="loading">Loading…</Note>
  if (q.error) return q.error instanceof ApiError && q.error.status === 404 ? <NotFound /> : <Note state="error">{q.error.message}</Note>
  // Previewing as someone who may not see the page: absent (rule 7), as the server answers for them.
  if (!sees(levelItem(q.data.page.visibility))) return <NotFound />
  // DAO-OS L6 Task 20: a page that leaves the repository (or enters it) is another file: its view, and its session, start again.
  return <PageView key={`${id}:${q.data.page.path === null ? 'store' : 'git'}`} read={q.data} thread={thread} />
}

type Menu =
  | { kind: 'slash'; q: string; at: { left: number; top: number } }
  | { kind: 'insert'; what: 'view' | 'record'; at: { left: number; top: number } }
  | { kind: 'mention'; q: string; at: { left: number; top: number }; manual: boolean }
  | { kind: 'link'; at: { left: number; top: number } }

const MENTION_KIND: Record<Mentionable['kind'], string> = { person: 'member', role: 'role', record: 'record', page: 'page' }

function PageView({ read, thread }: { read: PageRead; thread?: ThreadSlot }) {
  const { page, write, backlinks } = read
  const id = page.id
  const target = `page:${id}`
  const now = useNow(false)
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const canWrite = useCanWrite()
  const source = useVisibilitySource()
  const { visible, sees } = useViewer()
  const changes = useChanges()
  const editable = canWrite && write.mode !== 'none'
  const stagedHere = page.path !== null && (changes.view?.ops ?? []).some(op => op.op === 'file' && op.path === page.path)
  // R-L6-SUGGEST: a page whose edits need approval never reads "Saved · direct"; Suggest is offered on a page in git.
  // R-L6-SUGGEST-2 (the operator: "Everywhere, maintainers decide"): to one who saves it directly too, beside the save.
  const idle: Save = stagedHere ? 'staged' : write.mode === 'approval' ? 'approval' : 'direct'
  const suggestable = editable && (write.mode === 'approval' || write.mode === 'direct') && page.path !== null
  const session = useSession(id, editable, idle)

  const treeRead = useQuery({ queryKey: ['pages'], queryFn: api.pages, retry: false }).data
  const tree = treeRead ?? []
  const fromMark = usePageMark(page.fromMark) // DAO-OS L6 Task 19 (§10): where the page was read from, as the server sends it
  // --- DAO-OS L6 Task 18: presence beats while the page is open (editing while a session is), read for the bar; a
  // preview shows nobody (the server answered for you, not for whom you preview as). Opening the page marks its
  // notifications read. The conversation is held here for the slot: the toggle counts what the server served; a preview
  // as the public has none (conversation is the members' side, §8.2), so the thread is not drawn then.
  const { actor, known } = useActor()
  const { previewing, viewer } = useViewer()
  const me = known && actor && 'id' in actor ? { handle: actor.id, role: actor.name } : null
  const people = usePresence(target, { beat: known, editing: editable && session.markdown !== null })
  const presence = previewing ? [] : people
  useMarkRead(target, known)
  const talk = Boolean(thread) && known && viewer.as !== 'public'
  const conversation = useConversation(target, { enabled: talk, me })
  const [quote, setQuote] = useState<Anchor | null>(null)
  const [shownPassage, setShownPassage] = useState<string | null>(null)
  const [editorAt, setEditorAt] = useState(0)
  // --- end L6 Task 18

  const editor = useRef<HubEditor | null>(null)
  const markdown = useRef<string>('')
  const title = useRef<string | undefined>(undefined)
  const [shownTitle, setShownTitle] = useState(page.title)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [selection, setSelection] = useState<{ marks: Record<FormatMark, boolean>; at: { left: number; top: number } } | null>(null)
  const marks = useRef<Record<FormatMark, boolean>>({ bold: false, italic: false, heading: false })
  const [comparing, setComparing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggested, setSuggested] = useState<string | null>(null)
  // While a Suggest is sent the editor is read-only: what is typed then would not be in the proposal (R-L6-SUGGEST).
  const [sending, setSending] = useState(false)
  const floats = useRef<HTMLDivElement>(null)

  // The body the editor starts from: the session's (which may be a draft this tab kept), or the page as read.
  // `live`: a session is open, so the editor writes. An open that failed leaves the page as read, read-only (R-16a's fold).
  const live = editable && session.markdown !== null
  const body = live ? session.markdown : !editable || session.openError ? page.markdown : null
  useEffect(() => { if (body !== null) markdown.current = body }, [body, session.version])
  // Previewing (or leaving it) closes what only a writer has open.
  useEffect(() => { if (!editable) { setMenu(null); setSelection(null); setComparing(false); setSuggesting(false) } }, [editable])
  useEffect(() => { if (session.state !== 'conflict') setComparing(false) }, [session.state])
  // Task 16c review I4: on a page saved directly the session's idle end commits its draft, so while the Suggest form is
  // open the session is held (useSession `hold`); a session under a raised tree commits nothing and is not held.
  const { hold } = session
  const holdOpen = live && suggesting && write.mode === 'direct'
  useEffect(() => { hold(holdOpen); return () => hold(false) }, [hold, holdOpen])

  const level = source.visibilityOf(levelItem(page.visibility))
  // DAO-OS L6 Task 20: the bar's visibility control — what the server would accept, for a writer who is not previewing.
  const vis = usePageVisibility({ page, editable, level, tree: treeRead, changes, session })
  const ancestors = ancestorsOf(id, page.parent, tree)
  const path = [{ label: 'Workspace', href: '/workspace' }, ...ancestors.map(n => ({ label: n.title || n.id, href: pageHref(n.id) })),
    { label: shownTitle || id, href: pageHref(id) }]
  const shownBacklinks = backlinks.filter(b => sees(levelItem(b.visibility)))
  const meta = [
    page.edited ? `Edited ${ageText(page.edited.at, now)}${page.edited.by ? ` by ${page.edited.by}` : ''}` : null,
    write.mode === 'direct' ? 'Workspace write · saves directly' : write.mode === 'approval' ? 'Workspace write · needs approval' : 'Read only',
    shownBacklinks.length > 0 ? `${shownBacklinks.length} backlink${shownBacklinks.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ')

  const mentionQ = menu?.kind === 'mention' ? menu.q : null
  const offered = useQuery({
    queryKey: ['mentionables', target, mentionQ ?? ''], queryFn: () => api.mentionables(target, mentionQ ?? ''),
    enabled: mentionQ !== null && editable, retry: false, staleTime: 10_000,
  }).data
  const collections = useQuery({ queryKey: ['collections'], queryFn: api.collections, enabled: menu?.kind === 'insert' && menu.what === 'view', retry: false }).data
  const resources = useResources()

  const onChange = (md: string) => {
    markdown.current = md
    session.save(md, title.current)
  }
  const onTitle = (t: string) => {
    title.current = t
    setShownTitle(t)
    session.save(markdown.current, t)
  }
  const onCaret = (c: Caret) => {
    setMenu(m => {
      if (!m) return m
      if (m.kind === 'slash' && !c.slash) return null
      if (m.kind === 'mention' && (m.manual ? c.docChanged : !c.mention)) return null
      if (m.kind === 'insert' && !c.slash) return null
      return m
    })
    setSelection(c.empty || !live ? null : { marks: marks.current, at: c.at })
  }
  const caretAt = (): { left: number; top: number } => {
    const v = editor.current?.view
    try { const c = v!.coordsAtPos(v!.state.selection.from); return { left: c.left, top: c.bottom } } catch { return { left: 0, top: 0 } }
  }

  const pickInsert = (kind: InsertKind) => {
    if (kind === 'view' || kind === 'record') { setMenu(m => ({ kind: 'insert', what: kind, at: m?.at ?? caretAt() })); return }
    editor.current?.insert(kind)
    setMenu(null)
  }
  const pickMention = (m: Mentionable) => {
    editor.current?.mention({ kind: MENTION_KIND[m.kind], ref: m.id, label: m.label })
    setMenu(null)
  }

  // While a menu is open the caret stays in the editor and its keys go to the menu's listbox (L4c's Listbox: it is driven
  // by its active descendant). Escape closes it; the editor keeps the rest.
  const onKeyDownCapture = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!menu || menu.kind === 'link') return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(e.key)) return
    const list = floats.current?.querySelector<HTMLElement>('.ed-pop-l')
    if (!list || !editorHolds(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    list.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true, cancelable: true }))
  }
  const editorHolds = (t: EventTarget) => t instanceof Node && Boolean(editor.current?.view.dom.contains(t))

  const copyLink = async () => {
    const address = pageAddress(id)
    try {
      await navigator.clipboard.writeText(address)
      setNote(null)
      announce(LINK_COPIED)
    } catch {
      setNote(`The link could not be copied here. The page’s address is ${address}`)
    }
  }
  const newSubpage = async () => {
    setNote(null)
    try {
      const out = await api.createPage({ title: 'Untitled', parent: id })
      void qc.invalidateQueries({ queryKey: ['pages'] })
      if (out.staged) { announce(NEW_PAGE_STAGED); setNote(NEW_PAGE_STAGED) }
      else navigate(pageHref(out.id))
    } catch (err) { setNote(err instanceof Error ? err.message : String(err)) }
  }
  const resolve = async (k: 'mine' | 'theirs') => {
    setBusy(true)
    try { await session.keep(k) } finally { setBusy(false) }
  }

  const insertOptions = menu?.kind === 'insert'
    ? menu.what === 'view'
      ? (collections?.collections ?? []).map(c => ({
          key: c.id, content: <><Icon name="table" />{c.name ?? c.id}</>,
          onPick: () => {
            const view = c.views?.[0]?.id ?? 'table'
            editor.current?.insert('view', { collection: c.id, view, label: c.name ?? c.id })
            setMenu(null)
          },
        }))
      : visible(resources.data ?? []).filter(r => r.source?.registry && r.source.entityId).slice(0, 50).map(r => ({
          key: r.id, content: <><Icon name="safe" />{r.name}</>,
          onPick: () => {
            editor.current?.insert('record', { ref: `${r.source!.registry}:${r.source!.entityId}`, label: r.name })
            setMenu(null)
          },
        }))
    : []

  // --- DAO-OS L6 Task 18: the open comments' passages, marked in the editor (L4c's Commented: underlined clay), the one
  // shown last ringed; Show the passage scrolls the editor to it (never through the document's marks: C3's carry).
  const anchorsKey = JSON.stringify(conversation.anchors)
  useEffect(() => {
    const view = editor.current?.view
    if (!view) return
    const anchors = conversation.anchors
    let at: { doc: unknown; set: DecorationSet } | null = null
    view.setProps({
      decorations: state => {
        if (anchors.length === 0) return DecorationSet.empty
        if (at?.doc === state.doc) return at.set
        const index = textIndex(state.doc)
        const marks = anchors.flatMap(a => {
          const r = findPassage(state.doc, a, index)
          return r ? [Decoration.inline(r.from, r.to, { nodeName: 'mark', class: a.id === shownPassage ? 'ed-cmt on' : 'ed-cmt', 'data-anchor': a.id })] : []
        })
        at = { doc: state.doc, set: DecorationSet.create(state.doc, marks) }
        return at.set
      },
    })
  }, [editorAt, anchorsKey, shownPassage])
  const showPassage = (a: ShownAnchor) => {
    const view = editor.current?.view
    if (!view) return
    const r = findPassage(view.state.doc, { exact: a.exact ?? a.text, prefix: a.prefix ?? '', suffix: a.suffix ?? '' })
    if (!r) return
    setShownPassage(a.id)
    try {
      const { node } = view.domAtPos(r.from)
      const el = node instanceof Element ? node : node.parentElement
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
    } catch { /* no layout */ }
  }
  const commentOnSelection = () => {
    const view = editor.current?.view
    const a = view ? anchorOf(view.state) : null
    setQuote(a)
    setCommentsOpen(true)
  }
  // --- end L6 Task 18
  const threadId = `thread-${id}`
  return (
    <div className="ed-page hub-page">
      <div className="ed">
        <EditorBar path={path} save={session.state} saveReason={session.state === 'refused' ? session.error ?? undefined : undefined} onCompare={editable ? () => { setComparing(true); void session.openCompare() } : undefined}
          presence={presence} visibility={level} onVisibility={vis.onVisibility} visibilityOffers={vis.visibilityOffers} visibilityMore={vis.visibilityMore}
          proposed={vis.proposed} comments={talk ? conversation.open : 0} onComments={() => setCommentsOpen(o => !o)}
          commentsOpen={talk ? commentsOpen : undefined} commentsId={talk ? threadId : undefined}
          onSuggest={suggestable && live ? () => { setSuggested(null); setSuggesting(o => !o) } : undefined} suggestOpen={suggesting} />
        <div className="pg-share">
          <Button small icon="link" onClick={() => void copyLink()}>Copy link</Button>
          <span className="pg-who">{whoCanSee(level, source)}</span>
          {editable && <Button small variant="ghost" icon="plus" onClick={() => void newSubpage()}>New subpage</Button>}
          {editable && !vis.moveHeld && <Button small variant="ghost" onClick={() => { setNote(null); setMoving(true) }}>Move to…</Button>}
        </div>
        {moving && (
          // Walk I9: a move that takes the page out of the repository ends its session first, as a narrowing does.
          <MovePageDialog page={{ id, title: shownTitle || page.title, parent: page.parent, visibility: page.visibility }} onCancel={() => setMoving(false)}
            before={async leaves => { if (leaves) await session.end() }} after={leaves => { if (leaves) session.retry() }}
            onMoved={out => { setMoving(false); if (out.staged) setNote(MOVE_STAGED) }} />
        )}
        {page.stale === 'missing-parent' && <Note state="notYet">{PARENT_MISSING}</Note>}
        {vis.error && <Note state="error">{vis.error}</Note>}
        {editable && vis.moveNote && <Note state="notYet">{vis.moveNote}</Note>}
        {vis.dialog}
        {note && <Note state="notYet">{note}</Note>}
        {suggested && <Note state="notYet" action={<Link href={`/governance/proposals/${encodeURIComponent(suggested)}`}>Open the proposal</Link>}>{SUGGESTED(suggested)}</Note>}
        {suggestable && live && suggesting && (
          <SuggestForm pageTitle={shownTitle || id} onClose={() => setSuggesting(false)} onSuggest={async proposal => {
            setSending(true)
            try {
              const made = await session.suggest(markdown.current, title.current, proposal)
              setSuggesting(false)
              setSuggested(String(made.id))
              announce(SUGGESTED(String(made.id)))
            } finally { setSending(false) }
          }} />
        )}
        {editable && session.error && <Note state="error">{session.error}</Note>}
        {editable && session.openError && (
          <Note state="error" action={<Button small onClick={session.retry}>Retry</Button>}>{`${OPEN_FAILED} ${session.openError}`}</Note>
        )}
        {editable && session.offer && (
          <Note state="notYet" action={<><Button small onClick={session.putBack}>Put back</Button> <Button small variant="ghost" onClick={session.discard}>Discard</Button></>}>{OFFER_KEPT}</Note>
        )}
        {editable && comparing && session.compare && (
          <section className="pg-compare" aria-label="Compare">
            <p className="pg-compare-t">Someone saved a newer version. Keep yours over theirs, or take theirs and drop yours.</p>
            <div className="pg-compare-g">
              {([['As you opened it', session.compare.base], ['Theirs now', session.compare.theirs], ['Yours', session.compare.mine]] as const).map(([label, text]) => (
                <figure className="pg-well" key={label}><figcaption>{label}</figcaption><pre>{text}</pre></figure>
              ))}
            </div>
            <div className="pg-compare-a">
              <Button small primary disabled={busy} onClick={() => void resolve('mine')}>Keep mine</Button>
              <Button small disabled={busy} onClick={() => void resolve('theirs')}>Take theirs</Button>
            </div>
          </section>
        )}
        <PageBody meta={meta} title={page.title} now={now} from={fromMark}
          editTitle={live && !sending && !vis.moveHeld && !session.ending ? { onInput: onTitle, onEnter: () => editor.current?.view.focus() } : undefined}>
          {body === null
            ? <Note state="loading">Opening the page…</Note>
            : (
              <div onKeyDownCapture={onKeyDownCapture}>
                <EditorHost key={`${live ? 'edit' : 'read'}:${session.version}:${live ? '' : body}`} body={body} label={`${shownTitle || id} · page body`}
                  readOnly={!live || sending || vis.moveHeld || session.ending} onChange={onChange}
                  onSlash={q => setMenu(m => ({ kind: 'slash', q, at: m?.kind === 'slash' ? m.at : caretAt() }))}
                  onMention={(q, at) => setMenu({ kind: 'mention', q, at, manual: false })}
                  onSelection={s => { marks.current = s.marks; setSelection(sel => (sel ? { ...sel, marks: s.marks } : sel)) }}
                  onLink={() => setMenu({ kind: 'link', at: caretAt() })}
                  onCaret={onCaret} onReady={e => { editor.current = e; setEditorAt(n => n + 1) }} />
              </div>
            )}
        </PageBody>
        {shownBacklinks.length > 0 && (
          <div className="pg-backlinks">
            <DataList label="Linked from">
              {shownBacklinks.map(b => <DataRow key={b.id} kind="page" title={b.title || b.id} href={pageHref(b.id)} marks={[]} />)}
            </DataList>
          </div>
        )}
      </div>
      {talk && thread?.({
        open: commentsOpen, close: () => setCommentsOpen(false), id: threadId, target,
        visibility: level, conversation, quote, dropQuote: () => setQuote(null), showPassage, me: me?.handle, meName: me?.role,
      })}
      {live && !sending && (
        // The floating chrome: kept out of the editor's focus (a press on it never takes the caret away).
        <div ref={floats} className="pg-floats" onMouseDown={e => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault() }}>
          {selection && !menu && (
            <div className="pg-float pg-float-above" style={{ left: selection.at.left, top: selection.at.top }}>
              <SelectionToolbar marks={selection.marks} onToggle={mk => editor.current?.toggle(mk)}
                onLink={() => setMenu({ kind: 'link', at: selection.at })}
                onMention={() => setMenu({ kind: 'mention', q: '', at: selection.at, manual: true })}
                onComment={commentOnSelection} />
            </div>
          )}
          {menu?.kind === 'slash' && (
            <div className="pg-float" style={{ left: menu.at.left, top: menu.at.top }}><SlashMenu query={menu.q} onPick={pickInsert} /></div>
          )}
          {menu?.kind === 'insert' && (
            <div className="pg-float" style={{ left: menu.at.left, top: menu.at.top }}>
              <Listbox head={menu.what === 'view' ? 'A view of a collection' : 'A record'} className="ed-slash" options={insertOptions}
                empty={menu.what === 'view' ? 'No collection you may see yet.' : 'No record you may see yet.'} />
            </div>
          )}
          {menu?.kind === 'mention' && (
            <div className="pg-float" style={{ left: menu.at.left, top: menu.at.top }}>
              <MentionPicker items={mentionables((offered ?? []) as ServedMentionable[], menu.q)} onPick={pickMention} />
            </div>
          )}
          {menu?.kind === 'link' && (
            <div className="pg-float" style={{ left: menu.at.left, top: menu.at.top }}>
              <LinkField onDone={href => { if (href !== null) editor.current?.link(href); setMenu(null); editor.current?.view.focus() }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The toolbar's Link (or ⌘⇧L): an address, then Apply; an empty address removes the link. Escape leaves it. */
function LinkField({ onDone }: { onDone(href: string | null): void }) {
  const [href, setHref] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  return (
    <form className="menu pg-link" onSubmit={e => { e.preventDefault(); onDone(href.trim()) }}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onDone(null) } }}>
      <div className="mh">Link</div>
      <input ref={input} className="input" aria-label="Link address" placeholder="https://… or ./page-id.md" value={href} onChange={e => setHref(e.target.value)} />
      <div className="pg-link-a">
        <Button small primary type="submit">Apply</Button>
        <Button small onClick={() => onDone('')}>Remove link</Button>
      </div>
    </form>
  )
}

