// @vitest-environment jsdom
// DAO-OS L7 Task 18: /deploy — the prepared steps in order, and read back.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import Deploy from './Deploy.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { houseSource } from '../session/houseSource.ts'
import { OPEN_CHANGES } from '../keys/useHouseKeys.ts'
import { COMPOSED_SYSTEMS } from '../test/fixtures/house/composed.ts'
import { DEPLOY_PLAN, DEPLOY_SAFE, REPLACES, SPACE_DRAFT, STEP_HATS, STEP_REGISTER, STEP_SPACE, STEP_WEARERS, STEP_WIRE, WIRE_WINDOW } from '../test/fixtures/house/deploy.ts'
import type { Op } from '../api.ts'

afterEach(() => vi.unstubAllGlobals())

const systems = { 'GET /api/registries/systems': { name: 'systems', kind: 'collection', schemaVersion: '1.0', entries: COMPOSED_SYSTEMS } }
const rows = () => [...document.querySelectorAll<HTMLElement>('.dep-step')]
const titles = () => rows().map(r => r.querySelector('.dep-t')!.textContent)
const marks = () => rows().map(r => r.querySelector('.dep-h .smark-word')!.textContent)
const row = (title: string) => rows().find(r => r.querySelector('.dep-t')!.textContent === title)!
const heard: string[] = []
const hear = () => heard.push(OPEN_CHANGES)

describe('/deploy (L7 Task 18)', () => {
  it('lists the steps in order, each with its mark, under the page’s heading and the count', async () => {
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN }))
    renderAt(<Deploy />, '/deploy')
    expect(await screen.findByRole('heading', { level: 1, name: 'Deploy' })).toBeTruthy()
    await waitFor(() => expect(titles()).toEqual(DEPLOY_PLAN.steps.map(s => s.title)))
    expect(marks()).toEqual(['Done', 'Done', 'Ready', 'Ready', 'Waits', 'Waits', 'Ready', 'Ready'])
    expect(document.querySelector('.rh-meta')!.textContent).toBe('Sepolia · 8 prepared transactions, in order')
    expect(row('Deploy the Hats Signer Gate').querySelector('.dep-w')!.textContent).toBe('Waits for the child hats to be read back.')
    // who signs, said on each step
    expect(row('Create the Safe').querySelector('.dep-s')!.textContent).toBe('Any account, from its own wallet · Test DAO Safe')
    expect(row('Create the child hats').querySelector('.dep-s')!.textContent).toBe('Test DAO Safe signs, in the Safe app · Test DAO roles')
  })

  it('a ready Safe step is the prepared-transaction card; an account step the account-step card', async () => {
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(rows().length).toBe(8))
    const hats = within(row('Create the child hats')).getByRole('region', { name: 'Prepared transaction' })
    expect(hats.querySelector('.ptx-ct')!.textContent).toBe(STEP_HATS.step!.call.summary)
    expect(hats.textContent).toContain('nonce 0')
    expect(within(row('Give the hats to their first wearers')).getByRole('region', { name: 'Prepared transaction' }).textContent).toContain(`nonce ${STEP_WEARERS.step!.safe!.payload.nonce}`)
    // the page's one primary is Read back: Open in Safe is secondary here
    expect(within(hats).getByRole('link', { name: /Open in Safe/ }).className).not.toContain('primary')
    expect(within(row('Register the daoURI')).getByRole('region', { name: 'Register the daoURI' }).querySelector('.ptx-never')!.textContent)
      .toBe('Sign this from your own wallet. The Hub never signs.')
    expect(rows().filter(r => r.querySelector('.ptx')).length).toBe(3)
  })

  it('a Safe card’s threshold is the one the server says the step carries (M-4)', async () => {
    const hats = { ...STEP_HATS, threshold: 3 }
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': { ...DEPLOY_PLAN, steps: [hats] } }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(rows().length).toBe(1))
    expect(within(row('Create the child hats')).getByRole('region', { name: 'Prepared transaction' }).textContent).toContain('0 of 3 signed')
  })

  it('draws a ready step’s differs as warnings: the wiring window, and step 9 replacing another text', async () => {
    const wire = { ...STEP_WIRE, status: 'ready' as const, waits: undefined, differs: [WIRE_WINDOW], step: STEP_HATS.step }
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': { ...DEPLOY_PLAN, steps: [wire, STEP_REGISTER] } }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(rows().length).toBe(2))
    expect([...row('Wire the gate to the Safe').querySelectorAll('.dep-warn li')].map(l => l.textContent)).toEqual([WIRE_WINDOW])
    expect([...row('Register the daoURI').querySelectorAll('.dep-warn li')].map(l => l.textContent)).toEqual([REPLACES])
    expect(marks()).toEqual(['Ready', 'Ready'])
  })

  it('a mismatch lists what the chain shows instead, under “Doesn’t match”', async () => {
    const top = { ...DEPLOY_PLAN.steps[1]!, status: 'mismatch' as const, differs: ['the top hat at 1 is worn by 0x…00b1, not the Safe'] }
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': { ...DEPLOY_PLAN, steps: [DEPLOY_PLAN.steps[0]!, top] } }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(rows().length).toBe(2))
    expect(marks()).toEqual(['Done', 'Doesn’t match'])
    expect([...row('Mint the top hat to the Safe').querySelectorAll('.dep-off li')].map(l => l.textContent)).toEqual(top.differs)
  })

  it('step 8 is the settings to paste: the JSON in Mono with Copy, and its three links; no call, no card', async () => {
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': { ...DEPLOY_PLAN, steps: [STEP_SPACE] } }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(rows().length).toBe(1))
    const r = row('The Snapshot space')
    expect(r.querySelector('.ptx')).toBeNull()
    expect(JSON.parse(r.querySelector('.dep-json')!.textContent!)).toEqual(SPACE_DRAFT.settings)
    expect(within(r).getByRole('button', { name: 'Copy settings' })).toBeTruthy()
    const hrefs = within(r).getAllByRole('link').map(a => a.getAttribute('href'))
    expect(hrefs).toEqual([SPACE_DRAFT.links.name, SPACE_DRAFT.links.create, SPACE_DRAFT.links.space])
  })

  it('a mismatched space keeps its draft, to paste again', async () => {
    const off = { ...STEP_SPACE, status: 'mismatch' as const, differs: ['the space on the Snapshot hub is named "Other", not "Test DAO"'] }
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': { ...DEPLOY_PLAN, steps: [off] } }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(rows().length).toBe(1))
    expect(row('The Snapshot space').querySelector('.dep-off li')!.textContent).toBe(off.differs[0])
    expect(JSON.parse(row('The Snapshot space').querySelector('.dep-json')!.textContent!)).toEqual(SPACE_DRAFT.settings)
  })

  it('Read back (the page’s primary) posts what the signer ran — the ready steps and their predictions — and opens the tray', async () => {
    const op = { op: 'update', record: 'systems:test-dao-safe', set: { address: DEPLOY_SAFE } } as unknown as Op
    const change = changeView({ ops: [op], classes: ['records'] })
    const { calls } = fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN,
      'POST /api/deploy/read-back': { readBack: { systems: [] }, staged: [op], change } }))
    heard.length = 0
    window.addEventListener(OPEN_CHANGES, hear)
    try {
      renderAt(<Deploy />, '/deploy')
      const button = await screen.findByRole('button', { name: 'Read back' })
      expect(button.className).toContain('primary')
      fireEvent.click(button)
      await waitFor(() => expect(heard).toEqual([OPEN_CHANGES]))
      const sent = calls.filter(c => c.method === 'POST' && c.path === '/api/deploy/read-back').map(c => c.body)
      expect(sent).toEqual([{ ran: DEPLOY_PLAN.steps.filter(s => s.status === 'ready').map(s => ({ step: s.id, system: s.system, predicts: s.predicts.map(p => ({ kind: p.kind, value: p.value })) })) }])
      await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('Read back: 1 change staged in your changes.'))
    } finally { window.removeEventListener(OPEN_CHANGES, hear) }
  })

  it('a read-back that keeps the Safes\u2019 on_deploy says why, beside what it staged (walk G4)', async () => {
    const op = { op: 'update', record: 'systems:test-dao-safe', set: { address: DEPLOY_SAFE } } as unknown as Op
    const note = 'The Systems are recorded as deployed, but their governance is not added: role council is already written. It stays in the Safe\u2019s record.'
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN,
      'POST /api/deploy/read-back': { readBack: { systems: [] }, staged: [op], change: changeView({ ops: [op], classes: ['records'] }), note } }))
    renderAt(<Deploy />, '/deploy')
    fireEvent.click(await screen.findByRole('button', { name: 'Read back' }))
    expect(await screen.findByText(note)).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe(`Read back: 1 change staged in your changes. ${note}`))
  })

  // Fix I-2: the plan is the chain as it was read; after a read-back, on focus and on a visibility change it is read again.
  const gets = (calls: { method: string; path: string }[]) => calls.filter(c => c.method === 'GET' && c.path === '/api/deploy').length

  it('after every read-back answer the plan is read again: a 200, a MISMATCH, a 422 and a 502', async () => {
    const answers: unknown[] = [
      { readBack: { systems: [] }, staged: [] },
      refuse(409, { code: 'MISMATCH', error: 'Not staged: test-dao-roles: another top hat took it.', readBack: { systems: [] } }),
      refuse(422, { errors: [{ record: 'governance:governance', field: '', message: 'rule records: nobody can propose under it.' }] }),
      refuse(502, { code: 'READ_FAILED', error: 'ethereum-sepolia-rpc.publicnode.com did not answer in time' }),
    ]
    for (const answer of answers) {
      const { calls } = fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN, 'POST /api/deploy/read-back': answer }))
      const { unmount } = renderAt(<Deploy />, '/deploy')
      fireEvent.click(await screen.findByRole('button', { name: 'Read back' }))
      await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/api/deploy/read-back')).toBe(true))
      await waitFor(() => expect(gets(calls)).toBe(2))
      unmount()
      vi.unstubAllGlobals()
    }
  })

  it('focus and a visibility change read the plan again', async () => {
    const { calls } = fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(rows().length).toBe(8))
    expect(gets(calls)).toBe(1)
    fireEvent.focus(window)
    await waitFor(() => expect(gets(calls)).toBe(2))
    await waitFor(() => expect(rows().length).toBe(8))
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(gets(calls)).toBe(3))
  })

  it('says when the plan was read, in a <time> the walks mask', async () => {
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(rows().length).toBe(8))
    const time = document.querySelector(`time[datetime="${DEPLOY_PLAN.readAt}"]`)!
    expect(time).toBeTruthy()
    expect(time.hasAttribute('data-volatile')).toBe(true)
    expect(time.parentElement!.textContent).toMatch(/^Read /)
  })

  it('a step whose System the read-back reads deployed is never drawn Ready beside it, while the plan is read again', async () => {
    let first = true
    const { calls } = fetchRoutes(baseRoutes({ ...systems,
      // the first read answers; the read after the read-back has not come back yet
      'GET /api/deploy': () => (first ? (first = false, DEPLOY_PLAN) : new Promise(() => {})),
      'POST /api/deploy/read-back': { readBack: { systems: [{ id: 'test-dao-roles', status: 'deployed', found: {}, differs: [] }] }, staged: [] } }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(marks()).toEqual(['Done', 'Done', 'Ready', 'Ready', 'Waits', 'Waits', 'Ready', 'Ready']))
    fireEvent.click(screen.getByRole('button', { name: 'Read back' }))
    await waitFor(() => expect(screen.getByRole('group', { name: 'Read back' })).toBeTruthy())
    expect(gets(calls)).toBe(2)
    expect(marks()).toEqual(['Done', 'Done', 'Done', 'Done', 'Waits', 'Waits', 'Ready', 'Ready'])
    expect(row('Create the child hats').querySelector('.ptx')).toBeNull()
    expect(row('Give the hats to their first wearers').querySelector('.ptx')).toBeNull()
  })

  it('a read-back that finds nothing new stages nothing and says so; the tray stays shut', async () => {
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN, 'POST /api/deploy/read-back': { readBack: { systems: [] }, staged: [] } }))
    heard.length = 0
    window.addEventListener(OPEN_CHANGES, hear)
    try {
      renderAt(<Deploy />, '/deploy')
      fireEvent.click(await screen.findByRole('button', { name: 'Read back' }))
      await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('Read back: the chain shows nothing new to stage.'))
      expect(heard).toEqual([])
    } finally { window.removeEventListener(OPEN_CHANGES, hear) }
  })

  it('a 409 MISMATCH is shown with the read-back’s rows and what differs, and nothing is staged', async () => {
    const readBack = { systems: [
      { id: 'test-dao-safe', status: 'deployed', found: {}, differs: [] },
      { id: 'test-dao-roles', status: 'mismatch', found: {}, differs: ['the Safe wears no top hat at 2; another top hat took it — prepare again'] },
    ] }
    const error = 'Not staged: test-dao-roles: the Safe wears no top hat at 2; another top hat took it — prepare again.'
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN, 'POST /api/deploy/read-back': refuse(409, { code: 'MISMATCH', error, readBack }) }))
    heard.length = 0
    window.addEventListener(OPEN_CHANGES, hear)
    try {
      renderAt(<Deploy />, '/deploy')
      fireEvent.click(await screen.findByRole('button', { name: 'Read back' }))
      await waitFor(() => expect(document.querySelector('.note-error')?.textContent).toBe(error))
      const table = screen.getByRole('group', { name: 'Read back' })
      expect([...table.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['Test DAO Safe', 'Test DAO roles'])
      expect([...table.querySelectorAll('dd')].map(d => d.textContent)).toEqual(['Deployed', 'Doesn’t match: the Safe wears no top hat at 2; another top hat took it — prepare again'])
      expect(heard).toEqual([])
    } finally { window.removeEventListener(OPEN_CHANGES, hear) }
  })

  it('says each other refusal in its own sentence, staging nothing', async () => {
    const answers: [number, Record<string, unknown>, string][] = [
      [409, { code: 'PART_HIDDEN', error: 'Part of this composition is not yours to read: someone who can read all of it reads it back.' }, 'Part of this composition is not yours to read: someone who can read all of it reads it back.'],
      [409, { code: 'CHANGE_EDITS', error: 'Your changes already edit systems:test-dao-safe: apply, propose or discard them, then read back.', readBack: { systems: [] } }, 'Your changes already edit systems:test-dao-safe: apply, propose or discard them, then read back.'],
      [409, { code: 'KEPT_PRIVATE', error: 'This read-back would copy a value kept outside the repository into what the repository holds, and the repository keeps nothing stricter than members. Nothing was staged.', readBack: { systems: [] } }, 'This read-back would copy a value kept outside the repository into what the repository holds, and the repository keeps nothing stricter than members. Nothing was staged.'],
      [409, { code: 'NOT_ADMITTED', error: 'Part of what this read-back writes is kept at a level you are not admitted to, so you cannot write it: someone admitted to it reads it back. Nothing was staged.', readBack: { systems: [] } }, 'Part of what this read-back writes is kept at a level you are not admitted to, so you cannot write it: someone admitted to it reads it back. Nothing was staged.'],
      [409, { code: 'STAGED_ONLY', error: 'Apply or propose the composition first; deployments are prepared from what was decided.' }, 'Apply or propose the composition first; deployments are prepared from what was decided.'],
      [502, { code: 'READ_FAILED', error: 'ethereum-sepolia-rpc.publicnode.com did not answer in time' }, 'ethereum-sepolia-rpc.publicnode.com did not answer in time'],
    ]
    for (const [status, body, said] of answers) {
      fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN, 'POST /api/deploy/read-back': refuse(status, body) }))
      const { unmount } = renderAt(<Deploy />, '/deploy')
      fireEvent.click(await screen.findByRole('button', { name: 'Read back' }))
      await waitFor(() => expect(document.querySelector('.note-error')?.textContent).toBe(said))
      expect(screen.queryByRole('group', { name: 'Read back' })).toBeNull()
      unmount()
      vi.unstubAllGlobals()
    }
  })

  it('a 422 says the engine’s sentences; the lockout’s adds that a wearer who can propose is needed', async () => {
    const lockout = 'rule records: nobody can propose under it. The member role has no member with a git or wallet handle and is not sourced from a hat. Add a handle first (the owner’s claim: §8.1).'
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN,
      'POST /api/deploy/read-back': refuse(422, { errors: [{ record: 'governance:governance', field: '', message: lockout }], readBack: { systems: [] } }) }))
    renderAt(<Deploy />, '/deploy')
    fireEvent.click(await screen.findByRole('button', { name: 'Read back' }))
    await waitFor(() => expect(document.querySelector('.note-error')?.textContent)
      .toBe(`${lockout} Add a wearer who can propose to the composed tree, then read back again.`))
  })

  it('answers what the plan answers instead of steps: nothing composed, only staged, part hidden, a failed read', async () => {
    const answers: [number, string, string][] = [
      [409, 'NOTHING_COMPOSED', 'Nothing is composed. Add a DAO template or compose on the canvas first.'],
      [409, 'STAGED_ONLY', 'Apply or propose the composition first; deployments are prepared from what was decided.'],
      [409, 'PART_HIDDEN', 'Part of this composition is not yours to read: someone who can read all of it prepares it.'],
      [502, 'READ_FAILED', 'ethereum-sepolia-rpc.publicnode.com did not answer in time'],
    ]
    for (const [status, code, error] of answers) {
      fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': refuse(status, { code, error }) }))
      const { unmount } = renderAt(<Deploy />, '/deploy')
      await waitFor(() => expect(document.querySelector('.note')?.textContent).toBe(error))
      expect(rows()).toEqual([])
      expect(screen.queryByRole('button', { name: 'Read back' })).toBeNull()
      expect(document.body.textContent).not.toMatch(/0x[0-9a-f]{4}/i)
      unmount()
      vi.unstubAllGlobals()
    }
  })

  it('a 401 (the public, not signed in) is the house’s unavailable note, not an error (M-6)', async () => {
    const said = 'Sign in to read this.'
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': refuse(401, { code: 'SIGN_IN', error: said }) }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(document.querySelector('.note')).toBeTruthy())
    const note = document.querySelector('.note')!
    expect(note.className).toBe('note note-unavailable')
    expect(note.getAttribute('role')).toBe('note')
    expect(document.querySelector('.note-error')).toBeNull()
    expect(rows()).toEqual([])
    expect(screen.queryByRole('button', { name: 'Read back' })).toBeNull()
  })

  it('previewing as Public, the plan is not asked: no steps, no addresses, no Read back', async () => {
    const { calls } = fetchRoutes(baseRoutes({ ...systems, 'GET /api/deploy': DEPLOY_PLAN }))
    renderAt(<ViewAsProvider initial={{ as: 'public' }} source={houseSource({ tree: [], worn: [], levels: ['public', 'members'], config: { collections: {}, defaults: {} }, writable: [] })}><Deploy /></ViewAsProvider>, '/deploy')
    expect(await screen.findByRole('heading', { level: 1, name: 'Deploy' })).toBeTruthy()
    await new Promise(r => setTimeout(r, 30))
    expect(calls.filter(c => c.path === '/api/deploy')).toEqual([])
    expect(rows()).toEqual([])
    expect(screen.queryByRole('button', { name: 'Read back' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/0x[0-9a-f]{4}/i)
    expect(screen.getByText('Nothing composed is shown.')).toBeTruthy()
  })

  it('an actor who is no member reads the steps without Read back', async () => {
    fetchRoutes(baseRoutes({ ...systems, 'GET /api/actor': { unknown: 'someone@example.invalid' }, 'GET /api/deploy': DEPLOY_PLAN }))
    renderAt(<Deploy />, '/deploy')
    await waitFor(() => expect(rows().length).toBe(8))
    expect(screen.queryByRole('button', { name: 'Read back' })).toBeNull()
  })
})
