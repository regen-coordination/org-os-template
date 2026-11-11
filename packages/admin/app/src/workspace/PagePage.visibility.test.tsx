// @vitest-environment jsdom
// DAO-OS L6 Task 20 (spec §4.4, §12, §15): a page's visibility control in the editor bar. A narrowing that leaves the
// repository asks with the count of its subpages and L5's LEAVES_GIT sentence before posting; a widening of a git page to
// public stages a publication (a file op on its front matter) and reads "Members → Public, proposed"; a private page offers
// "Move into the repository…", which stages the move alone and then shows where it stands; the control is absent while
// previewing and for a viewer who may not write the page (Q77). The server decides: what is offered is what it accepts.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { EditorView } from 'prosemirror-view'
import { editorOf } from './EditorHost.tsx'
import type { VisibilityView } from '../api.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import { proposalView } from '../test/fixtures/proposals.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import type { Viewer } from '../viewAs/visibility.ts'
import { houseSource } from '../session/houseSource.ts'
import { PAGE_LEAVES_GIT } from '../../../lib/narrow.mjs'
import { splitPage } from '../../../lib/workspace/pages.mjs'
import PagePage from './PagePage.tsx'
import { gitSubpages } from './pageVisibility.tsx'

const CELO = 'eip155:42220'
const hat = (levels: string) => `${CELO}:0x0000000d${levels.padEnd(56, '0')}`
const TOP = hat(''), COUNCIL = hat('0001'), OPS = hat('0002')
const VIEW: VisibilityView = {
  tree: [{ hat: TOP, name: 'Top', above: [] }, { hat: COUNCIL, name: 'Council', above: [TOP] }, { hat: OPS, name: 'Ops', above: [TOP] }],
  worn: [OPS], levels: ['public', 'members', `hat:${OPS}`], config: { collections: {}, defaults: {} }, writable: ['projects'],
}
const PRIVATE = 'p-0123456789ab'
/** The tree the member reads: a handbook at the root, the treasury page under it with two git subpages and a private one,
 *  and a private page at the root. */
const TREE = [
  { id: 'handbook-1a2b', title: 'Handbook', parent: null, order: 1000, visibility: 'members' },
  { id: 'treasury-3c4d', title: 'How the treasury is run', parent: 'handbook-1a2b', order: 1000, visibility: 'members' },
  { id: 'safe-9a9a', title: 'The Safe', parent: 'treasury-3c4d', order: 1000, visibility: 'members' },
  { id: 'keys-1b1b', title: 'Who holds the keys', parent: 'safe-9a9a', order: 1000, visibility: 'members' },
  { id: 'p-00aa00aa00aa', title: 'Signer notes', parent: 'treasury-3c4d', order: 2000, visibility: `hat:${OPS}` },
  { id: PRIVATE, title: 'Ops notes', parent: null, order: 2000, visibility: `hat:${OPS}` },
  { id: 'welcome-5e5e', title: 'Welcome', parent: 'handbook-1a2b', order: 3000, visibility: 'members' },
]
const BODY = 'The treasury is one Safe at the same address on seven chains.\n'
function readOf(id: string, mode: 'direct' | 'approval' | 'none' = 'direct') {
  const n = TREE.find(p => p.id === id)!
  return {
    page: { id, title: n.title, parent: n.parent, path: n.visibility.startsWith('hat:') ? null : `pages/${id}.md`, visibility: n.visibility, markdown: BODY,
      edited: { at: '2026-11-05T09:00:00Z', by: 'ops-lead' },
      // the server's count of the git subpages a widening makes public with it (every one here takes its level)
      ...(n.visibility.startsWith('hat:') ? {} : { widens: gitSubpages(id, TREE) }) },
    write: { mode, rule: null }, backlinks: [],
  }
}

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

function serve(id: string, over: Record<string, unknown> = {}) {
  return fetchRoutes({
    ...baseRoutes(),
    'GET /api/visibility': VIEW,
    'GET /api/proposals': [],
    'GET /api/pages': TREE,
    [`GET /api/pages/${id}`]: readOf(id),
    'GET /api/presence': {},
    'POST /api/presence': { target: `page:${id}`, people: [] },
    'POST /api/reads': { target: `page:${id}`, at: '2026-11-05T09:00:00Z', read: 0 },
    [`POST /api/pages/${id}/sessions`]: { session: 'ses_1', base: 'b0', markdown: BODY },
    'PUT /api/sessions/ses_1': { save: 'direct' },
    'POST /api/sessions/ses_1/close': { commit: 'c1' },
    ...over,
  })
}
function draw(id: string, viewer?: Viewer) {
  return renderAt(<ViewAsProvider source={houseSource(VIEW)} initial={viewer}><PagePage id={id} /></ViewAsProvider>, `/p/${id}`)
}
const opened = (title: string) => screen.findByRole('textbox', { name: `${title} · page body` }, { timeout: 4000 })
const control = (name: RegExp) => screen.findByRole('button', { name }, { timeout: 4000 })
const posted = (calls: { method: string; path: string; body: unknown }[], path: string) => calls.filter(c => c.method === 'POST' && c.path === path)

describe('narrowing a page (§4.4)', () => {
  it('narrowing a page asks with the count of subpages and L5’s LEAVES_GIT sentence before posting; the session ends first', async () => {
    const { calls } = serve('treasury-3c4d', { 'POST /api/visibility/narrow': { commit: 'c2', moved: true, subpages: 2 } })
    draw('treasury-3c4d')
    await opened('How the treasury is run')
    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hat: Ops' }))
    const dialog = screen.getByRole('dialog', { name: 'Narrow to Hat: Ops?' })
    // two git subpages leave with it; the private one below it is already out of the repository
    expect(dialog.textContent).toContain(PAGE_LEAVES_GIT(2))
    expect(dialog.textContent).toContain("It and its 2 subpages leave the repository from now on. Its earlier versions stay in the repository's history")
    expect(posted(calls, '/api/visibility/narrow')).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posted(calls, '/api/visibility/narrow')).toEqual([])

    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hat: Ops' }))
    fireEvent.click(screen.getByRole('button', { name: 'Narrow to Hat: Ops' }))
    await waitFor(() => expect(posted(calls, '/api/visibility/narrow').map(c => c.body)).toEqual([{ target: { page: 'treasury-3c4d' }, level: `hat:${OPS}` }]))
    // the editing session was saved and closed before the page left the repository
    const at = (p: string) => calls.findIndex(c => c.method === 'POST' && c.path === p)
    expect(at('/api/sessions/ses_1/close')).toBeGreaterThanOrEqual(0)
    expect(at('/api/sessions/ses_1/close')).toBeLessThan(at('/api/visibility/narrow'))
  })

  it('a narrowing that stays in the repository (public → members) posts at once, with no question', async () => {
    const tree = TREE.map(n => (n.id === 'handbook-1a2b' ? { ...n, visibility: 'public' } : n))
    const { calls } = serve('handbook-1a2b', {
      'GET /api/pages': tree,
      'GET /api/pages/handbook-1a2b': { ...readOf('handbook-1a2b'), page: { ...readOf('handbook-1a2b').page, visibility: 'public' } },
      'POST /api/visibility/narrow': { commit: 'c2', moved: false },
    })
    draw('handbook-1a2b')
    await opened('Handbook')
    fireEvent.click(await control(/^Public/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Members' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(posted(calls, '/api/visibility/narrow').map(c => c.body)).toEqual([{ target: { page: 'handbook-1a2b' }, level: 'members' }]))
  })

  it('a refused narrowing is an error note in the server’s words (never an alert)', async () => {
    const sentence = 'Other pages link to this page by name: Welcome. Change those links to ↗ first. Nothing was changed.'
    serve('treasury-3c4d', { 'POST /api/visibility/narrow': refuse(409, { code: 'REFERRED', error: sentence }) })
    draw('treasury-3c4d')
    await opened('How the treasury is run')
    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hat: Ops' }))
    fireEvent.click(screen.getByRole('button', { name: 'Narrow to Hat: Ops' }))
    const note = await screen.findByText(sentence)
    expect(note.closest('.note-error')).not.toBeNull()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('widening a page (§4.4)', () => {
  const FILE = '---\nid: handbook-1a2b\ntitle: Handbook\nparent: null\norder: 1000\n---\nThe handbook.\n'

  it('widening a git page to public stages a publication op and reads "Members → Public, proposed"', async () => {
    let staged = changeView()
    const { calls } = serve('handbook-1a2b', {
      'GET /api/files?path=pages%2Fhandbook-1a2b.md': { path: 'pages/handbook-1a2b.md', text: FILE, base: 'blob-1', class: 'workspace', editor: 'page' },
      'GET /api/changes': () => staged,
      'POST /api/changes/ops': (init: RequestInit | undefined) => {
        const { ops } = JSON.parse(String(init!.body)) as { ops: Record<string, unknown>[] }
        staged = changeView({ ops: ops as never, classes: ['workspace', 'publication'] })
        return staged
      },
    })
    draw('handbook-1a2b')
    await opened('Handbook')
    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Public' }))
    // Task 20 review I2: asked first, with what it exposes (was: staged at once, no question)
    const dialog = screen.getByRole('dialog', { name: 'Widen to Public?' })
    expect(dialog.textContent).toContain('Handbook and its 4 subpages that take its level become public, for anyone to read, once decided.')
    expect(posted(calls, '/api/changes/ops')).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(posted(calls, '/api/changes/ops')).toEqual([])
    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Public' }))
    fireEvent.click(screen.getByRole('button', { name: 'Widen to Public' }))
    await waitFor(() => expect(posted(calls, '/api/changes/ops')).toHaveLength(1))
    const [op] = (posted(calls, '/api/changes/ops')[0]!.body as { ops: { op: string; path: string; text: string; base: string }[] }).ops
    expect(op).toMatchObject({ op: 'file', path: 'pages/handbook-1a2b.md', base: 'blob-1' })
    // the front matter gains the level, the rest of the file as it was
    expect(splitPage(op!.text).front).toMatchObject({ id: 'handbook-1a2b', title: 'Handbook', visibility: 'public' })
    expect(splitPage(op!.text).body).toBe('The handbook.\n')
    expect(posted(calls, '/api/visibility/narrow')).toEqual([])
    const b = await control(/^Members → Public, proposed$/)
    expect(b.querySelector('.vis-to')!.textContent).toBe('Public, proposed')
  })

  // Task 20 review I1 (PF-R96): the session ends first, so what the member typed is in the file the widening is built over.
  it('widening ends the editing session first, then reads the file, stages over it, and opens the next session', async () => {
    const { calls } = serve('handbook-1a2b', {
      'GET /api/files?path=pages%2Fhandbook-1a2b.md': { path: 'pages/handbook-1a2b.md', text: FILE, base: 'blob-2', class: 'workspace', editor: 'page' },
      'POST /api/changes/ops': changeView({ classes: ['workspace', 'publication'] }),
    })
    draw('handbook-1a2b')
    const box = await opened('Handbook')
    fireEvent.input(box, { target: { textContent: 'Typed.' } })
    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Public' }))
    fireEvent.click(screen.getByRole('button', { name: 'Widen to Public' }))
    await waitFor(() => expect(posted(calls, '/api/changes/ops')).toHaveLength(1))
    const at = (method: string, p: string) => calls.findIndex(c => c.method === method && c.path === p)
    expect(at('POST', '/api/sessions/ses_1/close')).toBeGreaterThanOrEqual(0)
    expect(at('POST', '/api/sessions/ses_1/close')).toBeLessThan(at('GET', '/api/files?path=pages%2Fhandbook-1a2b.md'))
    expect(at('GET', '/api/files?path=pages%2Fhandbook-1a2b.md')).toBeLessThan(at('POST', '/api/changes/ops'))
    expect((posted(calls, '/api/changes/ops')[0]!.body as { ops: { base: string }[] }).ops[0]!.base).toBe('blob-2')
    await waitFor(() => expect(posted(calls, '/api/pages/handbook-1a2b/sessions')).toHaveLength(2))
  })

  it('Public is not offered under a parent that is not public (a page is never more open than its parent)', async () => {
    serve('treasury-3c4d')
    draw('treasury-3c4d')
    await opened('How the treasury is run')
    fireEvent.click(await control(/^Members/))
    expect(screen.queryByRole('menuitemradio', { name: 'Public' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Move into the repository/ })).toBeNull()
  })
})

describe('a private page moved into the repository (§12)', () => {
  const moved = changeView({ private: [{ ref: 'stg-1', class: 'workspace', op: { op: 'move-to-git', collection: 'pages', id: PRIVATE, level: 'members' } }] } as never)

  it('a private page offers "Move into the repository…", which stages move-to-git and shows the proposal’s state', async () => {
    let staged = changeView()
    const { calls } = serve(PRIVATE, {
      'GET /api/changes': () => staged,
      'POST /api/changes/ops': () => { staged = moved; return staged },
    })
    draw(PRIVATE)
    await opened('Ops notes')
    fireEvent.click(await control(/^Hat: Ops/))
    // the move is the way in: no Members or Public level to pick, nor a wider hat
    expect(screen.queryByRole('menuitemradio', { name: 'Members' })).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: 'Public' })).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: 'Hat: Council' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move into the repository…' }))
    const dialog = screen.getByRole('dialog', { name: 'Move into the repository?' })
    expect(within(dialog).getAllByRole('radio').map(r => r.closest('label')!.querySelector('.choice-t')!.textContent)).toEqual(['Members', 'Public'])
    expect(posted(calls, '/api/changes/ops')).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stage the move' }))
    await waitFor(() => expect(posted(calls, '/api/changes/ops').map(c => c.body)).toEqual([{ ops: [{ op: 'update', record: `pages:${PRIVATE}`, set: { visibility: 'members' } }] }]))
    // the session ended first, so the move pins the page as it was typed
    const at = (p: string) => calls.findIndex(c => c.method === 'POST' && c.path === p)
    expect(at('/api/sessions/ses_1/close')).toBeLessThan(at('/api/changes/ops'))
    await control(/^Hat: Ops → Members, proposed$/)
    // staged, it is not offered again
    fireEvent.click(await control(/^Hat: Ops → Members, proposed$/))
    expect(screen.queryByRole('menuitem', { name: 'Move into the repository…' })).toBeNull()
  })

  it('an open proposal holding the move reads as proposed, and the menu names the proposal and its state', async () => {
    const open = proposalView({ id: 'p-9', author: 'steward-a', derived: 'approving', ops: [{ op: 'private', ref: 'stg-1', class: 'workspace', publication: true }] as never,
      private: [{ ref: 'stg-1', class: 'workspace', op: { op: 'move-to-git', collection: 'pages', id: PRIVATE, level: 'public' }, says: 'Moves Ops notes into the repository, readable by public.' }] } as never)
    serve(PRIVATE, { 'GET /api/proposals': [open] })
    draw(PRIVATE)
    await opened('Ops notes')
    fireEvent.click(await control(/^Hat: Ops → Public, proposed$/))
    const link = screen.getByRole('menuitem', { name: 'Proposal p-9 · Approving' })
    expect(link.getAttribute('href')).toBe('/governance/proposals/p-9')
    expect(screen.queryByRole('menuitem', { name: 'Move into the repository…' })).toBeNull()
  })

  it('a refused move is an error note in the server’s words', async () => {
    const sentence = 'Ops notes has comments written while it was private, which everyone it moves to would read: delete them first, or keep it private. Nothing was staged.'
    serve(PRIVATE, { 'POST /api/changes/ops': refuse(422, { errors: [{ record: `pages:${PRIVATE}`, field: '', message: sentence }] }) })
    draw(PRIVATE)
    await opened('Ops notes')
    fireEvent.click(await control(/^Hat: Ops/))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move into the repository…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stage the move' }))
    const note = await screen.findByText(sentence)
    expect(note.closest('.note-error')).not.toBeNull()
  })
})

describe('who is drawn the control (Q77)', () => {
  it('the control is hidden while previewing and for a viewer who may not write the thing', async () => {
    serve('handbook-1a2b')
    const first = draw('handbook-1a2b', { as: 'members' })
    await opened('Handbook')
    await waitFor(() => expect(document.querySelector('.ed-bar .vis')?.textContent).toBe('Members'))
    expect(document.querySelector('.vis-ctl')).toBeNull()
    first.unmount()

    serve('handbook-1a2b', { 'GET /api/pages/handbook-1a2b': readOf('handbook-1a2b', 'none') })
    draw('handbook-1a2b')
    await opened('Handbook')
    await waitFor(() => expect(document.querySelector('.ed-bar .vis')?.textContent).toBe('Members'))
    expect(document.querySelector('.vis-ctl')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Members/ })).toBeNull()
  })

  it('a writer is drawn the control only once the visibility view is read (nothing offered from the fixtures)', async () => {
    serve('handbook-1a2b', { 'GET /api/visibility': () => new Promise(() => {}) })
    draw('handbook-1a2b')
    await opened('Handbook')
    expect(document.querySelector('.vis-ctl')).toBeNull()
  })
})

// DAO-OS L6 Task 20 review C1 (PF-R95): a page whose edit your tray stages does not leave the repository; the server refuses
// it too (409 STAGED), and the Hub says so before anything is asked, ended or posted.
describe('a narrowing while your tray stages an edit of the tree (C1)', () => {
  const held = (path: string) => changeView({ ops: [{ op: 'file', path, text: '---\nid: x\n---\nEdited.\n', base: 'blob-1' }] as never, classes: ['workspace'] })

  it('is not asked nor posted while the tray stages an edit of the page: an error note says why, and the session stays open', async () => {
    const { calls } = serve('treasury-3c4d', { 'GET /api/changes': held('pages/treasury-3c4d.md') })
    draw('treasury-3c4d')
    await opened('How the treasury is run')
    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hat: Ops' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const note = await screen.findByText('Your changes stage an edit of this page: apply or discard it first. Nothing was changed.')
    expect(note.closest('.note-error')).not.toBeNull()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(posted(calls, '/api/visibility/narrow')).toEqual([])
    expect(posted(calls, '/api/sessions/ses_1/close')).toEqual([])
  })

  it('names a staged subpage by its title', async () => {
    const { calls } = serve('treasury-3c4d', { 'GET /api/changes': held('pages/keys-1b1b.md') })
    draw('treasury-3c4d')
    await opened('How the treasury is run')
    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hat: Ops' }))
    await screen.findByText('Your changes stage an edit of Who holds the keys, a subpage of this page: apply or discard it first. Nothing was changed.')
    expect(posted(calls, '/api/visibility/narrow')).toEqual([])
  })
})

// DAO-OS L6 Task 20 review I3 (PF-R98, the fallback): a narrowing out of the repository ends the session first, which commits
// its text to git at the level it had. With uncommitted text the dialog says so plainly and narrows only on that explicit
// choice, never by default.
describe('a narrowing with uncommitted edits (I3)', () => {
  const typeAtEnd = (view: EditorView, text: string) => act(() => {
    for (const ch of text) { const { from, to } = view.state.selection; view.dispatch(view.state.tr.insertText(ch, from, to)) }
  })
  const COMMITTED_FIRST = 'Your edits from this session are committed to the repository first, where members can read them.'

  it('says the edits are committed first, and holds the narrowing until that is chosen', async () => {
    const { calls } = serve('treasury-3c4d', { 'POST /api/visibility/narrow': { commit: 'c2', moved: true, subpages: 2 } })
    draw('treasury-3c4d')
    const view = editorOf(await opened('How the treasury is run'))!.view
    typeAtEnd(view, ' Meant for Ops.')
    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hat: Ops' }))
    const dialog = screen.getByRole('dialog', { name: 'Narrow to Hat: Ops?' })
    expect(dialog.textContent).toContain(COMMITTED_FIRST)
    const confirm = within(dialog).getByRole('button', { name: 'Narrow to Hat: Ops' })
    expect(confirm.hasAttribute('disabled') || confirm.getAttribute('aria-disabled') === 'true').toBe(true)
    fireEvent.click(confirm)
    expect(posted(calls, '/api/visibility/narrow')).toEqual([])
    expect(posted(calls, '/api/sessions/ses_1/close')).toEqual([])
    const group = within(dialog).getByRole('radiogroup', { name: 'Your edits from this session' })
    expect(within(group).getAllByRole('radio').every(r => !(r as HTMLInputElement).checked)).toBe(true)
    fireEvent.click(within(group).getByRole('radio', { name: /Keep them in the editor/ }))
    expect(confirm.hasAttribute('disabled') || confirm.getAttribute('aria-disabled') === 'true').toBe(true)
    fireEvent.click(within(group).getByRole('radio', { name: /Commit them, then narrow/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Narrow to Hat: Ops' }))
    await waitFor(() => expect(posted(calls, '/api/visibility/narrow')).toHaveLength(1))
  })

  it('with nothing typed, the dialog asks only the narrowing', async () => {
    serve('treasury-3c4d')
    draw('treasury-3c4d')
    await opened('How the treasury is run')
    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hat: Ops' }))
    const dialog = screen.getByRole('dialog', { name: 'Narrow to Hat: Ops?' })
    expect(dialog.textContent).not.toContain(COMMITTED_FIRST)
    expect(within(dialog).queryByRole('radiogroup')).toBeNull()
  })
})

// DAO-OS L6 Task 20 review minors: M2 (a preview shows no level from your own staged ops), M4 (a staged move holds the
// editor), M5 (the editor holds while the session ends).
describe('the level in flight and the editor around a level change (M2, M4, M5)', () => {
  const WIDENING = '---\nid: handbook-1a2b\ntitle: Handbook\nparent: null\norder: 1000\nvisibility: public\n---\nThe handbook.\n'

  it('M2: previewing, your own staged widening is not drawn as the level in flight; an open proposal’s still is', async () => {
    serve('handbook-1a2b', { 'GET /api/changes': changeView({ ops: [{ op: 'file', path: 'pages/handbook-1a2b.md', text: WIDENING, base: 'blob-1' }] as never }) })
    const first = draw('handbook-1a2b', { as: 'members' })
    await opened('Handbook')
    await waitFor(() => expect(document.querySelector('.ed-bar .vis')?.textContent).toBe('Members'))
    // and it stays so once the tray is read
    await new Promise(r => setTimeout(r, 50))
    expect(document.querySelector('.ed-bar .vis')?.textContent).toBe('Members')
    first.unmount()

    const open = proposalView({ id: 'p-7', author: 'steward-a', derived: 'approving', ops: [{ op: 'file', path: 'pages/handbook-1a2b.md', text: WIDENING, base: 'blob-1' }] as never })
    serve('handbook-1a2b', { 'GET /api/proposals': [open] })
    draw('handbook-1a2b', { as: 'members' })
    await opened('Handbook')
    await waitFor(() => expect(document.querySelector('.ed-bar .vis')?.textContent).toContain('Public, proposed'))
  })

  it('M4: while a move of the page is staged, the editor is read-only and a note says the move would go stale', async () => {
    serve(PRIVATE, { 'GET /api/changes': changeView({ private: [{ ref: 'stg-1', class: 'workspace', op: { op: 'move-to-git', collection: 'pages', id: PRIVATE, level: 'members' } }] } as never) })
    draw(PRIVATE)
    const box = await opened('Ops notes')
    await screen.findByText('A move of this page into the repository is staged: an edit now would leave the move stale. Apply or discard it first.')
    await waitFor(() => expect(editorOf(box)!.view.dom.getAttribute('contenteditable')).toBe('false'))
  })

  it('K5: while an open proposal holds the move, the editor is read-only and a note names the proposal', async () => {
    const open = proposalView({ id: 'p-9', author: 'steward-b', derived: 'approving', ops: [{ op: 'private', ref: 'stg-1', class: 'workspace', publication: true }] as never,
      private: [{ ref: 'stg-1', class: 'workspace', op: { op: 'move-to-git', collection: 'pages', id: PRIVATE, level: 'members' }, says: 'Moves Ops notes into the repository, readable by members.' }] } as never)
    serve(PRIVATE, { 'GET /api/proposals': [open] })
    draw(PRIVATE)
    const box = await opened('Ops notes')
    await screen.findByText('A move of this page into the repository is proposed in p-9: an edit now would leave the move stale. Decide or withdraw the proposal first.')
    await waitFor(() => expect(editorOf(box)!.view.dom.getAttribute('contenteditable')).toBe('false'))
  })

  it('M5: while the session ends before a narrowing, the editor is read-only', async () => {
    serve('treasury-3c4d', { 'POST /api/sessions/ses_1/close': () => new Promise(() => {}) })
    draw('treasury-3c4d')
    const box = await opened('How the treasury is run')
    expect(editorOf(box)!.view.dom.getAttribute('contenteditable')).toBe('true')
    fireEvent.click(await control(/^Members/))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hat: Ops' }))
    fireEvent.click(screen.getByRole('button', { name: 'Narrow to Hat: Ops' }))
    await waitFor(() => expect(editorOf(box)!.view.dom.getAttribute('contenteditable')).toBe('false'))
  })
})
