// @vitest-environment jsdom
// A node's move mode (C6 fix I-1, WCAG 2.1.1 and 2.5.7): on a map that keeps its layout, `m` (or the inspector's Move)
// picks the focused node up, the arrows or the nudge buttons carry it a step at a time, Enter or Done keeps it through
// onMove, Escape or Cancel puts it back; each is said. Outside it, the arrows walk the map (§8.5).
import type { ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { HouseMap, MOVE_STEP, MOVE_STEP_LARGE, type HouseMapProps } from './HouseMap.tsx'
import type { MapNodeData } from './HouseNode.tsx'
import { flowEnv } from '../test/flowEnv.ts'
import { renderAt } from '../test/render.tsx'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'

const node = (id: string, name: string): MapNodeData => ({ item: { id, kind: 'project', name }, facts: '', states: [] })
const ITEMS = [node('project:a', 'Alpha'), node('project:b', 'Beta')]
const POSITIONS = { 'project:a': { x: 100, y: 100 }, 'project:b': { x: 400, y: 100 } }
const nodeEl = (id: string) => document.querySelector(`[data-node-id="${id}"]`) as HTMLElement
const flowOf = (id: string) => nodeEl(id).closest('.react-flow__node') as HTMLElement

// what the page's one live region is asked to say (parts/live.tsx's event)
let said: string[] = []
const hear = (e: Event) => { said.push(String((e as CustomEvent).detail)) }
beforeEach(() => { flowEnv(); said = []; window.addEventListener('org-os-announce', hear) })
afterEach(() => { window.removeEventListener('org-os-announce', hear); vi.unstubAllGlobals() })

function draw(over: Partial<HouseMapProps> = {}, wrap = (el: ReactElement) => el) {
  const onMove = vi.fn()
  renderAt(wrap(<HouseMap items={ITEMS} links={[]} variant="members" positions={POSITIONS} onMove={onMove} {...over} />))
  return { onMove }
}
const ready = () => waitFor(() => expect(nodeEl('project:a')).not.toBeNull())
/** Move mode hands focus back on the next tick (HouseMap's setTimeout): let it land inside act (C10: no act() noise). */
const settle = () => act(() => new Promise<void>(r => { setTimeout(r, 0) }))

describe('move mode', () => {
  it('moves the focused node by keys, a step and a large step, and keeps it with Enter', async () => {
    const { onMove } = draw()
    await ready()
    act(() => nodeEl('project:a').focus())
    fireEvent.keyDown(nodeEl('project:a'), { key: 'm' })
    expect(said.at(-1)).toBe('Moving Alpha. The arrows move it, Enter puts it there, Escape puts it back.')
    fireEvent.keyDown(nodeEl('project:a'), { key: 'ArrowRight' })
    fireEvent.keyDown(nodeEl('project:a'), { key: 'ArrowDown', shiftKey: true })
    expect(said.at(-1)).toBe(`Alpha: ${100 + MOVE_STEP} across, ${100 + MOVE_STEP_LARGE} down.`)
    await waitFor(() => expect(flowOf('project:a').style.transform).toBe(`translate(${100 + MOVE_STEP}px,${100 + MOVE_STEP_LARGE}px)`))
    fireEvent.keyDown(nodeEl('project:a'), { key: 'Enter' })
    expect(onMove).toHaveBeenCalledExactlyOnceWith('project:a', { x: 100 + MOVE_STEP, y: 100 + MOVE_STEP_LARGE })
    expect(said.at(-1)).toMatch(/^Alpha moved to .* Its place is kept\.$/)
    await settle()
  })

  it('puts it back with Escape, keeping nothing', async () => {
    const { onMove } = draw()
    await ready()
    fireEvent.keyDown(nodeEl('project:a'), { key: 'm' })
    fireEvent.keyDown(nodeEl('project:a'), { key: 'ArrowLeft' })
    fireEvent.keyDown(nodeEl('project:a'), { key: 'Escape' })
    expect(onMove).not.toHaveBeenCalled()
    expect(said.at(-1)).toBe('Move cancelled. Alpha is back at 100 across, 100 down.')
    await waitFor(() => expect(flowOf('project:a').style.transform).toBe('translate(100px,100px)'))
    await settle()
  })

  it('moves it with the nudge buttons, then Done keeps it; Cancel puts another back', async () => {
    const { onMove } = draw()
    await ready()
    fireEvent.keyDown(nodeEl('project:a'), { key: 'm' })
    const bar = screen.getByRole('toolbar', { name: 'Move Alpha' })
    fireEvent.click(screen.getByRole('button', { name: 'Move down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move right' }))
    expect(bar).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onMove).toHaveBeenCalledExactlyOnceWith('project:a', { x: 100 + MOVE_STEP, y: 100 + MOVE_STEP })
    expect(screen.queryByRole('toolbar')).toBeNull()
    fireEvent.keyDown(nodeEl('project:b'), { key: 'm' })
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onMove).toHaveBeenCalledTimes(1)
    await settle()
  })

  it('hands the caller Move with a click, for the inspector', async () => {
    const onSelect = vi.fn()
    draw({ onSelect })
    await ready()
    fireEvent.click(flowOf('project:b'))
    const acts = onSelect.mock.calls[0]![1] as { move?: () => void }
    expect(typeof acts.move).toBe('function')
    act(() => acts.move!())
    expect(await screen.findByRole('toolbar', { name: 'Move Beta' })).toBeTruthy()
    await settle()
  })

  it('outside move mode the arrows walk the map, and no node moves', async () => {
    const { onMove } = draw()
    await ready()
    act(() => nodeEl('project:a').focus())
    fireEvent.keyDown(nodeEl('project:a'), { key: 'ArrowRight' })
    expect(onMove).not.toHaveBeenCalled()
    expect(flowOf('project:a').style.transform).toBe('translate(100px,100px)')
    await settle()
  })

  it('is not offered to a viewer who may not write: previewing, `m` does nothing and nothing can be dragged (C-23)', async () => {
    const onSelect = vi.fn()
    const { onMove } = draw({ onSelect }, el => <ViewAsProvider initial={{ as: 'members' }}>{el}</ViewAsProvider>)
    await ready()
    fireEvent.keyDown(nodeEl('project:a'), { key: 'm' })
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(flowOf('project:a').classList.contains('draggable')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Auto-layout' })).toBeNull()
    fireEvent.click(flowOf('project:a'))
    expect(onSelect.mock.calls[0]![1]).toEqual({})
    expect(onMove).not.toHaveBeenCalled()
  })
})
