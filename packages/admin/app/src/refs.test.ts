import { describe, it, expect } from 'vitest'
import { REFS as SERVER_REFS } from '../../lib/data-validate.mjs'
import { REFS, refOf } from './refs.ts'

describe('refs', () => {
  it("mirrors the server's reference table exactly", () => {
    expect(REFS).toEqual(SERVER_REFS)
  })

  it("finds a field's target registry", () => {
    expect(refOf('projects', 'lead')?.target).toBe('members')
    expect(refOf('projects', 'contributors')?.array).toBe(true)
    expect(refOf('projects', 'title')).toBeUndefined()
  })
})
