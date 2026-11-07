// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { LiveRegion } from '../../parts/live.tsx'
import { SAFE, SAFE_CHAINS } from '../../test/fixtures/house/org.ts'
import { AddressChip, COPIED_MS } from './AddressChip.tsx'
import { ChainChip } from './ChainChip.tsx'
import { Amount } from './Amount.tsx'
import { ReadAge } from './ReadAge.tsx'
import { Icon, type IconName } from '../../design/Icon.tsx'

const here = dirname(fileURLToPath(import.meta.url))
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const atomsCss = noComments(readFileSync(join(here, '..', '..', 'design', 'css', 'atoms.css'), 'utf8'))
const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1]!.trim(), m[2]!] as const)
const body = (sel: string) => rules(atomsCss).filter(([s]) => s.split(',').map(x => x.trim()).includes(sel)).map(([, b]) => b).join(' ')

const SHORT = '0x6AFF…343a'
const REFUSED = 'Couldn’t copy. Select the address and copy it.'
const live = () => screen.getByTestId('live').textContent
const withLive = (ui: ReactElement) => render(<>{ui}<LiveRegion /></>)
/** The house's 13px glyph, drawn on its own (in a detached node), to compare with what an atom draws. */
function glyph(name: IconName) {
  const c = document.createElement('div')
  render(<Icon name={name} size="xs" />, { container: c })
  return c.innerHTML
}
/** Let the clipboard's promise settle and React draw what follows. */
const settle = () => act(async () => { await Promise.resolve() })

let writeText: ReturnType<typeof vi.fn>
function clipboard(impl: (text: string) => Promise<void>) {
  writeText = vi.fn(impl)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}
beforeEach(() => clipboard(async () => {}))
afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(navigator, 'clipboard') })

describe('AddressChip (§7.5)', () => {
  it('still: the chip as text, no control of its own, the CAIP-10 id in its title (E-36)', () => {
    const { container } = render(<AddressChip value={SAFE} chain="eip155:42220" still />)
    const chip = container.querySelector('.addr.addr-still') as HTMLElement
    expect(chip.tagName).toBe('SPAN')
    expect(chip.textContent).toBe('0x6AFF…343a')
    expect(chip.title).toBe(`eip155:42220:${SAFE}`)
    expect(container.querySelector('button')).toBeNull()
  })

  it('click copies the plain 0x address; title is the CAIP-10 id', async () => {
    withLive(<AddressChip value={SAFE} chain="eip155:42220" />)
    const chip = screen.getByRole('button', { name: `Copy address ${SHORT}` })
    expect(chip.getAttribute('title')).toBe(`eip155:42220:${SAFE}`)
    expect(chip.textContent).toBe(SHORT)
    fireEvent.click(chip)
    await settle()
    expect(writeText).toHaveBeenCalledWith(SAFE)
  })

  it('copied: the glyph becomes a check, "Copied 0x6AFF…343a" is announced, it reverts after 1600 ms', async () => {
    vi.useFakeTimers()
    withLive(<AddressChip value={SAFE} chain="eip155:42220" />)
    const chip = screen.getByRole('button', { name: `Copy address ${SHORT}` })
    expect(chip.hasAttribute('data-copied')).toBe(false)
    expect(chip.querySelector('.addr-ok .i')).not.toBeNull() // the check is there, hidden, to cross-fade in
    fireEvent.click(chip)
    await settle()
    expect(chip.hasAttribute('data-copied')).toBe(true)
    expect(live()).toBe(`Copied ${SHORT}`)
    expect(COPIED_MS).toBe(1600)
    act(() => { vi.advanceTimersByTime(1599) })
    expect(chip.hasAttribute('data-copied')).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(chip.hasAttribute('data-copied')).toBe(false)
  })

  it('a second copy restarts the 1600 ms, it does not cut the first short', async () => {
    vi.useFakeTimers()
    withLive(<AddressChip value={SAFE} />)
    const chip = screen.getByRole('button')
    fireEvent.click(chip); await settle()
    act(() => { vi.advanceTimersByTime(1000) })
    fireEvent.click(chip); await settle()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(chip.hasAttribute('data-copied')).toBe(true)
    act(() => { vi.advanceTimersByTime(600) })
    expect(chip.hasAttribute('data-copied')).toBe(false)
  })

  it('cross-fades the glyph: scale .25 → 1, opacity, blur 4 → 0 over 300 ms; none of it under reduced motion', () => {
    // the check is hidden until copied, the copy glyph once copied; the shown one keeps opacity 1, scale 1, no filter
    const hidden = /opacity: 0;[^}]*scale: var\(--scale-copy\);[^}]*filter: blur\(var\(--blur-copy\)\);/
    expect(body('.addr:not([data-copied]) .addr-ok .i')).toMatch(hidden)
    expect(body('.addr[data-copied] .addr-cp .i')).toMatch(hidden)
    expect(body('.addr[data-copied] .addr-ok .i')).toBe('')
    expect(body('.addr-ok .i')).toMatch(/color: var\(--accent\);/); expect(body('.addr-ok .i')).not.toMatch(/opacity|scale|filter/)
    expect(body('.addr-ic .i')).toMatch(/transition: opacity var\(--dur-copy\) var\(--ease\), scale var\(--dur-copy\) var\(--ease\), filter var\(--dur-copy\) var\(--ease\);/)
    expect(atomsCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.addr-ic \.i \{ transition-property: opacity; scale: 1 !important; filter: none !important; \}/)
    const house = readFileSync(join(here, '..', '..', 'design', 'skins', 'house.css'), 'utf8')
    expect(house).toMatch(/--dur-copy: 300ms;/); expect(house).toMatch(/--scale-copy: \.25;/); expect(house).toMatch(/--blur-copy: 4px;/)
  })

  it('the context menu (right-click, and Shift+F10) offers "Copy CAIP-10", which copies eip155:42220:0x…', async () => {
    withLive(<AddressChip value={SAFE} chain="eip155:42220" />)
    const chip = screen.getByRole('button', { name: `Copy address ${SHORT}` })
    expect(screen.queryByRole('menu')).toBeNull()
    const right = fireEvent.contextMenu(chip)
    expect(right).toBe(false) // the browser's own menu is not drawn over ours
    const menu = screen.getByRole('menu', { name: `Address ${SHORT}` })
    expect(within(menu).getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Copy address', 'Copy CAIP-10'])
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0])
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(chip)

    fireEvent.keyDown(chip, { key: 'F10', shiftKey: true })
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Copy CAIP-10' }))
    await settle()
    expect(writeText).toHaveBeenCalledWith(`eip155:42220:${SAFE}`)
    expect(live()).toBe(`Copied CAIP-10 eip155:42220:${SHORT}`)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(chip)
  })

  it('without a chain there is no CAIP-10 id: no title of one, and the browser keeps its own context menu', () => {
    withLive(<AddressChip value={SAFE} />)
    const chip = screen.getByRole('button', { name: `Copy address ${SHORT}` })
    expect(chip.getAttribute('title')).toBe(SAFE)
    expect(fireEvent.contextMenu(chip)).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each(['exampledao.eth', '42220 / 13', `${SAFE}a`, SAFE.slice(0, 41)])('a value that is not an address is shown and copied whole: %s', async value => {
    withLive(<AddressChip value={value} chain="eip155:42220" />)
    const chip = screen.getByRole('button', { name: `Copy ${value}` })
    expect(chip.textContent).toBe(value)
    expect(chip.getAttribute('title')).toBe(value) // never a CAIP-10 id built from something that is not an address
    expect(fireEvent.contextMenu(chip)).toBe(true)
    fireEvent.click(chip)
    await settle()
    expect(writeText).toHaveBeenCalledWith(value)
    expect(live()).toBe(`Copied ${value}`)
  })

  it('an empty value draws nothing to copy', () => {
    const { container } = withLive(<AddressChip value="" />)
    expect(container.querySelector('.addr')).toBeNull()
  })

  it('a refused clipboard says so: no copied state, the sentence is announced, and the full value is shown', async () => {
    clipboard(async () => { throw new DOMException('denied', 'NotAllowedError') })
    withLive(<AddressChip value={SAFE} chain="eip155:42220" />)
    const chip = screen.getByRole('button', { name: `Copy address ${SHORT}` })
    fireEvent.click(chip)
    await settle()
    expect(chip.hasAttribute('data-copied')).toBe(false)
    expect(live()).toBe(REFUSED)
    const full = document.querySelector('.addr-sel')!
    expect(full.textContent).toBe(SAFE)
    expect(window.getSelection()?.toString()).toBe(SAFE) // selected for the person, ready for their own copy
  })

  it('a refused Copy CAIP-10 offers the CAIP-10 id to copy by hand, not the plain address (L4a final review M-10)', async () => {
    clipboard(async () => { throw new DOMException('denied', 'NotAllowedError') })
    withLive(<AddressChip value={SAFE} chain="eip155:42220" />)
    fireEvent.keyDown(screen.getByRole('button', { name: `Copy address ${SHORT}` }), { key: 'F10', shiftKey: true })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy CAIP-10' }))
    await settle()
    expect(live()).toBe(REFUSED)
    expect(document.querySelector('.addr-sel')!.textContent).toBe(`eip155:42220:${SAFE}`)
    expect(window.getSelection()?.toString()).toBe(`eip155:42220:${SAFE}`)
  })

  it('no clipboard at all (an insecure page) is a refusal too', async () => {
    Reflect.deleteProperty(navigator, 'clipboard')
    withLive(<AddressChip value={SAFE} />)
    fireEvent.click(screen.getByRole('button'))
    await settle()
    expect(live()).toBe(REFUSED)
    expect(document.querySelector('.addr-sel')!.textContent).toBe(SAFE)
  })

  it('warn adds the alert glyph and the reason', () => {
    const zero = `0x${'0'.repeat(40)}`
    withLive(<AddressChip value={zero} chain="eip155:42220" warn="Not a contract on Celo" />)
    const chip = screen.getByRole('button', { name: 'Copy address 0x0000…0000' })
    expect(chip.classList.contains('addr-warn')).toBe(true)
    expect(chip.querySelector('.addr-cp')!.innerHTML).toBe(glyph('alert'))
    expect(chip.getAttribute('title')).toBe(`Not a contract on Celo · eip155:42220:${zero}`)
    const desc = chip.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)!.textContent).join(' ')
    expect(desc).toContain('Not a contract on Celo')
    expect(desc).toContain(zero)
  })

  it('the chip is a button named "Copy address 0x6AFF…343a", never a link; the full address is in its description', () => {
    const { container } = withLive(<AddressChip value={SAFE} chain="eip155:42220" />)
    const chip = screen.getByRole('button', { name: `Copy address ${SHORT}` })
    expect(chip.tagName).toBe('BUTTON')
    expect(chip.getAttribute('type')).toBe('button')
    expect(container.querySelector('a')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(document.getElementById(chip.getAttribute('aria-describedby')!)!.textContent).toBe(SAFE)
    for (const svg of chip.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true')
  })

  it('named: the name in Sans instead of the hex; click still copies the address', async () => {
    withLive(<AddressChip value={SAFE} name="exampledao.eth" />)
    const chip = screen.getByRole('button', { name: 'Copy address exampledao.eth' })
    expect(chip.querySelector('.addr-name')!.textContent).toBe('exampledao.eth')
    fireEvent.click(chip); await settle()
    expect(writeText).toHaveBeenCalledWith(SAFE)
  })

  it('full: the whole address, wrapping anywhere', () => {
    withLive(<AddressChip value={SAFE} full />)
    const chip = screen.getByRole('button', { name: `Copy address ${SAFE}` })
    expect(chip.classList.contains('addr-full')).toBe(true)
    expect(chip.textContent).toBe(SAFE)
    expect(body('.addr-full')).toMatch(/overflow-wrap: anywhere;/)
  })

  it('pins the copied state for /parts, and keeps hover under a hover-capable pointer', () => {
    withLive(<AddressChip value={SAFE} copied />)
    expect(screen.getByRole('button').hasAttribute('data-copied')).toBe(true)
    expect(atomsCss).toMatch(/@media \(hover: hover\) \{[^@]*\.addr:not\(\.addr-full\):hover \{ background: var\(--wash-strong\); \}/)
  })
})

describe('ChainChip (§7.6)', () => {
  it('one chain "Celo" with a hollow glyph', () => {
    const { container } = render(<ChainChip chains={['eip155:42220']} />)
    const chip = container.querySelector('.chain')!
    expect(chip.textContent).toBe('Celo')
    expect(chip.querySelector('.chain-glyph')!.getAttribute('aria-hidden')).toBe('true')
    expect(chip.classList.contains('chain-multi')).toBe(false)
    expect(chip.tagName).toBe('SPAN') // nothing to open: not a control
    expect(body('.chain-glyph')).toMatch(/border: var\(--stroke-w\) solid var\(--faint\);/)
  })

  it('seven chains read "7 chains"; focus opens a popover listing their names', () => {
    render(<ChainChip chains={[...SAFE_CHAINS]} />)
    const chip = screen.getByRole('button', { name: /^7 chains/ })
    expect(chip.textContent).toBe('7 chains')
    expect(chip.classList.contains('chain-multi')).toBe(true)
    const pop = document.getElementById(chip.getAttribute('aria-controls')!)!
    expect(pop.hidden).toBe(true)
    fireEvent.focus(chip)
    expect(pop.hidden).toBe(false)
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    expect(within(pop).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Ethereum', 'Optimism', 'Arbitrum', 'Gnosis', 'Polygon', 'Base', 'Celo'])
    fireEvent.keyDown(chip, { key: 'Escape' })
    expect(pop.hidden).toBe(true)
    fireEvent.mouseEnter(chip.parentElement!)
    expect(pop.hidden).toBe(false)
    fireEvent.mouseLeave(chip.parentElement!)
    expect(pop.hidden).toBe(true)
    fireEvent.click(chip) // a touch has no hover: a tap opens it
    expect(pop.hidden).toBe(false)
    fireEvent.blur(chip)
    expect(pop.hidden).toBe(true)
  })

  it('names the chains in the chip’s description, so a screen reader hears them without opening it', () => {
    render(<ChainChip chains={[...SAFE_CHAINS]} />)
    const chip = screen.getByRole('button', { name: /^7 chains/ })
    expect(document.getElementById(chip.getAttribute('aria-describedby')!)!.textContent).toBe('Ethereum, Optimism, Arbitrum, Gnosis, Polygon, Base, Celo')
  })

  it('Sepolia reads "Sepolia · test" with a dashed class', () => {
    const { container } = render(<ChainChip chains={['eip155:11155111']} />)
    const chip = container.querySelector('.chain')!
    expect(chip.textContent).toBe('Sepolia · test')
    expect(chip.classList.contains('chain-test')).toBe(true)
    expect(body('.chain-test')).toMatch(/border-style: dashed;/)
  })

  it('agree 6 of 7 reads "6 of 7 agree" with the clay class', () => {
    render(<ChainChip chains={[...SAFE_CHAINS]} agree={6} />)
    const chip = screen.getByRole('button', { name: /^6 of 7 agree/ })
    expect(chip.classList.contains('chain-split')).toBe(true)
    expect(body('.chain-split')).toMatch(/border-color: var\(--attn\);[^}]*color: var\(--attn\);/)
  })

  it('agree on every chain is no disagreement', () => {
    render(<ChainChip chains={[...SAFE_CHAINS]} agree={7} />)
    expect(screen.getByRole('button', { name: /^7 chains/ }).classList.contains('chain-split')).toBe(false)
  })

  it('an unknown chain shows its CAIP-2 id in Mono', () => {
    const { container } = render(<ChainChip chains={['eip155:999']} />)
    const id = container.querySelector('.chain .chain-id')!
    expect(id.textContent).toBe('eip155:999')
    expect(body('.chain-id')).toMatch(/font-family: var\(--mono\);/)
  })

  // B3 fix 1 (I-1): a chip inside a link (a Needs you row) may hold no control; `still` draws the same chip as a span,
  // its chains named for a screen reader, with the one naming and class rule.
  it('still: several chains are a span, not a button, their names said after the count', () => {
    const { container } = render(<ChainChip chains={[...SAFE_CHAINS]} still />)
    expect(container.querySelector('button')).toBeNull()
    const chip = container.querySelector('.chain')!
    expect(chip.tagName).toBe('SPAN')
    expect(chip.classList.contains('chain-multi')).toBe(true)
    expect(chip.querySelector('.sr-only')!.textContent).toBe(': Ethereum, Optimism, Arbitrum, Gnosis, Polygon, Base, Celo')
    expect(chip.textContent!.startsWith('7 chains')).toBe(true)
  })

  it('still: a disagreement is the clay "6 of 7 agree"; one chain, one test chain and an unknown chain read as the chip does', () => {
    const { container } = render(<>
      <ChainChip chains={[...SAFE_CHAINS]} agree={6} still />
      <ChainChip chains={['eip155:42220']} still />
      <ChainChip chains={['eip155:11155111']} still />
      <ChainChip chains={['eip155:999']} still />
      <ChainChip chains={['eip155:42220']} agree={0} still />
    </>)
    const chips = [...container.querySelectorAll(':scope > .chain')]
    expect(chips.map(c => c.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN', 'SPAN', 'SPAN'])
    expect(chips[0]!.classList.contains('chain-split')).toBe(true)
    expect(chips[0]!.firstChild!.nextSibling!.textContent).toBe('6 of 7 agree')
    expect(chips[1]!.textContent).toBe('Celo')
    expect(chips[2]!.textContent).toBe('Sepolia · test')
    expect(chips[2]!.classList.contains('chain-test')).toBe(true)
    expect(chips[3]!.querySelector('.chain-id')!.textContent).toBe('eip155:999')
    expect(chips[4]!.textContent).toBe('0 of 1 agree')
    expect(chips[4]!.classList.contains('chain-split')).toBe(true)
  })

  it('draws no brand: no image, no colour of a chain', () => {
    const { container } = render(<><ChainChip chains={['eip155:1']} /><ChainChip chains={[...SAFE_CHAINS]} /></>)
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toMatch(/style=/)
  })
})

describe('Amount (§7.7)', () => {
  it('isolates "< 0.01" in a <bdi>, so it keeps its order on a right-to-left page (E-45)', () => {
    const { container } = render(<div dir="rtl"><Amount value="0.001" unit="USDGLO" decimals={2} /></div>)
    const bdi = container.querySelector('.amt-v > bdi')!
    expect(bdi.textContent).toBe('< 0.01')
    const plain = render(<Amount value="12" unit="USDGLO" decimals={2} />).container
    expect(plain.querySelector('bdi')).toBeNull()
  })

  it('value then unit in mute, a no-break space between', () => {
    const { container } = render(<Amount value="1271" unit="USDGLO" decimals={2} />)
    const amt = container.querySelector('.amt')!
    expect(amt.textContent).toBe('1,271.00 USDGLO')
    expect(amt.querySelector('.amt-u')!.textContent).toBe(' USDGLO')
    expect(body('.amt-u')).toMatch(/color: var\(--mute\);/)
    expect(body('.amt')).toMatch(/font-variant-numeric: tabular-nums slashed-zero;/)
  })

  it('outgoing uses a true minus', () => {
    const { container } = render(<Amount value="-1829" unit="USDGLO" decimals={2} />)
    expect(container.querySelector('.amt-v')!.textContent).toBe('−1,829.00')
  })

  it('aged is mute', () => {
    const { container } = render(<Amount value="3100" unit="USDGLO" decimals={2} aged />)
    expect(container.querySelector('.amt')!.classList.contains('amt-aged')).toBe(true)
    expect(body('.amt-aged')).toMatch(/color: var\(--mute\);/)
  })

  it('null is "—" and "not read yet"', () => {
    const { container } = render(<Amount value={null} unit="USDGLO" decimals={2} />)
    const amt = container.querySelector('.amt')!
    expect(amt.classList.contains('amt-none')).toBe(true)
    expect(amt.textContent).toBe('— not read yet')
    expect(amt.textContent).not.toContain('USDGLO')
    // the unit's narrowed gap is for a unit, not for the words "not read yet" (L4a final review M-11)
    expect(body('.amt-none .amt-u')).toMatch(/word-spacing: normal;/)
  })

  it('large uses the display class; body is 14', () => {
    const { container } = render(<><Amount value="3100" unit="USDGLO" decimals={0} size="large" /><Amount value="27561390.98" unit="G$" decimals={2} size="body" /></>)
    const [large, bodyAmt] = [...container.querySelectorAll('.amt')]
    expect(large!.classList.contains('amt-display')).toBe(true)
    expect(large!.textContent).toBe('3,100 USDGLO')
    expect(body('.amt-display')).toMatch(/var\(--display\)/)
    expect(bodyAmt!.classList.contains('amt-body')).toBe(true)
    expect(body('.amt-body')).toMatch(/font-size: var\(--fs-body\);/)
  })

  it('copying the shown value copies the exact amount', () => {
    const { container } = render(<Amount value="123456789012345678901234.129" unit="USDGLO" decimals={2} />)
    const v = container.querySelector('.amt-v')!
    expect(v.textContent).toBe('123,456,789,012,345,678,901,234.12')
    window.getSelection()!.selectAllChildren(container.querySelector('.amt')!)
    const setData = vi.fn()
    fireEvent.copy(v, { clipboardData: { setData } })
    expect(setData).toHaveBeenCalledWith('text/plain', '123456789012345678901234.129')
  })
})

describe('ReadAge (§7.9): one case per ReadingState, each a <time datetime> with the ISO in title', () => {
  const now = new Date('2026-10-29T12:00:00Z')
  const age = () => document.querySelector('.age')!
  const isTime = (iso: string) => {
    expect(age().tagName).toBe('TIME')
    expect(age().getAttribute('datetime')).toBe(iso)
    expect(age().getAttribute('title')).toBe(iso)
  }

  it('fresh: "read 4 min ago"', () => {
    render(<ReadAge state="fresh" readAt="2026-10-29T11:56:00Z" now={now} />)
    expect(age().textContent).toBe('read 4 min ago')
    expect(age().className).toBe('age')
    isTime('2026-10-29T11:56:00Z')
  })

  it('aged: the clock glyph, in mute', () => {
    render(<ReadAge state="aged" readAt="2026-10-29T11:22:00Z" now={now} />)
    expect(age().textContent).toBe('read 38 min ago')
    expect(age().classList.contains('age-aged')).toBe(true)
    expect(age().querySelector('svg')!.outerHTML).toBe(glyph('clock'))
    expect(body('.age-aged')).toMatch(/color: var\(--mute\);/)
    isTime('2026-10-29T11:22:00Z')
  })

  it('failed: the alert glyph, in clay, "couldn’t read · last 2 h ago"', () => {
    render(<ReadAge state="failed" readAt="2026-10-29T11:58:00Z" lastGood="2026-10-29T10:00:00Z" now={now} />)
    expect(age().textContent).toBe('couldn’t read · last 2 h ago')
    expect(age().classList.contains('age-failed')).toBe(true)
    expect(age().querySelector('svg')!.outerHTML).toBe(glyph('alert'))
    expect(body('.age-failed')).toMatch(/color: var\(--attn\);/)
    isTime('2026-10-29T10:00:00Z') // the time it names is the last good read
  })

  it('failed with no last good read: "not read yet · couldn’t read"', () => {
    render(<ReadAge state="failed" readAt="2026-10-29T11:58:00Z" lastGood={null} now={now} />)
    expect(age().textContent).toBe('not read yet · couldn’t read')
    expect(age().classList.contains('age-failed')).toBe(true)
    isTime('2026-10-29T11:58:00Z') // the attempt that failed
  })

  it('reading: the spinner and "reading…"', () => {
    render(<ReadAge state="reading" readAt="2026-10-29T11:56:00Z" now={now} />)
    expect(age().textContent).toBe('reading…')
    expect(age().querySelector('.spin')!.getAttribute('aria-hidden')).toBe('true')
    isTime('2026-10-29T11:56:00Z')
  })

  it('unknown: "not read yet", faint; with no time to name it is not a <time>', () => {
    render(<ReadAge state="unknown" readAt={null} now={now} />)
    expect(age().textContent).toBe('not read yet')
    expect(age().tagName).toBe('SPAN')
    expect(age().hasAttribute('title')).toBe(false)
    expect(body('.age')).toMatch(/color: var\(--faint\);/)
  })

  it('a fresh or aged state with no time says "not read yet", never "read  ago"', () => {
    render(<><ReadAge state="fresh" readAt={null} now={now} /><ReadAge state="aged" readAt="not a date" now={now} /></>)
    expect([...document.querySelectorAll('.age')].map(a => a.textContent)).toEqual(['not read yet', 'not read yet'])
  })

  it('says a read across years with its year', () => {
    render(<ReadAge state="aged" readAt="2025-10-28T08:00:00Z" now={now} />)
    expect(age().textContent).toBe('read 28 Oct 2025')
  })
})
