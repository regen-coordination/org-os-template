// @vitest-environment jsdom
// DAO-OS L6 Task 16: a page in the Hub — the editor under L4c's chrome, its session's saves and the save state.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse, resource } from '../test/data.ts'
import { MENTIONABLES, PAGE_NODES, pageReadOf } from '../test/fixtures/house/workspace.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXTURE_SOURCE, type Viewer } from '../viewAs/visibility.ts'
import { SAVE_WORDS } from '../elements/workspace/SaveState.tsx'
import { UNREADABLE_FRONT } from '../../../lib/workspace/pages.mjs'
import PagePage, { ancestorsOf, OFFER_KEPT, OPEN_FAILED, PARENT_MISSING } from './PagePage.tsx'
import { editorOf } from './EditorHost.tsx'
import { DRAFT_DEBOUNCE_MS, keptDraft, LEFT_UNSAVED, SUGGEST_HOLD_MS } from './useSession.tsx'
/** L5's store sentence (server/private/ops.ts NO_STORE; the server module cannot load in jsdom). */
const NO_STORE = 'This server has no private store open, so nothing private can be read or written here.'
import { whoCanSee } from './share.ts'
import { SENDING, SUGGESTED, SUGGEST_TO_GIT } from './SuggestForm.tsx'
import { errorNote, heard } from '../test/notes.ts'
import { clientWith, statusOf, statusRoute } from '../test/writesOff.ts'
import { pageThread } from './ConversationThread.tsx'

const ID = 'treasury-3c4d'
const BODY = 'The treasury is one Safe at the same address on seven chains.\n'
const SAVE_WAIT = { timeout: DRAFT_DEBOUNCE_MS + 2500 }

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

function routes(over: Record<string, unknown> = {}) {
  return fetchRoutes({
    ...baseRoutes(),
    'GET /api/pages': PAGE_NODES,
    [`GET /api/pages/${ID}`]: pageReadOf(ID),
    'GET /api/presence': { [`page:${ID}`]: [{ handle: 'steward-b', role: 'Steward B', editing: false }] },
    [`POST /api/pages/${ID}/sessions`]: { session: 'ses_1', base: 'b0', markdown: BODY },
    'PUT /api/sessions/ses_1': { save: 'direct' },
    'POST /api/sessions/ses_1/close': { commit: 'c1' },
    ...over,
  })
}

function draw(viewer?: Viewer, id = ID) {
  const ui = viewer ? <ViewAsProvider source={FIXTURE_SOURCE} initial={viewer}><PagePage id={id} /></ViewAsProvider> : <PagePage id={id} />
  return renderAt(ui, `/p/${id}`)
}

async function editorView(title = 'How the treasury is run'): Promise<EditorView> {
  const box = await screen.findByRole('textbox', { name: `${title} · page body` }, { timeout: 4000 }) // a shared machine: room for a slow first draw
  return editorOf(box)!.view
}

/** Types `text` at the end of the document, as the keyboard would (`/` and `@` through the editor's own text input). */
function type(view: EditorView, text: string) {
  act(() => {
    for (const ch of text) {
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', f => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
    }
  })
}
function caretAtEnd(view: EditorView) {
  act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc))) })
}
/** A new empty paragraph at the end, the caret in it: where `/` opens the slash menu. */
function newParagraph(view: EditorView) {
  act(() => {
    const tr = view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph!.create())
    view.dispatch(tr.setSelection(TextSelection.atEnd(tr.doc)))
  })
}
/** The bar's save state, as its words read. */
const saveWord = () => document.querySelector('.ed-bar .save-w')?.textContent ?? null
const puts = (calls: { method: string; path: string; body: unknown }[]) => calls.filter(c => c.method === 'PUT' && c.path.startsWith('/api/sessions/'))

describe('/p/:id — a page', () => {
  it('renders PageBody with the editor inside it, the bar’s path, and the meta line', async () => {
    routes()
    draw()
    const view = await editorView()
    const body = view.dom.closest('article.ed-body')!
    expect(body).toBeTruthy()
    expect(within(body as HTMLElement).getByRole('heading', { level: 1 }).textContent).toBe('How the treasury is run')
    expect(view.dom.getAttribute('aria-multiline')).toBe('true')
    expect(view.dom.textContent).toContain('one Safe at the same address')
    const crumbs = screen.getByRole('navigation', { name: 'Page path' })
    expect(within(crumbs).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Workspace', 'Handbook', 'How the treasury is run'])
    expect(body.querySelector('.ed-meta')!.textContent).toMatch(/^Edited .* by ops-lead · Workspace write · saves directly$/)
    expect(screen.getByRole('img', { name: 'Steward B is reading' })).toBeTruthy()
  })

  it('typing saves after 800 ms: the save state walks Saving… → Saved · direct', async () => {
    let answer!: (v: unknown) => void
    const { calls } = routes({ 'PUT /api/sessions/ses_1': () => new Promise(r => { answer = r }) })
    draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' More.')
    // nothing goes before the debounce
    expect(puts(calls)).toHaveLength(0)
    await vi.waitFor(() => expect(puts(calls)).toHaveLength(1), SAVE_WAIT)
    expect(puts(calls)[0]!.body).toEqual({ markdown: 'The treasury is one Safe at the same address on seven chains. More.\n' })
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.saving))
    await act(async () => { answer({ save: 'direct' }) })
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.direct))
    expect(keptDraft(ID)).toBeNull() // acknowledged: nothing kept on this device
  })

  it('under a raised tree it reads "Staged · needs approval", and the tray gains the page’s op', async () => {
    let staged = false
    const op = { op: 'file', path: `pages/${ID}.md`, text: 'x', base: 'b0' }
    const { calls } = routes({
      [`GET /api/pages/${ID}`]: pageReadOf(ID, { mode: 'approval' }),
      'PUT /api/sessions/ses_1': () => { staged = true; return { save: 'staged' } },
      'GET /api/changes': () => changeView(staged ? { ops: [op] } as never : {}),
    })
    draw()
    const view = await editorView()
    expect(document.querySelector('.ed-meta')!.textContent).toContain('Workspace write · needs approval')
    caretAtEnd(view)
    type(view, '!')
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.staged), SAVE_WAIT)
    // the change is read again, now holding the page's one op
    await vi.waitFor(() => expect(calls.filter(c => c.path === '/api/changes').length).toBeGreaterThanOrEqual(2))
  })

  it('a 409 shows "Someone saved a newer version"; Compare offers Keep mine and Take theirs', async () => {
    const compare = { base: BODY, theirs: 'Theirs.\n', mine: `${BODY.trimEnd()}!\n` }
    let opened = 0
    const { calls } = routes({
      [`POST /api/pages/${ID}/sessions`]: () => (++opened === 1 ? { session: 'ses_1', base: 'b0', markdown: BODY } : { session: 'ses_2', base: 'b1', markdown: compare.mine }),
      'PUT /api/sessions/ses_1': refuse(409, { code: 'CONFLICT', error: 'Someone saved a newer version.', compare }),
      'POST /api/sessions/ses_1/resolve': { commit: 'c2' },
      'POST /api/sessions/ses_2/close': { commit: null },
    })
    draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, '!')
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.conflict), SAVE_WAIT)
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    const region = await screen.findByRole('region', { name: 'Compare' })
    expect([...region.querySelectorAll('figcaption')].map(f => f.textContent)).toEqual(['As you opened it', 'Theirs now', 'Yours'])
    expect([...region.querySelectorAll('pre')].map(p => p.textContent)).toEqual([compare.base, compare.theirs, compare.mine])
    expect(within(region).getByRole('button', { name: 'Take theirs' })).toBeTruthy()
    fireEvent.click(within(region).getByRole('button', { name: 'Keep mine' }))
    await vi.waitFor(() => expect(calls.some(c => c.path === '/api/sessions/ses_1/resolve' && (c.body as { keep: string }).keep === 'mine')).toBe(true))
    // the session ended with the resolve; the next one opens on the result
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.direct))
    expect(opened).toBe(2)
    expect(screen.queryByRole('region', { name: 'Compare' })).toBeNull()
  })

  it('offline keeps the draft in sessionStorage and reads "Offline · kept on this device"', async () => {
    routes({ 'PUT /api/sessions/ses_1': () => { throw new TypeError('Failed to fetch') } })
    draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' Offline.')
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.offline), SAVE_WAIT)
    expect(keptDraft(ID)).toEqual({ base: 'b0', was: BODY, markdown: 'The treasury is one Safe at the same address on seven chains. Offline.\n' })
  })

  it('a draft this tab kept is sent again when the page is still that version', async () => {
    sessionStorage.setItem(`org-os-admin.page-draft.${ID}@b0`, JSON.stringify({ base: 'b0', was: BODY, markdown: 'Kept on this device.\n' }))
    const { calls } = routes()
    draw()
    const view = await editorView()
    expect(view.dom.textContent).toBe('Kept on this device.')
    await vi.waitFor(() => expect(puts(calls).map(c => c.body)).toEqual([{ markdown: 'Kept on this device.\n' }]))
  })

  it('previewing hides every write control and makes the editor read-only (no session is opened)', async () => {
    const { calls } = routes({ [`GET /api/pages/${ID}`]: pageReadOf(ID, { visibility: 'members' }) })
    draw({ as: 'members' })
    const view = await editorView()
    expect(view.dom.getAttribute('contenteditable')).toBe('false')
    expect(screen.queryByRole('button', { name: 'New subpage' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('contenteditable')).toBeNull()
    expect(document.querySelector('.vis-ctl')).toBeNull()
    expect(calls.some(c => c.path.endsWith('/sessions'))).toBe(false)
    // Copy link is not a write: it stays
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('a page the preview may not see is absent (not found)', async () => {
    routes()
    draw({ as: 'members' })
    expect(await screen.findByRole('heading', { level: 1, name: `No page at /p/${ID}.` })).toBeTruthy()
  })

  it('a viewer the server gives no write reads the page read-only', async () => {
    const { calls } = routes({ [`GET /api/pages/${ID}`]: pageReadOf(ID, { mode: 'none' }) })
    draw()
    const view = await editorView()
    expect(view.dom.getAttribute('contenteditable')).toBe('false')
    expect(document.querySelector('.ed-meta')!.textContent).toContain('Read only')
    expect(calls.some(c => c.path.endsWith('/sessions'))).toBe(false)
  })

  it('`/` opens the slash menu and each of its six kinds inserts its node', async () => {
    routes({
      'GET /api/collections': { collections: [{ id: 'tasks', name: 'Tasks', views: [{ id: 'open', name: 'Open', kind: 'table', filters: [] }], visibility: 'members', builtin: true }] },
      'GET /api/resources': [resource()],
    })
    draw()
    const view = await editorView()
    const insert = async (label: string, pick?: string) => {
      newParagraph(view)
      type(view, '/')
      const menu = await screen.findByRole('listbox', { name: 'Insert · /' })
      fireEvent.click(within(menu).getByText(label))
      if (pick) {
        const second = await screen.findByRole('listbox', { name: label })
        fireEvent.click(await within(second).findByText(pick))
      }
      await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    }
    await insert('Callout')
    await insert('Task')
    await insert('Table')
    await insert('Divider')
    await insert('A view of a collection', 'Tasks')
    await insert('A record', resource().name)
    const kinds: string[] = []
    view.state.doc.forEach(n => { kinds.push(n.type.name) })
    for (const k of ['alert', 'bullet_list', 'table', 'horizontal_rule', 'embed_view', 'embed_record']) expect(kinds).toContain(k)
    let embed: Record<string, unknown> = {}
    view.state.doc.forEach(n => { if (n.type.name === 'embed_view') embed = n.attrs })
    expect(embed).toMatchObject({ collection: 'tasks', view: 'open', label: 'Tasks' })
    // no `/` is left in the text
    expect(view.state.doc.textContent).not.toContain('/')
  })

  it('the slash menu closes when what follows `/` stops being a query (the engine sends no "closed")', async () => {
    routes()
    draw()
    const view = await editorView()
    newParagraph(view)
    type(view, '/ta')
    expect(await screen.findByRole('listbox', { name: 'Insert · /' })).toBeTruthy()
    type(view, ' ')
    await vi.waitFor(() => expect(screen.queryByRole('listbox', { name: 'Insert · /' })).toBeNull())
  })

  it('`@` opens the picker with C3’s disabled rows; a pick writes the mention', async () => {
    routes({ 'GET /api/mentionables': MENTIONABLES })
    draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' @')
    const picker = await screen.findByRole('listbox', { name: 'Mention' })
    const blocked = await within(picker).findByText('Treasury steward')
    expect(blocked.closest('[role="option"]')!.getAttribute('aria-disabled')).toBe('true')
    expect(within(picker).queryByText('Grants draft')).toBeNull() // a page the author may not see is never offered
    fireEvent.click(blocked)
    expect(screen.getByRole('listbox', { name: 'Mention' })).toBeTruthy() // a disabled row is never picked
    fireEvent.click(within(picker).getByText('Ops lead'))
    await vi.waitFor(() => expect(screen.queryByRole('listbox', { name: 'Mention' })).toBeNull())
    let mark: Record<string, unknown> | null = null
    view.state.doc.descendants(n => { const m = n.marks.find(k => k.type.name === 'mention'); if (m) mark = m.attrs })
    expect(mark).toMatchObject({ kind: 'member', ref: 'ops-lead' })
  })

  it('leaving the page closes the session (after sending the last text)', async () => {
    const { calls } = routes()
    const { unmount } = draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' Last.')
    unmount()
    await vi.waitFor(() => expect(calls.some(c => c.path === '/api/sessions/ses_1/close')).toBe(true))
    const order = calls.filter(c => c.path.startsWith('/api/sessions/ses_1')).map(c => `${c.method} ${c.path}`)
    expect(order).toEqual(['PUT /api/sessions/ses_1', 'POST /api/sessions/ses_1/close'])
  })

  it('a renamed title is saved with the body; UNREADABLE_FRONT is said in its words', async () => {
    const sentence = UNREADABLE_FRONT('The front matter is not closed')
    const { calls } = routes({ 'PUT /api/sessions/ses_1': refuse(422, { code: 'UNREADABLE_FRONT', error: sentence }) })
    draw()
    await editorView()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.getAttribute('contenteditable')).toBe('plaintext-only')
    h1.textContent = 'Treasury, as run'
    fireEvent.input(h1)
    expect(await screen.findByText(sentence, {}, SAVE_WAIT)).toBeTruthy()
    expect(saveWord()).toBe(SAVE_WORDS.refused)
    expect(puts(calls)[0]!.body).toEqual({ markdown: BODY, title: 'Treasury, as run' })
    expect(screen.getByRole('textbox', { name: 'Treasury, as run · page body' })).toBeTruthy()
  })

  // Walk M3: the top bar's path names a page from the pages read (GET /api/pages, the trunk's), which a saved title left
  // "Untitled" until a reload: the session commits when it ends, so the read says the old title until then.
  it('a saved title names the page in the pages the top bar reads, without waiting for the session’s commit', async () => {
    const { calls } = routes()
    const Probe = () => {
      const d = useQuery({ queryKey: ['pages'], queryFn: api.pages, retry: false }).data
      return <output data-testid="pages-title">{d?.find(n => n.id === ID)?.title ?? ''}</output>
    }
    renderAt(<><PagePage id={ID} /><Probe /></>, `/p/${ID}`)
    await editorView()
    const before = screen.getByTestId('pages-title').textContent
    expect(before).not.toBe('Treasury, as run')
    const h1 = screen.getByRole('heading', { level: 1 })
    h1.textContent = 'Treasury, as run'
    fireEvent.input(h1)
    await vi.waitFor(() => expect(puts(calls).length).toBe(1), SAVE_WAIT)
    await vi.waitFor(() => expect(screen.getByTestId('pages-title').textContent).toBe('Treasury, as run'))
  })

  it('a page whose parent is missing is shown, with "Its parent page is missing."', async () => {
    routes({ 'GET /api/pages/orphan-7a8b': pageReadOf('orphan-7a8b'), 'POST /api/pages/orphan-7a8b/sessions': { session: 'ses_1', base: 'b0', markdown: BODY } })
    draw(undefined, 'orphan-7a8b')
    await editorView('Old notes')
    expect(screen.getByText(PARENT_MISSING)).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Page path' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Workspace', 'Old notes'])
  })
})

// Fix round 1 (review I1, I2 and the fold-ins; ruling R-16a).
describe('/p/:id — refusals, a failed open, and the session’s other answers', () => {
  const sleep = (ms: number) => act(() => new Promise<void>(r => setTimeout(r, ms)))

  it.each([
    ['UNREADABLE_FRONT', 422, UNREADABLE_FRONT('The front matter is not closed')],
    ['a size', 413, 'A page is at most 524288 bytes, and this one would be 600000. Nothing was written.'],
    ['CANNOT_LINK', 422, 'This page is members; that record is kept at hat:ops, so it cannot be linked from here.'],
    ['a rule’s 403', 403, 'Only the Council may change pages here.'],
  ])('a refusal (%s) reads "Not saved" with its sentence; the text stays, and is not sent again until edited', async (_kind, status, sentence) => {
    const { calls } = routes({ 'PUT /api/sessions/ses_1': refuse(status as number, { error: sentence, ...(status === 422 && String(sentence).startsWith('This page') ? { code: 'CANNOT_LINK' } : {}) }) })
    draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' Refused.')
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.refused), SAVE_WAIT)
    expect(screen.getAllByText(sentence as string).length).toBeGreaterThanOrEqual(1)
    expect(document.querySelector('.ed-bar .save')!.getAttribute('title')).toBe(sentence)
    expect(view.state.doc.textContent).toContain('Refused.')
    expect(keptDraft(ID)).toMatchObject({ markdown: `${BODY.trimEnd()} Refused.\n`, refused: sentence })
    await sleep(DRAFT_DEBOUNCE_MS + 300)
    expect(puts(calls)).toHaveLength(1) // not sent again on its own
    type(view, '!')
    await vi.waitFor(() => expect(puts(calls)).toHaveLength(2), SAVE_WAIT)
  })

  it('leaving with refused text says so, keeps it on this device, and only closes the session', async () => {
    const sentence = 'Only the Council may change pages here.'
    const { calls } = routes({ 'PUT /api/sessions/ses_1': refuse(403, { error: sentence }) })
    const { rerender } = draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' Refused.')
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.refused), SAVE_WAIT)
    const live = screen.getByTestId('live')
    rerender(<p>Elsewhere</p>) // the route changes; the frame (and its live region) stays
    expect(live.textContent).toBe(LEFT_UNSAVED)
    await vi.waitFor(() => expect(calls.some(c => c.path === '/api/sessions/ses_1/close')).toBe(true))
    expect(puts(calls)).toHaveLength(1)
    expect(keptDraft(ID)?.refused).toBe(sentence)
  })

  it('a refused draft from last time is offered, never sent on its own: Put back sends it; Discard forgets it', async () => {
    const kept = { base: 'b0', was: BODY, markdown: 'Refused last time.\n', refused: 'Only the Council may change pages here.' }
    sessionStorage.setItem(`org-os-admin.page-draft.${ID}@b0`, JSON.stringify(kept))
    const { calls } = routes()
    draw()
    const view = await editorView()
    expect(view.dom.textContent).toBe(BODY.trimEnd())
    expect(await screen.findByText(OFFER_KEPT)).toBeTruthy()
    await sleep(DRAFT_DEBOUNCE_MS + 200)
    expect(puts(calls)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Put back' }))
    await vi.waitFor(() => expect(puts(calls).map(c => c.body)).toEqual([{ markdown: 'Refused last time.\n' }]))
    expect((await editorView()).dom.textContent).toBe('Refused last time.')

    vi.unstubAllGlobals()
    sessionStorage.setItem(`org-os-admin.page-draft.${ID}@b0`, JSON.stringify(kept))
    const second = routes()
    const { unmount } = draw()
    unmount()
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }, { timeout: 4000 }))
    expect(keptDraft(ID)).toBeNull()
    expect(puts(second.calls)).toHaveLength(0)
  })

  it('an open that fails (the store is down) shows the page read-only with the reason and Retry, which opens it', async () => {
    let opened = 0
    routes({ [`POST /api/pages/${ID}/sessions`]: () => (++opened === 1
      ? new Response(JSON.stringify({ error: NO_STORE, code: 'PRIVATE_STORE' }), { status: 503 })
      : { session: 'ses_1', base: 'b0', markdown: BODY }) })
    draw()
    const view = await editorView()
    expect(view.dom.getAttribute('contenteditable')).toBe('false')
    expect(view.dom.textContent).toBe(BODY.trimEnd())
    expect(await screen.findByText(`${OPEN_FAILED} ${NO_STORE}`)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('contenteditable')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(screen.getByRole('textbox', { name: /page body/ }).getAttribute('contenteditable')).toBe('true'))
    expect(opened).toBe(2)
    expect(screen.queryByText(`${OPEN_FAILED} ${NO_STORE}`)).toBeNull()
  })

  it('a save answered { save, session } landed in the next session, which every later request uses', async () => {
    const { calls } = routes({ 'PUT /api/sessions/ses_1': { save: 'direct', session: 'ses_2' }, 'PUT /api/sessions/ses_2': { save: 'direct' }, 'POST /api/sessions/ses_2/close': { commit: 'c2' } })
    const { unmount } = draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' One.')
    await vi.waitFor(() => expect(puts(calls)).toHaveLength(1), SAVE_WAIT)
    type(view, ' Two.')
    await vi.waitFor(() => expect(puts(calls)).toHaveLength(2), SAVE_WAIT)
    expect(puts(calls).map(c => c.path)).toEqual(['/api/sessions/ses_1', '/api/sessions/ses_2'])
    unmount()
    await vi.waitFor(() => expect(calls.some(c => c.path === '/api/sessions/ses_2/close')).toBe(true))
  })

  it('NO_SESSION (the server restarted) opens the next session and sends it the same text', async () => {
    let opened = 0
    const { calls } = routes({
      [`POST /api/pages/${ID}/sessions`]: () => ({ session: `ses_${++opened}`, base: `b${opened}`, markdown: BODY }),
      'PUT /api/sessions/ses_1': refuse(404, { error: 'There is no editing session ses_1.', code: 'NO_SESSION' }),
      'PUT /api/sessions/ses_2': { save: 'direct' },
    })
    draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' Again.')
    await vi.waitFor(() => expect(puts(calls)).toHaveLength(2), SAVE_WAIT)
    expect(puts(calls).map(c => [c.path, c.body])).toEqual([
      ['/api/sessions/ses_1', { markdown: `${BODY.trimEnd()} Again.\n` }], ['/api/sessions/ses_2', { markdown: `${BODY.trimEnd()} Again.\n` }]])
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.direct))
  })

  it.each([
    ['GONE', 'This page was deleted, or left the repository, since the session opened, so the draft cannot be written over it. Copy what you need from Compare. Nothing was written.'],
    ['NO_CONFLICT', 'This session has no newer version to resolve: close it to save the draft. Nothing was written.'],
  ])('Keep mine refused %s is said in its words', async (code, sentence) => {
    const compare = { base: BODY, theirs: '', mine: `${BODY.trimEnd()}!\n` }
    routes({
      'PUT /api/sessions/ses_1': refuse(409, { code: 'CONFLICT', error: 'Someone saved a newer version.', compare }),
      'POST /api/sessions/ses_1/resolve': refuse(409, { code, error: sentence }),
    })
    draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, '!')
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.conflict), SAVE_WAIT)
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    fireEvent.click(within(await screen.findByRole('region', { name: 'Compare' })).getByRole('button', { name: 'Keep mine' }))
    expect(await screen.findByText(sentence)).toBeTruthy()
  })

  it('the tab going away sends the last text with keepalive and no close; with nothing pending, it closes', async () => {
    const { fn, calls } = routes()
    const { unmount } = draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' Going.')
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    await vi.waitFor(() => expect(puts(calls)).toHaveLength(1))
    const init = (path: string) => fn.mock.calls.find(([u]) => String(u).endsWith(path))?.[1] as RequestInit | undefined
    expect(init('/api/sessions/ses_1')!.keepalive).toBe(true)
    expect(calls.some(c => c.path.endsWith('/close'))).toBe(false)
    // the debounced save still goes (the page may come back from the cache); then nothing is pending
    await vi.waitFor(() => expect(puts(calls)).toHaveLength(2), SAVE_WAIT)
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.direct))
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    await vi.waitFor(() => expect(calls.some(c => c.path === '/api/sessions/ses_1/close')).toBe(true))
    expect(init('/api/sessions/ses_1/close')!.keepalive).toBe(true)
    unmount()
  })
})

describe('Copy link, and who can see the page', () => {
  it('copies the page’s Hub address', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    routes()
    draw()
    await editorView()
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/${ID}`))
  })

  it.each([
    ['public', 'Who can see this: Public'],
    ['members', 'Who can see this: Members'],
    ['hat:ops', 'Who can see this: Ops and the hats above it (Council, Top)'],
    ['hat:top', 'Who can see this: Top'],
  ])('the line follows the page’s visibility: %s', async (level, line) => {
    routes({ [`GET /api/pages/${ID}`]: pageReadOf(ID, { visibility: level }) })
    draw()
    await editorView()
    expect(document.querySelector('.pg-who')!.textContent).toBe(line)
    expect(whoCanSee(FIXTURE_SOURCE.visibilityOf({ facts: { visibility: level } }), FIXTURE_SOURCE)).toBe(line)
  })
})

// --- DAO-OS L6 Task 16b (R-L6-SUGGEST): Suggest — a page editing session becomes a proposal
describe('Suggest an edit', () => {
  const approval = (over: Record<string, unknown> = {}) => routes({ [`GET /api/pages/${ID}`]: pageReadOf(ID, { mode: 'approval' }), ...over })
  const suggestButton = () => screen.queryByRole('button', { name: 'Suggest' })

  it('a person who may only suggest is offered Suggest and no direct save', async () => {
    approval()
    draw()
    await editorView()
    expect(suggestButton()).toBeTruthy()
    expect(saveWord()).toBe(SAVE_WORDS.approval)
    expect(saveWord()).not.toBe(SAVE_WORDS.direct)
    expect(document.querySelector('.ed-meta')!.textContent).toContain('Workspace write · needs approval')
  })

  // R-L6-SUGGEST-2 (the operator: "Everywhere, maintainers decide"): one who saves the page directly may suggest it too.
  it('a member who saves the page directly is offered Suggest beside the direct save', async () => {
    routes()
    draw()
    await editorView()
    expect(suggestButton()).toBeTruthy()
    expect(suggestButton()!.getAttribute('title')).toBe('Suggest this edit')
    expect(saveWord()).toBe(SAVE_WORDS.direct)
  })

  it('Suggest is never offered on a page the person cannot see, nor to one who may not write', async () => {
    // May not write: no Suggest.
    routes({ [`GET /api/pages/${ID}`]: pageReadOf(ID, { mode: 'none' }) })
    const b = draw()
    await editorView()
    expect(suggestButton()).toBeNull()
    b.unmount()
    // Previewing as someone who may see the page: no write control, so no Suggest.
    routes({ [`GET /api/pages/${ID}`]: pageReadOf(ID, { mode: 'approval', visibility: 'members' }) })
    const c = draw({ as: 'members' })
    await editorView()
    expect(suggestButton()).toBeNull()
    c.unmount()
    // A page the viewer may not see is absent, and so is everything on it.
    approval()
    draw({ as: 'members' })
    expect(await screen.findByRole('heading', { level: 1, name: `No page at /p/${ID}.` })).toBeTruthy()
    expect(suggestButton()).toBeNull()
  })

  it('a private page is not offered Suggest', async () => {
    const read = pageReadOf(ID, { mode: 'approval' })
    routes({ [`GET /api/pages/${ID}`]: { ...read, page: { ...read.page, path: null } } })
    draw()
    await editorView()
    expect(suggestButton()).toBeNull()
  })

  it('Suggest sends the editor’s text with the title and note, says they go to git, and links the proposal', async () => {
    let opened = 0
    const { calls } = approval({
      [`POST /api/pages/${ID}/sessions`]: () => ({ session: `ses_${++opened}`, base: 'b0', markdown: BODY }),
      'POST /api/sessions/ses_1/suggest': { id: 'P-2026-10-31-01', title: 'Edit to How the treasury is run', state: 'open' },
      'POST /api/sessions/ses_2/close': { commit: null },
    })
    draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' More.')
    fireEvent.click(suggestButton()!)
    const form = screen.getByRole('region', { name: 'Suggest this edit' })
    expect((within(form).getByLabelText('Title') as HTMLInputElement).value).toBe('Suggested edit to How the treasury is run')
    expect(form.textContent).toContain(SUGGEST_TO_GIT)
    fireEvent.change(within(form).getByLabelText('Note'), { target: { value: 'One more word.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Suggest' }))
    // Said on the page, under the bar, and once through the live region.
    await vi.waitFor(() => expect(screen.getAllByText(SUGGESTED('P-2026-10-31-01')).some(el => el.closest('.note') !== null)).toBe(true))
    const sent = calls.filter(c => c.path === '/api/sessions/ses_1/suggest')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.body).toEqual({
      markdown: 'The treasury is one Safe at the same address on seven chains. More.\n',
      proposal: { title: 'Suggested edit to How the treasury is run', rationale: 'One more word.' },
    })
    // The debounced save never went beside it, and a new session opened on the page as the repository holds it.
    expect(puts(calls)).toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Open the proposal' }).getAttribute('href')).toBe('/governance/proposals/P-2026-10-31-01')
    await vi.waitFor(() => expect(opened).toBe(2))
    expect(calls.some(c => c.path === '/api/sessions/ses_1/close')).toBe(false) // the server ended it: nothing is sent to it
    expect(screen.queryByRole('region', { name: 'Suggest this edit' })).toBeNull()
  })

  it('while the suggestion is sent the editor is read-only and the form says so; answered, it writes again', async () => {
    let answer!: (v: unknown) => void
    let opened = 0
    approval({
      [`POST /api/pages/${ID}/sessions`]: () => ({ session: `ses_${++opened}`, base: 'b0', markdown: BODY }),
      'POST /api/sessions/ses_1/suggest': () => new Promise(r => { answer = r }),
      'POST /api/sessions/ses_2/close': { commit: null },
    })
    draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' More.')
    fireEvent.click(suggestButton()!)
    const form = screen.getByRole('region', { name: 'Suggest this edit' })
    const ear = heard()
    fireEvent.click(within(form).getByRole('button', { name: 'Suggest' }))
    // said through the page's one polite region (C11 I-2), and shown in the form
    await vi.waitFor(() => expect(within(form).getByText(SENDING)).toBeTruthy())
    expect(ear.said).toContain(SENDING)
    ear.stop()
    expect(view.dom.getAttribute('contenteditable')).toBe('false')
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('contenteditable')).toBeNull()
    await act(async () => { answer({ id: 'P-2026-10-31-02', title: 'Edit to How the treasury is run', state: 'open' }) })
    await vi.waitFor(() => expect(opened).toBe(2))
    const again = await editorView()
    await vi.waitFor(() => expect(again.dom.getAttribute('contenteditable')).toBe('true'))
  })

  it('the save state goes back to "Edits need approval" once the suggestion has taken the page’s op out of the tray', async () => {
    let staged = true
    const op = { op: 'file', path: `pages/${ID}.md`, text: 'x', base: 'b0' }
    let opened = 0
    approval({
      'GET /api/changes': () => changeView(staged ? { ops: [op] } as never : {}),
      [`POST /api/pages/${ID}/sessions`]: () => ({ session: `ses_${++opened}`, base: 'b0', markdown: BODY }),
      'POST /api/sessions/ses_1/suggest': () => { staged = false; return { id: 'P-2026-10-31-03', title: 'x', state: 'open' } },
      'POST /api/sessions/ses_2/close': { commit: null },
    })
    draw()
    await editorView()
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.staged))
    fireEvent.click(suggestButton()!)
    fireEvent.click(within(screen.getByRole('region', { name: 'Suggest this edit' })).getByRole('button', { name: 'Suggest' }))
    await vi.waitFor(() => expect(saveWord()).toBe(SAVE_WORDS.approval))
  })

  // Task 16c fix round 2 (review I4): on a page saved directly the server commits the session's draft PAGE_IDLE_MS (60 s)
  // after its last save. While the Suggest form is open, the session is held: its last text goes again every
  // SUGGEST_HOLD_MS, so the edit being suggested is never committed by the idle end while its title and note are written.
  it('on a page saved directly, the open Suggest form holds the session so its idle end never commits the edit', async () => {
    expect(SUGGEST_HOLD_MS).toBe(20000) // a third of the server's PAGE_IDLE_MS (60000, server/workspace/sessions.ts)
    const { calls } = routes()
    draw()
    const view = await editorView()
    caretAtEnd(view)
    type(view, ' More.')
    await vi.waitFor(() => expect(puts(calls)).toHaveLength(1), SAVE_WAIT)
    const text = puts(calls)[0]!.body
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      fireEvent.click(suggestButton()!)
      expect(screen.getByRole('region', { name: 'Suggest this edit' })).toBeTruthy()
      await act(async () => { vi.advanceTimersByTime(SUGGEST_HOLD_MS - 1) })
      expect(puts(calls)).toHaveLength(1)
      await act(async () => { vi.advanceTimersByTime(1) })
      await vi.waitFor(() => expect(puts(calls)).toHaveLength(2))
      expect(puts(calls)[1]!.body).toEqual(text)
      await act(async () => { vi.advanceTimersByTime(SUGGEST_HOLD_MS) })
      await vi.waitFor(() => expect(puts(calls)).toHaveLength(3))
      expect(saveWord()).toBe(SAVE_WORDS.direct) // held quietly: the save state does not walk
      // The form put away (the bar's Suggest again): the hold ends.
      fireEvent.click(screen.getAllByRole('button', { name: 'Suggest' }).find(b => b.closest('.ed-bar') !== null)!)
      expect(screen.queryByRole('region', { name: 'Suggest this edit' })).toBeNull()
      await act(async () => { vi.advanceTimersByTime(3 * SUGGEST_HOLD_MS) })
      expect(puts(calls)).toHaveLength(3)
    } finally { vi.useRealTimers() }
  })

  it('on a page whose edits need approval, the open Suggest form sends nothing to hold: a session there commits nothing', async () => {
    const { calls } = approval({ 'PUT /api/sessions/ses_1': { save: 'staged' } })
    draw()
    await editorView()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      fireEvent.click(suggestButton()!)
      await act(async () => { vi.advanceTimersByTime(3 * SUGGEST_HOLD_MS) })
      expect(puts(calls)).toHaveLength(0)
    } finally { vi.useRealTimers() }
  })

  it('a refused suggestion is said in the form, in the server’s words', async () => {
    const said = 'Sync first: this repository has never fetched from its remote, so it cannot tell whether the trunk is behind. Sync first, then try again. Nothing was written.'
    approval({ 'POST /api/sessions/ses_1/suggest': refuse(409, { code: 'SYNC_FIRST', error: said }), 'PUT /api/sessions/ses_1': { save: 'staged' } })
    draw()
    await editorView()
    fireEvent.click(suggestButton()!)
    const form = screen.getByRole('region', { name: 'Suggest this edit' })
    const ear = heard()
    fireEvent.click(within(form).getByRole('button', { name: 'Suggest' }))
    // a clay error note, said once through the polite region: not an alert (C10, E-81)
    await vi.waitFor(() => expect(errorNote(form).textContent).toBe(said))
    await vi.waitFor(() => expect(ear.said).toContain(said))
    ear.stop()
    expect(screen.queryByText(/Suggested as proposal/)).toBeNull()
  })
})
// --- end L6 Task 16b

describe('ancestorsOf', () => {
  it('walks the parents nearest last, and stops at a loop', () => {
    const nodes = [
      { id: 'a', title: 'A', parent: 'b', order: 1, visibility: 'members' },
      { id: 'b', title: 'B', parent: 'a', order: 1, visibility: 'members' },
    ]
    expect(ancestorsOf('c', 'a', nodes).map(n => n.id)).toEqual(['b', 'a'])
    expect(ancestorsOf(ID, 'handbook-1a2b', [...PAGE_NODES]).map(n => n.id)).toEqual(['handbook-1a2b'])
  })
})

// R2 (plan D-6): while the Hub's writes are off the page is read, never edited: no editing session is opened (so nothing
// is saved, suggested or resolved), the editor is read-only, and New subpage and Move to… are not drawn. Presence beats,
// the read mark and the comments stay. With writes on, the same page opens its session and offers both.
describe('/p/:id while the Hub\'s writes are off', () => {
  for (const off of [true, false]) {
    it(off ? 'off: read only, no session, no New subpage or Move to…; presence, the read mark and Comments stay'
      : 'on: the session opens, the editor writes, New subpage and Move to… are offered', async () => {
      const { calls } = routes({
        ...statusRoute(off),
        [`POST /api/presence`]: { target: `page:${ID}`, people: [] },
        'POST /api/reads': { target: `page:${ID}`, at: '2026-11-11T00:00:00Z', read: 0 },
        'GET /api/notifications': [],
        [`GET /api/comments?target=page%3A${ID}`]: [],
      })
      renderAt(<PagePage id={ID} thread={pageThread} />, `/p/${ID}`, { queryClient: clientWith(off) })
      const view = await editorView()
      await vi.waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/api/presence')).toBe(true), { timeout: 4000 })
      await vi.waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/api/reads')).toBe(true), { timeout: 4000 })
      expect(screen.getByRole('button', { name: /^Comments, / })).toBeTruthy()
      if (off) {
        await new Promise(r => setTimeout(r, 100))
        expect(calls.filter(c => c.path.startsWith(`/api/pages/${ID}/sessions`) || c.path.startsWith('/api/sessions/'))).toEqual([])
        expect(view.dom.getAttribute('contenteditable')).toBe('false')
        expect(screen.queryByRole('button', { name: 'New subpage' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Move to…' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull()
        // R4a (the hosted walk, PR7-R67): nothing says an edit saves: no save state, and the meta line reads Read only
        expect(document.body.textContent).not.toContain('Saved · direct')
        expect(document.body.textContent).not.toContain('saves directly')
        expect(document.body.textContent).toContain('Read only')
      } else {
        expect(document.body.textContent).toContain('saves directly')
        await vi.waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === `/api/pages/${ID}/sessions`)).toBe(true), { timeout: 4000 })
        expect(screen.getByRole('button', { name: 'New subpage' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Move to…' })).toBeTruthy()
      }
    })
  }
})

// R2b (review M-1): until GET /api/status has loaded, the page opens no editing session on arrival (a refused write on a
// read-only Hub); the page reads meanwhile, and the session opens once the status says the writes are on.
describe('/p/:id before the status is read', () => {
  it('opens no session until the status says on, then opens it', async () => {
    let answer: (v: unknown) => void = () => {}
    const { calls } = routes({ 'GET /api/status': () => new Promise(r => { answer = r }) })
    renderAt(<PagePage id={ID} />, `/p/${ID}`)
    expect(await screen.findByText('Opening the page…', {}, { timeout: 4000 })).toBeTruthy()
    await new Promise(r => setTimeout(r, 100))
    expect(calls.filter(c => c.path.startsWith(`/api/pages/${ID}/sessions`))).toEqual([])
    answer(statusOf(false))
    await vi.waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === `/api/pages/${ID}/sessions`)).toBe(true), { timeout: 4000 })
    expect((await editorView()).dom.getAttribute('contenteditable')).toBe('true')
  })
})
