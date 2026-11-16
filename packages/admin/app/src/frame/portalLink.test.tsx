// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { Sidebar } from './Sidebar.tsx'
import { OrgSwitcher } from './OrgSwitcher.tsx'
import { BottomBar } from './BottomBar.tsx'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { Shell } from '../design/Shell.tsx'
import { KeyMap } from '../keys/KeyMap.tsx'
import { HouseKeys } from '../keys/useHouseKeys.ts'
import { paletteItems } from '../palette/palette.ts'
import { setupItems } from '../boards/SetupChecklist.tsx'
import { SignIn } from '../elements/signin/SignIn.tsx'
import { portalOriginOf } from '../session/session.ts'
import { renderAt } from '../test/render.tsx'
import { fakeAddress } from '../test/fixtures/house/org.ts'
import type { SessionView } from '../api.ts'
import type { HouseCounts, Identity } from './sections.ts'

// D-5 (platform 0.7): the Portal link is drawn only when the Hub has a portal origin — hosted, ORG_OS_PORTAL_ORIGIN set,
// so GET /api/session answers `portal` — and it goes to that origin. A hosted Hub without one, and a local Hub, draw no
// Portal link anywhere: the sidebar's foot, the org switcher, the phone's More sheet, ⌘K, the setup checklist, `g d`
// and the key map, the sign-in card. (/portal itself stays the sample page there: App.test.tsx.)

const ORIGIN = 'https://portal.example.test'
const HOSTED: SessionView = { mode: 'hosted', signIn: null, signedIn: false, portal: ORIGIN }
const HOSTED_NONE: SessionView = { mode: 'hosted', signIn: null, signedIn: false, portal: null }
const LOCAL: SessionView = { mode: 'local', signIn: null, signedIn: false }
const MODES = [['hosted with a portal origin', HOSTED], ['hosted without one', HOSTED_NONE], ['local', LOCAL]] as const

const ORG = { name: 'Example DAO', mark: null }
const WHO: Identity = { hatName: 'Council steward', address: fakeAddress(7), hatId: '13.1', hats: ['Council steward'] }
const COUNTS: HouseCounts = { needs: 0, proposals: 0, systems: 0, changes: 0 }

const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void }
const before = { showModal: proto.showModal, close: proto.close }
beforeEach(() => {
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') })
})
afterEach(() => { proto.showModal = before.showModal; proto.close = before.close; vi.restoreAllMocks() })

/** Drawn with GET /api/session already answered as `session`. */
const at = (ui: ReactElement, session: SessionView, path = '/') => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  queryClient.setQueryData(['session'], session)
  return renderAt(ui, path, { queryClient })
}
const expectPortalLink = (a: HTMLElement | null) => {
  expect(a).not.toBeNull()
  expect(a!.getAttribute('href')).toBe(ORIGIN)
  expect(a!.getAttribute('target')).toBe('_blank')
  expect(a!.getAttribute('rel')).toContain('noopener')
}

describe('portalOriginOf (D-5)', () => {
  it('is the session\'s portal origin, and null without one', () => {
    expect(portalOriginOf(HOSTED)).toBe(ORIGIN)
    expect(portalOriginOf(HOSTED_NONE)).toBeNull()
    expect(portalOriginOf(LOCAL)).toBeNull()
    expect(portalOriginOf(null)).toBeNull()
    // only an https origin, as the server's settings take it
    expect(portalOriginOf({ ...LOCAL, portal: 'javascript:alert(1)' } as SessionView)).toBeNull()
    expect(portalOriginOf({ ...LOCAL, portal: 'http://portal.example.test' } as SessionView)).toBeNull()
  })
})

describe.each(MODES)('the Portal link, %s (D-5)', (_name, session) => {
  const linked = session === HOSTED

  it('the sidebar\'s foot', () => {
    at(<Sidebar org={ORG} counts={COUNTS} identity={WHO} />, session)
    const a = screen.queryByRole('link', { name: /^Portal/ })
    if (linked) expectPortalLink(a)
    else expect(a).toBeNull()
    expect(document.querySelector('a[href="/portal"]')).toBeNull()
  })

  it('the org switcher\'s menu', () => {
    at(<OrgSwitcher org={ORG} />, session)
    fireEvent.click(screen.getByRole('button', { name: 'Example DAO' }))
    const menu = screen.getByRole('menu', { name: 'Example DAO' })
    const item = within(menu).queryByRole('menuitem', { name: /^Portal/ })
    if (linked) expectPortalLink(item)
    else { expect(item).toBeNull(); expect(menu.querySelector('[role="separator"]')).toBeNull() }
  })

  it('the phone\'s More sheet', () => {
    at(<ViewAsProvider><BottomBar counts={COUNTS} identity={WHO} /></ViewAsProvider>, session)
    const more = within(screen.getByRole('navigation', { name: 'Hub' })).getByRole('button', { name: 'More' })
    more.focus(); fireEvent.click(more)
    const a = within(screen.getByRole('dialog', { name: 'More' })).queryByRole('link', { name: /^Portal/ })
    if (linked) expectPortalLink(a)
    else expect(a).toBeNull()
  })

  it('g d, and the key map\'s row', () => {
    at(<><Shell title="t" width={1440} nav={<button type="button">In the sidebar</button>} top={<HouseKeys />}><h1>Home</h1></Shell><KeyMap /></>, session)
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.keyDown(document.body, { key: 'g' }); fireEvent.keyDown(document.body, { key: 'd' })
    if (linked) expect(opened).toHaveBeenCalledWith(ORIGIN, '_blank', 'noopener,noreferrer')
    else expect(opened).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: '?' })
    const rows = within(screen.getByRole('dialog', { name: 'Keys' })).getAllByRole('rowheader').map(r => r.textContent)
    expect(rows.includes('Portal, in a new tab')).toBe(linked)
  })

  it('⌘K lists Portal under Jump to only with the origin', () => {
    const portal = session === HOSTED ? ORIGIN : null
    const items = paletteItems([], [], [], { hasChanges: false, canApply: false, record: null, portal })
    const item = items.find(i => i.label === 'Portal')
    if (linked) expect(item).toMatchObject({ group: 'jump', keys: 'g d', open: ORIGIN })
    else expect(item).toBeUndefined()
    expect(items.some(i => i.go === '/portal')).toBe(false)
  })

  it('the setup checklist\'s first item opens the portal only with the origin', () => {
    const portal = session === HOSTED ? ORIGIN : null
    const first = setupItems({ org: null, counts: {}, rules: 0, proposals: 0 }, portal)[0]!
    expect(first).toMatchObject({ id: 'portal', label: 'Name and portal', done: false })
    expect(first.href).toBe(linked ? ORIGIN : null)
  })

  it('the sign-in card says "portal", and links it only with the origin', () => {
    const portalHref = session === HOSTED ? ORIGIN : null
    renderAt(<SignIn org="Example DAO" state="not-member" onSignIn={() => {}} onCancel={() => {}} portalHref={portalHref} />)
    const note = document.querySelector('.signin .note-t')!.textContent
    expect(note).not.toMatch(/door/)
    const a = screen.queryByRole('link', { name: 'Read the portal' })
    if (linked) {
      expect(note).toBe('This address wears no hat in Example DAO’s tree. You can still read the portal.')
      expect(a!.getAttribute('href')).toBe(ORIGIN)
    } else {
      expect(note).toBe('This address wears no hat in Example DAO’s tree.')
      expect(a).toBeNull()
    }
  })
})
