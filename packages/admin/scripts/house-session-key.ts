// The session key, from the command line (Lane 3 Task 12, I5):
//
//   npm run -s house:session-key -- new                 a private Ed25519 JWK on stdout, one line
//   <a private JWK on stdin> | npm run -s house:session-key -- public   its public JWK on stdout, one line
//
// The house signs each sign-in's I5 token with the private key (`HOUSE_SESSION_PRIVATE_JWK`); the org's sites verify it
// with the public one (`HOUSE_SESSION_PUBLIC_JWK`) without asking the house. `new` writes the key and nothing else, so its
// output can go straight into a secret store; the private key is read on stdin only, never from a file or an argument.
// Nothing said on stderr repeats what was read.
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export interface Io {
  /** The whole of stdin, as text. Asked only by `public`. */
  stdin: () => Promise<string>
  out: (text: string) => void
  err: (text: string) => void
}

const USAGE = 'Use: npm run -s house:session-key -- new (a private key on stdout), or <a private key> | npm run -s house:session-key -- public.'
const NOT_KEY = 'What came on stdin is not a private Ed25519 JWK ({"kty":"OKP","crv":"Ed25519","d":…}); nothing was written.'
const NOT_ITS_OWN = 'The private JWK on stdin names an "x" that is not its own public key; nothing was written.'
/** stdin is refused past this: a JWK is under 200 bytes. */
const MAX_BYTES = 16 * 1024

/** A private Ed25519 JWK: `kty`, `crv`, `d` and `x`, nothing more. */
export function newPrivateJwk(): JsonWebKey {
  const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
  return { kty: 'OKP', crv: 'Ed25519', d: jwk.d!, x: jwk.x! }
}

/** The public JWK of a private one (`d` dropped), or the sentence that says why there is none. */
export function publicJwkOf(text: string): JsonWebKey | { refuse: string } {
  let jwk: JsonWebKey
  try { jwk = JSON.parse(text) as JsonWebKey } catch { return { refuse: NOT_KEY } }
  if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.d !== 'string') return { refuse: NOT_KEY }
  let x: string
  try {
    const priv = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: jwk.d, x: jwk.x ?? '' } as never, format: 'jwk' })
    x = createPublicKey(priv).export({ format: 'jwk' }).x!
  } catch { return { refuse: NOT_KEY } }
  if (jwk.x !== undefined && jwk.x !== x) return { refuse: NOT_ITS_OWN }
  return { kty: 'OKP', crv: 'Ed25519', x }
}

/** Runs one verb; answers the exit code. */
export async function main(argv: string[], io: Io): Promise<number> {
  if (argv.length !== 1 || (argv[0] !== 'new' && argv[0] !== 'public')) { io.err(USAGE); return 1 }
  if (argv[0] === 'new') { io.out(JSON.stringify(newPrivateJwk())); return 0 }
  const text = await io.stdin()
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) { io.err(NOT_KEY); return 1 }
  const pub = publicJwkOf(text.trim())
  if ('refuse' in pub) { io.err(pub.refuse); return 1 }
  io.out(JSON.stringify(pub))
  return 0
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), { stdin: readStdin, out: t => process.stdout.write(`${t}\n`), err: t => console.error(t) })
}
