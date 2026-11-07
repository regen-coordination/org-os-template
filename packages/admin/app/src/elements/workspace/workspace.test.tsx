// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { renderAt } from '../../test/render.tsx'
import { ViewAsProvider } from '../../viewAs/ViewAs.tsx'
import { Shell } from '../../design/Shell.tsx'
import { LiveRegion } from '../../parts/live.tsx'
import type { Viewer } from '../../viewAs/visibility.ts'
import { SaveState, type Save } from './SaveState.tsx'
import { EditorBar } from './EditorBar.tsx'
import { Callout, Commented, Current, EmbedRecord, EmbedView, PageBody, Selected } from './PageBody.tsx'
import { SelectionToolbar } from './SelectionToolbar.tsx'
import { SlashMenu } from './SlashMenu.tsx'
import { CommentThread, type Comment } from './CommentThread.tsx'
import { Composer } from './Composer.tsx'
import { MentionPicker } from './MentionPicker.tsx'
import { mentionables } from './mentions.ts'
import { COMMENTS, ME, MENTIONABLES, PAGE } from '../../test/fixtures/house/workspace.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'

const as = (viewer: Viewer, ui: ReactElement) => renderAt(<ViewAsProvider initial={viewer}>{ui}</ViewAsProvider>)
const MEMBERS = { level: 'members' } as const
const HAT_OPS = { level: 'hat', hat: 'ops', name: 'Ops' } as const
const noop = () => {}

afterEach(() => { vi.restoreAllMocks() })

describe('SaveState (§10.1, §10.6)', () => {
  const cases: [Save, string, string][] = [
    ['direct', 'Saved · direct', 'svg'],
    ['saving', 'Saving…', '.spin'],
    ['staged', 'Staged · needs approval', '.smark-staged'],
    ['conflict', 'Someone saved a newer version', 'svg'],
    ['offline', 'Offline · kept on this device', 'svg'],
    ['refused', 'Not saved', 'svg'], // DAO-OS L6 Task 16, R-16a
    ['approval', 'Edits need approval', '.smark-staged'], // DAO-OS L6 Task 16b, R-L6-SUGGEST
  ]
  for (const [state, words, glyph] of cases) {
    it(`${state}: its glyph and "${words}"`, () => {
      const { container } = renderAt(<SaveState state={state} onCompare={noop} />)
      const save = container.querySelector('.save')!
      expect(save.classList.contains(`save-${state}`)).toBe(true)
      expect(save.querySelector('.save-w')!.textContent).toBe(words)
      expect(save.querySelector(glyph)).not.toBeNull()
      expect(save.querySelector(glyph)!.getAttribute('aria-hidden')).toBe('true')
    })
  }

  it('a newer version offers Compare, which calls onCompare; nothing else offers it', () => {
    const onCompare = vi.fn()
    const { rerender } = renderAt(<SaveState state="conflict" onCompare={onCompare} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    expect(onCompare).toHaveBeenCalledOnce()
    rerender(<SaveState state="offline" onCompare={onCompare} />)
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull()
  })

  it('says a change of state once, through the page’s one polite region, and nothing on first draw', () => {
    const { rerender } = renderAt(<><LiveRegion /><SaveState state="direct" /></>)
    const live = document.querySelector('[aria-live="polite"]')!
    expect(live.textContent).toBe('')
    rerender(<><LiveRegion /><SaveState state="offline" /></>)
    expect(live.textContent).toBe('Offline · kept on this device')
  })

  // ported with L6's SaveState by C11 fix round 1: a refused save says the server's reason with "Not saved"
  it('a refused save is clay, says "Not saved" and the reason once, and keeps the reason for a screen reader', () => {
    const { container, rerender } = renderAt(<SaveState state="direct" />)
    rerender(<SaveState state="refused" reason="The page is read-only now." />)
    expect(container.querySelector('.save-bad')).not.toBeNull()
    expect(screen.getByTestId('live').textContent).toBe('Not saved. The page is read-only now.')
    expect(container.querySelector('.save .sr-only')!.textContent).toBe(': The page is read-only now.')
  })

  it('clay for a newer version and offline, moss for staged, faint for a direct save', () => {
    const { container, rerender } = renderAt(<SaveState state="conflict" />)
    expect(container.querySelector('.save-bad')).not.toBeNull()
    rerender(<SaveState state="offline" />)
    expect(container.querySelector('.save-bad')).not.toBeNull()
    rerender(<SaveState state="direct" />)
    expect(container.querySelector('.save-bad')).toBeNull()
  })
})

describe('EditorBar (§10.1, E-17)', () => {
  const bar = (over: Partial<Parameters<typeof EditorBar>[0]> = {}) => (
    <EditorBar path={[...PAGE.path]} save="direct" presence={[...PAGE.presence]} visibility={HAT_OPS} onVisibility={noop}
      comments={2} onComments={noop} {...over} />
  )

  it('draws the path, the save state, presence, the visibility control and the comments toggle with its count', () => {
    const onComments = vi.fn()
    renderAt(bar({ onComments }))
    const path = screen.getByRole('navigation', { name: 'Page path' })
    expect(within(path).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Knowledge', 'Treasury', 'How the treasury is run'])
    expect(within(path).getByRole('link', { name: 'Treasury' }).getAttribute('href')).toBe('/workspace/knowledge/treasury')
    expect(within(path).getByText('How the treasury is run').getAttribute('aria-current')).toBe('page')
    expect(document.querySelector('.ed-bar .save-direct')).not.toBeNull()
    expect(screen.getByRole('img', { name: 'Ops lead is editing; Steward B is reading' })).toBeTruthy()
    const control = document.querySelector('.ed-bar button.vis-ctl')!
    expect(control.getAttribute('aria-haspopup')).toBe('menu')
    expect(control.textContent).toBe('Hat: Ops')
    const toggle = screen.getByRole('button', { name: 'Comments, 2' })
    expect(toggle.textContent).toBe('2')
    fireEvent.click(toggle)
    expect(onComments).toHaveBeenCalledOnce()
  })

  it('says whether the thread is open on the toggle', () => {
    const { rerender } = renderAt(bar({ commentsOpen: true }))
    expect(screen.getByRole('button', { name: 'Comments, 2' }).getAttribute('aria-expanded')).toBe('true')
    rerender(bar({ commentsOpen: false }))
    expect(screen.getByRole('button', { name: 'Comments, 2' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('draws the control only when the caller passes onVisibility: it never decides who may narrow (Q77)', () => {
    renderAt(bar({ onVisibility: undefined }))
    expect(document.querySelector('.ed-bar .vis-ctl')).toBeNull()
    expect(document.querySelector('.ed-bar .vis')!.textContent).toBe('Hat: Ops')
  })

  it('previewing hides the visibility control and the toggle’s write actions; the level and the toggle stay', () => {
    as({ as: 'members' }, <>{bar()}<CommentThread comments={COMMENTS} visibility={HAT_OPS} me={ME} now={FIXED_NOW} form="panel"
      onSend={noop} onRetry={noop} onDiscard={noop} onResolve={noop} onTask={noop} /></>)
    expect(document.querySelector('.ed-bar .vis-ctl')).toBeNull()
    expect(document.querySelector('.ed-bar .vis')!.textContent).toBe('Hat: Ops')
    expect(screen.getByRole('button', { name: 'Comments, 2' })).toBeTruthy()
    for (const name of ['Reply', 'Resolve', 'Turn into a task', 'Retry', 'Discard', 'Comment']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('PageBody (§10.1, E-14, §18-2)', () => {
  const page = (viewer: Viewer = { as: 'you' }) => as(viewer, (
    <PageBody meta={PAGE.meta} title={PAGE.title} from={PAGE.from} now={FIXED_NOW}>
      <p>The treasury is one Safe. <Selected>Any four of its eight signers can move funds</Selected>, and <a href="/roles">the signers</a> sign.</p>
      <Callout>The Hub never signs.</Callout>
      <h2>What it holds</h2>
      <h3>On Celo</h3>
      <EmbedRecord kind="safe" name="Treasury" read={{ state: 'fresh', readAt: new Date(FIXED_NOW.getTime() - 240_000).toISOString() }} now={FIXED_NOW}
        rows={[{ label: 'USDGLO on Celo', value: '12,480.22 USDGLO' }, { label: 'G$ on Celo', value: '27,561,390.98 G$' }]} item={{ facts: { visibility: 'members' } }} />
      <EmbedView label="Tasks" item={{ facts: { visibility: 'members' } }}><div className="tabs-here">tabs</div></EmbedView>
      <EmbedRecord kind="safe" name="Grants pool" rows={[{ label: 'Held', value: '1' }]} item={{ facts: { visibility: 'hat:treasury' } }} />
      <Current><p>When a pool’s funds sit unused, <Commented anchor="season">the Council can ask for them back</Commented>.</p></Current>
    </PageBody>
  ))

  it('the title in the display class, Fraunces 32 (a page’s h1); the meta line 12 faint with the from mark', () => {
    page()
    const h1 = screen.getByRole('heading', { level: 1, name: 'How the treasury is run' })
    expect(h1.classList.contains('display')).toBe(true)
    expect(h1.classList.contains('ed-title')).toBe(true)
    const meta = document.querySelector('.ed-meta')!
    expect(meta.textContent).toBe('Edited 4 min ago by Ops lead · Workspace write · saves directly · 3 backlinks · from knowledge/treasury/how-the-treasury-is-run.md · read 4 min ago')
    expect(document.querySelector('.ed-prose h2')!.textContent).toBe('What it holds')
    expect(document.querySelector('.ed-prose h3')!.textContent).toBe('On Celo')
  })

  it('a callout on --sunken with its glyph; an embedded record with its eyebrow head (glyph, name · kind, read age) and data rows', () => {
    page()
    const callout = document.querySelector('.ed-callout')!
    expect(callout.querySelector('svg')).not.toBeNull()
    expect(callout.textContent).toBe('The Hub never signs.')
    const rec = screen.getByRole('group', { name: 'Treasury · Safe' })
    const head = rec.querySelector('.ed-embed-h')!
    expect(head.querySelector('svg')).not.toBeNull()
    expect(head.textContent).toBe('Treasury · Saferead 4 min ago')
    expect([...rec.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['USDGLO on Celo', 'G$ on Celo'])
    expect([...rec.querySelectorAll('dd')].map(d => d.textContent)).toEqual(['12,480.22 USDGLO', '27,561,390.98 G$'])
  })

  it('an embedded view inside the same kind of block', () => {
    page()
    const view = screen.getByRole('group', { name: 'Tasks · view' })
    expect(view.classList.contains('ed-embed')).toBe(true)
    expect(view.querySelector('.tabs-here')).not.toBeNull()
  })

  it('the editing affordances: the current block’s rule, selected text, commented text marked for its comment, links', () => {
    page()
    expect(document.querySelector('.ed-cur p')).not.toBeNull()
    expect(document.querySelector('.ed-sel')!.textContent).toBe('Any four of its eight signers can move funds')
    const mark = document.querySelector('mark.ed-cmt')!
    expect(mark.getAttribute('data-anchor')).toBe('season')
    expect(mark.textContent).toBe('the Council can ask for them back')
    expect(document.querySelector('.ed-prose a')!.textContent).toBe('the signers')
  })

  it('an embed the reader may not see is absent on the members’ side: no slot, no title (§18-2)', () => {
    page({ as: 'members' })
    expect(screen.queryByRole('group', { name: /Grants pool/ })).toBeNull()
    expect(document.body.textContent).not.toContain('Grants pool')
    expect(document.body.textContent).not.toContain('Not visible to you')
    expect(document.querySelectorAll('.ed-embed')).toHaveLength(2)
  })

  it('previewing as Public, the members-level embeds go the same way', () => {
    page({ as: 'public' })
    expect(document.querySelectorAll('.ed-embed')).toHaveLength(0)
    expect(document.querySelector('.members-only, .mention-gone')).toBeNull()
  })
})

describe('SelectionToolbar (§10.1)', () => {
  it('bold, italic and heading toggle with aria-pressed; link, mention and comment act; one toolbar named Format', () => {
    const onToggle = vi.fn(), onLink = vi.fn(), onMention = vi.fn(), onComment = vi.fn()
    renderAt(<SelectionToolbar marks={{ bold: true, italic: false, heading: false }} onToggle={onToggle} onLink={onLink} onMention={onMention} onComment={onComment} />)
    const bar = screen.getByRole('toolbar', { name: 'Format' })
    expect(within(bar).getAllByRole('button').map(b => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])).toEqual([
      ['Bold', 'true'], ['Italic', 'false'], ['Heading', 'false'], ['Link', null], ['Mention', null], ['Comment', null],
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }))
    expect(onToggle).toHaveBeenCalledWith('italic')
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mention' }))
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect([onLink, onMention, onComment].map(f => f.mock.calls.length)).toEqual([1, 1, 1])
  })

  it('is one tab stop; the arrows move along it and hold at the ends, Home and End jump', () => {
    renderAt(<SelectionToolbar marks={{ bold: false, italic: false, heading: false }} onToggle={noop} onLink={noop} onMention={noop} onComment={noop} />)
    const buttons = within(screen.getByRole('toolbar')).getAllByRole('button')
    expect(buttons.map(b => b.tabIndex)).toEqual([0, -1, -1, -1, -1, -1])
    buttons[0]!.focus()
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(buttons[1])
    fireEvent.keyDown(buttons[1]!, { key: 'End' })
    expect(document.activeElement).toBe(buttons[5])
    fireEvent.keyDown(buttons[5]!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(buttons[5])
    fireEvent.keyDown(buttons[5]!, { key: 'Home' })
    expect(document.activeElement).toBe(buttons[0])
    expect(buttons.map(b => b.tabIndex)).toEqual([0, -1, -1, -1, -1, -1])
  })
})

describe('SlashMenu (§10.1)', () => {
  it('a listbox “Insert · /” with the six kinds, the first active', () => {
    renderAt(<SlashMenu query="" onPick={noop} />)
    const list = screen.getByRole('listbox', { name: 'Insert · /' })
    const options = within(list).getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['A view of a collection', 'A record', 'Callout', 'Task', 'Table', 'Divider'])
    expect(options.map(o => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false'])
    expect(list.getAttribute('aria-activedescendant')).toBe(options[0]!.id)
  })

  it('narrows to the kinds the query names, and picks by click or by the arrows and Enter', () => {
    const onPick = vi.fn()
    const { rerender } = renderAt(<SlashMenu query="/ta" onPick={onPick} />)
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Task', 'Table'])
    const list = screen.getByRole('listbox')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('table')
    rerender(<SlashMenu query="" onPick={onPick} />)
    fireEvent.click(screen.getByRole('option', { name: 'Divider' }))
    expect(onPick).toHaveBeenLastCalledWith('divider')
  })

  it('says so when nothing matches', () => {
    renderAt(<SlashMenu query="xyz" onPick={noop} />)
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('Nothing to insert called “xyz”.')).toBeTruthy()
  })
})

describe('CommentThread (§10.3, E-15, E-16)', () => {
  const thread = (over: Partial<Parameters<typeof CommentThread>[0]> = {}) => (
    <CommentThread comments={COMMENTS} visibility={HAT_OPS} me={ME} now={FIXED_NOW} form="panel"
      onSend={noop} onRetry={noop} onDiscard={noop} onResolve={noop} onTask={noop} {...over} />
  )

  it('heads with “Comments · 2 open” and the page’s visibility marker (comments follow it)', () => {
    renderAt(thread())
    const panel = screen.getByRole('complementary', { name: 'Comments' })
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('Comments · 2 open')
    expect(panel.querySelector('.thread-h .vis')!.textContent).toBe('Hat: Ops')
  })

  it('a comment: 28px monogram, handle, time, body, and Reply · Resolve · Turn into a task', () => {
    const onResolve = vi.fn(), onTask = vi.fn()
    renderAt(thread({ onResolve, onTask }))
    const first = screen.getByRole('article', { name: 'Steward B, 2 h ago' })
    expect(first.querySelector('.av.av-lg')!.textContent).toBe('SB')
    expect(first.querySelector('.cmt-who')!.textContent).toBe('Steward B')
    expect(first.querySelector('time')!.textContent).toBe('2 h ago')
    expect(first.querySelector('.cmt-b')!.textContent).toBe('Only after a season? Do we write the season down?')
    const acts = first.querySelector(':scope > .cmt-main > .cmt-f')!
    expect([...acts.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Reply', 'Resolve', 'Turn into a task'])
    fireEvent.click(within(acts as HTMLElement).getByRole('button', { name: 'Resolve' }))
    fireEvent.click(within(acts as HTMLElement).getByRole('button', { name: 'Turn into a task' }))
    expect(onResolve).toHaveBeenCalledWith('c-1')
    expect(onTask).toHaveBeenCalledWith('c-1')
  })

  it('replies indent, under their comment, with no actions of their own; your own comments say You', () => {
    renderAt(thread())
    const replies = document.querySelectorAll('.cmt-reply')
    expect(replies).toHaveLength(2)
    expect([...replies].map(r => r.querySelector('.cmt-who')!.textContent)).toEqual(['Ops lead', 'You'])
    expect(replies[0]!.querySelector('.cmt-f')).toBeNull()
  })

  it('sending: the body mute and “Sending…”', () => {
    renderAt(thread())
    const sending = document.querySelector('.cmt-sending')!
    expect(sending.querySelector('.cmt-state')!.textContent).toBe('Sending…')
    expect(sending.querySelector('.cmt-b')!.textContent).toBe('Thanks — linking is enough.')
    expect(sending.querySelector('.cmt-f')).toBeNull()
  })

  it('not sent: clay “Not sent”, with Retry and Discard', () => {
    const onRetry = vi.fn(), onDiscard = vi.fn()
    renderAt(thread({ onRetry, onDiscard }))
    const failed = document.querySelector('.cmt-not-sent') as HTMLElement
    expect(failed.querySelector('.cmt-state.save-bad')!.textContent).toBe('Not sent')
    expect(within(failed).getAllByRole('button').map(b => b.textContent)).toEqual(['Retry', 'Discard'])
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry' }))
    fireEvent.click(within(failed).getByRole('button', { name: 'Discard' }))
    expect(onRetry).toHaveBeenCalledWith('c-2')
    expect(onDiscard).toHaveBeenCalledWith('c-2')
  })

  it('resolved: one line “Resolved by Ops lead · 3 replies · Show”; Show opens it', () => {
    renderAt(thread())
    const line = document.querySelector('.cmt-resolved')!
    expect(line.textContent).toBe('Resolved by Ops lead · 3 replies · Show')
    expect(document.body.textContent).not.toContain('Which chains does the Safe hold funds on?')
    fireEvent.click(within(line as HTMLElement).getByRole('button', { name: 'Show' }))
    expect(document.body.textContent).toContain('Which chains does the Safe hold funds on?')
    expect(screen.getByRole('button', { name: 'Hide' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('Reply opens a composer under the comment; what it sends names the comment it answers', () => {
    const onSend = vi.fn()
    renderAt(thread({ onSend }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0]!)
    const box = screen.getByRole('textbox', { name: 'Reply to Steward B' })
    fireEvent.change(box, { target: { value: 'Agreed.' } })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    expect(onSend).toHaveBeenCalledWith('Agreed.', 'c-1')
  })

  it('an anchored comment quotes its passage; selecting it scrolls the page to the marked text', () => {
    const into = vi.fn()
    Element.prototype.scrollIntoView = into
    renderAt(<><p><Commented anchor="season">the Council can ask for them back</Commented></p>{thread()}</>)
    const quote = screen.getByRole('button', { name: 'Show the passage: “the Council can ask for them back”' })
    fireEvent.click(quote)
    expect(into).toHaveBeenCalledOnce()
    expect(into.mock.contexts[0]).toBe(document.querySelector('mark[data-anchor="season"]'))
    expect(document.querySelector('mark[data-anchor="season"]')!.classList.contains('on')).toBe(true)
  })

  it('a conversation shows no save state: “Sending…” and “Not sent” are on the comments themselves (E-16)', () => {
    renderAt(thread())
    expect(document.querySelector('.thread .save:not(.cmt-state)')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Saved · direct|Staged · needs approval/)
  })

  it('a panel at 1200 of frame width and over, a sheet below it (from the frame, CC-13)', () => {
    const at = (width: number) => renderAt(
      <Shell title="Page" nav={null} width={width} specimen>
        <CommentThread comments={COMMENTS} visibility={HAT_OPS} me={ME} now={FIXED_NOW} onSend={noop} onRetry={noop} onDiscard={noop} onResolve={noop} onTask={noop} onClose={noop} />
      </Shell>,
    )
    const wide = at(1200)
    expect(document.querySelector('.thread.thread-panel')).not.toBeNull()
    expect(document.querySelector('dialog')).toBeNull()
    wide.unmount()
    at(1100)
    const sheet = document.querySelector('dialog.thread-sheet')!
    expect(sheet.querySelector('.thread')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close comments' })).toBeTruthy()
  })

  it('the sheet closes on Esc and on its × through onClose', () => {
    const onClose = vi.fn()
    renderAt(thread({ form: 'sheet', onClose }))
    const sheet = document.querySelector('dialog.thread-sheet')!
    fireEvent(sheet, new Event('cancel', { cancelable: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Close comments' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('Composer (§10.3)', () => {
  it('a monogram and a box: the hint “Only people who can see this page are offered.”, and Comment', () => {
    renderAt(<Composer me={ME} onSend={noop} />)
    expect(document.querySelector('.composer .av.av-lg')!.textContent).toBe('CS')
    const box = screen.getByRole('textbox', { name: 'Comment' })
    expect(box.getAttribute('aria-describedby')).toBe(screen.getByText('Only people who can see this page are offered.').id)
    expect(box.getAttribute('aria-keyshortcuts')).toBe('Meta+Enter Control+Enter')
    expect(screen.getByRole('button', { name: 'Comment' }).classList.contains('primary')).toBe(true)
  })

  it('⌘↵ (or Ctrl+↵) sends the trimmed text and empties the box; Enter alone is a new line; nothing empty is sent', () => {
    const onSend = vi.fn()
    renderAt(<Composer me={ME} onSend={onSend} />)
    const box = screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: '  Ask the Council.  ' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    expect(onSend).toHaveBeenCalledWith('Ask the Council.')
    expect(box.value).toBe('')
    fireEvent.change(box, { target: { value: 'Again' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    fireEvent.change(box, { target: { value: 'By the button' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(onSend.mock.calls.map(c => c[0])).toEqual(['Ask the Council.', 'Again', 'By the button'])
  })

  it('draws the mention picker it is given under the box', () => {
    renderAt(<Composer me={ME} onSend={noop} picker={<MentionPicker items={mentionables(MENTIONABLES, '')} onPick={noop} />} />)
    expect(document.querySelector('.composer .mpop [role="listbox"]')).not.toBeNull()
  })
})

describe('MentionPicker (§10.4, C-21)', () => {
  it('lists people (monogram, name, hat) and roles (hat glyph, “3 people”) and the records offered', () => {
    renderAt(<MentionPicker items={mentionables(MENTIONABLES, '')} onPick={noop} />)
    const list = screen.getByRole('listbox', { name: 'Mention' })
    const options = within(list).getAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual([
      'OLOps leadOps', 'CSCouncil stewardCouncil', 'Ops3 people', 'TreasuryRecord', 'SBSteward BCouncil', 'TSTreasury stewardcan’t see this page',
    ])
    expect(options[2]!.querySelector('svg')).not.toBeNull()
  })

  it('a member who can’t see the page is aria-disabled with “can’t see this page”, and picking it does nothing', () => {
    const onPick = vi.fn()
    renderAt(<MentionPicker items={mentionables(MENTIONABLES, '')} onPick={onPick} />)
    const off = screen.getByRole('option', { name: /Treasury steward/ })
    expect(off.getAttribute('aria-disabled')).toBe('true')
    expect(off.textContent).toContain('can’t see this page')
    fireEvent.click(off)
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: /Ops lead/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'ops-lead' }))
  })

  it('records and pages the author may not see are never offered', () => {
    renderAt(<MentionPicker items={mentionables(MENTIONABLES, '')} onPick={noop} />)
    expect(screen.queryByRole('option', { name: /Grants draft/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /^Treasurer/ })).toBeNull()
  })

  it('the arrows move through the list, onto a disabled member too; Enter there picks nothing', () => {
    const onPick = vi.fn()
    renderAt(<MentionPicker items={mentionables(MENTIONABLES, 'st')} onPick={onPick} />)
    const list = screen.getByRole('listbox')
    fireEvent.keyDown(list, { key: 'End' })
    expect(list.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: /Treasury steward/ }).id)
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'steward-b' }))
  })

  it('says so when no one matches', () => {
    renderAt(<MentionPicker items={[]} onPick={noop} />)
    expect(screen.getByText('No one by that name can be mentioned here.')).toBeTruthy()
  })
})

