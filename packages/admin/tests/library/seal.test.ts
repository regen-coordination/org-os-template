import { describe, it, expect } from 'vitest'
import { sealReceipts, type Seal } from '../../server/library/seal.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import type { StageOp } from '../../server/changes/types.ts'

// The seal (DAO-OS L1, ruling L1-R1): what only the decision knows (who, the day, the rule or the proposal, and the
// hash of each record as it is created) is written into the receipt where the change is applied or proposed. Pure:
// ops built by hand, nothing read or written.
const BOARD_VALUE = { id: 'desk', name: 'Desk', layout: 'flow', blocks: [] }
const BOARD: StageOp = { op: 'create', record: 'boards:desk', value: BOARD_VALUE }
const PROJECT: StageOp = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }
const RECEIPT: StageOp = {
  op: 'create', record: 'library:board-desk',
  value: {
    id: 'board-desk', entry: 'board:desk', version: '1.0.0', shelf: 'framework',
    created: [{ record: 'boards:desk', base: null }],
    status: 'installed', by: null, at: null, decision: null, removed: null,
  },
}
const REMOVAL: StageOp = { op: 'update', record: 'library:board-desk', set: { status: 'removed', removed: { by: null, at: null, decision: null } } }
const DIRECT: Seal = { by: 'bruno', at: '2026-10-29', decision: { rule: 'records/direct', change: 'chg_x' } }

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
/** The first created base of a sealed receipt create. */
const baseIn = (op: StageOp | undefined): unknown => ((op as unknown as { value: { created: { base: unknown }[] } }).value.created[0]!.base)

describe('sealReceipts', () => {
  it("fills a receipt create's by, at, decision and each created base, and nothing else", () => {
    const ops = [BOARD, PROJECT, RECEIPT]
    const sealed = sealReceipts(ops, DIRECT)
    expect(sealed[2]).toEqual({
      op: 'create', record: 'library:board-desk',
      value: {
        id: 'board-desk', entry: 'board:desk', version: '1.0.0', shelf: 'framework',
        created: [{ record: 'boards:desk', base: baseOf(BOARD_VALUE) }],
        status: 'installed', by: 'bruno', at: '2026-10-29', decision: { rule: 'records/direct', change: 'chg_x' }, removed: null,
      },
    })
    expect(baseIn(sealed[2])).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashes the create op as it stands in the ops, so a board edited in the tray is hashed edited', () => {
    const renamed = { ...BOARD_VALUE, name: 'Front desk' }
    const sealed = sealReceipts<StageOp>([{ op: 'create', record: 'boards:desk', value: renamed }, RECEIPT], DIRECT)
    const base = baseIn(sealed[1])
    expect(base).toBe(baseOf(renamed))
    expect(base).not.toBe(baseOf(BOARD_VALUE))
  })

  it('leaves every op that is not a receipt equal to the input, and never changes the input', () => {
    const ops = [BOARD, PROJECT, RECEIPT, REMOVAL]
    const was = copy(ops)
    const sealed = sealReceipts(ops, DIRECT)
    expect(sealed[0]).toEqual(BOARD)
    expect(sealed[1]).toEqual(PROJECT)
    expect(ops).toEqual(was)
    expect(sealed[2]).not.toBe(ops[2])
    expect(sealed[3]).not.toBe(ops[3])
  })

  it("fills a removal's set.removed with by, at and decision", () => {
    const sealed = sealReceipts([{ op: 'delete', record: 'boards:desk' }, REMOVAL], DIRECT)
    expect(sealed[1]).toEqual({
      op: 'update', record: 'library:board-desk',
      set: { status: 'removed', removed: { by: 'bruno', at: '2026-10-29', decision: { rule: 'records/direct', change: 'chg_x' } } },
    })
  })

  it('leaves a receipt update that does not remove, and a receipt delete, as they are (the engine refuses both)', () => {
    const other: StageOp = { op: 'update', record: 'library:board-desk', set: { status: 'installed' } }
    const del: StageOp = { op: 'delete', record: 'library:board-desk' }
    const sealed = sealReceipts([other, del], DIRECT)
    expect(sealed).toEqual([other, del])
  })

  it('sealed again with another decision keeps only the second', () => {
    const proposed: Seal = { by: 'ana', at: '2026-10-30', decision: { proposal: 'p-2026-10-30-001-ab12' } }
    const twice = sealReceipts(sealReceipts([BOARD, RECEIPT, REMOVAL], DIRECT), proposed)
    expect((twice[1] as { value: Record<string, unknown> }).value).toMatchObject({ by: 'ana', at: '2026-10-30', decision: { proposal: 'p-2026-10-30-001-ab12' } })
    expect((twice[1] as { value: Record<string, unknown> }).value.decision).toEqual({ proposal: 'p-2026-10-30-001-ab12' })
    expect((twice[2] as { set: Record<string, unknown> }).set.removed).toEqual({ by: 'ana', at: '2026-10-30', decision: { proposal: 'p-2026-10-30-001-ab12' } })
  })

  it('keeps the base and before an engine op carries', () => {
    const op = { ...RECEIPT, base: null, before: null }
    const [sealed] = sealReceipts([{ ...BOARD, base: null, before: null }, op], DIRECT).slice(1)
    expect(sealed).toMatchObject({ base: null, before: null, record: 'library:board-desk' })
  })
})
