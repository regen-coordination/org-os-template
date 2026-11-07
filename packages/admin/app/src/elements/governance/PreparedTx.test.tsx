// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { renderAt } from '../../test/render.tsx'
import { ViewAsProvider } from '../../viewAs/ViewAs.tsx'
import { Icon, type IconName } from '../../design/Icon.tsx'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { EXECUTED_TX_HASH, PREPARED_IN, PREPARED_RETURN } from '../../test/fixtures/house/governance.ts'
import { PreparedTx } from './PreparedTx.tsx'
import { payloadJson, type PreparedView } from './prepared.ts'

const NOW = FIXED_NOW
const FOOT = 'The Hub never signs. Signers review and sign this in the Safe app.'
/** §9.6's nine drawn states, as the fixtures name them (a failed read lays over the state it keeps). */
const STATES = ['preparing', 'unsigned', 'partly-signed', 'ready', 'executed', 'mismatch', 'replaced', 'stale', 'read-failed']
const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ')
const glyph = (name: IconName) => renderAt(<Icon name={name} />).container.querySelector('svg')!.innerHTML
const live = () => screen.getByTestId('live').textContent
const settle = () => act(async () => { await Promise.resolve() })

let writeText: ReturnType<typeof vi.fn>
function clipboard(impl: (text: string) => Promise<void>) {
  writeText = vi.fn(impl)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}
beforeEach(() => clipboard(async () => {}))
afterEach(() => { Reflect.deleteProperty(navigator, 'clipboard') })

function draw(ui: ReactElement, preview = false) {
  return renderAt(preview ? <ViewAsProvider initial={{ as: 'public' }}>{ui}</ViewAsProvider> : ui)
}
const card = (tx: PreparedView, extra: { onPrepareAgain?: () => void } = {}) => {
  const { container } = draw(<PreparedTx tx={tx} now={NOW} {...extra} />)
  return container.querySelector<HTMLElement>('.ptx')!
}
const head = (el: HTMLElement) => ({
  title: el.querySelector('.ptx-t')!.textContent, sub: plain(el.querySelector('.ptx-s')!.textContent), end: el.querySelector('.ptx-end')!,
})

describe('PreparedTx (§9.6)', () => {
  it('every state keeps the foot line: the house never signs', () => {
    expect(Object.keys(PREPARED_IN)).toEqual(expect.arrayContaining(STATES))
    for (const state of STATES) {
      const { container, unmount } = draw(<PreparedTx tx={PREPARED_IN[state]!} now={NOW} />)
      expect(container.querySelector('.ptx-never')!.textContent, state).toBe(FOOT)
      unmount()
    }
  })

  it('is a labelled region on a raised card, named by its head', () => {
    const el = card(PREPARED_RETURN)
    expect(screen.getByRole('region', { name: 'Prepared transaction' })).toBe(el)
  })

  it('partly signed: the layers tile, "Treasury Safe · nonce 18" (the nonce in Mono), the chain chip and the meter "2 of 4 signed"', () => {
    const el = card(PREPARED_RETURN)
    const h = head(el)
    expect(h.title).toBe('Prepared transaction')
    expect(h.sub).toBe('Treasury Safe · nonce 18')
    expect(el.querySelector('.ptx-s .mono')!.textContent).toBe('nonce 18')
    expect(el.querySelector('.ptx-h .ktile svg')!.innerHTML).toBe(glyph('layers'))
    expect(h.end.querySelector('.chain')!.textContent).toBe('Celo')
    expect(h.end.querySelectorAll('.meter > i.on')).toHaveLength(2)
    expect(h.end.querySelector('.meter-l')!.textContent).toBe('2 of 4 signed')
  })

  it('preparing: the reading ring and "Reading the nonce from the Safe…"; nothing to copy or open yet', () => {
    const el = card(PREPARED_IN.preparing!)
    const h = head(el)
    expect(h.title).toBe('Preparing')
    expect(h.sub).toBe('Reading the nonce from the Safe…')
    expect(el.querySelector('.ptx-s .spin')).not.toBeNull()
    expect(el.querySelector('details')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy payload' })).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('unsigned: "0 of 4 signed"', () => {
    expect(head(card(PREPARED_IN.unsigned!)).end.querySelector('.meter-l')!.textContent).toBe('0 of 4 signed')
  })

  it('ready: "4 of 4 signed · any signer can execute it in the Safe", and the open mark "Not executed"', () => {
    const h = head(card(PREPARED_IN.ready!))
    expect(h.title).toBe('Ready to execute')
    expect(h.sub).toBe('4 of 4 signed · any signer can execute it in the Safe')
    expect(h.end.querySelector('.smark-open .smark-word')!.textContent).toBe('Not executed')
  })

  it('executed: the moss tile with the check, "matched what was prepared", and the moss strip with the block, the age and the tx hash chip', () => {
    const el = card(PREPARED_IN.executed!)
    const h = head(el)
    expect(h.title).toBe('Executed and read back')
    expect(h.sub).toBe('nonce 18 · matched what was prepared')
    expect(el.querySelector('.ptx-h .ktile')!.classList.contains('ktile-moss')).toBe(true)
    expect(el.querySelector('.ptx-h .ktile svg')!.innerHTML).toBe(glyph('check'))
    expect(h.end.querySelector('.smark-done .smark-word')!.textContent).toBe('Done')
    const strip = el.querySelector('.ptx-out')!
    expect(strip.classList.contains('ptx-out-bad')).toBe(false)
    expect(plain(strip.querySelector('.ptx-out-t')!.textContent)).toBe('Executed on Celo · block 31,204,118 · read back 2 min ago')
    const chip = within(strip as HTMLElement).getByRole('button', { name: 'Copy 0x9e4b…1c07' })
    expect(chip.getAttribute('title')).toBe(EXECUTED_TX_HASH)
  })

  it('executed, and the transaction failed: the clay strip says nothing moved', () => {
    const el = card(PREPARED_IN['executed-failed']!)
    expect(el.querySelector('.ptx-h .ktile')!.classList.contains('ktile-attn')).toBe(true)
    expect(head(el).end.querySelector('.smark-failed .smark-word')!.textContent).toBe('Failed')
    const strip = el.querySelector('.ptx-out')!
    expect(strip.classList.contains('ptx-out-bad')).toBe(true)
    expect(strip.textContent).toBe('Executed on Celo, and the transaction failed. Nothing it would have moved has moved.')
  })

  it('mismatch: the clay strip says what differs from what was prepared', () => {
    const el = card(PREPARED_IN.mismatch!)
    expect(head(el).title).toBe('Not what was prepared')
    const strip = el.querySelector('.ptx-out')!
    expect(strip.classList.contains('ptx-out-bad')).toBe(true)
    expect(strip.textContent).toBe('Not the transaction the proposal prepared: its data differs.')
  })

  it('replaced: "Nonce 18 was used by another transaction. Nothing from this proposal ran." and Prepare again; nothing to copy or open', () => {
    const again = vi.fn()
    const el = card(PREPARED_IN.replaced!, { onPrepareAgain: again })
    const h = head(el)
    expect(h.title).toBe('Nonce 18 was used by another transaction')
    expect(h.sub).toBe('Nothing from this proposal ran.')
    expect(el.querySelector('.ptx-h .ktile')!.classList.contains('ktile-attn')).toBe(true)
    fireEvent.click(within(h.end as HTMLElement).getByRole('button', { name: 'Prepare again' }))
    expect(again).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Copy payload' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Open in Safe/ })).toBeNull()
    expect(el.querySelector('.ptx-never')!.textContent).toBe(FOOT)
  })

  it('Prepare again is a write: not drawn while previewing, nor without an action', () => {
    const { unmount } = draw(<PreparedTx tx={PREPARED_IN.replaced!} now={NOW} onPrepareAgain={() => {}} />, true)
    expect(screen.queryByRole('button', { name: 'Prepare again' })).toBeNull()
    unmount()
    card(PREPARED_IN.replaced!)
    expect(screen.queryByRole('button', { name: 'Prepare again' })).toBeNull()
  })

  it('stale: the clay clock tile, "The proposal changed after this was prepared. Rev 3 is current; this payload is from rev 2." and the stale mark', () => {
    const el = card(PREPARED_IN.stale!)
    const h = head(el)
    expect(h.title).toBe('The proposal changed after this was prepared')
    expect(h.sub).toBe('Rev 3 is current; this payload is from rev 2.')
    expect(el.querySelector('.ptx-h .ktile svg')!.innerHTML).toBe(glyph('clock'))
    expect(h.end.querySelector('.smark-stale .smark-word')!.textContent).toBe('Stale')
    expect(screen.queryByRole('button', { name: 'Copy payload' })).toBeNull()
  })

  it('read failed: the card keeps its last state; the meter is mute, with the failed age', () => {
    const el = card(PREPARED_IN['read-failed']!)
    const h = head(el)
    expect(h.title).toBe('Prepared transaction')
    expect(h.end.querySelector('.ptx-mute .meter-l')!.textContent).toBe('2 of 4 signed')
    expect(plain(el.querySelector('.ptx-s .age-failed')!.textContent)).toBe('couldn’t read · last 12 min ago')
    expect(card(PREPARED_RETURN).querySelector('.ptx-mute, .age-failed')).toBeNull()
  })

  it('read failed after a mismatch, an execution or a ready count: that state\'s head and strip stay, with the failed age (fix I-1)', () => {
    const failed = (name: string) => card({ ...PREPARED_IN[name]!, readFailed: true, failedAge: PREPARED_IN['read-failed']!.failedAge! })
    const age = (el: HTMLElement) => plain(el.querySelector('.ptx-s .age-failed')!.textContent)
    const mismatch = failed('mismatch')
    expect(head(mismatch).title).toBe('Not what was prepared')
    expect(mismatch.querySelector('.ptx-out.ptx-out-bad')!.textContent).toBe('Not the transaction the proposal prepared: its data differs.')
    expect(age(mismatch)).toBe('couldn’t read · last 12 min ago')
    const executed = failed('executed')
    expect(head(executed).title).toBe('Executed and read back')
    expect(executed.querySelector('.smark-done')).not.toBeNull()
    expect(executed.querySelector('.ptx-out:not(.ptx-out-bad)')).not.toBeNull()
    expect(age(executed)).toBe('couldn’t read · last 12 min ago')
    const ready = failed('ready')
    expect(head(ready).title).toBe('Ready to execute')
    expect(head(ready).sub).toBe('4 of 4 signed · any signer can execute it in the Safecouldn’t read · last 12 min ago')
    expect(ready.querySelector('.smark-open')).not.toBeNull()
  })

  it('calls are numbered, "from <chip> to <chip>", the amount at the end', () => {
    const el = card(PREPARED_RETURN)
    const calls = [...el.querySelectorAll<HTMLElement>('ol.ptx-calls > li.ptx-call')]
    expect(calls.map(c => c.querySelector('.ptx-n')!.textContent)).toEqual(['1', '2'])
    expect(calls[0]!.querySelector('.ptx-ct')!.textContent).toBe('Return Network Projects to the Safe')
    const line = calls[0]!.querySelector<HTMLElement>('.ptx-cs')!
    expect(line.firstChild!.textContent).toBe('from ')
    const chips = within(line).getAllByRole('button')
    expect(chips.map(c => c.getAttribute('aria-label'))).toEqual([`Copy address ${chips[0]!.textContent}`, 'Copy address 0x6AFF…343a'])
    expect(chips[1]!.getAttribute('title')).toBe('eip155:42220:0x6AFFe5105DE869fE4A27b3353468eFb51a55343a')
    expect(plain(calls[0]!.lastElementChild!.textContent)).toBe('1,271.00 USDGLO')
    expect(calls[0]!.lastElementChild!.classList.contains('amt')).toBe(true)
  })

  it('the total sits in a sunken strip: "Back to the treasury · 3,100.00 USDGLO", exact (L4b-M5-b)', () => {
    const total = card(PREPARED_RETURN).querySelector('.ptx-total')!
    expect(total.querySelector('.ptx-total-w')!.textContent).toBe('Back to the treasury')
    expect(plain(total.querySelector('.amt')!.textContent)).toBe('3,100.00 USDGLO')
  })

  it('the payload is a <details>, closed, with to (and the contract\'s name), value, operation, data and safeTxHash', () => {
    const el = card(PREPARED_RETURN)
    const details = el.querySelector('details.ptx-payload')!
    expect(details.hasAttribute('open')).toBe(false)
    expect(details.querySelector('summary')!.textContent).toBe('Payload')
    const pairs = [...details.querySelectorAll('dl.ptx-well > dt')].map(dt => [dt.textContent, dt.nextElementSibling!.textContent])
    const p = PREPARED_RETURN.payload
    expect(pairs).toEqual([['to', `${p.to} (MultiSend)`], ['value', '0'], ['operation', '1 · delegatecall'], ['data', p.data], ['safeTxHash', p.safeTxHash]])
  })

  it('a payload the ledger keeps only the hash of says "data hash"', () => {
    const tx = { ...PREPARED_RETURN, payload: { to: PREPARED_RETURN.payload.to, value: '0', operation: 0 as const, dataHash: `0x${'0'.repeat(64)}`, safeTxHash: '0x1' } }
    const dts = [...card(tx).querySelectorAll('dl.ptx-well > dt')].map(dt => [dt.textContent, dt.nextElementSibling!.textContent])
    expect(dts).toEqual([['to', tx.payload.to], ['value', '0'], ['operation', '0 · call'], ['data hash', tx.payload.dataHash], ['safeTxHash', '0x1']])
  })

  it('Copy payload copies the payload as JSON and says so', async () => {
    card(PREPARED_RETURN)
    fireEvent.click(screen.getByRole('button', { name: 'Copy payload' }))
    await settle()
    expect(writeText).toHaveBeenCalledWith(payloadJson(PREPARED_RETURN))
    expect(live()).toBe('Copied the payload.')
    expect(document.querySelector('.ptx-sel')).toBeNull()
  })

  it('a refused clipboard: no copied state, the sentence is announced, and the JSON is shown selected', async () => {
    clipboard(async () => { throw new DOMException('denied', 'NotAllowedError') })
    card(PREPARED_RETURN)
    fireEvent.click(screen.getByRole('button', { name: 'Copy payload' }))
    await settle()
    expect(live()).toBe('Couldn’t copy. Select the payload and copy it.')
    const shown = document.querySelector('.ptx-sel')!
    expect(shown.textContent).toBe(payloadJson(PREPARED_RETURN))
    expect(window.getSelection()?.toString()).toBe(payloadJson(PREPARED_RETURN))
    expect(screen.getByRole('button', { name: 'Copy payload' }).textContent).toBe('Copy payload') // no copied state: the button reads as before
  })

  it('Open in Safe ↗ is the primary link, and names a new tab', () => {
    card(PREPARED_RETURN)
    const open = screen.getByRole('link', { name: 'Open in Safe (opens in a new tab)' })
    expect(open.getAttribute('href')).toBe(PREPARED_RETURN.openHref)
    expect(open.getAttribute('target')).toBe('_blank')
    expect(open.classList.contains('primary')).toBe(true)
  })

  it('an 18-decimal value is exact: 1234567890123456789012 base units read 1,234.567890123456789012 (L4b-M5)', () => {
    const tx = { ...PREPARED_RETURN, calls: [{ ...PREPARED_RETURN.calls[0]!, amount: { raw: '1234567890123456789012', unit: 'USDGLO', decimals: 18 } }] }
    const el = card(tx)
    expect(plain(el.querySelector('.ptx-call .amt')!.textContent)).toBe('1,234.567890123456789012 USDGLO')
    expect(plain(el.querySelector('.ptx-total .amt')!.textContent)).toBe('1,234.567890123456789012 USDGLO')
  })

  it('every amount on the card is exact: one base unit of CELO, and a total of 3,100.125 USDGLO, never rounded (L4b-M5)', () => {
    const wei = card({ ...PREPARED_RETURN, calls: [{ ...PREPARED_RETURN.calls[0]!, amount: { raw: '1', unit: 'CELO', decimals: 18 } }] })
    expect(plain(wei.querySelector('.ptx-call .amt')!.textContent)).toBe('0.000000000000000001 CELO')
    expect(plain(wei.querySelector('.ptx-total .amt')!.textContent)).toBe('0.000000000000000001 CELO')
    const odd = [{ ...PREPARED_RETURN.calls[0]!, amount: { raw: '1271125000000000000000', unit: 'USDGLO', decimals: 18 } }, PREPARED_RETURN.calls[1]!]
    const el = card({ ...PREPARED_RETURN, calls: odd })
    expect([...el.querySelectorAll('.ptx-call .amt')].map(a => plain(a.textContent))).toEqual(['1,271.125 USDGLO', '1,829.00 USDGLO'])
    expect(plain(el.querySelector('.ptx-total .amt')!.textContent)).toBe('3,100.125 USDGLO')
  })

  it('thirty calls: numbered 1 to 30, each with its amount, the total their exact sum', () => {
    const calls = Array.from({ length: 30 }, (_, i) => ({ ...PREPARED_RETURN.calls[0]!, title: `Call ${i + 1}`, amount: { raw: `${i + 1}000000000000000000`, unit: 'USDGLO', decimals: 18 } }))
    const el = card({ ...PREPARED_RETURN, calls })
    const items = [...el.querySelectorAll('ol.ptx-calls > li.ptx-call')]
    expect(items).toHaveLength(30)
    expect(items.map(li => li.querySelector('.ptx-n')!.textContent)).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)))
    expect(plain(items[29]!.querySelector('.amt')!.textContent)).toBe('30.00 USDGLO')
    expect(plain(el.querySelector('.ptx-total .amt')!.textContent)).toBe('465.00 USDGLO')
  })

  it('an amount above 2^53 keeps every digit, in the call and in the total', () => {
    const big = { raw: '9007199254740993000000000000000001', unit: 'USDGLO', decimals: 18 }
    const el = card({ ...PREPARED_RETURN, calls: [{ ...PREPARED_RETURN.calls[0]!, amount: big }] })
    expect(plain(el.querySelector('.ptx-call .amt')!.textContent)).toBe('9,007,199,254,740,993.000000000000000001 USDGLO')
    expect(plain(el.querySelector('.ptx-total .amt')!.textContent)).toBe('9,007,199,254,740,993.000000000000000001 USDGLO')
  })

  it('no calls says "No calls", and draws no total', () => {
    const el = card({ ...PREPARED_RETURN, calls: [] })
    expect(el.querySelector('.ptx-none')!.textContent).toBe('No calls')
    expect(el.querySelector('.ptx-calls')).toBeNull()
    expect(el.querySelector('.ptx-total')).toBeNull()
  })

  it('brief: the head, its strip and the never-signs line, as /parts draws the other states', () => {
    const { container } = draw(<PreparedTx tx={PREPARED_IN.executed!} now={NOW} brief />)
    const el = container.querySelector('.ptx')!
    expect(el.classList.contains('ptx-brief')).toBe(true)
    expect(el.querySelector('.ptx-h')).not.toBeNull()
    expect(el.querySelector('.ptx-out')).not.toBeNull()
    expect(el.querySelector('.ptx-foot .ptx-never')!.textContent).toBe(FOOT)
    for (const part of ['.ptx-calls', '.ptx-total', '.ptx-payload', '.ptx-acts']) expect(el.querySelector(part), part).toBeNull()
  })
})
