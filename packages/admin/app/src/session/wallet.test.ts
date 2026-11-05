// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeAddress } from '../elements/atoms/chain.ts'
import { WALLET_METHODS, askWallet, findProvider, requestAddress, signText, NO_ADDRESS, type Eip1193 } from './wallet.ts'

const ADDRESS = fakeAddress(4)

/** A provider that records what it is asked and answers from `answers`. */
function provider(answers: Record<string, unknown> = {}) {
  const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }) => answers[method])
  return { request } satisfies Eip1193
}

afterEach(() => {
  delete (window as { ethereum?: unknown }).ethereum
})

describe('the wallet module (L5 spec §4.5)', () => {
  it('pins the four methods it may call', () => {
    expect(WALLET_METHODS).toEqual(['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'personal_sign'])
  })

  it.each(['eth_sendTransaction', 'eth_signTypedData_v4', 'eth_sign', 'wallet_switchEthereumChain', 'eth_sendRawTransaction'])(
    'throws before calling the provider for %s', async (method) => {
      const p = provider()
      await expect(askWallet(p, method)).rejects.toThrow(method)
      expect(p.request).not.toHaveBeenCalled()
    })

  it('passes a method of the four through to the provider, with its params', async () => {
    const p = provider({ eth_chainId: '0xa4ec' })
    expect(await askWallet(p, 'eth_chainId')).toBe('0xa4ec')
    expect(p.request).toHaveBeenCalledWith({ method: 'eth_chainId' })
  })

  it('asks the provider only through askWallet: wallet.ts calls request( once, and no other file under app/src does', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    expect(readFileSync(join(here, 'wallet.ts'), 'utf8').match(/\.request\(/g)).toHaveLength(1)
    const src = join(here, '..') + sep
    const files = filesUnder(src).filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(join('session', 'wallet.ts')))
    expect(files.filter(f => /\.request\(\s*\{\s*method/.test(readFileSync(f, 'utf8'))).map(f => f.slice(src.length))).toEqual([])
  })

  it('finds an EIP-6963 announced provider first, before window.ethereum', async () => {
    const announced = provider()
    const injected = provider()
    ;(window as { ethereum?: unknown }).ethereum = injected
    const answer = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: '00000000-0000-4000-8000-000000000001', name: 'Fixture Wallet', icon: 'data:image/svg+xml,<svg/>', rdns: 'org.example.wallet' }, provider: announced },
    }))
    window.addEventListener('eip6963:requestProvider', answer)
    try {
      expect(await findProvider()).toBe(announced)
    } finally { window.removeEventListener('eip6963:requestProvider', answer) }
  })

  it('falls back to window.ethereum when nothing announces itself', async () => {
    const injected = provider()
    ;(window as { ethereum?: unknown }).ethereum = injected
    expect(await findProvider()).toBe(injected)
  })

  it('finds nothing in a browser without a wallet', async () => {
    expect(await findProvider()).toBeNull()
  })

  it('requestAddress asks eth_requestAccounts and gives the first address', async () => {
    const p = provider({ eth_requestAccounts: [ADDRESS, fakeAddress(5)] })
    expect(await requestAddress(p)).toBe(ADDRESS)
    expect(p.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })

  it('requestAddress refuses an empty answer, or one that is not an address, in words', async () => {
    await expect(requestAddress(provider({ eth_requestAccounts: [] }))).rejects.toThrow(NO_ADDRESS)
    await expect(requestAddress(provider({ eth_requestAccounts: ['0x1234'] }))).rejects.toThrow(NO_ADDRESS)
  })

  it('signText asks personal_sign with the text as UTF-8 hex and the address, and gives the signature', async () => {
    const signature = '0x' + 'ab'.repeat(65)
    const p = provider({ personal_sign: signature })
    expect(await signText(p, 'Hi ✓', ADDRESS)).toBe(signature)
    expect(p.request).toHaveBeenCalledWith({ method: 'personal_sign', params: ['0x486920e29c93', ADDRESS] })
  })
})

const src = join(dirname(fileURLToPath(import.meta.url)), '..') + sep
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(e => { const p = join(dir, e); return statSync(p).isDirectory() ? filesUnder(p) : [p] })
}

describe('no eth_send in app/src', () => {
  it('finds eth_send nowhere under app/src but this test', () => {
    const files = filesUnder(src).filter(f => !/\.(woff2?|png|jpe?g|webp|gif|ico)$/.test(f))
    expect(files.length).toBeGreaterThan(100)
    const self = fileURLToPath(import.meta.url)
    const hits = files.filter(f => f !== self && /eth_send/.test(readFileSync(f, 'utf8'))).map(f => f.slice(src.length))
    expect(hits).toEqual([])
    expect(readFileSync(self, 'utf8')).toMatch(/eth_send/) // the scan can find it
  })
})
