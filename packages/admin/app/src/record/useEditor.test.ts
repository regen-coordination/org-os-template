// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ApiError, type StageOp } from '../api.ts'
import { diffSet, useEditor } from './useEditor.ts'
import type { Value } from './fields.ts'

describe('diffSet', () => {
  it('stages only what changed; a field the entry held and you cleared is staged as null', () => {
    expect(diffSet({ id: 'p1', title: 'T', status: 'idea' }, { id: 'p1', title: 'T', status: 'develop' })).toEqual({ status: 'develop' })
    expect(diffSet({ id: 'p1', title: 'T' }, { id: 'p1', title: null })).toEqual({ title: null })
    expect(diffSet({ id: 'p1', title: 'T' }, { id: 'p1' })).toEqual({ title: null })
    expect(diffSet({ id: 'p1', tags: ['a'] }, { id: 'p1', tags: [] })).toEqual({ tags: [] })
  })

  it('stages nothing for a field the entry did not hold that is empty again (I1)', () => {
    expect(diffSet({ id: 'p1', title: 'T' }, { id: 'p1', title: 'T', summary: null })).toEqual({})
    expect(diffSet({ id: 'p1' }, { id: 'p1', summary: '' })).toEqual({})
    expect(diffSet({ id: 'p1' }, { id: 'p1', contributors: [] })).toEqual({})
    expect(diffSet({ id: 'p1' }, { id: 'p1', summary: 'S' })).toEqual({ summary: 'S' })
  })
})

describe('useEditor', () => {
  it('Take theirs drops the refusals said about the draft it replaces (final 12)', async () => {
    const refuse = async (_ops: StageOp[]) => { throw new ApiError(422, [{ record: 'projects:p1', field: 'lead', message: 'no member with id "zed" in members' }], 'invalid') }
    const mine: Value = { id: 'p1', title: 'T', lead: 'zed' }
    const { result, rerender } = renderHook((p: { latest: Value }) => useEditor({ registry: 'projects', entityId: 'p1', latest: p.latest, creating: false, stage: refuse }),
      { initialProps: { latest: mine } })
    act(() => result.current.start())
    act(() => result.current.set('title', 'T2'))
    await act(async () => { await result.current.save() })
    expect(result.current.errors.map(e => e.field)).toEqual(['lead'])
    rerender({ latest: { id: 'p1', title: 'Theirs', lead: 'ana' } })
    expect(result.current.stale).toBe(true)
    act(() => result.current.takeTheirs())
    expect(result.current.errors).toEqual([])
    expect(result.current.canSave).toBe(true)
  })

  it('cancel while saving closes at once, and the late answer changes nothing (Review Focus 4)', async () => {
    let finish!: () => void
    const slow = (_ops: StageOp[]) => new Promise<void>(r => { finish = r })
    const { result } = renderHook(() => useEditor({ registry: 'projects', entityId: 'p1', latest: { id: 'p1', title: 'T' }, creating: false, stage: slow }))
    act(() => result.current.start())
    act(() => result.current.set('title', 'T2'))
    let saving!: Promise<string | null>
    act(() => { saving = result.current.save() })
    expect(result.current.busy).toBe(true)
    act(() => result.current.cancel())
    expect(result.current.editing).toBe(false)
    expect(result.current.busy).toBe(false)
    await act(async () => { finish(); await saving })
    expect(result.current.editing).toBe(false)
  })

  it('stale stays true while a save is in flight, as before machines (ruling 4)', async () => {
    let finish!: () => void
    const slow = (_ops: StageOp[]) => new Promise<void>(r => { finish = r })
    const { result, rerender } = renderHook((p: { latest: Value }) => useEditor({ registry: 'projects', entityId: 'p1', latest: p.latest, creating: false, stage: slow }),
      { initialProps: { latest: { id: 'p1', title: 'T' } as Value } })
    act(() => result.current.start())
    act(() => result.current.set('title', 'T2'))
    let saving!: Promise<string | null>
    act(() => { saving = result.current.save() })
    rerender({ latest: { id: 'p1', title: 'Theirs' } })
    expect(result.current.busy).toBe(true)
    expect(result.current.stale).toBe(true)
    expect(result.current.canSave).toBe(false)
    await act(async () => { finish(); await saving })
  })

  it('two save() calls in one tick stage once', async () => {
    const calls: StageOp[][] = []
    const stage = async (ops: StageOp[]) => { calls.push(ops) }
    const { result } = renderHook(() => useEditor({ registry: 'projects', entityId: 'p1', latest: { id: 'p1', title: 'T' }, creating: false, stage }))
    act(() => result.current.start())
    act(() => result.current.set('title', 'T2'))
    await act(async () => { await Promise.all([result.current.save(), result.current.save()]) })
    expect(calls).toHaveLength(1)
  })
})
