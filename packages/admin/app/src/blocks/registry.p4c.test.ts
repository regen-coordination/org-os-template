import { describe, it, expect } from 'vitest'
import { blockTypes } from './index.ts'
import { BLOCK_TYPES } from '../../../lib/board-query.mjs'

describe('the block registry', () => {
  it('holds the blocks, exactly the ones validate:data knows (P4 spec §4.3)', () => {
    expect(blockTypes().map(b => b.type).filter(t => !t.startsWith('test-')).sort()).toEqual([...BLOCK_TYPES].sort())
  })
})
