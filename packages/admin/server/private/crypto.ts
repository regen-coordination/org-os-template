import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/** The private store's backups are sealed with AES-256-GCM under a maintainer's key (L5 spec §10.4, Q3). A sealed
 *  file is `ORGOSPS1`, a 12-byte IV, the ciphertext, and the 16-byte GCM tag; the magic is also the tag's additional
 *  data, so a file that claims to be another format fails as damaged. The key is 32 random bytes in a file of its
 *  own, mode 600, kept away from the server (outside the repository and the store's folder). */

export const MAGIC = Buffer.from('ORGOSPS1', 'latin1')
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

/** Opens a sealed file. A file whose tag holds is opened, whatever else is said of it. Only when the tag fails is
 *  `intact` asked what is known of the file apart from the key: true when its manifest line's SHA-256 matches it,
 *  false when it does not, null when there is no line to compare with. GCM cannot tell a wrong key from a changed
 *  byte, so: a file known intact was sealed under another key; one known changed is damaged; with nothing known, a
 *  first block that opens to SQLite's header means the key is right and the file was changed after it. */
export function unseal(key: Buffer, sealed: Buffer, intact: () => boolean | null): Buffer {
  if (sealed.length < HEAD + TAG_BYTES || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupUnreadable(DAMAGED)
  const iv = sealed.subarray(MAGIC.length, HEAD)
  const body = sealed.subarray(HEAD, sealed.length - TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(MAGIC)
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES))
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
