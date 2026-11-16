import { describe, it, expect, vi } from 'vitest'
import { handleEvent } from './events.ts'
import { onJobOutput } from './jobLogs.ts'

const client = () => {
  const keys: unknown[][] = []
  return { keys, qc: { invalidateQueries: async ({ queryKey }: { queryKey: unknown[] }) => { keys.push(queryKey) } } }
}

describe('handleEvent', () => {
  it('DAO-OS L6 §8.5: pages, presence and conversation make their queries stale', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'pages-changed' }, qc)
    handleEvent({ type: 'presence', target: 'page:guide-0001', people: [] }, qc)
    handleEvent({ type: 'conversation', target: 'page:guide-0001' }, qc)
    expect(keys).toEqual([['pages'], ['page'], ['file'], ['presence', 'page:guide-0001'], ['comments', 'page:guide-0001'], ['notifications'], ['mentionables', 'page:guide-0001']])
  })

  it('a change to a registry, a page or DECISIONS.md makes every file read by the source editor stale (T19 review I3)', () => {
    for (const msg of [{ type: 'registry-changed', registry: 'governance' }, { type: 'pages-changed' }, { type: 'decisions-changed' }] as const) {
      const { keys, qc } = client()
      handleEvent(msg, qc)
      expect(keys).toContainEqual(['file'])
    }
  })

  it('a registry change refreshes that registry, the list, the status and the staged change', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'registry-changed', registry: 'projects' }, qc)
    expect(keys).toEqual([['registry', 'projects'], ['registries'], ['status'], ['changes'], ['file']])
  })

  it('a narrowing (a change to data/visibility.yaml, or to the store alone) re-reads the levels and every record (Task 16)', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'registry-changed', registry: 'visibility' }, qc)
    expect(keys).toContainEqual(['visibility'])
    expect(keys).toContainEqual(['registry'])
  })

  it('a change to data/collections.yaml re-reads the definitions and saved views (DAO-OS L6 Task 17)', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'registry-changed', registry: 'collections' }, qc)
    expect(keys).toContainEqual(['collections'])
  })

  it('a change to data/systems.yaml re-reads the deployment plan (DAO-OS L7 Task 11)', () => {
    const { keys, qc } = client()
    handleEvent({ type: 'registry-changed', registry: 'systems' }, qc)
    expect(keys).toContainEqual(['deploy'])
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
    expect(keys).toEqual([['governance'], ['decision'], ['file']])
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
