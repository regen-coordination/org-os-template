// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import Operations from './Operations.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { resource } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'

const mod = resource({ id: 'module:a', kind: 'module', board: 'systems', name: 'org-os-buzz', source: { path: 'modules/a/module.yaml', editable: false } })
const ops = [
  { id: 'module.checks', label: 'Re-run checks', effect: 'reads', network: false, confirm: false, params: { type: 'object' }, preset: null, unavailable: null },
  { id: 'module.doctor', label: 'Run doctor', effect: 'reads', network: true, confirm: true, params: { type: 'object' }, preset: null, unavailable: null },
  { id: 'module.command-check', label: 'Run check: npm test | tee', effect: 'changes', network: true, confirm: true, params: { type: 'object' }, preset: { index: 0 }, unavailable: 'holds a shell character' },
]
const doctorPlan = { op: 'module.doctor', resource: 'module:a', inProcess: false, cmd: 'npm', args: ['run', 'buzz:doctor'], writes: [], timeoutMs: 120000, confirm: true, nonce: 'n' }
const routes = (extra: Record<string, unknown> = {}) => fetchRoutes({
  'GET /api/operations?resource=module%3Aa': ops, 'GET /api/jobs?resource=module%3Aa': [], ...extra,
})

describe('Operations', () => {
  it('runs a plain read on a click, asks first for the rest, and says why one cannot run', async () => {
    const { calls } = routes({
      'POST /api/jobs': { id: 'j1', status: 'running' }, 'GET /api/jobs/j1': { job: { id: 'j1', status: 'running', sentence: null }, log: '' },
      'POST /api/operations/module.doctor/plan': doctorPlan,
    })
    renderAt(<Operations resource={mod} />, '/r/module/a')
    // Operations as buttons, each named by what it does, its effect beside it (§14.1)
    const list = await screen.findByRole('list', { name: 'Operations' })
    expect(within(list).getAllByRole('listitem').map(li => li.querySelector('.ops-k')!.textContent))
      .toEqual(['reads', 'reads · network · asks first', 'changes · network · asks first'])
    const blocked = within(list).getByRole('button', { name: 'Run check: npm test | tee' })
    // held with its reason (§6.2: aria-disabled, the reason beside it), not a bare disabled
    expect(blocked.getAttribute('aria-disabled')).toBe('true')
    expect(within(list).getByText('holds a shell character', { selector: '.ops-why' })).toBeTruthy()
    fireEvent.click(blocked)
    expect(calls.some(c => c.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Re-run checks' }))
    await waitFor(() => expect(calls.find(c => c.method === 'POST' && c.path === '/api/jobs')?.body).toEqual({ op: 'module.checks', resource: 'module:a', params: {} }))
    // the job's log opens under the operations, the running mark on it
    expect(await screen.findByText('Running')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Run doctor' }))
    // a confirm dialog naming what runs
    const dialog = await screen.findByRole('dialog', { name: 'Run doctor' })
    expect(await within(dialog).findByText('npm run buzz:doctor')).toBeTruthy()
  })

  it('opens the operation the address asks for (⌘K, the inspector, the head), then drops it from the address', async () => {
    routes({ 'POST /api/operations/module.doctor/plan': doctorPlan })
    const { loc } = renderAt(<Operations resource={mod} />, '/r/module/a?op=module.doctor&opLabel=Run+doctor')
    expect(await screen.findByRole('dialog', { name: 'Run doctor' })).toBeTruthy()
    expect(loc.history.at(-1)).toBe('/r/module/a')
  })

  it('asks once for the operation the address opened: a cancel stays cancelled when the operations refetch', async () => {
    routes({ 'POST /api/operations/module.doctor/plan': doctorPlan })
    const { qc } = renderAt(<Operations resource={mod} />, '/r/module/a?op=module.doctor&opLabel=Run+doctor')
    await screen.findByRole('dialog', { name: 'Run doctor' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // The refetch must bring changed data, or structural sharing keeps the same array and nothing reruns.
    routes({ 'GET /api/operations?resource=module%3Aa': [...ops, { ...ops[0]!, id: 'module.extra', label: 'Extra' }], 'POST /api/operations/module.doctor/plan': doctorPlan })
    await qc.invalidateQueries({ queryKey: ['operations', 'module:a'] })
    await screen.findByRole('button', { name: 'Extra' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it("lists past runs, and opens one's log", async () => {
    const created = new Date().toISOString()
    routes({
      'GET /api/jobs?resource=module%3Aa': [{ id: 'j0', op: 'module.checks', resource: 'module:a', label: 'Re-run checks', cmd: null, args: [], writes: [], status: 'ok',
        created, started: created, ended: created, exitCode: 0, changed: [], surprises: [], sentence: 'All checks pass.' }],
      'GET /api/jobs/j0': { job: { id: 'j0', label: 'Re-run checks', status: 'ok', sentence: 'All checks pass.' }, log: 'checks: 3 ok\n' },
    })
    const { container } = renderAt(<Operations resource={mod} />, '/r/module/a')
    fireEvent.click(await screen.findByRole('button', { name: 'Re-run checks · ok · just now' }))
    await screen.findByText('All checks pass.')
    expect(container.querySelector('pre.mono-well')!.textContent).toBe('checks: 3 ok\n')
  })

  it('says so when nothing applies', async () => {
    routes({ 'GET /api/operations?resource=module%3Aa': [] })
    renderAt(<Operations resource={mod} />, '/r/module/a')
    expect(await screen.findByText('No operations apply to this module.')).toBeTruthy()
  })

  it('says nothing is empty while loading or after a failed read (C16)', async () => {
    routes({ 'GET /api/operations?resource=module%3Aa': new Promise(() => {}) as never })
    renderAt(<Operations resource={mod} />, '/r/module/a')
    expect(await screen.findByText('Loading…')).toBeTruthy()
    expect(screen.queryByText('No operations apply to this module.')).toBeNull()
  })

  it('shows the error alone when the operations cannot be read (C16)', async () => {
    fetchRoutes({ 'GET /api/jobs?resource=module%3Aa': [] })
    renderAt(<Operations resource={mod} />, '/r/module/a')
    await waitFor(() => expect(document.querySelector('.note-error')).toBeTruthy())
    expect(screen.queryByText('No operations apply to this module.')).toBeNull()
  })

  it('previewing, offers no operation and opens no dialog from the address (C8 fix I-1, C-23)', async () => {
    routes({ 'POST /api/operations/module.doctor/plan': doctorPlan })
    const { loc } = renderAt(<ViewAsProvider initial={{ as: 'members' }}><Operations resource={mod} /></ViewAsProvider>, '/r/module/a?op=module.doctor&opLabel=Run+doctor')
    // the operations and runs are read; nothing they bring may open a dialog while previewing
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(document.querySelector('.ops')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run doctor' })).toBeNull()
    expect(loc.history.at(-1)).toBe('/r/module/a?op=module.doctor&opLabel=Run+doctor')
  })
})
