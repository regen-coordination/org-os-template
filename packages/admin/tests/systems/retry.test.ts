import { describe, it, expect, vi, afterEach } from 'vitest'
import { failedReadRetry } from '../../server/systems/retry.ts'

afterEach(() => vi.useRealTimers())

describe('the retry after a failed read', () => {
  it('a refresh that left a read failed triggers exactly one retry, 60 s later', async () => {
    vi.useFakeTimers()
    const retry = vi.fn()
    const r = failedReadRetry({ delayMs: 60_000, hasFailed: () => true, retry })
    r.afterRefresh(); r.afterRefresh() // two refreshes in a row do not pile up
    await vi.advanceTimersByTimeAsync(59_000)
    expect(retry).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(retry).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(retry).toHaveBeenCalledTimes(1) // another retry needs another refresh that finds a failure
  })

  it('a refresh with every read good schedules nothing', async () => {
    vi.useFakeTimers()
    const retry = vi.fn()
    failedReadRetry({ delayMs: 60_000, hasFailed: () => false, retry }).afterRefresh()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(retry).not.toHaveBeenCalled()
  })

  it('stop() cancels the pending retry and later refreshes schedule none', async () => {
    vi.useFakeTimers()
    const retry = vi.fn()
    const r = failedReadRetry({ delayMs: 60_000, hasFailed: () => true, retry })
    r.afterRefresh(); r.stop(); r.afterRefresh()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(retry).not.toHaveBeenCalled()
  })
})
