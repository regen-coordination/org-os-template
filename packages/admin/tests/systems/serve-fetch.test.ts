import { describe, it, expect } from 'vitest'
import { networkFetch } from '../../server/serve.ts'

describe('the server\'s default fetch', () => {
  it('refuses to reach the network under a test run (S13)', async () => {
    const init = { method: 'GET' as const, headers: {}, redirect: 'error' as const, signal: new AbortController().signal }
    await expect(networkFetch('https://example.org/', init)).rejects.toThrow(/no network in tests/)
  })
})
