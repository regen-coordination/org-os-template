// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { DoorPage } from './DoorPage.tsx'
import { MembersOnly } from './MembersOnly.tsx'
import { doorSections } from './door.ts'
import { DOOR_PUBLIC } from '../test/fixtures/house/door.ts'
import { FIXED_NOW } from '../test/fixtures/parts.ts'

/** L9 renders the door on the server (E-A2; L9 plan Tasks 15–16): `renderToString(<DoorPage model={model} />)` with no
 *  `window`, and the HTML read without script holds every section and the map's node names as links. */
const html = () => renderToString(<DoorPage model={DOOR_PUBLIC} now={FIXED_NOW} />)
const unescape = (s: string) => s.replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/&quot;/g, '"')

describe('the door on the server', () => {
  it('draws with no window, as L9 calls it, with or without a clock', () => {
    expect(typeof window).toBe('undefined')
    expect(() => renderToString(<DoorPage model={DOOR_PUBLIC} />)).not.toThrow()
  })

  it('holds the map’s node names as links, each to the section that shows it', () => {
    const out = html()
    const still = out.slice(out.indexOf('<ul class="door-map-still"'), out.indexOf('</ul>', out.indexOf('<ul class="door-map-still"')))
    const links = [...still.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ href: m[1], text: unescape(m[2]!.replace(/<[^>]+>/g, '')) }))
    const want = DOOR_PUBLIC.map.items.filter(d => d.href)
    expect(links).toHaveLength(want.length)
    for (const d of want) expect(links.some(l => l.href === d.href && l.text.startsWith(d.item.name)), d.item.name).toBe(true)
  })

  it('holds every present section’s heading, numbered without gaps, and the foot', () => {
    const out = unescape(html())
    for (const s of doorSections(DOOR_PUBLIC)) {
      expect(out).toContain(`id="${s.id}"`)
      expect(out).toMatch(new RegExp(`>${s.no}</p><h2 [^>]*>${s.name}</h2>`))
    }
    expect(out).toContain('A DAO-OS Hub')
    expect(out).not.toMatch(/house/i)
  })

  it('Members links to the members’ origin /sign-in; a door-only site has no Members button', () => {
    expect(renderToString(<DoorPage model={{ ...DOOR_PUBLIC, membersOrigin: 'https://hub.example.org' }} now={FIXED_NOW} />))
      .toContain('href="https://hub.example.org/sign-in"')
    expect(renderToString(<DoorPage model={{ ...DOOR_PUBLIC, membersOrigin: null }} now={FIXED_NOW} />)).not.toContain('Members<')
  })

  it('draws "Members only" for an embed that does not resolve, with nothing else', () => {
    expect(renderToString(<MembersOnly />)).toMatch(/^<p class="door-mo"><svg [^>]*aria-hidden="true"[^>]*>[\s\S]*<\/svg>Members only<\/p>$/)
  })
})
