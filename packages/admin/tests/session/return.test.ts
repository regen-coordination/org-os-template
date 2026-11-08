import { describe, it, expect } from 'vitest'
import { safeReturn } from '../../lib/return-url.mjs'

// Lane 3 Task 5: the I6 return rule. After sign-in the Hub sends a person back only to its own paths or to a host
// inside the org's domain over https; anything else goes to the Hub's root (Review Focus 4: no open redirect).

const HUB = 'https://hub.example.org'
const ROOT = `${HUB}/`
const D = 'example.org'

describe('safeReturn (I6)', () => {
  it('return to evil.example → hub root', () => {
    expect(safeReturn('https://evil.example/', HUB, D)).toBe(ROOT)
    expect(safeReturn('https://evil.example/?next=https://ideas.example.org/', HUB, D)).toBe(ROOT)
  })

  it('a lookalike host → hub root', () => {
    for (const raw of [
      'https://example.org.evil.example/', 'https://evilexample.org/', 'https://ideas.example.org.evil.example/x',
      'https://xn--exmple-cua.org/', 'https://example.org%2eevil.example/', 'https://ideas.example.org./',
    ]) expect(safeReturn(raw, HUB, D)).toBe(ROOT)
  })

  it('http → hub root', () => {
    expect(safeReturn('http://ideas.example.org/x', HUB, D)).toBe(ROOT)
    expect(safeReturn('ftp://ideas.example.org/x', HUB, D)).toBe(ROOT)
  })

  it('credentials in the URL → hub root', () => {
    expect(safeReturn('https://user:pass@ideas.example.org/', HUB, D)).toBe(ROOT)
    expect(safeReturn('https://ideas.example.org@evil.example/', HUB, D)).toBe(ROOT)
    expect(safeReturn('https://user@ideas.example.org/', HUB, D)).toBe(ROOT)
  })

  it('//evil.example → hub root', () => {
    for (const raw of ['//evil.example', '//evil.example/x', '/\\evil.example', '\\\\evil.example', '/\t/evil.example', ' //evil.example']) {
      expect(safeReturn(raw, HUB, D)).toBe(ROOT)
    }
  })

  it('javascript: → hub root', () => {
    for (const raw of ['javascript:alert(1)', 'JavaScript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      expect(safeReturn(raw, HUB, D)).toBe(ROOT)
    }
  })

  it('a subdomain is honoured', () => {
    expect(safeReturn('https://ideas.example.org/x?y=1#z', HUB, D)).toBe('https://ideas.example.org/x?y=1#z')
    expect(safeReturn('https://a.b.example.org/', HUB, D)).toBe('https://a.b.example.org/')
    expect(safeReturn('https://IDEAS.Example.org/x', HUB, D)).toBe('https://ideas.example.org/x')
  })

  it('the bare domain is honoured', () => {
    expect(safeReturn('https://example.org/', HUB, D)).toBe('https://example.org/')
    expect(safeReturn('https://example.org', HUB, D)).toBe('https://example.org/')
    expect(safeReturn('https://example.org/x', HUB, '.example.org')).toBe('https://example.org/x')
  })

  it('a same-hub path is kept', () => {
    expect(safeReturn('/proposals/p-1?tab=diff#top', HUB, D)).toBe('/proposals/p-1?tab=diff#top')
    expect(safeReturn('/', HUB, D)).toBe('/')
    expect(safeReturn('/x', `${HUB}/`, null)).toBe('/x')
  })

  it('no domain configured: only same-hub paths', () => {
    expect(safeReturn('/me', HUB, null)).toBe('/me')
    expect(safeReturn('https://ideas.example.org/x', HUB, null)).toBe(ROOT)
    expect(safeReturn('https://hub.example.org/x', HUB, null)).toBe(ROOT)
  })

  it('nothing, or what is not a URL or a path, → hub root', () => {
    for (const raw of [null, undefined, '', '   ', 'ideas.example.org', 'proposals/p-1', '?x=1', '#x', 'https://', 'https://[::1/']) {
      expect(safeReturn(raw, HUB, D)).toBe(ROOT)
    }
  })

  it('a URL with an explicit port, or holding an address, → hub root', () => {
    expect(safeReturn('https://ideas.example.org:8443/x', HUB, D)).toBe(ROOT)
    expect(safeReturn('https://ideas.example.org/x?who=steward@example.org', HUB, D)).toBe(ROOT)
    expect(safeReturn('https://ideas.example.org/x?who=steward%40example.org', HUB, D)).toBe(ROOT)
    expect(safeReturn('/me?who=steward@example.org', HUB, D)).toBe(ROOT)
  })

  it('a hub with no https origin answers its root for an absolute URL, and still keeps paths', () => {
    expect(safeReturn('https://ideas.example.org/x', 'http://127.0.0.1:4680', null)).toBe('http://127.0.0.1:4680/')
    expect(safeReturn('/x', 'http://127.0.0.1:4680', null)).toBe('/x')
  })
})
