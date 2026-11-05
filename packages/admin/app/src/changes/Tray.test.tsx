// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import Tray from './Tray.tsx'
import Changes from '../pages/Changes.tsx'
import { Shell } from '../design/Shell.tsx'
import { usePanel } from '../parts/panels.tsx'
import { Route, Switch, useLocation } from 'wouter'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { OPEN_CHANGES } from '../keys/useHouseKeys.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import { EXPANDED, NOTE, STAGED, STALE, THRESHOLD, WEARERS, trayView } from '../test/fixtures/house/tray.ts'
import type { ChangeView } from '../api.ts'

// jsdom has <dialog> but not showModal/close: draw them as the browser does, enough to see open and closed.
const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void }
const native = { showModal: proto.showModal, close: proto.close }
beforeEach(() => {
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') })
})
afterEach(() => { proto.showModal = native.showModal; proto.close = native.close; vi.unstubAllGlobals(); vi.restoreAllMocks() })

const three = (over: Partial<ChangeView> = {}) => changeView({
  ops: [
    { op: 'update', record: 'projects:river-commons', set: { stage: 'develop', partners: ['example-coop', 'example-network'] }, base: 'h', before: { stage: 'discovery', partners: ['example-coop'] } },
    { op: 'update', record: 'funding-opportunities:fundacion-x', set: { status: 'submitted' }, base: 'h', before: { status: 'drafting' } },
  ],
  rule: { direct: true, sentence: 'you alone (solo maintainer)', source: 'implied by model: solo-maintainer' }, ...over,
})
const tray = () => screen.findByRole('region', { name: 'Changes' })
const reads = (calls: { method: string; path: string }[]) => calls.filter(c => c.method === 'GET' && c.path === '/api/changes').length
/** Review, pressed as a reader does (focus on it first), and the expanded panel it opens. */
const review = async () => {
  const t = await tray()
  const button = within(t).getByRole('button', { name: 'Review' })
  button.focus()
  fireEvent.click(button)
  return { t, button, panel: within(t).getByRole('group', { name: 'Your change' }) }
}
const ops = (panel: HTMLElement) => within(within(panel).getByRole('list', { name: 'Staged ops' })).getAllByRole('listitem')

describe('Tray', () => {
  it('stays away while nothing is staged', async () => {
    fetchRoutes(baseRoutes())
    const { qc, container } = renderAt(<Tray />)
    await waitFor(() => expect(qc.getQueryData(['changes'])).toBeTruthy())
    expect(container.textContent).toBe('')
  })

  // B3 (fix wave): the tray's own read failure was a bare paragraph; it is the house's refusal, said once.
  it('says so when the change cannot be read, as the house’s refusal, once through the polite region', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': refuse(500, { error: 'boom' }) }))
    renderAt(<Tray />)
    const note = (await within(await tray()).findByText('Could not read your staged changes: boom')).closest('.note-error')
    expect(note).not.toBeNull()
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('Could not read your staged changes: boom'))
  })

  it('shows the count and the last op with its rule; Review lists the ops, Show diff the combined diff', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': three() }))
    renderAt(<Tray />)
    const t = await tray()
    expect(within(t).getByText('2 staged changes')).toBeTruthy()
    expect(t.querySelector('.tray-line')!.textContent).toBe('funding-opportunities:fundacion-x · status: submitted · Saves directly · you alone (solo maintainer)')
    const { panel } = await review()
    expect(within(panel).getByText('2 ops · 2 records')).toBeTruthy()
    expect(ops(panel)).toHaveLength(2)
    expect(within(panel).getByText('discovery').tagName).toBe('S')
    expect(within(panel).getByRole('link', { name: 'funding-opportunities:fundacion-x' }).getAttribute('href')).toBe('/r/funding/fundacion-x')
    fireEvent.click(within(panel).getByRole('button', { name: 'Show diff' }))
    const diff = within(panel).getByRole('table', { name: 'Staged changes' })
    expect(within(diff).getAllByRole('row')).toHaveLength(4)
    expect(within(panel).getByRole('button', { name: 'Show diff' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('× removes its whole op, whatever fields it holds: one block, one op (§5.6)', async () => {
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'DELETE /api/changes/ops/0': three(), 'DELETE /api/changes/ops/1': three() }))
    renderAt(<Tray />)
    const { panel } = await review()
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove op: stage, partners on projects:river-commons' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/changes/ops/0')).toBe(true))
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove op: status on funding-opportunities:fundacion-x' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/changes/ops/1')).toBe(true))
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('× on a stale multi-field op unstages it whole: nothing is staged back over the trunk’s value (C20)', async () => {
    const stale = three({ stale: [0], current: [{ stage: 'execute', partners: ['example-coop'] }, null] })
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': stale, 'DELETE /api/changes/ops/0': three() }))
    renderAt(<Tray />)
    const { panel } = await review()
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove op: stage, partners on projects:river-commons' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/changes/ops/0')).toBe(true))
    expect(calls.filter(c => c.method === 'POST')).toEqual([])
  })

  it('× on a stale one-field op still unstages the whole op (C20)', async () => {
    const stale = three({ stale: [1], current: [null, { status: 'won' }] })
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': stale, 'DELETE /api/changes/ops/1': three() }))
    renderAt(<Tray />)
    const { panel } = await review()
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove op: status on funding-opportunities:fundacion-x' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/changes/ops/1')).toBe(true))
  })

  it('× on a replace unstages it whole, as any op (C21: no field is re-staged)', async () => {
    const replace = changeView({ ops: [{ op: 'replace', record: 'projects:site', value: { id: 'site', title: 'Site', note: 'n', lead: 'ana' }, base: 'h', before: { id: 'site', title: 'Old site', note: 'x' } }] })
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': replace, 'DELETE /api/changes/ops/0': changeView() }))
    renderAt(<Tray />)
    const { panel } = await review()
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove op: title, note, lead on Old site' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/changes/ops/0')).toBe(true))
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('applies as one commit, shows its short sha, then closes', async () => {
    let held = three()
    fetchRoutes(baseRoutes({ 'GET /api/changes': () => held, 'POST /api/changes/apply': () => { held = changeView(); return { commit: 'abc1234def5678' } } }))
    renderAt(<Tray appliedMs={30} />)
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('commit abc1234')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('commit abc1234')).toBeNull())
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull()
  })

  it('an applied change marks the generated-files answer out of date', async () => {
    let held = three()
    fetchRoutes(baseRoutes({ 'GET /api/changes': () => held, 'POST /api/changes/apply': () => { held = changeView(); return { commit: 'abc1234def5678' } } }))
    const { qc } = renderAt(<Tray appliedMs={30} />)
    qc.setQueryData(['generated'], { behind: false })
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Apply' }))
    await screen.findByText('commit abc1234')
    expect(qc.getQueryState(['generated'])!.isInvalidated).toBe(true)
  })

  it('says so when there was nothing to commit, then closes (C3)', async () => {
    let held = three()
    fetchRoutes(baseRoutes({ 'GET /api/changes': () => held, 'POST /api/changes/apply': () => { held = changeView(); return { commit: '' } } }))
    renderAt(<Tray appliedMs={30} />)
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Nothing to commit: the files already hold these values.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Nothing to commit: the files already hold these values.')).toBeNull())
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull()
  })

  it("keeps every op when Apply fails, with the server's message in attn", async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'POST /api/changes/apply': refuse(503, { error: 'Not applied: git refused the commit (index.lock). Nothing was changed.' }) }))
    renderAt(<Tray />)
    const t = await tray()
    fireEvent.click(within(t).getByRole('button', { name: 'Apply' }))
    expect((await within(t).findByText('Not applied: git refused the commit (index.lock). Nothing was changed.')).className).toContain('err')
    expect(within(t).getByText('2 staged changes')).toBeTruthy()
  })

  it('on a 409 with no code, shows the error as written, keeps every op, and does not re-read (C7)', async () => {
    const sentence = 'data/projects.yaml has YAML errors: bad indentation at line 4.'
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'POST /api/changes/apply': refuse(409, { error: sentence }) }))
    renderAt(<Tray />)
    const t = await tray()
    const before = reads(calls)
    fireEvent.click(within(t).getByRole('button', { name: 'Apply' }))
    expect((await within(t).findByText(sentence)).className).toContain('err')
    expect(within(t).getByText('2 staged changes')).toBeTruthy()
    expect(reads(calls)).toBe(before)
  })

  it("on a 409 STALE, re-reads the change so the stale ops show, with the server's sentence (C19)", async () => {
    const sentence = 'Not applied: one op was staged against a record that has changed since. Nothing was written. Take theirs or keep mine on it, then apply again.'
    let held = three()
    fetchRoutes(baseRoutes({ 'GET /api/changes': () => held,
      'POST /api/changes/apply': () => { held = three({ stale: [1], current: [null, { status: 'won' }] }); return new Response(JSON.stringify({ stale: [1], error: sentence, code: 'STALE' }), { status: 409 }) } }))
    renderAt(<Tray />)
    const t = await tray()
    fireEvent.click(within(t).getByRole('button', { name: 'Apply' }))
    expect((await within(t).findByText(sentence)).className).toContain('err')
    await within(t).findByText('1 op changed on the trunk — choose what stands')
    const { panel } = await review()
    expect(within(panel).getByText('trunk now: won')).toBeTruthy()
  })

  it("on a 409 DIRTY, gives the server's sentence as written, plus every path (C4)", async () => {
    const sentence = 'Not saved: data/projects.yaml has changes that are not committed yet, and this save would commit them along with yours.'
    fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'POST /api/changes/apply': refuse(409, { error: sentence, code: 'DIRTY', paths: ['data/projects.yaml', 'data/funding-opportunities.yaml'] }) }))
    renderAt(<Tray />)
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText(sentence)).toBeTruthy()
    expect(screen.getByText('Files: data/projects.yaml, data/funding-opportunities.yaml').className).toContain('err')
  })

  it('on a 403, shows the reason in attn', async () => {
    const reason = 'example-os decides changes by consensus; it stays staged until it is proposed.'
    fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'POST /api/changes/apply': refuse(403, { reason, error: reason }) }))
    renderAt(<Tray />)
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Apply' }))
    expect((await screen.findByText(reason)).className).toContain('err')
  })

  it("on a 422, puts each error on its op's block by record and field, and opens the ops", async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': three(),
      'POST /api/changes/apply': refuse(422, { errors: [{ record: 'funding-opportunities:fundacion-x', field: 'status', message: 'must be one of drafting, submitted, won' }] }) }))
    renderAt(<Tray />)
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Apply' }))
    const err = await screen.findByText('must be one of drafting, submitted, won')
    expect(err.closest('li')!.textContent).toContain('funding-opportunities:fundacion-x')
    expect(screen.getByRole('group', { name: 'Your change' })).toBeTruthy()
    expect(screen.getByText('Not applied: 1 field is refused; the marked row says why.')).toBeTruthy()
  })

  it("on a 422, a refusal of a whole op (field '') is a line of its own, not on a block (C5)", async () => {
    const message = 'Not deleted: funding-opportunities "fundacion-x" is still referred to by projects "p" (funding).'
    fetchRoutes(baseRoutes({ 'GET /api/changes': three(),
      'POST /api/changes/apply': refuse(422, { errors: [{ record: 'funding-opportunities:fundacion-x', field: '', message }] }) }))
    renderAt(<Tray />)
    const t = await tray()
    fireEvent.click(within(t).getByRole('button', { name: 'Apply' }))
    const line = await within(t).findByText(message)
    expect(line.className).toContain('err')
    expect(line.closest('li')).toBeNull()
  })

  it('on a 404 from ×, re-reads the change: another tab took the op (C5)', async () => {
    const gone = 'No op 1 in this change: it holds 1, numbered from 0.'
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'DELETE /api/changes/ops/1': refuse(404, { error: gone }) }))
    renderAt(<Tray />)
    const { t, panel } = await review()
    const before = reads(calls)
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove op: status on funding-opportunities:fundacion-x' }))
    expect(await within(t).findByText(gone)).toBeTruthy()
    await waitFor(() => expect(reads(calls)).toBeGreaterThan(before))
  })

  it("a refused × says it in its own verb (C5)", async () => {
    const errors = [{ record: 'projects:river-commons', field: 'lead', message: 'no members "ana"' }]
    fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'DELETE /api/changes/ops/1': refuse(422, { errors }) }))
    renderAt(<Tray />)
    const { t, panel } = await review()
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove op: status on funding-opportunities:fundacion-x' }))
    expect(await within(t).findByText('Not removed: projects:river-commons · lead: no members "ana"')).toBeTruthy()
  })

  it('disables Apply with the reason when the rule is not direct for you', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': three({ rule: { direct: false, sentence: 'example-os decides changes by consensus; it stays staged until it is proposed.', source: 'data/governance.yaml' } }) }))
    renderAt(<Tray />)
    const t = await tray()
    expect((within(t).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(t).getByText('example-os decides changes by consensus; it stays staged until it is proposed.')).toBeTruthy()
  })

  it('marks a stale op with the value on the trunk now, and rebases on your choice', async () => {
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': three({ stale: [1], current: [null, { status: 'won' }] }), 'POST /api/changes/ops/1/rebase': three() }))
    renderAt(<Tray />)
    const t = await tray()
    expect(within(t).queryByRole('button', { name: 'Apply' })).toBeNull()
    const { panel } = await review()
    expect((within(panel).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
    const stale = ops(panel)[1]!
    expect(stale.className).toContain('stale')
    expect(within(stale).getByText('trunk now: won')).toBeTruthy()
    fireEvent.click(within(stale).getByRole('button', { name: 'Take theirs' }))
    await waitFor(() => expect(calls.find(c => c.path === '/api/changes/ops/1/rebase')?.body).toEqual({ keep: 'theirs' }))
  })

  it('asks before Discard all, naming what goes, and discards on yes', async () => {
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'DELETE /api/changes': () => new Response(null, { status: 204 }) }))
    renderAt(<Tray />)
    const { panel } = await review()
    fireEvent.click(within(panel).getByRole('button', { name: 'Discard all' }))
    const ask = screen.getByRole('dialog', { name: 'Discard 2 staged ops?' })
    expect(within(ask).getByText('They exist only in your change. Nothing on the trunk is touched.')).toBeTruthy()
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep them' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard 2 staged ops?' })).toBeNull())
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
    fireEvent.click(within(panel).getByRole('button', { name: 'Discard all' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard 2 staged ops?' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/changes')).toBe(true))
  })

  it('applies when ⌘K asks, through the apply-changes event', async () => {
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'POST /api/changes/apply': { commit: 'abc1234' } }))
    renderAt(<Tray />)
    await tray()
    act(() => { window.dispatchEvent(new Event('apply-changes')) })
    await waitFor(() => expect(calls.some(c => c.path === '/api/changes/apply')).toBe(true))
  })

  it('is absent when your git email matches no member', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/actor': { unknown: 'x@example.org' }, 'GET /api/changes': three() }))
    const { qc, container } = renderAt(<Tray />)
    await waitFor(() => expect(qc.getQueryData(['actor'])).toBeTruthy())
    expect(container.textContent).toBe('')
  })

  it('renders hostile record keys and values as text (Review Focus 3)', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': changeView({ ops: [{ op: 'update', record: 'projects:<img src=x>', set: { title: '<script>alert(1)</script>' }, base: 'h', before: { title: 'a' } }] }) }))
    const { container } = renderAt(<Tray />)
    const { panel } = await review()
    fireEvent.click(within(panel).getByRole('button', { name: 'Show diff' }))
    expect(container.querySelector('img, script')).toBeNull()
    expect(within(panel).getAllByText('<script>alert(1)</script>').length).toBeGreaterThan(0)
  })
  /** An apply route that answers only when the test says so. */
  const pendingApply = () => {
    let answer: (v: unknown) => void = () => {}
    const route = () => new Promise(resolve => { answer = resolve })
    return { route, answer: (v: unknown) => answer(v) }
  }

  it('sends one apply for a double click, and hides the actions while it is pending', async () => {
    const p = pendingApply()
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'POST /api/changes/apply': p.route }))
    renderAt(<Tray />)
    const t = await tray()
    const button = within(t).getByRole('button', { name: 'Apply' }) as HTMLButtonElement
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(within(t).queryByRole('button', { name: 'Apply' })).toBeNull())
    expect(calls.filter(c => c.path === '/api/changes/apply')).toHaveLength(1)
    await act(async () => { p.answer({ commit: 'abc1234' }) })
    expect(calls.filter(c => c.path === '/api/changes/apply')).toHaveLength(1)
  })

  it('sends one apply when ⌘K asks while an apply is pending', async () => {
    const p = pendingApply()
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/changes': three(), 'POST /api/changes/apply': p.route }))
    renderAt(<Tray />)
    await tray()
    act(() => { window.dispatchEvent(new Event('apply-changes')) })
    act(() => { window.dispatchEvent(new Event('apply-changes')) })
    await waitFor(() => expect(calls.filter(c => c.path === '/api/changes/apply')).toHaveLength(1))
    act(() => { window.dispatchEvent(new Event('apply-changes')) })
    await act(async () => { p.answer({ commit: 'abc1234' }) })
    expect(calls.filter(c => c.path === '/api/changes/apply')).toHaveLength(1)
  })

  it("forgets an old refusal once the change is empty: a new stage shows no old line", async () => {
    let held = three()
    fetchRoutes(baseRoutes({ 'GET /api/changes': () => held,
      'POST /api/changes/apply': () => { held = changeView(); return new Response(JSON.stringify({ error: 'Nothing is staged: the change holds no ops to apply.', code: 'EMPTY' }), { status: 400 }) } }))
    const { qc } = renderAt(<Tray />)
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull())
    held = three()
    await act(async () => { await qc.invalidateQueries({ queryKey: ['changes'] }) })
    const t = await tray()
    expect(within(t).queryByText('Nothing is staged: the change holds no ops to apply.')).toBeNull()
  })

  it('clips long values, with the whole of each in its title (Review Focus 3)', async () => {
    const long = 'a very long value '.repeat(112).trim()
    const key = `projects:${'p'.repeat(2000)}`
    fetchRoutes(baseRoutes({ 'GET /api/changes': changeView({ ops: [{ op: 'update', record: key, set: { note: long }, base: 'h', before: { note: `old ${long}` } }] }) }))
    renderAt(<Tray />)
    const { panel } = await review()
    for (const text of [key, long, `old ${long}`]) {
      const el = within(panel).getByText(text)
      expect(el.classList.contains('clip')).toBe(true)
      expect(el.getAttribute('title')).toBe(text)
    }
  })

  it("draws a new record's line with no old value", async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': changeView({ ops: [{ op: 'create', record: 'ideas:new', value: { id: 'new', title: 'venture commune' }, base: null, before: null }] }) }))
    renderAt(<Tray />)
    const { panel } = await review()
    const line = within(panel).getByText('new record').closest('.trayop-chg')!
    expect(line.querySelector('s')).toBeNull()
    expect(line.textContent).toContain('venture commune')
  })

  it('while one action is in flight, every other control waits: Discard all during Apply asks nothing and sends nothing', async () => {
    let release!: (r: Response) => void
    const { calls } = fetchRoutes(baseRoutes({
      'GET /api/changes': three(),
      'POST /api/changes/apply': () => new Promise<Response>(r => { release = r }),
    }))
    renderAt(<Tray />)
    const { t, panel } = await review()
    fireEvent.click(within(panel).getByRole('button', { name: 'Apply' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Discard all' }))
    expect(screen.queryByRole('dialog', { name: /^Discard/ })).toBeNull()
    expect(calls.filter(c => c.method === 'DELETE')).toEqual([])
    release(new Response(JSON.stringify({ commit: 'abc1234def' }), { status: 200 }))
    expect(await within(t).findByText('Applied')).toBeTruthy()
  })

  it('closes the expanded panel on Escape: it is the bottom panel', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': three() }))
    renderAt(<Tray />)
    const { t } = await review()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(within(t).queryByRole('group', { name: 'Your change' })).toBeNull())
    expect(within(t).getByRole('button', { name: 'Review' })).toBeTruthy()
  })

  it('the panel is a modal dialog; Escape closes it, then focus returns to Review (shut first, then focus)', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': three() }))
    renderAt(<Tray />)
    const { t, button, panel } = await review()
    const pop = panel.closest('dialog')!
    expect(pop.hasAttribute('open')).toBe(true)
    expect(proto.showModal).toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Your change' })))
    const x = within(panel).getByRole('button', { name: 'Remove op: status on funding-opportunities:fundacion-x' })
    x.focus()
    const openAtFocus: boolean[] = []
    const focus = HTMLElement.prototype.focus
    vi.spyOn(button, 'focus').mockImplementation(function (this: HTMLElement) { openAtFocus.push(pop.hasAttribute('open')); focus.call(this) })
    fireEvent.keyDown(x, { key: 'Escape' })
    await waitFor(() => expect(within(t).queryByRole('group', { name: 'Your change' })).toBeNull())
    expect(openAtFocus).toEqual([false])
    expect(document.activeElement).toBe(button)
  })

  it('closes the bottom slot once the change is empty, so the next Escape is not swallowed (M-1)', async () => {
    let held = three()
    fetchRoutes(baseRoutes({ 'GET /api/changes': () => held, 'DELETE /api/changes': () => { held = changeView(); return new Response(null, { status: 204 }) } }))
    renderAt(<Tray />)
    const { panel } = await review()
    fireEvent.click(within(panel).getByRole('button', { name: 'Discard all' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard 2 staged ops?' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull())
    // fireEvent answers false when a listener called preventDefault: a slot took the key.
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true)
  })
})

describe('the docked tray (§5.6, C-6)', () => {
  it('is hidden while previewing: write actions are not drawn', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': STAGED }))
    const { qc, container } = renderAt(<ViewAsProvider initial={{ as: 'public' }}><Tray /></ViewAsProvider>)
    await waitFor(() => expect(qc.getQueryData(['changes'])).toBeTruthy())
    expect(container.querySelector('.tray')).toBeNull()
  })

  it('collapsed: a region named Changes, the moss count, the last op and its rule on one line, Review then Apply when direct', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': STAGED }))
    renderAt(<Tray />)
    const t = await tray()
    const count = t.querySelector('.tray-cnt')!
    expect([count.textContent, count.classList.contains('attn')]).toEqual(['2', false])
    expect(within(t).getByText('2 staged changes').tagName).toBe('B')
    expect(t.querySelector('.tray-line')!.textContent).toBe('Treasury signer · wearers: 8 · Saves directly · the steward decides alone')
    const buttons = within(t).getAllByRole('button')
    expect(buttons.map(b => [b.textContent, b.className.includes('primary')])).toEqual([['Review', false], ['Apply', true]])
  })

  it('collapsed: one op is "1 staged change"; Propose when the rule needs more than the author', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': trayView({ ops: [THRESHOLD] }) }))
    const a = renderAt(<Tray />)
    expect(within(await tray()).getByText('1 staged change')).toBeTruthy()
    a.unmount()
    fetchRoutes(baseRoutes({ 'GET /api/changes': trayView({ ops: [THRESHOLD, NOTE, WEARERS] }) }))
    renderAt(<Tray />)
    const t = await tray()
    expect(within(t).getByText('3 staged changes')).toBeTruthy()
    expect(t.querySelector('.tray-line')!.textContent).toBe('Treasury signer · wearers: 8 · Council consent decides this · 4 of 8')
    expect(within(t).getAllByRole('button').map(b => b.textContent)).toEqual(['Review', 'Propose'])
  })

  it('stale: the square reads "!" in clay, the line says what changed, and Review is the only action, primary', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': STALE }))
    renderAt(<Tray />)
    const t = await tray()
    const count = t.querySelector('.tray-cnt')!
    expect([count.textContent, count.classList.contains('attn')]).toEqual(['!', true])
    expect(within(t).getByText('1 op changed on the trunk — choose what stands')).toBeTruthy()
    const buttons = within(t).getAllByRole('button')
    expect(buttons.map(b => [b.textContent, b.className.includes('primary')])).toEqual([['Review', true]])
  })

  it('applying: a spinner, "Applying…" and the rule; no actions; the region is busy', async () => {
    let answer: (v: unknown) => void = () => {}
    fetchRoutes(baseRoutes({ 'GET /api/changes': STAGED, 'POST /api/changes/apply': () => new Promise(r => { answer = r }) }))
    renderAt(<Tray />)
    const t = await tray()
    fireEvent.click(within(t).getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(t.getAttribute('aria-busy')).toBe('true'))
    expect(t.querySelector('.tray-bar .spin')).not.toBeNull()
    expect(within(t).getByText('Applying…')).toBeTruthy()
    expect(t.querySelector('.tray-line')!.textContent).toBe('Saves directly · the steward decides alone')
    expect(within(t).queryAllByRole('button')).toEqual([])
    await act(async () => { answer({ commit: 'abc1234' }) })
  })

  it('expanded: "Your change", ops · records, one block per op (old struck, new in Mono), the stale op, and the foot', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': EXPANDED }))
    renderAt(<Tray />)
    const { panel } = await review()
    expect(within(panel).getByRole('heading', { name: 'Your change' })).toBeTruthy()
    expect(within(panel).getByText('3 ops · 2 records')).toBeTruthy()
    const [first, , signer] = ops(panel)
    expect(within(first!).getByRole('link', { name: 'Treasury' }).getAttribute('href')).toBe('/r/system/treasury')
    const was = within(first!).getByText('4 of 9')
    expect([was.tagName, was.className]).toEqual(['S', 'trayop-was clip'])
    expect(within(first!).getByText('4 of 8').className).toBe('trayop-new clip')
    expect(within(first!).getByText('threshold').className).toBe('trayop-k')
    expect(within(panel).getAllByRole('button', { name: /^Remove op: / }).map(b => b.getAttribute('aria-label'))).toEqual([
      'Remove op: threshold on Treasury', 'Remove op: note on Treasury', 'Remove op: wearers on Treasury signer'])
    expect(signer!.className).toContain('stale')
    expect(within(signer!).getByText('changed on the trunk')).toBeTruthy()
    expect(within(signer!).getByText('trunk now: 8')).toBeTruthy()
    expect(within(signer!).getAllByRole('button').map(b => b.textContent)).toEqual(['Keep mine', 'Take theirs', ''])
    const foot = panel.querySelector('.trayx-foot') as HTMLElement
    expect(within(foot).getByText('Council consent decides this · 4 of 8')).toBeTruthy()
    expect(within(foot).getAllByRole('button').map(b => [b.textContent, b.className.includes('primary')])).toEqual([['Show diff', false], ['Propose', true]])
  })

  it('Discard all asks first, "Discard 3 staged ops?"; Esc closes the question before focus returns to Discard all', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': EXPANDED }))
    renderAt(<Tray />)
    const { panel } = await review()
    const discard = within(panel).getByRole('button', { name: 'Discard all' })
    expect(discard.className).toContain('ghost')
    discard.focus()
    fireEvent.click(discard)
    const ask = screen.getByRole('dialog', { name: 'Discard 3 staged ops?' })
    const openAtFocus: boolean[] = []
    const focus = HTMLElement.prototype.focus
    vi.spyOn(discard, 'focus').mockImplementation(function (this: HTMLElement) { openAtFocus.push(ask.hasAttribute('open')); focus.call(this) })
    fireEvent.keyDown(within(ask).getByRole('button', { name: 'Keep them' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard 3 staged ops?' })).toBeNull())
    expect(openAtFocus).toEqual([false])
    expect(document.activeElement).toBe(discard)
    // the first Esc closed the question only: the panel is still open
    expect(screen.getByRole('group', { name: 'Your change' })).toBeTruthy()
  })

  it('opens on house:open-changes (g c), and Esc hands focus back to where it was', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': EXPANDED }))
    renderAt(<><button type="button">elsewhere</button><Tray /></>)
    const t = await tray()
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' })
    elsewhere.focus()
    act(() => { window.dispatchEvent(new Event(OPEN_CHANGES)) })
    const panel = within(t).getByRole('group', { name: 'Your change' })
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Your change' })))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(within(t).queryByRole('group', { name: 'Your change' })).toBeNull())
    expect(document.activeElement).toBe(elsewhere)
  })

  it('g c with nothing staged goes to /changes, which says so; while previewing it does nothing', async () => {
    fetchRoutes(baseRoutes())
    const { loc, qc, unmount } = renderAt(<Tray />)
    await waitFor(() => expect(qc.getQueryData(['changes'])).toBeTruthy())
    act(() => { window.dispatchEvent(new Event(OPEN_CHANGES)) })
    expect(loc.history.at(-1)).toBe('/changes')
    unmount()
    fetchRoutes(baseRoutes({ 'GET /api/changes': STAGED }))
    const b = renderAt(<ViewAsProvider initial={{ as: 'public' }}><Tray /></ViewAsProvider>)
    await waitFor(() => expect(b.qc.getQueryData(['changes'])).toBeTruthy())
    act(() => { window.dispatchEvent(new Event(OPEN_CHANGES)) })
    expect(b.loc.history).toEqual(['/'])
  })

  it('a press on the scrim (the dialog around the panel) closes the panel; a press inside does not', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': EXPANDED }))
    renderAt(<Tray />)
    const { t, button, panel } = await review()
    fireEvent.click(within(panel).getByText('3 ops · 2 records'))
    expect(within(t).getByRole('group', { name: 'Your change' })).toBeTruthy()
    fireEvent.click(panel.closest('dialog')!)
    await waitFor(() => expect(within(t).queryByRole('group', { name: 'Your change' })).toBeNull())
    expect(document.activeElement).toBe(button)
  })

  it('says a count that moves through the polite live region ("2 staged changes")', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': trayView({ ops: [THRESHOLD] }) }))
    const { qc } = renderAt(<Tray />)
    await tray()
    expect(screen.getByTestId('live').textContent).toBe('')
    act(() => { qc.setQueryData(['changes'], trayView({ ops: [THRESHOLD, WEARERS] })) })
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('2 staged changes'))
    expect(screen.getByTestId('live').getAttribute('aria-live')).toBe('polite')
  })

  it('on a phone: a card with the count, "N staged" and the primary only; a tap on the card opens /changes', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': STAGED }))
    const { loc } = renderAt(<Shell title="Fixture Org" nav={null} width={390} foot={<Tray />}><h1>Page</h1></Shell>)
    const t = await tray()
    expect(t.querySelector('.tray-cnt')!.textContent).toBe('2')
    const card = within(t).getByRole('link', { name: 'Review 2 staged changes' })
    expect(card.textContent).toBe('2 staged')
    expect(within(t).getAllByRole('button').map(b => b.textContent)).toEqual(['Apply'])
    expect(t.querySelector('.tray-line')).toBeNull()
    fireEvent.click(card)
    expect(loc.history.at(-1)).toBe('/changes')
  })

  it('on a phone, house:open-changes (g c) opens /changes', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': STAGED }))
    const { loc } = renderAt(<Shell title="Fixture Org" nav={null} width={390} foot={<Tray />}><h1>Page</h1></Shell>)
    await tray()
    act(() => { window.dispatchEvent(new Event(OPEN_CHANGES)) })
    expect(loc.history.at(-1)).toBe('/changes')
  })
})

describe('/changes (the tray as a page)', () => {
  it('is the page Changes: the change drawn whole, with no Review and no scrim', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': EXPANDED }))
    renderAt(<Changes />, '/changes')
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Changes')
    const t = await tray()
    const panel = await within(t).findByRole('group', { name: 'Your change' })
    expect(ops(panel)).toHaveLength(3)
    expect(within(t).queryByRole('button', { name: 'Review' })).toBeNull()
    expect(t.querySelector('dialog')).toBeNull()
  })

  it('says who you are could not be read, not that nothing is staged, when the actor read fails (review minor 7)', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/actor': refuse(500, { error: 'git is not answering' }) }))
    renderAt(<Changes />, '/changes')
    expect(await screen.findByText('Who you are couldn’t be read, so your staged changes are not shown.')).toBeTruthy()
    expect(screen.queryByText('Nothing is staged.')).toBeNull()
  })

  it('says nothing is staged when nothing is', async () => {
    fetchRoutes(baseRoutes())
    renderAt(<Changes />, '/changes')
    expect(await screen.findByText('Nothing is staged.')).toBeTruthy()
  })
})

describe('A13 review fixes', () => {
  /** A stand-in for the inspector: the right slot, opened by Inspect, holding a control of its own. */
  function Inspector() {
    const r = usePanel('right')
    return <>
      <button type="button" onClick={e => r.open('inspector', e.currentTarget)}>Inspect</button>
      {r.openId === 'inspector' && <aside aria-label="Inspector"><button type="button">Inside</button></aside>}
    </>
  }

  it('I-1: opening the panel closes the inspector it would cover, so the first Esc closes the panel, and focus goes back', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': EXPANDED }))
    renderAt(<><Inspector /><Tray /></>)
    const t = await tray()
    const inspect = screen.getByRole('button', { name: 'Inspect' })
    inspect.focus()
    fireEvent.click(inspect)
    screen.getByRole('button', { name: 'Inside' }).focus()
    act(() => { window.dispatchEvent(new Event(OPEN_CHANGES)) })
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull()
    expect(within(t).getByRole('group', { name: 'Your change' })).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(within(t).queryByRole('group', { name: 'Your change' })).toBeNull())
    expect(document.activeElement).toBe(inspect)
  })

  it('I-2: the panel is modal (showModal) and a route change closes it', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': EXPANDED }))
    const { loc } = renderAt(<Tray />, '/b/projects')
    const { t, panel } = await review()
    expect(proto.showModal).toHaveBeenCalledTimes(1)
    expect(panel.closest('dialog')!.hasAttribute('open')).toBe(true)
    act(() => { loc.navigate('/b/home') })
    await waitFor(() => expect(within(t).queryByRole('group', { name: 'Your change' })).toBeNull())
    // the slot went with it: the next Escape is nobody's
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true)
  })

  it('I-3: a keyboard Apply keeps focus in the tray while busy, and gives it back to Apply after a refusal', async () => {
    let refuseNow: () => void = () => {}
    fetchRoutes(baseRoutes({ 'GET /api/changes': three(),
      'POST /api/changes/apply': () => new Promise(r => { refuseNow = () => r(new Response(JSON.stringify({ error: 'Not applied: git refused the commit (index.lock).' }), { status: 503 })) }) }))
    renderAt(<Tray />)
    const t = await tray()
    const apply = within(t).getByRole('button', { name: 'Apply' })
    apply.focus()
    fireEvent.click(apply)
    await waitFor(() => expect(t.getAttribute('aria-busy')).toBe('true'))
    expect(document.activeElement).toBe(t.querySelector('.tray-bar'))
    await act(async () => { refuseNow() })
    await within(t).findByText('Not applied: git refused the commit (index.lock).')
    await waitFor(() => expect(document.activeElement).toBe(within(t).getByRole('button', { name: 'Apply' })))
  })

  it('I-3: a 422 opens the panel with Review as its opener, never the page: Esc puts focus on Review', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': three(),
      'POST /api/changes/apply': refuse(422, { errors: [{ record: 'funding-opportunities:fundacion-x', field: 'status', message: 'must be one of drafting, submitted, won' }] }) }))
    renderAt(<Tray />)
    const t = await tray()
    const apply = within(t).getByRole('button', { name: 'Apply' })
    apply.focus()
    fireEvent.click(apply)
    const panel = await within(t).findByRole('group', { name: 'Your change' })
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Your change' })))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(within(t).queryByRole('group', { name: 'Your change' })).toBeNull())
    expect(document.activeElement).toBe(within(t).getByRole('button', { name: 'Review' }))
  })

  it('I-4: on a phone a 422 opens /changes, and its rows carry the marks the message points at', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/changes': three(),
      'POST /api/changes/apply': refuse(422, { errors: [{ record: 'funding-opportunities:fundacion-x', field: 'status', message: 'must be one of drafting, submitted, won' }] }) }))
    function Dock() { const [at] = useLocation(); return at === '/changes' ? null : <Tray /> }
    const { loc } = renderAt(
      <Shell title="Fixture Org" nav={null} width={390} foot={<Dock />}><Switch><Route path="/changes"><Changes /></Route><Route><h1>Page</h1></Route></Switch></Shell>)
    fireEvent.click(within(await tray()).getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(loc.history.at(-1)).toBe('/changes'))
    const err = await screen.findByText('must be one of drafting, submitted, won')
    expect(err.closest('li')!.textContent).toContain('funding-opportunities:fundacion-x')
    expect(screen.getByText('Not applied: 1 field is refused; the marked row says why.')).toBeTruthy()
    expect(screen.getAllByRole('region', { name: 'Changes' })).toHaveLength(1)
  })

  it('M-3: on a phone, the busy card is the ring and the word, with no rule line', async () => {
    let answer: (v: unknown) => void = () => {}
    fetchRoutes(baseRoutes({ 'GET /api/changes': STAGED, 'POST /api/changes/apply': () => new Promise(r => { answer = r }) }))
    renderAt(<Shell title="Fixture Org" nav={null} width={390} foot={<Tray />}><h1>Page</h1></Shell>)
    const t = await tray()
    fireEvent.click(within(t).getByRole('button', { name: 'Apply' }))
    await within(t).findByText('Applying…')
    expect(t.querySelector('.tray-line')).toBeNull()
    expect(t.querySelector('.tray-bar .spin')).not.toBeNull()
    await act(async () => { answer({ commit: 'abc1234' }) })
  })
})
