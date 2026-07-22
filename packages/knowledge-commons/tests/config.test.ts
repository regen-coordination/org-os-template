import { describe, it, expect } from 'vitest'
import { defineKmsConfig } from '../src/config.ts'

const minimal = {
  identity: { name: 'test/commons' },
  sources: [{ id: 'a', label: 'A', dir: '.', content: ['docs/**'] }],
}

describe('defineKmsConfig', () => {
  it('accepts a minimal config and applies defaults', () => {
    const c = defineKmsConfig(minimal)
    expect(c.identity.accent).toBe('#D6281E')
    expect(c.identity.emoji).toBe('◉')
    expect(c.features.graph).toBe(true)
    expect(c.sources[0].exclude).toEqual([])
  })
  it('rejects duplicate source ids', () => {
    expect(() => defineKmsConfig({ ...minimal, sources: [minimal.sources[0], minimal.sources[0]] }))
      .toThrow(/duplicate source id/i)
  })
  it('rejects source ids that are not url-safe slugs', () => {
    expect(() => defineKmsConfig({ ...minimal, sources: [{ id: 'Bad Id!', label: 'x', dir: '.', content: ['**'] }] }))
      .toThrow()
  })
})
