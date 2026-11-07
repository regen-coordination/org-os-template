import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes,
  type KeyObject,
} from 'node:crypto'

/** The private store's backups are sealed with AES-256-GCM under a maintainer's key (L5 spec §10.4, Q3). A sealed
 *  file is `ORGOSPS1`, a 12-byte IV, the ciphertext, and the 16-byte GCM tag; the magic is also the tag's additional
 *  data, so a file that claims to be another format fails as damaged. The key is 32 random bytes in a file of its
 *  own, mode 600, kept away from the server (outside the repository and the store's folder). */

export const MAGIC = Buffer.from('ORGOSPS1', 'latin1')
/** A backup sealed to a maintainer's X25519 public key (L9 spec §7.1, Q-L9-2): `ORGOSPK1`, the 32-byte ephemeral public
 *  key, a 12-byte IV, the ciphertext and the 16-byte tag. The AES-256-GCM key is HKDF-SHA256 over the ECDH secret, salt
 *  ephemeral ‖ recipient (raw, 32 bytes each), info `HKDF_INFO`; the magic is the additional data. The server holds only
 *  the public key, so it can seal its backups and never open them. */
export const MAGIC_PK = Buffer.from('ORGOSPK1', 'latin1')
export const HKDF_INFO = 'org-os private store backup v1'
const RAW_KEY = 32
export const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const HEAD = MAGIC.length + IV_BYTES

/** What a store file's first 16 bytes are: under the right key a sealed backup's first block opens to these. */
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1')

export const WRONG_KEY = 'This backup cannot be read with that key.'
export const DAMAGED = 'This backup has been changed or is damaged; it was not restored.'

/** A backup that cannot be opened, in the words to say. */
export class BackupUnreadable extends Error {
  constructor(message: string) { super(message); this.name = 'BackupUnreadable' }
}

/** Makes a key file: 32 random bytes, mode 600. Never replaces one: a key that backups were sealed with is the only
 *  way to read them. */
export function createKey(file: string): void {
  try { writeFileSync(file, randomBytes(KEY_BYTES), { mode: 0o600, flag: 'wx' }) } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`There is already a key at ${file}; it was left as it is.`)
    throw err
  }
  chmodSync(file, 0o600) // whatever the umask
}

/** The key in `file`, which must hold exactly 32 bytes. */
export function readKey(file: string): Buffer {
  let key: Buffer
  try { key = readFileSync(file) } catch (err) {
    throw new Error(`The key file ${file} could not be read: ${(err as Error).message}`)
  }
  if (key.length !== KEY_BYTES) throw new Error(`The key file ${file} holds ${key.length} bytes; a key is ${KEY_BYTES}. Make one with npm run house:backup:key -- <file>.`)
  return key
}

export function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(MAGIC)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()])
}

/** What opens a backup: L5's 32-byte symmetric key, or a maintainer's X25519 private key (PEM). */
export type OpeningKey = Buffer | { privateKeyPem: string }

/** The key in `file` that opens backups: a PEM file is read as a private key (whatever it holds: a public key there
 *  opens nothing, and says so as a wrong key), anything else as L5's 32-byte key file. */
export function readOpeningKey(file: string): OpeningKey {
  let bytes: Buffer
  try { bytes = readFileSync(file) } catch (err) {
    throw new Error(`The key file ${file} could not be read: ${(err as Error).message}`)
  }
  if (bytes.subarray(0, 11).toString('latin1') === '-----BEGIN ') return { privateKeyPem: bytes.toString('utf8') }
  return readKey(file)
}

/** Makes a maintainer's key pair (§7.1): X25519, both PEM; the private file mode 600. Never replaces either file: a key
 *  that backups were sealed to is the only way to read them. Made on a maintainer's machine, never on the server. */
export function createKeyPair(privateFile: string, publicFile: string): void {
  for (const f of [privateFile, publicFile]) if (existsSync(f)) throw new Error(`There is already a key at ${f}; it was left as it is.`)
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const write = (file: string, text: string, mode: number) => {
    try { writeFileSync(file, text, { mode, flag: 'wx' }) } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`There is already a key at ${file}; it was left as it is.`)
      throw err
    }
    chmodSync(file, mode) // whatever the umask
  }
  write(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 0o600)
  write(publicFile, publicKey.export({ type: 'spki', format: 'pem' }) as string, 0o644)
}

/** The sentence for a backup public key file that is not an X25519 public key (a private key is refused by name: the
 *  server must never hold what opens its backups), or null when it is one. A start check (§5.1) and `hub check`. */
export function publicKeyRefusal(file: string): string | null {
  let text: string
  try { text = readFileSync(file, 'utf8') } catch {
    return `The backup public key at ${file} could not be read. Mount the public key there, then start again.`
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    return `The backup public key at ${file} is a private key. Only the public key goes to the server; keep the private one on a maintainer's machine, then start again.`
  }
  try { if (createPublicKey(text).asymmetricKeyType === 'x25519') return null } catch { /* not a key */ }
  return `The backup public key at ${file} is not an X25519 public key. Make a key pair with npm run house:backup:keypair -- <private file> <public file>, then start again.`
}

/** The public key in `file`, as PEM; throws `publicKeyRefusal`'s sentence when it is not one. */
export function readPublicKey(file: string): string {
  const refused = publicKeyRefusal(file)
  if (refused) throw new Error(refused)
  return readFileSync(file, 'utf8')
}

const rawOf = (key: KeyObject): Buffer => Buffer.from(key.export({ format: 'jwk' }).x as string, 'base64url')
const x25519Public = (raw: Buffer): KeyObject =>
  createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: raw.toString('base64url') }, format: 'jwk' })
const hkdfKey = (secret: Buffer, ephemeral: Buffer, recipient: Buffer): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, Buffer.concat([ephemeral, recipient]), HKDF_INFO, KEY_BYTES))

/** Seals `plain` to the X25519 public key in `publicKeyPem` (§7.1, `ORGOSPK1`): an ephemeral key pair, ECDH, HKDF-SHA256
 *  and AES-256-GCM, all `node:crypto`. Only the matching private key opens it. */
export function sealTo(publicKeyPem: string, plain: Buffer): Buffer {
  const recipient = createPublicKey(publicKeyPem)
  if (recipient.asymmetricKeyType !== 'x25519') throw new Error('A backup is sealed to an X25519 public key; this key is not one.')
  const eph = generateKeyPairSync('x25519')
  const ephRaw = rawOf(eph.publicKey)
  const key = hkdfKey(diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), ephRaw, rawOf(recipient))
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(MAGIC_PK)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([MAGIC_PK, ephRaw, iv, body, cipher.getAuthTag()])
}

/** Opens a sealed file of either format, told apart by its magic: `ORGOSPS1` under L5's symmetric key, `ORGOSPK1` under
 *  a maintainer's private key. A key of the other kind is a wrong key. A file whose tag holds is opened, whatever else is
 *  said of it. Only when the tag fails is `intact` asked what is known of the file apart from the key: true when its
 *  manifest line's SHA-256 matches it, false when it does not, null when there is no line to compare with. GCM cannot
 *  tell a wrong key from a changed byte, so: a file known intact was sealed under another key; one known changed is
 *  damaged; with nothing known, a first block that opens to SQLite's header means the key is right and the file was
 *  changed after it. */
export function unseal(key: OpeningKey, sealed: Buffer, intact: () => boolean | null): Buffer {
  const magic = sealed.subarray(0, MAGIC.length)
  if (magic.equals(MAGIC_PK)) return unsealPk(key, sealed, intact)
  if (sealed.length < HEAD + TAG_BYTES || !magic.equals(MAGIC)) throw new BackupUnreadable(DAMAGED)
  if (!Buffer.isBuffer(key)) throw new BackupUnreadable(WRONG_KEY)
  return open(key, MAGIC, sealed.subarray(MAGIC.length, HEAD), sealed.subarray(HEAD, sealed.length - TAG_BYTES), sealed.subarray(sealed.length - TAG_BYTES), intact)
}

function unsealPk(key: OpeningKey, sealed: Buffer, intact: () => boolean | null): Buffer {
  const head = MAGIC_PK.length + RAW_KEY + IV_BYTES
  if (sealed.length < head + TAG_BYTES) throw new BackupUnreadable(DAMAGED)
  if (Buffer.isBuffer(key)) throw new BackupUnreadable(WRONG_KEY)
  let aes: Buffer
  try {
    const priv = createPrivateKey(key.privateKeyPem)
    const ephRaw = sealed.subarray(MAGIC_PK.length, MAGIC_PK.length + RAW_KEY)
    const secret = diffieHellman({ privateKey: priv, publicKey: x25519Public(ephRaw) })
    aes = hkdfKey(secret, ephRaw, rawOf(createPublicKey(priv)))
  } catch {
    // A public key, another kind of key, or text that is no key: it cannot open this file.
    throw new BackupUnreadable(WRONG_KEY)
  }
  const iv = sealed.subarray(MAGIC_PK.length + RAW_KEY, head)
  return open(aes, MAGIC_PK, iv, sealed.subarray(head, sealed.length - TAG_BYTES), sealed.subarray(sealed.length - TAG_BYTES), intact)
}

function open(key: Buffer, aad: Buffer, iv: Buffer, body: Buffer, tag: Buffer, intact: () => boolean | null): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(body), decipher.final()])
  } catch {
    const known = intact()
    if (known !== null) throw new BackupUnreadable(known ? WRONG_KEY : DAMAGED)
    // GCM's stream is CTR: the first block opens on its own, unauthenticated, and is only looked at.
    const first = createDecipheriv('aes-256-gcm', key, iv).update(body.subarray(0, SQLITE_HEADER.length))
    throw new BackupUnreadable(first.equals(SQLITE_HEADER) ? DAMAGED : WRONG_KEY)
  }
}
