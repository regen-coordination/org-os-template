// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import ConfirmBox, { quoteArg, commandLine } from './ConfirmBox.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import type { OperationInfo, Resource } from '../api.ts'

const role: Resource = { id: 'role:platform', kind: 'role', board: 'systems', name: 'platform', status: 'free', attention: null, changed: null, facts: {}, source: null }
const seatOp: OperationInfo = { id: 'role.seat', label: 'Seat platform', effect: 'changes', network: false, confirm: true, preset: null, unavailable: null,
  params: { type: 'object', required: ['brief', 'title'], properties: { brief: { type: 'string', maxLength: 4000 }, title: { type: 'string', maxLength: 24 } } } }
const doctorOp: OperationInfo = { id: 'module.doctor', label: 'Run doctor', effect: 'reads', network: true, confirm: true, preset: null, unavailable: null,
  params: { type: 'object' } }
const plan = (over = {}) => ({ op: 'role.seat', resource: 'role:platform', inProcess: false, cmd: '/usr/bin/node',
  args: ['/r/scripts/crew.mjs', 'seat', 'platform', '--title', 'site', '--', "it's; rm -rf ~"], writes: ['memory/crew/'], timeoutMs: 120000, confirm: true, nonce: 'n1', ...over })

describe('quoting', () => {
  it('quotes only what a shell would split, so the line reads like what runs', () => {
    expect(quoteArg('platform')).toBe('platform')
    expect(quoteArg('--title')).toBe('--title')
    expect(quoteArg("it's; rm -rf ~")).toBe(`'it'\\''s; rm -rf ~'`)
    expect(commandLine(plan())).toBe(`/usr/bin/node /r/scripts/crew.mjs seat platform --title site -- 'it'\\''s; rm -rf ~'`)
  })
})

describe('ConfirmBox', () => {
  it('chooses an enum from a select, keeps an emptied select as "", and drops an emptied text field', async () => {
    const op: OperationInfo = { ...seatOp, params: { type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'] }, note: { type: 'string' } } } }
    const { calls } = fetchRoutes({ 'POST /api/operations/role.seat/plan': plan() })
    render(<ConfirmBox op={op} resource={role} onDone={() => {}} onCancel={() => {}} />)
    const mode = screen.getByLabelText('mode') as HTMLSelectElement
    expect([...mode.options].map(o => o.value)).toEqual(['', 'a', 'b'])
    fireEvent.change(mode, { target: { value: 'b' } })
    fireEvent.change(mode, { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('note'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show the command' }))
    await waitFor(() => expect(calls[0]!.body).toEqual({ resource: 'role:platform', params: { mode: '' } }))
  })

  it('Cancel and Escape cancel', () => {
    fetchRoutes({})
    const onCancel = vi.fn()
    render(<ConfirmBox op={seatOp} resource={role} onDone={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('asks for the params, shows the exact command, and runs it with the nonce', async () => {
    const { calls } = fetchRoutes({ 'POST /api/operations/role.seat/plan': plan(), 'POST /api/jobs': { id: 'j1', status: 'running' } })
    const onDone = vi.fn()
    render(<ConfirmBox op={seatOp} resource={role} onDone={onDone} onCancel={() => {}} />)
    // a confirm dialog named for what runs (E-66), its parameters field rows of the house's inputs
    const dialog = screen.getByRole('dialog', { name: 'Seat platform' })
    expect(dialog.tagName).toBe('DIALOG')
    const params = within(dialog).getByRole('group', { name: 'Parameters' })
    expect(params.querySelector('dl.fields')).not.toBeNull()
    const brief = screen.getByLabelText('brief')
    expect(brief.tagName).toBe('TEXTAREA')
    expect(brief.className).toContain('input')
    expect(brief.getAttribute('aria-required')).toBe('true')
    fireEvent.change(brief, { target: { value: "it's; rm -rf ~" } })
    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'site' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show the command' }))
    const line = await screen.findByText(commandLine(plan()))
    expect(line.className).toBe('mono-well')
    expect(screen.getByText('may write memory/crew/ · timeout 120 s')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Run' }).className).toContain('primary')
    expect(calls[0]!.body).toEqual({ resource: 'role:platform', params: { brief: "it's; rm -rf ~", title: 'site' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: 'j1', status: 'running' }))
    expect(calls[1]!.body).toEqual({ nonce: 'n1' })
  })

  it('plans at once when there is nothing to fill in', async () => {
    fetchRoutes({ 'POST /api/operations/module.doctor/plan': plan({ op: 'module.doctor', cmd: 'npm', args: ['run', 'buzz:doctor'], writes: [], timeoutMs: 120000 }) })
    render(<ConfirmBox op={doctorOp} resource={role} onDone={() => {}} onCancel={() => {}} />)
    await screen.findByText('npm run buzz:doctor')
    expect(screen.getByText('writes nothing · timeout 120 s')).toBeTruthy()
  })

  it('shows field errors and refusals in words', async () => {
    fetchRoutes({ 'POST /api/operations/role.seat/plan': new Response(JSON.stringify({ errors: [{ field: 'title', message: 'must NOT have more than 24 characters' }] }), { status: 422 }) })
    render(<ConfirmBox op={seatOp} resource={role} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show the command' }))
    const error = await screen.findByText('must NOT have more than 24 characters')
    expect(error.closest('dd')!.previousElementSibling!.textContent).toBe('title')
    expect(screen.getByLabelText('title').getAttribute('aria-invalid')).toBe('true')
  })

  it('plans again after a refused run, for an operation with nothing to fill in', async () => {
    let planned = 0
    const { calls } = fetchRoutes({
      'POST /api/operations/module.doctor/plan': () => { planned += 1; return plan({ op: 'module.doctor', cmd: 'npm', args: ['run', 'buzz:doctor'], writes: [], timeoutMs: 120000, nonce: `n${planned}` }) },
      'POST /api/jobs': new Response(JSON.stringify({ error: 'This confirmation was already used or has expired. Plan the operation again.' }), { status: 409 }),
    })
    render(<ConfirmBox op={doctorOp} resource={role} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }))
    const refused = await screen.findByText('This confirmation was already used or has expired. Plan the operation again.')
    expect(refused.closest('.note-error')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show the command again' }))
    await screen.findByText('npm run buzz:doctor')
    expect(calls.filter(c => c.path === '/api/operations/module.doctor/plan')).toHaveLength(2)
  })

  it('reads busy while the plan or the run is out, and swallows a press then (C8 fix M-6)', async () => {
    let planned!: () => void, ran!: () => void
    const { calls } = fetchRoutes({
      'POST /api/operations/module.doctor/plan': () => new Promise(r => { planned = () => r(plan({ op: 'module.doctor', cmd: 'npm', args: ['run', 'buzz:doctor'], writes: [] })) }),
      'POST /api/jobs': () => new Promise(r => { ran = () => r({ id: 'j1', status: 'running' }) }),
    })
    const onDone = vi.fn()
    render(<ConfirmBox op={doctorOp} resource={role} onDone={onDone} onCancel={() => {}} />)
    const showing = await screen.findByRole('button', { name: 'Showing the command…' })
    expect(showing.getAttribute('aria-busy')).toBe('true')
    await act(async () => { planned() })
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }))
    const running = await screen.findByRole('button', { name: 'Running…' })
    expect(running.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(running)
    expect(calls.filter(c => c.path === '/api/jobs')).toHaveLength(1)
    await act(async () => { ran() })
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })
})
