// @vitest-environment jsdom
// DAO-OS L7 Task 18: the account-step card — a deployment step signed by any account from its own wallet (L7-D5).
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import { AccountStep, SIGN_IT_YOURSELF } from './AccountStep.tsx'
import { DEPLOY_FACTORY, DEPLOY_RESOLVER, STEP_GATE_READY, STEP_REGISTER } from '../../test/fixtures/house/deploy.ts'

const live = () => screen.getByTestId('live').textContent
const settle = () => act(async () => { await Promise.resolve() })
let writeText: ReturnType<typeof vi.fn>
function clipboard(impl: (text: string) => Promise<void>) {
  writeText = vi.fn(impl)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}
beforeEach(() => clipboard(async () => {}))
afterEach(() => { Reflect.deleteProperty(navigator, 'clipboard') })

describe('AccountStep (L7 Task 18)', () => {
  it('draws the step: its title, the chain chip, the to address chip, the value, the data in Mono, and the line the Hub always says', () => {
    renderAt(<AccountStep step={STEP_GATE_READY} />)
    const card = screen.getByRole('region', { name: 'Deploy the Hats Signer Gate' })
    expect(card.querySelector('.ptx-t')!.textContent).toBe('Deploy the Hats Signer Gate')
    expect(card.querySelector('.ptx-end .chain')!.textContent).toBe('Sepolia · test')
    expect(card.querySelector(`.addr[title*="${DEPLOY_FACTORY}"]`)).toBeTruthy()
    const well = card.querySelector('.ptx-well')!
    expect([...well.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['chain', 'to', 'value', 'data'])
    expect([...well.querySelectorAll('dd')].map(d => d.textContent)).toEqual(['eip155:11155111 · chain id 11155111', DEPLOY_FACTORY, '0', STEP_GATE_READY.step!.call.data])
    expect(card.querySelector('.ptx-never')!.textContent).toBe(SIGN_IT_YOURSELF)
    expect(SIGN_IT_YOURSELF).toBe('Sign this from your own wallet. The Hub never signs.')
    expect(card.querySelector('.ptx-ct')!.textContent).toBe('Deploy the Hats Signer Gate for Test DAO Safe through the module factory')
  })

  it('opens `to` on the explorer in a new tab, never as the page’s primary', () => {
    renderAt(<AccountStep step={STEP_GATE_READY} />)
    const open = screen.getByRole('link', { name: /^Open 0x0000…00f1 on the explorer/ })
    expect(open.getAttribute('href')).toBe(STEP_GATE_READY.link)
    expect(open.getAttribute('target')).toBe('_blank')
    expect(open.className).not.toContain('primary')
  })

  it('step 9 names the resolver it signs to and says whose account must sign', () => {
    renderAt(<AccountStep step={STEP_REGISTER} />)
    const card = screen.getByRole('region', { name: 'Register the daoURI' })
    expect(card.querySelector('.ptx-ct')!.textContent).toContain('Your account must own test-dao.eth')
    expect(card.querySelector(`.addr[title*="${DEPLOY_RESOLVER}"]`)).toBeTruthy()
    // M-3: who signs, said from the step as the page's row says it: the name's owner, not any account
    expect(card.querySelector('.ptx-s')!.textContent).toBe('The ENS name’s owner, from their own wallet')
  })

  it('any other account step says any account signs it', () => {
    renderAt(<AccountStep step={STEP_GATE_READY} />)
    expect(screen.getByRole('region', { name: 'Deploy the Hats Signer Gate' }).querySelector('.ptx-s')!.textContent).toBe('Any account signs it, from its own wallet')
  })

  it('Copy data writes the call data and says so in the polite region', async () => {
    renderAt(<AccountStep step={STEP_GATE_READY} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy data' }))
    await settle()
    expect(writeText).toHaveBeenCalledWith(STEP_GATE_READY.step!.call.data)
    expect(live()).toBe('Copied the data.')
  })

  it('a refused clipboard shows the data selected, and says how to copy it', async () => {
    clipboard(async () => { throw new DOMException('denied', 'NotAllowedError') })
    renderAt(<AccountStep step={STEP_GATE_READY} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy data' }))
    await settle()
    expect(live()).toBe('Couldn’t copy. Select the data and copy it.')
    expect(document.querySelector('.ptx-sel')!.textContent).toBe(STEP_GATE_READY.step!.call.data)
  })

  it('draws nothing for a step with no call (one that waits, or the Snapshot space)', () => {
    const { container } = renderAt(<AccountStep step={{ ...STEP_GATE_READY, status: 'waits', step: undefined }} />)
    expect(container.querySelector('.ptx')).toBeNull()
  })
})
