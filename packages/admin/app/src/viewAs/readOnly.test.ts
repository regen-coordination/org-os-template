import { describe, it, expect } from 'vitest'
import { READ_ONLY as SERVER } from '../../../server/hosted/instance-writes.ts'
import { READ_ONLY } from './ViewAs.tsx'

// R2 (plan D-6): a page that says the switch's sentence without asking says the server's own words.
describe('the read-only sentence', () => {
  it('is the server\'s READ_ONLY, word for word', () => {
    expect(READ_ONLY).toBe(SERVER)
  })
})
