// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { BlockView, blockTypes } from './index.ts'
import type { BlockState } from './types.ts'
import { blockFixtures, fixtureCtx, partsClient } from '../test/fixtures/parts.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { flowEnv } from '../test/flowEnv.ts'
import { recordId } from '../../../server/changes/records.ts'

const STATES: BlockState[] = ['loading', 'ready', 'empty', 'error', 'notYet', 'unavailable']
/** The engine's own addressing rule (server/changes/records.ts over lib/registries.mjs): a record is
 *  `<registry>:<id>`, the registry a collection the engine knows, the id not empty. A resource id
 *  (`project:br`) names a kind, not a registry, and is refused. */
const addressable = (record: string): boolean => { try { recordId(record); return true } catch { return false } }
const isStageOp = (o: unknown): boolean => {
  const x = o as Record<string, unknown>
  if (typeof x?.record !== 'string' || !addressable(x.record)) return false
  if (x.op === 'delete') return true
  if (x.op === 'update') return typeof x.set === 'object' && x.set !== null
  return (x.op === 'create' || x.op === 'replace') && typeof x.value === 'object' && x.value !== null
}

describe("the contract's op check (spec §7: ops the change engine accepts)", () => {
  it('takes a registry record and refuses a resource id, a document registry and a missing id', () => {
    expect(isStageOp({ op: 'delete', record: 'projects:br' })).toBe(true)
    expect(isStageOp({ op: 'delete', record: 'project:br' })).toBe(false)
    expect(isStageOp({ op: 'update', record: 'finances:x', set: {} })).toBe(false)
    expect(isStageOp({ op: 'delete', record: 'projects:' })).toBe(false)
  })
})

describe('every registered block type (spec §7)', () => {
  for (const def of blockTypes().filter(d => !d.type.startsWith('test-'))) {
    it(`${def.type}: renders all six states from fixtures, as a named region`, () => {
      flowEnv()
      fetchRoutes({})
      const f = blockFixtures[def.type]
      expect(f).toBeTruthy()
      for (const state of STATES) {
        const { unmount } = renderAt(<QueryClientProvider client={partsClient()}>
          <BlockView def={def} cfg={f!.cfg} id={`${def.type}-${state}`} data={f!.states[state]} ctx={fixtureCtx} />
        </QueryClientProvider>)
        // Found by its block id: a ready map block holds a second region (the canvas) of the same name.
        const region = document.querySelector(`[data-block="${def.type}-${state}"]`) as HTMLElement
        expect(region.getAttribute('role')).toBe('region')
        expect(document.getElementById(region.getAttribute('aria-labelledby')!)!.textContent!.startsWith(def.title(f!.cfg))).toBe(true)
        expect(region.dataset.state).toBe(state)
        unmount()
      }
    })

    it(`${def.type}: every action stages well-formed ops`, () => {
      for (const [name, fn] of Object.entries(def.actions ?? {})) {
        const args = blockFixtures[def.type]!.actionArgs?.[name] ?? []
        const ops = (fn as (...a: unknown[]) => unknown[])(...args)
        expect(Array.isArray(ops) && ops.length > 0 && ops.every(isStageOp)).toBe(true)
      }
    })
  }
})
