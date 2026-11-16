import { describe, it, expect } from 'vitest'
import { validateEntry } from '../../lib/data-validate.mjs'
import { composedSafe, composedTree, composedSpace } from '../lib/compose.fixtures.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_SCHEMAS } from '../fixtures.ts'

const errs = (e: unknown) => validateEntry('systems', e).filter(p => p.level === 'error')
const paths = (e: unknown) => errs(e).map(p => p.path)

describe('composed Systems in the schema (Q58)', () => {
  it("spec 4.1's three records validate", () => {
    for (const r of [composedSafe(), composedTree(), composedSpace()]) expect(errs(r), String(r.id)).toEqual([])
  })
  it('the same Safe without deployment and without an address is refused', () => {
    const { deployment, ...bare } = composedSafe()
    expect(paths(bare)).toEqual(expect.arrayContaining(['address']))
    expect(errs(bare).some(p => /address/.test(p.message))).toBe(true)
  })
  it('a deployed Safe still needs its address', () => {
    expect(errs({ ...composedSafe(), deployment: { status: 'deployed' } }).some(p => /address/.test(p.message))).toBe(true)
  })
  it('a relation with a label the canvas does not know is refused', () => {
    expect(paths({ ...composedSpace(), relates: [{ to: 'x', label: 'owns' }] }).some(p => /relates.*label/.test(p))).toBe(true)
  })
  it('a hat key that is not lower case is refused', () => {
    const t = composedTree()
    expect(paths({ ...t, hats: [{ ...t.hats[0], key: 'Council' }] }).some(p => /hats.*key/.test(p))).toBe(true)
  })
  it('a bare deployment: key (null) does not exempt a Safe from its address', () => {
    expect(errs({ ...composedSafe(), deployment: null, address: undefined }).some(p => /address/.test(p.message))).toBe(true)
  })
  it('a composed tree may record its top hat (deployment.top.hat, a hat ref); anything else there is refused', () => {
    const t = composedTree()
    const top = (hat: unknown) => ({ ...t, deployment: { ...t.deployment, top: { ...t.deployment.top, hat } } })
    expect(errs(top('eip155:11155111:0x0000012400000000000000000000000000000000000000000000000000000000'))).toEqual([])
    expect(errs(top(null))).toEqual([])
    expect(paths(top('0x00000124')).some(p => /deployment.*top.*hat/.test(p))).toBe(true)
  })
  it('a negative position and a fractional order are refused', () => {
    expect(errs({ ...composedSafe(), position: { x: -1, y: 0 } }).length).toBeGreaterThan(0)
    expect(errs({ ...composedSafe(), order: 1.5 }).length).toBeGreaterThan(0)
  })
  // DAO-OS L7 Task 17: a System's record page draws the fields of its kind (`x-kinds`, read by app/src/record/fields.ts);
  // L7's fields that the compose canvas writes (deployment, role, position, order) belong to no kind: drawn where held.
  it('names the kinds each of L7’s fields belongs to', () => {
    const props = (JSON.parse(readFileSync(join(PACKAGE_SCHEMAS, 'systems.schema.json'), 'utf8')) as { properties: Record<string, { 'x-kinds'?: string[] }> }).properties
    expect(Object.fromEntries(['branch', 'files', 'hats', 'signer_gate', 'deployment', 'role', 'position', 'order'].map(k => [k, props[k]!['x-kinds']]))).toEqual({
      branch: ['repo'], files: ['repo'], hats: ['hats-tree'], signer_gate: ['safe'], deployment: [], role: [], position: [], order: [],
    })
  })
})
