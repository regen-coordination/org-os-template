import { str } from '../resources/util.ts'
import type { Driver } from './driver.ts'

/** `value` when it is an http or https address, else null: the only addresses that are passed on. */
export function httpAddress(value: unknown): string | null {
  const raw = str(value)
  if (!raw) return null
  try {
    const { protocol } = new URL(raw)
    return protocol === 'http:' || protocol === 'https:' ? raw : null
  } catch { return null }
}

/** A framed link-out: the address, and whether the page may show it in a frame. No reads. */
export const link: Driver = {
  name: 'link',
  hosts: [],
  async read(system, ctx) {
    const raw = str(system.url)
    if (!raw) throw new Error('this system has no url')
    let url: URL
    try { url = new URL(raw) } catch { throw new Error(`"${raw}" is not an address`) }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`only http and https addresses are opened, not ${url.protocol}`)
    return { ok: true, readAt: ctx.now().toISOString(), facts: { url: raw }, sections: [], open: { url: raw, embeddable: system.embeddable === true } }
  },
}
