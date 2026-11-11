// @vitest-environment jsdom
// DAO-OS L6 Task 18: the conversation on a page in the Hub — L4c's CommentThread on the comments the server serves, its
// sending states, a mention's `notTold`, Resolve and Turn into a task, the picker, and a comment on a selected passage.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse } from '../test/data.ts'
import { PAGE_NODES, pageReadOf } from '../test/fixtures/house/workspace.ts'
import { Icon } from '../design/Icon.tsx'
import { MentionPicker } from '../elements/workspace/MentionPicker.tsx'
import { expandMentions, mentionQuery } from '../elements/workspace/mentions.ts'
import { entryHref } from '../hrefs.ts'
import PagePage from './PagePage.tsx'
import { pageThread, RecordThread } from './ConversationThread.tsx'
import { editorOf } from './EditorHost.tsx'
import { OPEN_TASK, TASK_MADE } from './useConversation.ts'
import { FIXTURE_SOURCE, type Visibility } from '../viewAs/visibility.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { clientWith, statusRoute } from '../test/writesOff.ts'

const MEMBERS: Visibility = { level: 'members' }

const ID = 'treasury-3c4d'
const TARGET = `page:${ID}`
const BODY = 'The treasury is one Safe at the same address on seven chains.\n'
const AT = '2026-10-31T09:00:00.000Z'
/** The server's NOT_TOLD (server/workspace/conversation.ts; the server module does not load in jsdom). */
const NOT_TOLD = (h: string) => `Not told: ${h} can’t see this page.`
const NO_STORE = 'This server has no private store open, so nothing private can be read or written here.'

type Served = Record<string, unknown> & { id: string; replies: Served[] }
const served = (over: Partial<Served> & { id: string }): Served => ({
  handle: 'steward-b', role: 'Steward B', at: AT, body: 'Do we write the season down?', state: 'sent', replies: [],
  by: 'steward-b', target: TARGET, parent: null, ...over,
})

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear() })

function routes(over: Record<string, unknown> = {}) {
  return fetchRoutes({
    ...baseRoutes(),
    'GET /api/pages': PAGE_NODES,
    [`GET /api/pages/${ID}`]: pageReadOf(ID, { visibility: 'members' }),
    'GET /api/presence': {},
    'POST /api/presence': { target: TARGET, people: [] },
    'POST /api/reads': { target: TARGET, at: AT, read: 0 },
    [`POST /api/pages/${ID}/sessions`]: { session: 'ses_1', base: 'b0', markdown: BODY },
    'PUT /api/sessions/ses_1': { save: 'direct' },
    'POST /api/sessions/ses_1/close': { commit: null },
    'GET /api/comments': [],
    ...over,
  })
}
const draw = () => renderAt(<PagePage id={ID} thread={pageThread} />, `/p/${ID}`)
async function editorView(): Promise<EditorView> {
  const box = await screen.findByRole('textbox', { name: 'How the treasury is run · page body' }, { timeout: 4000 })
  return editorOf(box)!.view
}
async function openThread(n = 0): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: `Comments, ${n}` }))
  return screen.findByRole('complementary', { name: 'Comments' })
}
const write = (thread: HTMLElement, text: string, label = 'Comment') => {
  const box = within(thread).getByRole('textbox', { name: label }) as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: text, selectionStart: text.length } })
  return box
}
const posts = (calls: { method: string; path: string; body: unknown }[], path = '/api/comments') => calls.filter(c => c.method === 'POST' && c.path === path)

describe('the conversation on a page (§8.2, Task 18)', () => {
  it('the thread lists the target’s comments in L4c’s shape; send shows Sending… then sent; a failed send shows Not sent with Retry and Discard', async () => {
    let answer!: (v: unknown) => void
    let sends = 0
    const { calls } = routes({
      'GET /api/comments': [served({ id: 'cmt_1', replies: [served({ id: 'cmt_2', handle: 'steward-a', role: 'Steward A', by: 'steward-a', parent: 'cmt_1', body: 'In the pool rules.' })] })],
      'POST /api/comments': (init: RequestInit) => {
        sends++
        const body = JSON.parse(String(init.body)) as { body: string }
        if (sends === 1) return new Promise(r => { answer = r })
        if (sends === 2) return refuse(503, { error: NO_STORE })()
        return { comment: served({ id: `cmt_${sends + 10}`, handle: 'steward-a', role: 'Steward A', by: 'steward-a', body: body.body }), notTold: [] }
      },
    })
    draw()
    await editorView()
    const thread = await openThread(1)
    expect(calls.some(c => c.method === 'GET' && c.path === `/api/comments?target=${encodeURIComponent(TARGET)}`)).toBe(true)
    // L4c's shape: the speaker by name, the reply under its root, the viewer's own reply as "You"
    expect(await within(thread).findByText('Do we write the season down?')).toBeTruthy()
    expect(within(thread).getByText('Steward B')).toBeTruthy()
    expect(thread.querySelector('.cmt-reply .cmt-b')!.textContent).toBe('In the pool rules.')
    expect(within(thread).getByText('You')).toBeTruthy()

    // send: Sending… until the server answers, then sent (its time, no state word)
    write(thread, 'Linking is enough.')
    fireEvent.click(within(thread).getByRole('button', { name: 'Comment' }))
    expect(await within(thread).findByText('Sending…')).toBeTruthy()
    expect(posts(calls)[0]!.body).toEqual({ target: TARGET, body: 'Linking is enough.' })
    await act(async () => { answer({ comment: served({ id: 'cmt_3', handle: 'steward-a', role: 'Steward A', by: 'steward-a', body: 'Linking is enough.' }), notTold: [] }) })
    await vi.waitFor(() => expect(within(thread).queryByText('Sending…')).toBeNull())
    const sent = within(thread).getByText('Linking is enough.').closest('article')!
    expect(sent.classList.contains('cmt-sent')).toBe(true)
    expect(screen.getByRole('button', { name: 'Comments, 2' })).toBeTruthy()

    // a refused send: Not sent, the server's reason, Retry and Discard; Retry sends it again
    write(thread, 'Second thought.')
    fireEvent.click(within(thread).getByRole('button', { name: 'Comment' }))
    expect(await within(thread).findByText('Not sent')).toBeTruthy()
    expect(within(thread).getByText(NO_STORE)).toBeTruthy()
    fireEvent.click(within(thread).getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(within(thread).getByText('Second thought.').closest('article')!.classList.contains('cmt-sent')).toBe(true))
    expect(within(thread).queryByText('Not sent')).toBeNull()
    expect(within(thread).queryByText(NO_STORE)).toBeNull()
    expect(posts(calls)).toHaveLength(3)
    expect(posts(calls)[2]!.body).toEqual({ target: TARGET, body: 'Second thought.' })
  })

  it('Discard drops a comment that was not sent', async () => {
    routes({ 'POST /api/comments': refuse(503, { error: NO_STORE }) })
    draw()
    await editorView()
    const thread = await openThread()
    write(thread, 'Lost words.')
    fireEvent.click(within(thread).getByRole('button', { name: 'Comment' }))
    expect(await within(thread).findByText('Not sent')).toBeTruthy()
    fireEvent.click(within(thread).getByRole('button', { name: 'Discard' }))
    expect(within(thread).queryByText('Lost words.')).toBeNull()
  })

  it('a mention of someone who can’t see shows NOT_TOLD under the comment', async () => {
    routes({
      'POST /api/comments': (init: RequestInit) => ({
        comment: served({ id: 'cmt_9', handle: 'steward-a', role: 'Steward A', by: 'steward-a', body: JSON.parse(String(init.body)).body }),
        notTold: [NOT_TOLD('steward-c')],
      }),
    })
    draw()
    await editorView()
    const thread = await openThread()
    write(thread, 'Ask [@Steward C](hub:member/steward-c) about it.')
    fireEvent.click(within(thread).getByRole('button', { name: 'Comment' }))
    const note = await within(thread).findByText(NOT_TOLD('steward-c'))
    expect(note.closest('article')!.querySelector('.cmt-b')!.textContent).toBe('Ask @Steward C about it.')
    // the mention is drawn as L4c's Mention: a link to the member's page
    expect(within(note.closest('article')!).getByRole('link', { name: 'Steward C' }).getAttribute('href')).toBe(entryHref('members', 'steward-c'))
  })

  it('Resolve collapses to "Resolved by …"; Turn into a task links the new task', async () => {
    const root = served({ id: 'cmt_1', body: 'Check the season.', replies: [served({ id: 'cmt_2', parent: 'cmt_1', body: 'Yes.' })] })
    const { calls } = routes({
      'GET /api/comments': [root],
      'POST /api/comments/cmt_1/task': { task: 'check-the-season', commit: 'c0ffee' },
      'POST /api/comments/cmt_1/resolve': { comment: { ...root, task: 'check-the-season', resolved: { by: 'steward-a', at: AT, role: 'Steward A' } } },
    })
    draw()
    await editorView()
    const thread = await openThread(1)
    await within(thread).findByText('Check the season.')
    fireEvent.click(within(thread).getByRole('button', { name: 'Turn into a task' }))
    const made = await within(thread).findByText(TASK_MADE('check-the-season'))
    expect(within(made).getByRole('link', { name: OPEN_TASK }).getAttribute('href')).toBe(entryHref('tasks', 'check-the-season'))
    expect(posts(calls, '/api/comments/cmt_1/task')).toHaveLength(1)
    // fix round 1: a comment becomes one task: the act is not offered again
    expect(within(thread).queryByRole('button', { name: 'Turn into a task' })).toBeNull()

    fireEvent.click(within(thread).getByRole('button', { name: 'Resolve' }))
    // fix round 1: the resolver is named as authors are (the server's `role`)
    await vi.waitFor(() => expect(thread.querySelector('.cmt-resolved')?.textContent).toMatch(/^Resolved by Steward A · 1 reply · Show/))
    expect(within(thread).queryByText('Check the season.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Comments, 0' })).toBeTruthy()
  })

  it('the task a comment became is served on it: everyone reads "Turned into the task …" and is not offered it again (fix round 1)', async () => {
    routes({ 'GET /api/comments': [served({ id: 'cmt_1', body: 'Check the season.', task: 'check-the-season', resolved: { by: 'steward-b', at: AT } })] })
    draw()
    await editorView()
    const thread = await openThread(0)
    fireEvent.click(await within(thread).findByRole('button', { name: 'Show' }))
    const made = await within(thread).findByText(TASK_MADE('check-the-season'))
    expect(within(made).getByRole('link', { name: OPEN_TASK }).getAttribute('href')).toBe(entryHref('tasks', 'check-the-season'))
    expect(within(thread).queryByRole('button', { name: 'Turn into a task' })).toBeNull()
    // no name served: the handle
    expect(thread.querySelector('.cmt-resolved')!.textContent).toMatch(/^Resolved by steward-b/)
  })

  it('the picker answers `@` from GET /api/mentionables; the comment is sent with the mention’s Markdown', async () => {
    const { calls } = routes({
      'GET /api/mentionables': [
        { kind: 'person', id: 'steward-b', label: 'Steward B', hat: 'Council', canSee: true, href: 'hub:member/steward-b' },
        { kind: 'person', id: 'steward-c', label: 'Steward C', canSee: false, href: 'hub:member/steward-c' },
      ],
      'POST /api/comments': (init: RequestInit) => ({ comment: served({ id: 'cmt_5', handle: 'steward-a', role: 'Steward A', by: 'steward-a', body: JSON.parse(String(init.body)).body }), notTold: [] }),
    })
    draw()
    await editorView()
    const thread = await openThread()
    const box = write(thread, 'Over to @ste')
    const picker = await within(thread).findByRole('listbox', { name: 'Mention' })
    expect(calls.some(c => c.path === `/api/mentionables?target=${encodeURIComponent(TARGET)}&q=ste`)).toBe(true)
    expect(within(picker).getByRole('option', { name: /Steward C/ }).getAttribute('aria-disabled')).toBe('true')
    // Enter in the box picks the active option (the box keeps the caret; its keys go to the listbox)
    fireEvent.keyDown(box, { key: 'Enter' })
    await vi.waitFor(() => expect(box.value).toBe('Over to @Steward B '))
    expect(within(thread).queryByRole('listbox', { name: 'Mention' })).toBeNull()
    fireEvent.click(within(thread).getByRole('button', { name: 'Comment' }))
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(posts(calls)[0]!.body).toEqual({ target: TARGET, body: 'Over to [@Steward B](hub:member/steward-b)' })
  })

  it('Comment on a selected passage sends its quote as the anchor; Show the passage rings it in the editor', async () => {
    const into = vi.fn()
    Element.prototype.scrollIntoView = into
    let listed: Served[] = []
    const { calls } = routes({
      'GET /api/comments': () => listed,
      'POST /api/comments': (init: RequestInit) => {
        const b = JSON.parse(String(init.body)) as { body: string; anchor: { exact: string; prefix: string; suffix: string } }
        const c = served({ id: 'cmt_7', handle: 'steward-a', role: 'Steward A', by: 'steward-a', body: b.body, anchor: { id: 'cmt_7', text: b.anchor.exact, ...b.anchor } })
        listed = [c]
        return { comment: c, notTold: [] }
      },
    })
    draw()
    const view = await editorView()
    const start = BODY.indexOf('one Safe') + 1 // the paragraph opens at 1
    act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, start + 'one Safe'.length))) })
    fireEvent.click(await screen.findByRole('button', { name: 'Comment' }))
    const thread = await screen.findByRole('complementary', { name: 'Comments' })
    expect(within(thread).getByText('On “one Safe”')).toBeTruthy()
    write(thread, 'Which Safe?')
    fireEvent.click(within(thread).getByRole('button', { name: 'Comment' }))
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(posts(calls)[0]!.body).toEqual({
      target: TARGET, body: 'Which Safe?', anchor: { exact: 'one Safe', prefix: 'The treasury is ', suffix: ' at the same address on seven ch' },
    })
    expect(within(thread).queryByText('On “one Safe”')).toBeNull() // the passage goes with the comment
    // the passage is marked in the editor (L4c's Commented), and Show the passage rings it there
    await vi.waitFor(() => expect(view.dom.querySelector('mark.ed-cmt[data-anchor="cmt_7"]')?.textContent).toBe('one Safe'))
    fireEvent.click(await within(thread).findByRole('button', { name: 'Show the passage: “one Safe”' }))
    await vi.waitFor(() => expect(view.dom.querySelector('mark.ed-cmt.on')?.getAttribute('data-anchor')).toBe('cmt_7'))
    expect(into).toHaveBeenCalled()
    expect(view.dom.contains(into.mock.contexts[0] as Node)).toBe(true)
  })

  it('a preview as the public draws no thread and reads no comments (conversation is the members’ side)', async () => {
    const { calls } = routes({ [`GET /api/pages/${ID}`]: pageReadOf(ID, { visibility: 'public' }), 'GET /api/comments': [served({ id: 'cmt_1' })] })
    renderAt(<ViewAsProvider source={FIXTURE_SOURCE} initial={{ as: 'public' }}><PagePage id={ID} thread={pageThread} /></ViewAsProvider>, `/p/${ID}`)
    await editorView()
    fireEvent.click(screen.getByRole('button', { name: 'Comments, 0' }))
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull()
    expect(calls.some(c => c.path.startsWith('/api/comments'))).toBe(false)
  })

  it('a record’s thread lists and sends on `record:<collection>:<id>`', async () => {
    const target = 'record:tasks:count-the-signers'
    const { calls } = routes({
      'GET /api/comments': [served({ id: 'cmt_1', target, body: 'Who counts?' })],
      'POST /api/reads': { target, at: AT, read: 0 },
      'POST /api/comments': { comment: served({ id: 'cmt_2', target, handle: 'steward-a', role: 'Steward A', by: 'steward-a', body: 'I do.' }), notTold: [] },
    })
    renderAt(<RecordThread target={target} visibility={MEMBERS} me={{ handle: 'steward-a', role: 'Steward A' }} />, '/r/task/count-the-signers')
    const thread = await screen.findByRole('complementary', { name: 'Comments' })
    expect(await within(thread).findByText('Who counts?')).toBeTruthy()
    write(thread, 'I do.')
    fireEvent.click(within(thread).getByRole('button', { name: 'Comment' }))
    await vi.waitFor(() => expect(posts(calls)[0]?.body).toEqual({ target, body: 'I do.' }))
    expect(posts(calls, '/api/reads')[0]!.body).toEqual({ target })
  })
})

describe('the mention picker reads a record’s collection (L4c C3’s carry)', () => {
  it('draws a record’s glyph from `recordKind`, never from its id', () => {
    renderAt(<MentionPicker items={[{ kind: 'record', id: 'projects:count', label: 'Count the signers', canSee: true, recordKind: 'tasks', href: 'hub:record/tasks/count' }]} onPick={() => {}} />)
    const svg = screen.getByRole('option', { name: /Count the signers/ }).querySelector('svg')!
    expect(svg.outerHTML).toBe(renderToStaticMarkup(<Icon name="check" />))
  })
})

describe('mentions typed in the composer', () => {
  it('reads the `@` word before the caret', () => {
    expect(mentionQuery('Ask @ste', 8)).toBe('ste')
    expect(mentionQuery('@', 1)).toBe('')
    expect(mentionQuery('mail a@b', 8)).toBeNull()
    expect(mentionQuery('Ask @ste now', 12)).toBeNull()
  })
  it('sends each picked `@label` as its Markdown, the longer name first, a link left alone', () => {
    const picks = [{ label: 'Steward', markdown: '[@Steward](hub:role/steward)' }, { label: 'Steward B', markdown: '[@Steward B](hub:member/steward-b)' }]
    expect(expandMentions('@Steward B and @Steward, and [@Steward](x)', picks))
      .toBe('[@Steward B](hub:member/steward-b) and [@Steward](hub:role/steward), and [@Steward](x)')
    expect(expandMentions('@Stewardship', picks)).toBe('@Stewardship')
  })
})

// R2b (review M-2): while the Hub's writes are off the editor is read-only, but a comment on a passage writes only the
// conversation (an allowed route): the selection toolbar offers Comment alone, without Bold, Link or Mention. With writes
// on, the editing toolbar is drawn whole, Comment among its buttons.
describe('a comment on a selected passage, the Hub\'s writes off and on', () => {
  for (const off of [true, false]) {
    it(off ? 'off: the read-only page offers Comment alone on a selection, and the comment is sent'
      : 'on: the editing toolbar is whole, Comment among it', async () => {
      const { calls } = routes({
        ...statusRoute(off),
        'POST /api/comments': (init: RequestInit) => {
          const b = JSON.parse(String(init.body)) as { body: string }
          return { comment: served({ id: 'cmt_9', handle: 'steward-a', role: 'Steward A', by: 'steward-a', body: b.body }), notTold: [] }
        },
      })
      renderAt(<PagePage id={ID} thread={pageThread} />, `/p/${ID}`, { queryClient: clientWith(off) })
      const live = await editorView()
      expect(live.dom.getAttribute('contenteditable')).toBe(off ? 'false' : 'true')
      const start = BODY.indexOf('one Safe') + 1
      act(() => { live.dispatch(live.state.tr.setSelection(TextSelection.create(live.state.doc, start, start + 'one Safe'.length))) })
      const bar = await screen.findByRole('toolbar', { name: 'Format' })
      expect(within(bar).getAllByRole('button').map(b => b.getAttribute('aria-label')))
        .toEqual(off ? ['Comment'] : ['Bold', 'Italic', 'Heading', 'Link', 'Mention', 'Comment'])
      fireEvent.click(within(bar).getByRole('button', { name: 'Comment' }))
      const thread = await screen.findByRole('complementary', { name: 'Comments' })
      expect(within(thread).getByText('On “one Safe”')).toBeTruthy()
      if (off) {
        write(thread, 'Which Safe?')
        fireEvent.click(within(thread).getByRole('button', { name: 'Comment' }))
        await vi.waitFor(() => expect(posts(calls)).toHaveLength(1))
        expect(posts(calls)[0]!.body).toMatchObject({ target: TARGET, body: 'Which Safe?', anchor: { exact: 'one Safe' } })
      }
    })
  }
})
