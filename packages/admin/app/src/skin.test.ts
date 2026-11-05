// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { applySkin, chosenSkin, instanceSkin, isSkin, setSkin, storedSkin } from './skin.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete document.documentElement.dataset.skin; localStorage.removeItem('org-os-admin.skin') })

describe('skin', () => {
  it('knows its skins, and not a made-up one', () => {
    expect(isSkin('bare')).toBe(true)
    expect(isSkin('house')).toBe(true)
    expect(isSkin('sample')).toBe(false)
    expect(isSkin('neon')).toBe(false)
    expect(isSkin(undefined)).toBe(false)
  })

  it("takes the instance's default from the client setting, and falls back to house when it is unknown", () => {
    expect(instanceSkin()).toBe('house')
    vi.stubEnv('VITE_ORG_OS_SKIN', 'bare')
    expect(instanceSkin()).toBe('bare')
    vi.stubEnv('VITE_ORG_OS_SKIN', 'neon')
    expect(instanceSkin()).toBe('house')
  })

  it("lets the viewer's choice win over the instance default, and keeps it for this browser", () => {
    vi.stubEnv('VITE_ORG_OS_SKIN', 'bare')
    expect(chosenSkin()).toBe('bare')
    setSkin('house')
    expect(storedSkin()).toBe('house')
    expect(chosenSkin()).toBe('house')
    expect(document.documentElement.dataset.skin).toBe('house')
  })

  it('ignores a stored skin that no longer exists', () => {
    localStorage.setItem('org-os-admin.skin', 'neon')
    expect(storedSkin()).toBeNull()
    expect(chosenSkin()).toBe('house')
  })

  it('applies a skin even when storage is refused', () => {
    const no = () => { throw new Error('denied') }
    vi.stubGlobal('localStorage', { getItem: no, setItem: no, removeItem: no })
    setSkin('bare')
    expect(document.documentElement.dataset.skin).toBe('bare')
    expect(chosenSkin()).toBe('house')
  })

  it('applies house for an id it does not know, and never leaves <html> without a skin', () => {
    applySkin('neon')
    expect(document.documentElement.dataset.skin).toBe('house')
    setSkin('neon')
    expect(document.documentElement.dataset.skin).toBe('house')
  })
})
