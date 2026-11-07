import { describe, it, expect, vi } from 'vitest'
import { handleEvent } from './events.ts'
import { onJobOutput } from './jobLogs.ts'

const client = () => {
  const keys: unknown[][] = []
  return { keys, qc: { invalidateQueries: async ({ queryKey }: { queryKey: unknown[] }) => { keys.push(queryKey) } } }
}

describe('handleEvent', () => {
  it('a registry change refreshes that registry, the list, the status and the staged change', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'registry-changed', registry: 'projects' }, qc)
    expect(keys).toEqual([['registry', 'projects'], ['registries'], ['status'], ['changes']])
  })

  it('a narrowing (a change to data/visibility.yaml, or to the store alone) re-reads the levels and every record (Task 16)', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'registry-changed', registry: 'visibility' }, qc)
    expect(keys).toContainEqual(['visibility'])
    expect(keys).toContainEqual(['registry'])
  })

  it('a change to governance.yaml also refreshes the Governance page', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'registry-changed', registry: 'governance' }, qc)
    expect(keys).toContainEqual(['governance'])
  })

  it('re-reads the boards when data/boards.yaml changes', () => {
    const qc = { invalidateQueries: vi.fn() }
    handleEvent({ type: 'registry-changed', registry: 'boards' }, qc)
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['boards'] })
  })

  it('re-reads the proposals when the ledger changes', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'registry-changed', registry: 'proposals' }, qc)
    expect(keys).toContainEqual(['proposals'])
  })

  it('a change to DECISIONS.md refreshes the Governance page and every opened decision text', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'decisions-changed' }, qc)
    expect(keys).toEqual([['governance'], ['decision']])
  })

  it('a change write refreshes the staged change in every tab (Review Focus 2)', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'changes' }, qc)
    expect(keys).toEqual([['changes']])
  })

  it('a resources change refreshes the boards and every open panel', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'resources-changed', ids: ['module:a'] }, qc)
    expect(keys).toEqual([['graph'], ['resource'], ['operations'], ['resources'], ['allOperations']])
  })

  it('a finished job refreshes jobs, that job, the boards and its resource', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'job-finished', job: { id: 'j1', resource: 'module:a' } }, qc)
    expect(keys).toEqual([['jobs'], ['job', 'j1'], ['graph'], ['resource', 'module:a']])
  })

  it('job output goes to whoever listens for that job, and stops when they leave', () => {
    const got: string[] = []
    const stop = onJobOutput('j1', c => got.push(c))
    handleEvent({ type: 'job-output', job: 'j1', resource: 'module:a', chunk: 'one' }, client().qc)
    handleEvent({ type: 'job-output', job: 'j2', resource: 'module:a', chunk: 'other' }, client().qc)
    stop()
    handleEvent({ type: 'job-output', job: 'j1', resource: 'module:a', chunk: 'two' }, client().qc)
    expect(got).toEqual(['one'])
  })
})
