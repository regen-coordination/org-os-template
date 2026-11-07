// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import JobLog, { merge } from './JobLog.tsx'
import { emitJobOutput } from '../jobLogs.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'

const job = (status: string, sentence: string | null = null) => ({ job: { id: 'j1', label: 'Ingest', status, sentence }, log: 'first\n' })

afterEach(() => { vi.unstubAllGlobals() })

describe('JobLog', () => {
  it('shows the log so far, then what streams in', async () => {
    fetchRoutes({ 'GET /api/jobs/j1': job('running') })
    const { container } = render(<QueryClientProvider client={new QueryClient()}><JobLog jobId="j1" /></QueryClientProvider>)
    await screen.findByText('Running')
    act(() => emitJobOutput('j1', 'second\n'))
    expect(container.querySelector('pre')!.textContent).toBe('first\nsecond\n')
  })

  it('draws the log in a Mono well under the running mark, the job named beside it', async () => {
    fetchRoutes({ 'GET /api/jobs/j1': job('running') })
    const { container } = render(<QueryClientProvider client={new QueryClient()}><JobLog jobId="j1" /></QueryClientProvider>)
    const log = await screen.findByRole('group', { name: 'Ingest log' })
    const mark = log.querySelector('.smark-running')!
    expect(mark.querySelector('.smark-shape.spin')!.getAttribute('aria-hidden')).toBe('true')
    expect(mark.textContent).toBe('Running')
    expect(container.querySelector('pre.mono-well.joblog-out')!.textContent).toBe('first\n')
  })

  it('marks how a job ended: done, or failed in its own words', async () => {
    fetchRoutes({ 'GET /api/jobs/j1': job('ok', 'All checks pass.') })
    const ok = render(<QueryClientProvider client={new QueryClient()}><JobLog jobId="j1" /></QueryClientProvider>)
    expect((await screen.findByText('Done')).closest('.smark-done')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    ok.unmount()
    fetchRoutes({ 'GET /api/jobs/j1': job('timed-out', 'Stopped after 120 s.') })
    render(<QueryClientProvider client={new QueryClient()}><JobLog jobId="j1" /></QueryClientProvider>)
    expect((await screen.findByText('Timed out')).closest('.smark-failed')).not.toBeNull()
    expect(screen.getByText('Stopped after 120 s.').closest('.note-error')).not.toBeNull()
  })

  it('shows the sentence once the job ended', async () => {
    fetchRoutes({ 'GET /api/jobs/j1': job('finished-with-surprises', 'Finished, and changed files it does not declare: stray.md.') })
    render(<QueryClientProvider client={new QueryClient()}><JobLog jobId="j1" /></QueryClientProvider>)
    expect(await screen.findByText('Finished, and changed files it does not declare: stray.md.')).toBeTruthy()
  })

  it('shows a line once when it arrives before the log snapshot does', async () => {
    let answer!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { answer = r })))
    const { container } = render(<QueryClientProvider client={new QueryClient()}><JobLog jobId="j1" /></QueryClientProvider>)
    act(() => emitJobOutput('j1', 'a\n'))
    await act(async () => answer(new Response(JSON.stringify({ job: { id: 'j1', label: 'Ingest', status: 'running', sentence: null }, log: 'a\n' }))))
    await screen.findByText('Running')
    expect(container.querySelector('pre')!.textContent).toBe('a\n')
  })

  it('says why a cancel was refused', async () => {
    fetchRoutes({
      'GET /api/jobs/j1': job('running'),
      'DELETE /api/jobs/j1': new Response(JSON.stringify({ error: 'Job "j1" is not running or waiting.' }), { status: 409 }),
    })
    render(<QueryClientProvider client={new QueryClient()}><JobLog jobId="j1" /></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Job "j1" is not running or waiting.')).toBeTruthy()
  })

  it('keeps a line streamed after the server built the snapshot', async () => {
    let answer!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { answer = r })))
    const { container } = render(<QueryClientProvider client={new QueryClient()}><JobLog jobId="j1" /></QueryClientProvider>)
    act(() => emitJobOutput('j1', 'second\n'))
    await act(async () => answer(new Response(JSON.stringify({ job: { id: 'j1', label: 'Ingest', status: 'running', sentence: null }, log: 'first\n' }))))
    await screen.findByText('Running')
    expect(container.querySelector('pre')!.textContent).toBe('first\nsecond\n')
  })
})

describe('merge', () => {
  it('drops the streamed lines the snapshot already holds', () => {
    expect(merge('x\na\n', 'a\n')).toBe('x\na\n')
  })

  it('appends streamed lines the snapshot does not hold', () => {
    expect(merge('x\n', 'a\n')).toBe('x\na\n')
  })

  it('appends only the part of the stream past the overlap', () => {
    expect(merge('x\na\n', 'a\nb\n')).toBe('x\na\nb\n')
  })

  it('shows the stream when the snapshot is empty', () => {
    expect(merge('', 'a\n')).toBe('a\n')
  })
})
