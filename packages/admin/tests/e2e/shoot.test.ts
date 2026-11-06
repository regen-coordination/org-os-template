import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fitRecord, foreignOrigin, PINNED, RECORD, RECORD_MAX_BYTES, RECORD_QUALITIES, recordsFor, shotName, WIDTHS, THEMES } from './shoot.mts'

describe('the screen harness', () => {
  it('shoots at 1440 and 390, light and dark, named the gallery’s way', () => {
    expect(WIDTHS).toEqual([1440, 390])
    expect(THEMES).toEqual(['light', 'dark'])
    expect(shotName('tokens', 1440, 'light')).toBe('tokens-1440-light')
  })

  it('shoots in one locale and one time zone, whatever the host’s (R-10)', () => {
    expect(PINNED).toEqual({ locale: 'en-US', timezoneId: 'UTC' })
  })

  it('lets the page reach only the fixture: anything else is named as foreign', () => {
    const base = 'http://localhost:4123'
    expect(foreignOrigin('http://localhost:4123/api/status', base)).toBeNull()
    expect(foreignOrigin('ws://localhost:4123/ws', base)).toBeNull()
    expect(foreignOrigin('data:image/png;base64,AAAA', base)).toBeNull()
    expect(foreignOrigin('blob:http://localhost:4123/0f0f', base)).toBeNull()
    expect(foreignOrigin('about:blank', base)).toBeNull()
    expect(foreignOrigin('https://fonts.googleapis.com/css2?family=Geist', base)).toBe('https://fonts.googleapis.com')
    expect(foreignOrigin('http://localhost:9999/', base)).toBe('http://localhost:9999')
    expect(foreignOrigin('http://127.0.0.1:4123/', base)).toBe('http://127.0.0.1:4123')
  })

  it('keeps one record list, light only, and finds a group’s records in it', () => {
    expect(RECORD).toEqual(['tokens-1440', 'controls-1440', 'atoms-1440', 'frame-1440', 'frame-390', 'tray-1440', 'rows-1440', 'needs-1440', 'views-1440', 'gov-1440', 'gov-roles-1440', 'map-1440', 'map-390', 'map-compose-1440', 'work-1440', 'lib-1440', 'door-1440'])
    expect(recordsFor('tokens')).toEqual(['tokens-1440'])
    expect(recordsFor('frame')).toEqual(['frame-1440', 'frame-390'])
    expect(recordsFor('rows')).toEqual(['rows-1440'])
    expect(recordsFor('needs')).toEqual(['needs-1440'])
    expect(recordsFor('views')).toEqual(['views-1440'])
    expect(recordsFor('gov')).toEqual(['gov-1440'])
    expect(recordsFor('gov-roles')).toEqual(['gov-roles-1440'])
    expect(recordsFor('map')).toEqual(['map-1440', 'map-390'])
    expect(recordsFor('map-compose')).toEqual(['map-compose-1440'])
    expect(recordsFor('work')).toEqual(['work-1440'])
    expect(recordsFor('door')).toEqual(['door-1440'])
    expect(recordsFor('blocks')).toEqual([])
    expect(recordsFor(null)).toEqual(RECORD)
  })

  it('encodes a record at the highest quality that fits 150 KiB, trying each in turn (ruling B4-a, Q39)', async () => {
    expect(RECORD_MAX_BYTES).toBe(150 * 1024)
    expect(RECORD_QUALITIES).toEqual([0.9, 0.8, 0.7, 0.6, 0.5, 0.4])
    const sizes: Record<number, number> = { 0.9: 220_000, 0.8: 174_000, 0.7: 156_000, 0.6: 143_000, 0.5: 134_000, 0.4: 120_000 }
    const tried: number[] = []
    const encode = async (q: number) => { tried.push(q); return Buffer.alloc(sizes[q]!) }
    expect(await fitRecord(encode)).toEqual({ quality: 0.6, webp: Buffer.alloc(143_000) })
    expect(tried).toEqual([0.9, 0.8, 0.7, 0.6])
    // a small record keeps the first quality
    expect((await fitRecord(async () => Buffer.alloc(50_000))).quality).toBe(0.9)
  })

  it('refuses a record that fits at no quality, saying its smallest size', async () => {
    await expect(fitRecord(async q => Buffer.alloc(Math.round(409_600 * q)))).rejects.toThrow('160.0 KiB at quality 0.4, over the 150 KiB a record may weigh')
  })

  // The committed record is re-shot from the example fixtures and comes back after 0.6.0
  // (docs/superpowers/history/org-os-0.6.md); until then there is none to weigh.
  // When PR B commits the re-shot record, require it again: make this a plain `it` whose first line is
  // `expect(committed.length).toBeGreaterThan(0)`, so a record that goes missing fails here instead of skipping.
  const RECORD_DIR = fileURLToPath(new URL('../../../../docs/design/house-record/', import.meta.url))
  const committed = existsSync(RECORD_DIR) ? readdirSync(RECORD_DIR).filter(f => f.endsWith('.webp')) : []
  it.skipIf(committed.length === 0)('keeps every committed record within 150 KiB', () => {
    const dir = RECORD_DIR
    const files = committed
    for (const f of files) expect(statSync(dir + f).size, f).toBeLessThanOrEqual(RECORD_MAX_BYTES)
  })
})
