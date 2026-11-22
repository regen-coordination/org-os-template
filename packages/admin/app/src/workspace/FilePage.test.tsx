// @vitest-environment jsdom
// DAO-OS L6 Task 19: the source editor (/files/*, spec §11, §15) — a governed file whole, in a Mono well; Save stages a
// `file` op into the tray, and what the server refuses is refused here in the server's words.
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Switch } from 'wouter'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXTURE_SOURCE, type Viewer } from '../viewAs/visibility.ts'
import { CANON_FILE, GENERATED, LEDGER_FILE, RATIFY_FILE, wholeFileRefusal } from '../../../lib/workspace/editors.mjs'
import Tray from '../changes/Tray.tsx'
import type { ChangeView, FileView } from '../api.ts'
import FilePage, { FILE_CHANGED } from './FilePage.tsx'
import { filesPathOf, READ_HERE, STAGED_WHOLE } from './files.ts'
import { clientWith, statusRoute } from '../test/writesOff.ts'

const GOV_TEXT = '# who decides what\nmodel: solo-maintainer\nroles:\n  - id: maintainer\n'
const GOV: FileView = { path: 'data/governance.yaml', text: GOV_TEXT, base: 'b1', class: 'governance', editor: 'rules+source' }
const DAO_JSON: FileView = { path: '.well-known/dao.json', text: '{\n  "name": "Fixture Org"\n}\n', base: 'b2', class: 'identity', editor: 'generated' }

// jsdom has <dialog> but not showModal/close (the tray's Review opens one)
const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void }
const native = { showModal: proto.showModal, close: proto.close }
beforeEach(() => {
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') })
})
afterEach(() => { proto.showModal = native.showModal; proto.close = native.close; vi.unstubAllGlobals() })

const fileRoute = (f: FileView) => ({ [`GET /api/files?path=${encodeURIComponent(f.path)}`]: f })
function draw(path: string, viewer?: Viewer, withTray = false) {
  const page = (
    <Switch>
      <Route path="/files">{() => <FilePage path="" />}</Route>
      <Route path="/files/*">{p => <FilePage path={filesPathOf(p['*'])} />}</Route>
    </Switch>
  )
  const ui = <>{page}{withTray && <Tray />}</>
  return renderAt(viewer ? <ViewAsProvider source={FIXTURE_SOURCE} initial={viewer}>{ui}</ViewAsProvider> : ui, path)
}
const posts = (calls: { method: string; path: string; body: unknown }[]) => calls.filter(c => c.method === 'POST' && c.path === '/api/changes/ops')

describe('/files/* — the source editor', () => {
  it('/files/data/governance.yaml shows the text in a Mono well; Save stages a file op and the tray shows it', async () => {
    const staged: ChangeView = changeView({ ops: [{ op: 'file', path: 'data/governance.yaml', text: `${GOV_TEXT}  - id: steward\n`, base: 'b1' }], classes: ['governance'] })
    const { calls } = fetchRoutes({ ...baseRoutes(), ...fileRoute(GOV), 'POST /api/changes/ops': staged })
    draw('/files/data/governance.yaml', undefined, true)
    const well = await screen.findByRole('textbox', { name: 'text' }) as HTMLTextAreaElement
    expect(screen.getByRole('heading', { level: 1, name: 'governance.yaml' })).toBeTruthy()
    const head = document.querySelector('header.rh')!
    expect(head.querySelector('.rh-id')!.textContent).toBe('data/governance.yaml')
    expect(head.querySelector('.rh-meta')!.textContent).toBe('Rules page, and the source editor for the whole fileclass governance')
    const fields = screen.getByRole('group', { name: 'File' })
    expect(within(fields).getByRole('link', { name: 'Open the Rules' }).getAttribute('href')).toBe('/governance/rules')
    expect(well.value).toBe(GOV_TEXT)
    expect(well.className).toBe('input mono-in rp-yaml')
    const save = screen.getByRole('button', { name: 'Save to changes' }) as HTMLButtonElement
    expect(save.disabled).toBe(true) // nothing to stage until the text changes
    fireEvent.change(well, { target: { value: `${GOV_TEXT}  - id: steward\n` } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(posts(calls)[0]!.body).toEqual({ ops: [{ op: 'file', path: 'data/governance.yaml', text: `${GOV_TEXT}  - id: steward\n`, base: 'b1' }] })
    // staged: said once through the polite region, marked on the page, and in the tray as one row, the file whole
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('data/governance.yaml is staged in your change.'))
    expect(await screen.findByText(STAGED_WHOLE)).toBeTruthy()
    const tray = await screen.findByRole('region', { name: 'Changes' })
    fireEvent.click(within(tray).getByRole('button', { name: 'Review' }))
    const ops = within(within(tray).getByRole('list', { name: 'Staged ops' })).getAllByRole('listitem')
    expect(ops).toHaveLength(1)
    expect(ops[0]!.textContent).toContain('data/governance.yaml')
    expect(ops[0]!.textContent).toContain('whole file')
    expect(within(ops[0]!).getByRole('link', { name: 'data/governance.yaml' }).getAttribute('href')).toBe('/files/data/governance.yaml')
  })

  it('/files/.well-known/dao.json shows GENERATED and no Save', async () => {
    fetchRoutes({ ...baseRoutes(), ...fileRoute(DAO_JSON) })
    draw('/files/.well-known/dao.json')
    expect(await screen.findByText(GENERATED)).toBeTruthy()
    expect(screen.getByLabelText('.well-known/dao.json').tagName).toBe('PRE')
    expect(screen.getByLabelText('.well-known/dao.json').className).toBe('mono-well')
    expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it.each([
    ['data/proposals.yaml', 'ledger', '', LEDGER_FILE],
    ['DECISIONS.md', 'ratify', '', RATIFY_FILE],
    ['data/kb/encyclopedia-entry.yaml', 'knowledge', 'workspace', CANON_FILE],
  ])('%s (%s) is refused whole in the server’s words, with no Save (PF-R1 for the canon)', async (path, editor, cls, sentence) => {
    expect(wholeFileRefusal(editor)).toBe(sentence)
    fetchRoutes({ ...baseRoutes(), ...fileRoute({ path, text: 'x: 1\n', base: 'b3', class: cls, editor }) })
    draw(`/files/${path}`)
    expect(await screen.findByText(sentence)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('a file the table gives an editor of its own is read here and links there, with no Save (PF-R78)', async () => {
    fetchRoutes({ ...baseRoutes(), ...fileRoute({ path: 'data/projects.yaml', text: 'projects: []\n', base: 'b4', class: 'records', editor: 'record' }) })
    draw('/files/data/projects.yaml')
    expect(await screen.findByText(READ_HERE('data/projects.yaml', 'record'))).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open its records' }).getAttribute('href')).toBe('/all/projects')
    expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
  })

  it('a refusal at stage is said in the server’s words, as an error note under the text (no alert), and the text stays', async () => {
    const lockout = 'Nobody could propose under the rule for governance: its role has no member. Nothing was staged.'
    fetchRoutes({ ...baseRoutes(), ...fileRoute(GOV),
      'POST /api/changes/ops': refuse(422, { error: 'refused', errors: [{ record: 'data/governance.yaml', field: '', message: lockout }] }) })
    draw('/files/data/governance.yaml')
    const well = await screen.findByRole('textbox', { name: 'text' }) as HTMLTextAreaElement
    fireEvent.change(well, { target: { value: 'model: solo-maintainer\nroles: []\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    const note = await screen.findByText(lockout)
    expect(note.closest('.note-error')).not.toBeNull()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(well.getAttribute('aria-invalid')).toBe('true')
    expect(well.value).toBe('model: solo-maintainer\nroles: []\n')
    expect(screen.queryByText(STAGED_WHOLE)).toBeNull()
  })

  it('previewing, the text is read in the well and nothing writes: no Save, no textbox', async () => {
    fetchRoutes({ ...baseRoutes(), ...fileRoute(GOV) })
    draw('/files/data/governance.yaml', { as: 'members' })
    expect((await screen.findByLabelText('data/governance.yaml')).textContent).toBe(GOV_TEXT)
    expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('previewing as the public, a file is absent: the not-found page, no text, class or editor rows, nothing asked (T19 review I2)', async () => {
    const f: FileView = { path: 'data/finances.yaml', text: 'budget: MEMBERS-ONLY-FIGURE\n', base: 'b', class: 'records', editor: 'source' }
    const { calls } = fetchRoutes({ ...baseRoutes(), ...fileRoute(f) })
    draw('/files/data/finances.yaml', { as: 'public' })
    expect(await screen.findByRole('heading', { level: 1, name: 'No page at /files/data/finances.yaml.' })).toBeTruthy()
    await new Promise(r => setTimeout(r, 50))
    expect(document.body.textContent).not.toContain('MEMBERS-ONLY-FIGURE')
    expect(document.body.textContent).not.toContain('records')
    expect(screen.queryByRole('group', { name: 'File' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(calls.some(c => c.path.startsWith('/api/files'))).toBe(false)
  })

  it('a file of the agent layer the viewer may not read draws exactly the page of a path that is not there (0.7.1 D6)', async () => {
    // The server answers both 404 in the same words (server/workspace/reads.ts): the page draws the sentence alone.
    const gone = (path: string) => refuse(404, { error: `${path} is not a governed file, so it has no editor here.` })
    fetchRoutes({ ...baseRoutes(), 'GET /api/files?path=memory%2F2026-11-01.md': gone('memory/2026-11-01.md'), 'GET /api/files?path=notes%2F2026-11-01.md': gone('notes/2026-11-01.md') })
    const drawn = async (path: string) => {
      const { container, unmount } = draw(`/files/${path}`)
      await screen.findByText(`${path} is not a governed file, so it has no editor here.`)
      expect(screen.getByRole('heading', { level: 1, name: '2026-11-01.md' })).toBeTruthy()
      expect(screen.queryByRole('group', { name: 'File' })).toBeNull()
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
      const html = container.innerHTML.replaceAll(path, '<path>')
      unmount()
      return html
    }
    expect(await drawn('memory/2026-11-01.md')).toBe(await drawn('notes/2026-11-01.md'))
  })

  it('a file the server will not serve is its sentence alone: no text, no class, no Save', async () => {
    const kept = 'data/horizon.yaml holds values that not every member may read, so it is not served whole here.'
    fetchRoutes({ ...baseRoutes(), 'GET /api/files?path=data%2Fhorizon.yaml': refuse(403, { error: kept }) })
    draw('/files/data/horizon.yaml')
    expect(await screen.findByText(kept)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'File' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
  })

  it('a source file not there yet opens empty, and Save stages it new (no base)', async () => {
    const { calls } = fetchRoutes({ ...baseRoutes(),
      ...fileRoute({ path: 'memory/2026-11-05.md', text: null, base: null, class: 'workspace', editor: 'source' }),
      'POST /api/changes/ops': changeView({ ops: [{ op: 'file', path: 'memory/2026-11-05.md', text: '# notes\n', base: null }] }) })
    draw('/files/memory/2026-11-05.md')
    const well = await screen.findByRole('textbox', { name: 'text' }) as HTMLTextAreaElement
    expect(well.value).toBe('')
    fireEvent.change(well, { target: { value: '# notes\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    await waitFor(() => expect(posts(calls)[0]?.body).toEqual({ ops: [{ op: 'file', path: 'memory/2026-11-05.md', text: '# notes\n', base: null }] }))
  })

  it('after Apply the well shows the applied text and the new base, so a second Save is not stale (T19 review I3)', async () => {
    let file: FileView = { path: 'memory/notes.md', text: 'one\n', base: 'b1', class: 'workspace', editor: 'source' }
    let held = changeView()
    const { calls } = fetchRoutes({ ...baseRoutes(),
      'GET /api/files?path=memory%2Fnotes.md': () => file,
      'GET /api/changes': () => held,
      'POST /api/changes/ops': (init: RequestInit | undefined) => {
        const { ops } = JSON.parse(String(init!.body)) as { ops: ChangeView['ops'] }
        held = changeView({ ops })
        return held
      },
      'POST /api/changes/apply': () => {
        const op = held.ops[0] as { text: string }
        file = { ...file, text: op.text, base: 'b2' }
        held = changeView()
        return { commit: 'abc1234def5678' }
      } })
    draw('/files/memory/notes.md', undefined, true)
    const well = () => screen.getByRole('textbox', { name: 'text' }) as HTMLTextAreaElement
    await screen.findByRole('textbox', { name: 'text' })
    fireEvent.change(well(), { target: { value: 'one\ntwo\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(posts(calls)[0]!.body).toEqual({ ops: [{ op: 'file', path: 'memory/notes.md', text: 'one\ntwo\n', base: 'b1' }] })
    const tray = await screen.findByRole('region', { name: 'Changes' })
    fireEvent.click(within(tray).getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(calls.filter(c => c.path === '/api/files?path=memory%2Fnotes.md').length).toBeGreaterThan(1))
    await waitFor(() => expect(screen.queryByText(STAGED_WHOLE)).toBeNull())
    expect(well().value).toBe('one\ntwo\n')
    fireEvent.change(well(), { target: { value: 'one\ntwo\nthree\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    await waitFor(() => expect(posts(calls)).toHaveLength(2))
    expect(posts(calls)[1]!.body).toEqual({ ops: [{ op: 'file', path: 'memory/notes.md', text: 'one\ntwo\nthree\n', base: 'b2' }] })
  })

  it('a file that changed while you were editing says so in its field row and offers Reload; Save keeps the base you began from', async () => {
    let file: FileView = { path: 'memory/notes.md', text: 'one\n', base: 'b1', class: 'workspace', editor: 'source' }
    const { calls } = fetchRoutes({ ...baseRoutes(), 'GET /api/files?path=memory%2Fnotes.md': () => file,
      'POST /api/changes/ops': changeView({ ops: [{ op: 'file', path: 'memory/notes.md', text: 'one\nmine\n', base: 'b1' }] }) })
    const { qc } = draw('/files/memory/notes.md')
    const well = () => screen.getByRole('textbox', { name: 'text' }) as HTMLTextAreaElement
    await screen.findByRole('textbox', { name: 'text' })
    fireEvent.change(well(), { target: { value: 'one\nmine\n' } })
    file = { ...file, text: 'one\ntheirs\n', base: 'b9' }
    void qc.invalidateQueries({ queryKey: ['file'] })
    expect(await screen.findByText(FILE_CHANGED('memory/notes.md'))).toBeTruthy()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(well().value).toBe('one\nmine\n') // your text stays until you reload
    expect(well().getAttribute('aria-describedby')).toBe('f-file-help')
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(posts(calls)[0]!.body).toEqual({ ops: [{ op: 'file', path: 'memory/notes.md', text: 'one\nmine\n', base: 'b1' }] })
  })

  it('Reload drops your text and opens the file as it is now', async () => {
    let file: FileView = { path: 'memory/notes.md', text: 'one\n', base: 'b1', class: 'workspace', editor: 'source' }
    fetchRoutes({ ...baseRoutes(), 'GET /api/files?path=memory%2Fnotes.md': () => file })
    const { qc } = draw('/files/memory/notes.md')
    const well = () => screen.getByRole('textbox', { name: 'text' }) as HTMLTextAreaElement
    await screen.findByRole('textbox', { name: 'text' })
    fireEvent.change(well(), { target: { value: 'one\nmine\n' } })
    file = { ...file, text: 'one\ntheirs\n', base: 'b9' }
    void qc.invalidateQueries({ queryKey: ['file'] })
    await screen.findByText(FILE_CHANGED('memory/notes.md'))
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(well().value).toBe('one\ntheirs\n'))
    expect(screen.queryByText(FILE_CHANGED('memory/notes.md'))).toBeNull()
  })

  it('/files/memory/ is the path field, from that folder; Open goes to the file', async () => {
    fetchRoutes({ ...baseRoutes(), ...fileRoute({ path: 'memory/2026-11-05.md', text: '# notes\n', base: 'b5', class: 'workspace', editor: 'source' }) })
    const { loc } = draw('/files/memory/')
    const field = await screen.findByRole('textbox', { name: 'Path' }) as HTMLInputElement
    expect(field.value).toBe('memory/')
    fireEvent.change(field, { target: { value: 'memory/2026-11-05.md' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(loc.history.at(-1)).toBe('/files/memory/2026-11-05.md'))
    expect((await screen.findByRole('textbox', { name: 'text' }) as HTMLTextAreaElement).value).toBe('# notes\n')
  })
})

// R2 (plan D-6): the source editor stages into the member's change, so while the Hub's writes are off the file is shown
// read only and Save to changes is not drawn. With writes on, the well is editable and Save is offered.
describe('/files/* while the Hub\'s writes are off', () => {
  for (const off of [true, false]) {
    it(off ? 'off: the text, read only, and no Save to changes' : 'on: the text in an editable well, and Save to changes', async () => {
      fetchRoutes({ ...baseRoutes(), ...fileRoute(GOV), ...statusRoute(off) })
      renderAt(
        <Switch><Route path="/files/*">{p => <FilePage path={filesPathOf(p['*'])} />}</Route></Switch>,
        '/files/data/governance.yaml', { queryClient: clientWith(off) })
      expect(await screen.findByRole('heading', { level: 1, name: 'governance.yaml' })).toBeTruthy()
      await waitFor(() => expect(document.body.textContent).toContain('model: solo-maintainer'))
      if (off) {
        await new Promise(r => setTimeout(r, 50))
        expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
        expect(screen.queryByRole('textbox', { name: 'text' })).toBeNull()
      } else {
        expect(await screen.findByRole('button', { name: 'Save to changes' })).toBeTruthy()
        expect(screen.getByRole('textbox', { name: 'text' })).toBeTruthy()
      }
    })
  }
})
