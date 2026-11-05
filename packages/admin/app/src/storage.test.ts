import { describe, it, expect, vi, afterEach } from 'vitest'
import { recallPositions, recallView, rememberPositions, rememberView } from './storage.ts'

afterEach(() => vi.unstubAllGlobals())
const memory = () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
  return store
}
const refused = () => {
  const no = () => { throw new Error('denied') }
  vi.stubGlobal('localStorage', { getItem: no, setItem: no, removeItem: no })
}

describe('storage', () => {
  it('remembers List · Map per section, and falls back to List when storage is refused (Review Focus 5)', () => {
    memory()
    expect(recallView('projects')).toBe('list')
    rememberView('projects', 'map')
    expect(recallView('projects')).toBe('map')
    expect(recallView('ideas')).toBe('list')
    refused()
    expect(() => rememberView('projects', 'map')).not.toThrow()
    expect(recallView('projects')).toBe('list')
  })

  it('keeps section positions, and drops what is not positions', () => {
    const store = memory()
    rememberPositions('crew', { 'seat:a': { x: 1, y: 2 } })
    expect(recallPositions('crew')).toEqual({ 'seat:a': { x: 1, y: 2 } })
    store.set('org-os-admin.layout.crew', '{"seat:a":{"x":"no"}}')
    expect(recallPositions('crew')).toEqual({})
    store.set('org-os-admin.layout.crew', 'not json')
    expect(recallPositions('crew')).toEqual({})
    rememberPositions('crew', null)
    expect(store.has('org-os-admin.layout.crew')).toBe(false)
    refused()
    expect(() => rememberPositions('crew', {})).not.toThrow()
    expect(recallPositions('crew')).toEqual({})
  })
})
