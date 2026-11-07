// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Icon, type IconName } from '../design/Icon.tsx'
import { LiveRegion } from '../parts/live.tsx'
import { ViewAsBand, ViewAsControl, ViewAsProvider, useCanWrite, useViewer } from './ViewAs.tsx'
import { RestrictedValue, VisibilityControl, VisibilityMarker } from './VisibilityMarker.tsx'
import { FIXTURE_SOURCE, type Visibility } from './visibility.ts'

const here = dirname(fileURLToPath(import.meta.url))
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const frameCss = noComments(readFileSync(join(here, '..', 'design', 'css', 'frame.css'), 'utf8'))
const atomsCss = noComments(readFileSync(join(here, '..', 'design', 'css', 'atoms.css'), 'utf8'))

/** The house's glyph drawn on its own, to compare with what an element draws. */
function glyph(name: IconName, size: 'xs' | 'sm' | 'md' = 'sm') {
  const c = document.createElement('div')
  render(<Icon name={name} size={size} />, { container: c })
  return c.innerHTML
}

const ITEMS = [
  { id: 'note', facts: { visibility: 'public' } },
  { id: 'minutes' },
  { id: 'ops-plan', facts: { visibility: 'hat:ops' } },
  { id: 'budget', facts: { visibility: 'members' } },
  { id: 'grant', facts: { visibility: 'public' } },
]

/** What a page would draw: its write control only while it may write, and the items the viewer sees. */
function Probe() {
  const { visible, previewing } = useViewer()
  const canWrite = useCanWrite()
  return (
    <div data-testid="probe" data-previewing={String(previewing)}>
      {canWrite && <button type="button">Edit</button>}
      <ul>{visible(ITEMS).map(i => <li key={i.id}>{i.id}</li>)}</ul>
    </div>
  )
}

function House() {
  return (
    <ViewAsProvider>
      <ViewAsControl />
      <ViewAsBand />
      <Probe />
      <LiveRegion />
    </ViewAsProvider>
  )
}

const shown = () => [...screen.getByTestId('probe').querySelectorAll('li')].map(li => li.textContent)

function chooseFromControl(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /^View as: / }))
  fireEvent.click(screen.getByRole('menuitemradio', { name }))
}

describe('the view-as control and band (§5.9, C-23)', () => {
  it('the control reads "View as: you", menu lists You, Public, Members, then each hat by name and id', () => {
    render(<House />)
    const control = screen.getByRole('button', { name: 'View as: you' })
    expect(control.getAttribute('aria-haspopup')).toBe('menu')
    expect(control.classList.contains('viewas')).toBe(true)
    expect(control.querySelector('svg')!.outerHTML).toBe(glyph('eye'))
    fireEvent.click(control)
    const menu = screen.getByRole('menu', { name: 'View as' })
    const radios = within(menu).getAllByRole('menuitemradio')
    expect(radios.map(r => r.firstElementChild!.nextElementSibling!.textContent)).toEqual(['You', 'Public', 'Members', 'Top', 'Council', 'Ops', 'Treasurer'])
    expect(radios.slice(3).map(r => document.getElementById(r.getAttribute('aria-describedby')!)!.textContent)).toEqual(['top', 'council', 'ops', 'treasury'])
    expect(radios.map(r => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false', 'false'])
    expect(within(menu).getByRole('group', { name: 'Hats' })).toBeTruthy()
    expect(document.activeElement).toBe(radios[0]) // focus on the checked one
  })

  it('choosing Public shows the band in role="status" with its words and an Exit preview button; the control reads "View as: Public" with the globe glyph', () => {
    render(<House />)
    expect(screen.queryByRole('status')).toBeNull()
    chooseFromControl('Public')
    const band = screen.getByRole('status')
    expect(band.classList.contains('band')).toBe(true)
    expect(band.textContent).toBe('Previewing as Public. Only what anyone can read is shown. Nothing can be changed here.Exit preview')
    expect(band.querySelector('b')!.textContent).toBe('Previewing as Public.')
    expect(within(band).getByRole('button', { name: 'Exit preview' })).toBeTruthy()
    const control = screen.getByRole('button', { name: 'View as: Public' })
    expect(control.querySelector('svg')!.outerHTML).toBe(glyph('globe'))
    // announced once, through the page's one polite region; the band itself does not speak again
    expect(screen.getByTestId('live').textContent).toBe('Previewing as Public. Only what anyone can read is shown. Nothing can be changed here.')
    expect(band.getAttribute('aria-live')).toBe('off')
  })

  it('previewing as Members or a hat says so in its own words', () => {
    render(<House />)
    chooseFromControl('Members')
    expect(screen.getByRole('status').textContent).toBe('Previewing as Members. Only what members can read is shown. Nothing can be changed here.Exit preview')
    expect(screen.getByRole('button', { name: 'View as: Members' }).querySelector('svg')!.outerHTML).toBe(glyph('members'))
    chooseFromControl('Ops')
    expect(screen.getByRole('status').textContent).toBe('Previewing as the Ops hat. Only what those who wear it can read is shown. Nothing can be changed here.Exit preview')
    expect(screen.getByRole('button', { name: 'View as: Ops hat' }).querySelector('svg')!.outerHTML).toBe(glyph('hat'))
  })

  it('useCanWrite() is false while previewing: the write control is not rendered, not disabled', () => {
    render(<House />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    chooseFromControl('Members')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getByTestId('probe').dataset.previewing).toBe('true')
  })

  it('visible() drops what the viewer may not see, keeping order', () => {
    render(<House />)
    expect(shown()).toEqual(['note', 'minutes', 'ops-plan', 'budget', 'grant'])
    chooseFromControl('Public')
    expect(shown()).toEqual(['note', 'grant'])
    chooseFromControl('Members')
    expect(shown()).toEqual(['note', 'minutes', 'budget', 'grant'])
    chooseFromControl('Council') // above ops: sees it
    expect(shown()).toEqual(['note', 'minutes', 'ops-plan', 'budget', 'grant'])
    chooseFromControl('Treasurer') // another branch: does not
    expect(shown()).toEqual(['note', 'minutes', 'budget', 'grant'])
  })

  it('Esc does not exit the preview', () => {
    render(<House />)
    chooseFromControl('Public')
    const exit = screen.getByRole('button', { name: 'Exit preview' })
    exit.focus()
    fireEvent.keyDown(exit, { key: 'Escape' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View as: Public' })).toBeTruthy()
  })

  it('Exit preview returns to you: the band goes, the control reads you again and takes the focus', () => {
    render(<House />)
    chooseFromControl('Public')
    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }))
    expect(screen.queryByRole('status')).toBeNull()
    const control = screen.getByRole('button', { name: 'View as: you' })
    expect(document.activeElement).toBe(control)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(shown()).toHaveLength(ITEMS.length)
    expect(screen.getByTestId('live').textContent).toBe('Preview ended.')
  })

  it('choosing You in the menu also ends the preview', () => {
    render(<House />)
    chooseFromControl('Public')
    chooseFromControl('You')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('is per tab: React state only, nothing written to storage', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem')
    render(<House />)
    chooseFromControl('Public')
    expect(set).not.toHaveBeenCalled()
    set.mockRestore()
  })

  // A11 replaces "compact (phone): the eye glyph alone, named by what it reads" (ledger): §5.9 says the eye on
  // the phone, previewing or not, and the button is named by what it does.
  it('compact (phone): the eye glyph alone, named by the action, while previewing too', () => {
    render(<ViewAsProvider initial={{ as: 'public' }}><ViewAsControl compact /></ViewAsProvider>)
    const b = screen.getByRole('button', { name: 'View as' })
    expect(b.textContent).toBe('')
    expect(b.querySelector('svg')!.outerHTML).toBe(glyph('eye'))
    fireEvent.click(b)
    expect(screen.getByRole('menu', { name: 'View as' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'Public' }).getAttribute('aria-checked')).toBe('true')
  })

  it('without a provider, the viewer is you and every write is allowed', () => {
    render(<Probe />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(shown()).toHaveLength(ITEMS.length)
  })

  it('takes another source in place of the fixtures (L5 replaces the source, not the components)', () => {
    const source = { visibilityOf: () => ({ level: 'public' } as Visibility), hatsAbove: () => [], hats: () => [{ hat: 'h1', name: 'Stewards' }], worn: () => [] }
    render(<ViewAsProvider source={source}><ViewAsControl /><Probe /></ViewAsProvider>)
    chooseFromControl('Public')
    expect(shown()).toHaveLength(ITEMS.length)
    fireEvent.click(screen.getByRole('button', { name: 'View as: Public' }))
    expect(screen.getByRole('menuitemradio', { name: 'Stewards' })).toBeTruthy()
  })

  it('draws the band and the control from tokens: the band solid ink, the control 28px outlined', () => {
    expect(frameCss).toMatch(/\.band \{[^}]*background: var\(--solid\);[^}]*color: var\(--on-solid\);/)
    expect(frameCss).toMatch(/\.band \.btn \{[^}]*background: transparent;[^}]*border-color: currentColor;/)
    expect(frameCss).toMatch(/\.viewas \{[^}]*block-size: var\(--h-viewas\);[^}]*border: var\(--rule-w\) solid var\(--rule-strong\);[^}]*background: var\(--raised\);/)
  })
})

describe('VisibilityMarker (§7.10)', () => {
  it('Public (globe), Members (two people), "Hat: Ops" (hat)', () => {
    const marks: [Visibility, string, IconName][] = [
      [{ level: 'public' }, 'Public', 'globe'], [{ level: 'members' }, 'Members', 'members'], [{ level: 'hat', hat: 'ops', name: 'Ops' }, 'Hat: Ops', 'hat'],
    ]
    for (const [value, word, icon] of marks) {
      const { container, unmount } = render(<VisibilityMarker value={value} />)
      const m = container.querySelector('.vis')!
      expect(m.textContent).toBe(word)
      expect(m.querySelector('svg')!.outerHTML).toBe(glyph(icon))
      unmount()
    }
  })

  it('a restricted field’s value reads "<hat> only" in faint, with the lock', () => {
    const { container } = render(<RestrictedValue hat="Ops" />)
    const v = container.querySelector('.vis.vis-field')!
    expect(v.textContent).toBe('Ops only')
    expect(v.querySelector('svg')!.outerHTML).toBe(glyph('lock'))
    expect(atomsCss).toMatch(/\.vis-field \{ color: var\(--faint\); \}/)
  })

  it('is drawn from tokens: glyph 14 + word 12/500 mute; the control 26px outlined', () => {
    expect(atomsCss).toMatch(/\.vis \{[^}]*font: var\(--fw-medium\) var\(--fs-tiny\)\/var\(--lh-ui\) var\(--sans\);[^}]*color: var\(--mute\);/)
    expect(atomsCss).toMatch(/\.vis-ctl \{[^}]*block-size: var\(--h-ctl-sm\);[^}]*border: var\(--rule-w\) solid var\(--rule-strong\);[^}]*background: var\(--raised\);/)
    expect(atomsCss).toMatch(/\.vis-to \{ color: var\(--accent\); \}/)
  })
})

describe('VisibilityControl (§7.10)', () => {
  const MEMBERS: Visibility = { level: 'members' }
  const open = (name = /^Members/) => fireEvent.click(screen.getByRole('button', { name }))
  const end = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? null

  it('is a 26px outlined button with the marker’s glyph and word and a chevron, opening the visibility menu', () => {
    render(<VisibilityControl value={MEMBERS} onChoose={() => {}} />)
    const b = screen.getByRole('button', { name: 'Members' })
    expect(b.className).toBe('vis vis-ctl')
    expect(b.getAttribute('aria-haspopup')).toBe('menu')
    const svgs = b.querySelectorAll('svg')
    expect(svgs[0]!.outerHTML).toBe(glyph('members'))
    expect(svgs[1]!.outerHTML).toBe(glyph('chevron-down', 'xs'))
    open()
    expect(screen.getByRole('menu', { name: 'Visibility' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Who can see this' })).toBeTruthy()
  })

  it('stricter choices say "applies now"; looser say "propose"', () => {
    const chose = vi.fn()
    render(<VisibilityControl value={MEMBERS} onChoose={chose} />)
    open()
    const pub = screen.getByRole('menuitemradio', { name: 'Public' })
    const ops = screen.getByRole('menuitemradio', { name: 'Hat: Ops' })
    const council = screen.getByRole('menuitemradio', { name: 'Hat: Council' })
    const mem = screen.getByRole('menuitemradio', { name: 'Members' })
    expect(end(pub)).toBe('propose')
    expect(end(ops)).toBe('applies now')
    expect(end(council)).toBe('applies now')
    expect(mem.getAttribute('aria-checked')).toBe('true')
    expect(end(mem)).toBeNull()
    fireEvent.click(pub)
    expect(chose).toHaveBeenLastCalledWith({ level: 'public' }, 'propose')
    open()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hat: Ops' }))
    expect(chose).toHaveBeenLastCalledWith({ level: 'hat', hat: 'ops', name: 'Ops' }, 'applies')
  })

  it('between hats: the hat above is stricter than the one below; the one below is looser', () => {
    render(<VisibilityControl value={{ level: 'hat', hat: 'ops', name: 'Ops' }} onChoose={() => {}} />)
    open(/^Hat: Ops/)
    expect(end(screen.getByRole('menuitemradio', { name: 'Hat: Council' }))).toBe('applies now')
    expect(end(screen.getByRole('menuitemradio', { name: 'Members' }))).toBe('propose')
  })

  it('a hat the actor does not wear, under no hat they wear, is aria-disabled "you don’t wear it", after a separator, and cannot be chosen', () => {
    const chose = vi.fn()
    render(<VisibilityControl value={MEMBERS} onChoose={chose} />)
    open()
    const menu = screen.getByRole('menu')
    for (const name of ['Hat: Top', 'Hat: Treasurer']) {
      const t = within(menu).getByRole('menuitem', { name })
      expect(t.getAttribute('aria-disabled')).toBe('true')
      expect(end(t)).toBe('you don’t wear it')
      expect(t.querySelector('svg')!.outerHTML).toBe(glyph('lock', 'md'))
      fireEvent.click(t)
    }
    expect(chose).not.toHaveBeenCalled()
    expect(within(menu).getByRole('separator')).toBeTruthy()
    const order = [...menu.querySelectorAll('[role^="menuitem"]')].map(i => i.firstElementChild!.nextElementSibling!.textContent)
    expect(order).toEqual(['Public', 'Members', 'Hat: Council', 'Hat: Ops', 'Hat: Top', 'Hat: Treasurer'])
  })

  // Coordinator ruling (overturns L4a-R19): a hat is read by its wearers and the wearers of the hats above it
  // (CONTEXT "Visibility"), so a member may narrow a thing to any hat at or below one they wear.
  it('a member wearing a hat above may pick the hat below; a hat in another branch stays disabled', () => {
    const chose = vi.fn()
    const source = { ...FIXTURE_SOURCE, worn: () => ['council'] }
    render(<ViewAsProvider source={source}><VisibilityControl value={MEMBERS} onChoose={chose} /></ViewAsProvider>)
    open()
    const menu = screen.getByRole('menu')
    const ops = within(menu).getByRole('menuitemradio', { name: 'Hat: Ops' })
    expect(ops.getAttribute('aria-disabled')).toBeNull()
    expect(end(ops)).toBe('applies now')
    fireEvent.click(ops)
    expect(chose).toHaveBeenLastCalledWith({ level: 'hat', hat: 'ops', name: 'Ops' }, 'applies')
    open()
    const treasurer = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Hat: Treasurer' })
    expect(treasurer.getAttribute('aria-disabled')).toBe('true')
    expect(end(treasurer)).toBe('you don’t wear it')
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Hat: Top' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('`proposed` reads "Members → Public, proposed" with the target in moss', () => {
    render(<VisibilityControl value={MEMBERS} proposed={{ level: 'public' }} onChoose={() => {}} />)
    const b = screen.getByRole('button', { name: 'Members → Public, proposed' })
    expect(b.querySelector('.vis-to')!.textContent).toBe('Public, proposed')
  })

  it('the marker reads a widening in flight too, for a reader who may not change it: "Members → Public, proposed" (L4a final review M-9)', () => {
    const { container } = render(<VisibilityMarker value={MEMBERS} proposed={{ level: 'public' }} />)
    const marker = container.querySelector('.vis')!
    expect(marker.textContent).toBe('Members → Public, proposed')
    expect(marker.querySelector('.vis-to')!.textContent).toBe('Public, proposed')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('`offers` leaves out the levels a thing cannot be given here (a private record: not Public, not Members; L5 R-L5-20.4)', () => {
    render(<VisibilityControl value={{ level: 'hat', hat: 'ops', name: 'Ops' }} offers={v => v.level === 'hat'} onChoose={() => {}} />)
    open(/^Hat: Ops/)
    expect(screen.queryByRole('menuitemradio', { name: 'Public' })).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: 'Members' })).toBeNull()
    expect(screen.getAllByRole('menuitemradio').map(r => r.firstElementChild!.nextElementSibling!.textContent)).toEqual(['Hat: Council', 'Hat: Ops'])
  })

  it('a `parent` puts its level in the menu header', () => {
    render(<VisibilityControl value={{ level: 'hat', hat: 'ops', name: 'Ops' }} parent={MEMBERS} onChoose={() => {}} />)
    open(/^Hat: Ops/)
    expect(screen.getByRole('group', { name: 'Who can see this · its parent is Members' })).toBeTruthy()
  })
})
