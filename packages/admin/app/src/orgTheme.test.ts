// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ORG_THEME_KEY, applyStoredAppearance, setOrgTheme, storedOrgTheme } from './orgTheme.ts'

const root = document.documentElement
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['theme', 'orgTheme', 'themeSwitching']) delete root.dataset[k]
})
const memory = () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
  return store
}

describe('instance themes in the browser', () => {
  it('keeps a chosen theme, sets it on <html> with its scheme, and hands back to the own look', () => {
    const store = memory()
    setOrgTheme({ id: 'deep', scheme: 'dark' })
    expect(root.dataset.orgTheme).toBe('deep')
    expect(root.dataset.theme).toBe('dark')
    expect(store.get(ORG_THEME_KEY)).toBe('deep:dark')
    expect(storedOrgTheme()).toEqual({ id: 'deep', scheme: 'dark' })
    setOrgTheme(null)
    expect(root.dataset.orgTheme).toBeUndefined()
    expect(storedOrgTheme()).toBeNull()
  })

  it('keeps a stored theme and its scheme at start-up, even with no light or dark choice stored', () => {
    const store = memory()
    store.set(ORG_THEME_KEY, 'dawn:light')
    root.dataset.orgTheme = 'dawn'; root.dataset.theme = 'light' // as the inline script drew it
    applyStoredAppearance()
    expect(root.dataset.theme).toBe('light')
    expect(root.dataset.orgTheme).toBe('dawn')
    store.delete(ORG_THEME_KEY); store.set('org-os-admin.theme', 'dark')
    applyStoredAppearance()
    expect(root.dataset.orgTheme).toBeUndefined()
    expect(root.dataset.theme).toBe('dark')
  })

  it('reads nothing from a made-up stored value', () => {
    const store = memory()
    store.set(ORG_THEME_KEY, '"><script>:dark')
    expect(storedOrgTheme()).toBeNull()
  })

  it('is drawn from the first frame by the inline script in index.html, which ignores anything else', () => {
    const html = readFileSync(join(process.cwd(), 'app/index.html'), 'utf8')
    const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
    const run = (stored: string | null, refuse = false) => {
      const el = { dataset: {} as Record<string, string> }
      const storage = { getItem: (k: string) => { if (refuse) throw new Error('refused'); return k === ORG_THEME_KEY ? stored : null } }
      new Function('document', 'localStorage', inline)({ documentElement: el }, storage)
      return el.dataset
    }
    expect(run('dawn:light')).toMatchObject({ orgTheme: 'dawn', theme: 'light' })
    expect(run('dawn:sepia').orgTheme).toBeUndefined()
    expect(run(null).orgTheme).toBeUndefined()
    expect(run('dawn:light', true).orgTheme).toBeUndefined()
  })
})
