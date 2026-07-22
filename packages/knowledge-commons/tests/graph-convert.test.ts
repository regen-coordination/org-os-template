import { describe, it, expect } from 'vitest'
import { convertNetworkx } from '../src/graph/convert.ts'
import fs from 'node:fs/promises'
import path from 'node:path'
import { FIXTURE_ROOT } from './fixtures/config.ts'

describe('convertNetworkx', () => {
  it('converts nodes/links with kind+source tags and preserves community', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(FIXTURE_ROOT, 'vault/graph.json'), 'utf8'))
    const g = convertNetworkx(raw, 'alpha')
    expect(g.order).toBe(2)                     // nodes
    expect(g.size).toBe(1)                      // edges
    const attrs = g.getNodeAttributes('alpha:commitment-pooling')
    expect(attrs).toMatchObject({ label: 'Commitment Pooling', community: 1, kind: 'semantic', source: 'alpha' })
    expect(g.getAttribute('builtAtCommit')).toBe('abc1234')
  })
})
