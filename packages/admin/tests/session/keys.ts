import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'

// Test signing keys (L5 spec §17): made per test, never committed as anything but test data under tests/. Keys and
// signatures apart from lib/siwe.mjs: EIP-191 hashed with @noble/hashes, signed with @noble/curves. Nothing is sent on
// chain; the house under test only recovers the address from a signature.

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

function eip55(lower40: string): string {
  const h = hex(keccak_256(Buffer.from(lower40)))
  let out = '0x'
  for (let i = 0; i < 40; i++) out += parseInt(h[i]!, 16) >= 8 ? lower40[i]!.toUpperCase() : lower40[i]
  return out
}

/** The EIP-55 address of a secret key. */
export const addressOfKey = (sk: Uint8Array) => eip55(hex(keccak_256(secp256k1.getPublicKey(sk, false).slice(1)).slice(12)))

/** An EIP-191 `personal_sign` signature of `text`: r, s, then v (27 or 28). */
export function sign(sk: Uint8Array, text: string): string {
  const body = Buffer.from(text, 'utf8')
  const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`), body]))
  const raw = secp256k1.sign(hash, sk, { prehash: false, format: 'recovered' }) // recovery byte first
  return '0x' + hex(raw.slice(1)) + (raw[0]! + 27).toString(16)
}

/** A fresh random secret key. */
export const key = () => secp256k1.utils.randomSecretKey()
