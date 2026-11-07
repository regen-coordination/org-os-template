import { describe, it, expect } from 'vitest'
import { testTimeoutMs } from './time-limit.ts'
import config from '../vitest.config.ts'

describe('the suite\'s time limit', () => {
  it('is 30 s when nothing is set', () => {
    expect(testTimeoutMs({})).toBe(30_000)
    expect(testTimeoutMs({ ADMIN_TEST_TIMEOUT_MS: '' })).toBe(30_000)
  })
  it('is what ADMIN_TEST_TIMEOUT_MS says, for a crowded machine', () => {
    expect(testTimeoutMs({ ADMIN_TEST_TIMEOUT_MS: '120000' })).toBe(120_000)
  })
  it('refuses a value that is not a time, in words', () => {
    for (const bad of ['2m', '0', '-5', '12.5', '30']) {
      expect(() => testTimeoutMs({ ADMIN_TEST_TIMEOUT_MS: bad })).toThrow(/ADMIN_TEST_TIMEOUT_MS is ".*whole number of milliseconds/)
    }
  })
  it('is the limit vitest runs with', () => {
    expect((config as { test: { testTimeout: number } }).test.testTimeout).toBe(testTimeoutMs())
  })
})
