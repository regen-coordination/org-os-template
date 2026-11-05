import { describe, it, expect } from 'vitest'
import { blockType, blockTypes, defineBlock } from './registry.ts'
import type { BlockDef } from './types.ts'

const def = (type: string): BlockDef => ({ type, label: type, config: [], title: () => type, useData: () => ({ state: 'empty' }), Body: () => null })

describe('the block registry', () => {
  it('registers a type once, finds it by name and lists it', () => {
    const d = defineBlock(def('test-a'))
    expect(blockType('test-a')).toBe(d)
    expect(blockTypes()).toContain(d)
    expect(blockType('nope')).toBeUndefined()
  })

  it('refuses a type defined twice', () => {
    defineBlock(def('test-b'))
    expect(() => defineBlock(def('test-b'))).toThrow('block type "test-b" is defined twice')
  })
})
