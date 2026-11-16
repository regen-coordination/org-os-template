import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readInstanceNav, INSTANCE_NAV_MAX_BYTES, INSTANCE_NAV_MAX_GROUPS, INSTANCE_NAV_MAX_ITEMS, INSTANCE_NAV_PATH, NAV_SECTIONS } from '../server/instanceNav.ts'
import { HOUSE_SECTIONS } from '../app/src/frame/sections.ts'
import { createApp } from '../server/app.ts'

let repo: string
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'instance-nav-')) })
afterEach(() => rmSync(repo, { recursive: true, force: true }))
const write = (yaml: string) => { mkdirSync(join(repo, 'house'), { recursive: true }); writeFileSync(join(repo, 'house', 'nav.yaml'), yaml) }
const NONE = { groups: [], more: null }

describe('readInstanceNav', () => {
  it('has no groups when the instance carries no nav: the house draws its own sections', () => {
    expect(readInstanceNav(repo)).toEqual(NONE)
  })
  it('reads groups in order: a house section by id (its label may be renamed), a place in the house, another site', () => {
    write(`groups:
  - items:
      - { section: home, label: Dashboard }
      - { section: needs }
  - label: Governance
    items:
      - { label: Decided, href: /governance/decisions, audience: [steward] }
      - { label: Funds, href: "https://old.example.org/funds", audience: [steward, node-lead] }
more: Everything else
`)
    expect(readInstanceNav(repo)).toEqual({
      groups: [
        { label: null, items: [{ section: 'home', label: 'Dashboard' }, { section: 'needs' }] },
        { label: 'Governance', items: [
          { label: 'Decided', href: '/governance/decisions', audience: ['steward'] },
          { label: 'Funds', href: 'https://old.example.org/funds', audience: ['steward', 'node-lead'] },
        ] },
      ],
      more: 'Everything else',
    })
  })
  it('never answers a hidden item: its slot is the file’s, not the viewer’s', () => {
    write('groups:\n  - label: Knowledge\n    items:\n      - { label: Portal, href: /b/threads, hidden: true }\n      - { label: Library, href: /library }\n')
    expect(readInstanceNav(repo).groups).toEqual([{ label: 'Knowledge', items: [{ label: 'Library', href: '/library' }] }])
  })
  it('leaves out an item with no label, an address that is not a link, or a section the house does not have', () => {
    write(`groups:
  - items:
      - { href: /a }
      - { label: Script, href: "javascript:alert(1)" }
      - { label: Other host, href: "//evil.example" }
      - { section: nowhere }
      - { label: Both, section: roles, href: /x }
      - just words
      - { label: Kept, href: /b/projects }
`)
    expect(readInstanceNav(repo).groups[0]!.items).toEqual([{ label: 'Kept', href: '/b/projects' }])
  })
  it('keeps only the Role names it knows in an audience; an audience with none left is no audience', () => {
    write('groups:\n  - items:\n      - { label: A, href: /a, audience: [steward, admin, Steward] }\n      - { label: B, href: /b, audience: [nobody] }\n      - { label: C, href: /c, audience: steward }\n')
    expect(readInstanceNav(repo).groups[0]!.items).toEqual([
      { label: 'A', href: '/a', audience: ['steward'] }, { label: 'B', href: '/b' }, { label: 'C', href: '/c' },
    ])
  })
  it('keeps an icon name only when it is a plain name', () => {
    write('groups:\n  - items:\n      - { label: A, href: /a, icon: calendar }\n      - { label: B, href: /b, icon: "<svg>" }\n')
    expect(readInstanceNav(repo).groups[0]!.items).toEqual([{ label: 'A', href: '/a', icon: 'calendar' }, { label: 'B', href: '/b' }])
  })
  it(`keeps at most ${INSTANCE_NAV_MAX_GROUPS} groups of ${INSTANCE_NAV_MAX_ITEMS} items, and drops a group left empty`, () => {
    const items = Array.from({ length: 20 }, (_, i) => `      - { label: I${i}, href: /i${i} }\n`).join('')
    write('groups:\n' + Array.from({ length: 12 }, (_, g) => `  - label: G${g}\n    items:\n${items}`).join('') + '  - label: Empty\n    items: []\n')
    const nav = readInstanceNav(repo)
    expect(nav.groups).toHaveLength(INSTANCE_NAV_MAX_GROUPS)
    expect(nav.groups.every(g => g.items.length === INSTANCE_NAV_MAX_ITEMS)).toBe(true)
  })
  it.each([['not YAML', 'groups: [ {'], ['a list', '- a\n- b\n'], ['no groups', 'more: More\n'], ['words', 'hello']])('has no groups when the file is %s', (_, yaml) => {
    write(yaml)
    expect(readInstanceNav(repo).groups).toEqual([])
  })
  it('refuses a file too large to be a nav', () => {
    write('groups:\n  - items:\n      - { label: A, href: /a }\n#' + 'x'.repeat(INSTANCE_NAV_MAX_BYTES))
    expect(readInstanceNav(repo)).toEqual(NONE)
  })
  it('knows the same sections the sidebar draws (a test keeps the two equal)', () => {
    expect([...NAV_SECTIONS]).toEqual(HOUSE_SECTIONS.map(s => s.id))
  })
})

describe(`GET ${INSTANCE_NAV_PATH}`, () => {
  it('answers the nav, and no groups when there is none', async () => {
    expect(await (await createApp(repo).request(INSTANCE_NAV_PATH)).json()).toEqual(NONE)
    write('groups:\n  - label: Network\n    items:\n      - { label: People, href: /b/people }\n')
    expect((await (await createApp(repo).request(INSTANCE_NAV_PATH)).json()).groups[0].label).toBe('Network')
  })
})
