// DAO-OS L7 (spec §5.1, §7.1): a wizard can live on a registered shelf. /api/wizards lists it beside the framework's,
// its id `<shelf>/<slug>`; its fields may ask for addresses and a count; its result names the entry to add and the
// config the answers fill.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountWizards } from '../../server/wizards/routes.ts'
import { stateDir } from '../../server/state.ts'
import { readField, resultOf, validateWizard } from '../../lib/wizards.mjs'
import { request } from 'node:http'
import { startServer } from '../../server/serve.ts'

const SHELF = join(dirname(fileURLToPath(import.meta.url)), '..', 'library', 'fixtures', 'test-shelf')
const WIZARD = join(SHELF, 'wizard', 'test-compose', 'wizard.yaml')
const def = () => parse(readFileSync(WIZARD, 'utf8'))
const A1 = '0x00000000000000000000000000000000000000a1'
const A2 = '0x00000000000000000000000000000000000000a2'

let repo: string
let home: string
let app: ReturnType<typeof createApp>
beforeEach(() => {
  repo = makeFixtureRepo()
  writeFileSync(join(repo, 'federation.yaml'), `identity:\n  name: Test DAO\nlibrary:\n  shelves:\n    - { path: ${SHELF} }\n`)
  home = mkdtempSync(join(tmpdir(), 'wizard-state-'))
  process.env.ORG_OS_ADMIN_HOME = home
  app = createApp(repo, a => mountWizards(a, { repo }))
})
afterEach(() => { removeFixtureRepo(repo); rmSync(home, { recursive: true, force: true }) })

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })

describe('a shelf wizard over HTTP', () => {
  it('GET /api/wizards lists test-shelf/test-compose beside the framework\'s wizards', async () => {
    const list = await (await send('GET', '/api/wizards')).json()
    const ids = list.map((w: { id: string }) => w.id)
    expect(ids).toContain('claim-handle')
    expect(ids).toContain('test-shelf/test-compose')
    expect(list.find((w: { id: string }) => w.id === 'test-shelf/test-compose')).toEqual({ id: 'test-shelf/test-compose', title: 'Compose a test council', summary: expect.any(String) })
  })

  it('gives the shelf wizard whole, by its id with the slash encoded, with its result', async () => {
    const res = await send('GET', `/api/wizards/${encodeURIComponent('test-shelf/test-compose')}`)
    expect(res.status).toBe(200)
    const one = await res.json()
    expect(one.id).toBe('test-shelf/test-compose')
    expect(one.result).toEqual({ add: 'template:test-council', config: { id: '${field.id}', name: '${field.name}', owners: '${field.owners}', threshold: '${field.threshold}' } })
  })

  it('keeps a shelf wizard\'s draft in a file of its own, outside the repository', async () => {
    const path = `/api/wizards/${encodeURIComponent('test-shelf/test-compose')}/draft`
    const saved = await (await send('PUT', path, { index: 1, answers: { name: 'Test DAO' } })).json()
    expect(saved).toMatchObject({ index: 1, answers: { name: 'Test DAO' } })
    expect(readdirSync(join(stateDir(repo), 'wizards'))).toEqual([expect.stringMatching(/^test-shelf__test-compose\.[A-Za-z0-9._-]+-1\.json$/)])
    expect(await (await send('GET', path)).json()).toEqual(saved)
    expect((await send('DELETE', path)).status).toBe(200)
  })

  it('without the shelf registered, the shelf wizard is not served', async () => {
    writeFileSync(join(repo, 'federation.yaml'), 'identity:\n  name: Test DAO\n')
    const list = await (await send('GET', '/api/wizards')).json()
    expect(list.map((w: { id: string }) => w.id)).not.toContain('test-shelf/test-compose')
    expect((await send('GET', `/api/wizards/${encodeURIComponent('test-shelf/test-compose')}`)).status).toBe(404)
  })
})

describe('the server an instance runs (startServer) mounts the wizards', () => {
  it('GET /api/wizards over HTTP lists the shelf wizard', async () => {
    const server = await startServer({ repo, port: 0 })
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: server.port, method: 'GET', path: '/api/wizards', headers: { host: `localhost:${server.port}` } }, res => {
          let text = ''
          res.on('data', chunk => { text += chunk })
          res.on('end', () => (res.statusCode === 200 ? resolve(text) : reject(new Error(`${res.statusCode}: ${text}`))))
        })
        req.on('error', reject)
        req.end()
      })
      expect(JSON.parse(body).map((w: { id: string }) => w.id)).toContain('test-shelf/test-compose')
    } finally { await server.close() }
  })
})

describe('field kinds addresses and count', () => {
  it('a wizard with an addresses field and a count field validates', () => {
    expect(validateWizard(def())).toEqual([])
  })

  it('an addresses answer is one address per line, 0x or CAIP-10; blank lines are skipped', () => {
    const field = { id: 'owners', label: 'Signers', kind: 'addresses' }
    expect(readField(field, `${A1}\n\n  eip155:11155111:${A2}  \n`)).toEqual({ value: [A1, `eip155:11155111:${A2}`] })
    expect(readField(field, `${A1}\nnot an address`)).toEqual({ error: 'Line 2, "not an address", is not an address: write 0x and 40 hex digits, or a CAIP-10 account.' })
    expect(readField(field, '')).toEqual({ error: 'Write at least one address.' })
  })

  it('a count answer is a whole number of at least 1', () => {
    const field = { id: 'threshold', label: 'Signatures needed', kind: 'count' }
    expect(readField(field, ' 2 ')).toEqual({ value: 2 })
    expect(readField(field, '0')).toEqual({ error: 'Signatures needed is a whole number, 1 or more.' })
    expect(readField(field, '1.5')).toEqual({ error: 'Signatures needed is a whole number, 1 or more.' })
  })
})

describe('the result', () => {
  it('fills the config from the answers', () => {
    expect(resultOf(def(), { name: 'Test DAO', owners: [A1, A2], threshold: 2 }))
      .toEqual({ add: 'template:test-council', config: { name: 'Test DAO', owners: [A1, A2], threshold: 2 } })
  })

  it('a result.config value naming no field is refused in words', () => {
    const d = def()
    d.result.config.salt = '${field.salt}'
    expect(validateWizard(d)).toEqual(['The result\'s config.salt names the field "salt", which no step asks for.'])
  })

  it('a result.config value that is not a field placeholder is refused in words', () => {
    const d = def()
    d.result.config.salt = '1'
    expect(validateWizard(d)).toEqual(['The result\'s config.salt is "1"; each value is "${field.<id>}", a field of a step.'])
  })

  it('a result that names no entry is refused in words', () => {
    const d = def()
    d.result.add = 'test-council'
    expect(validateWizard(d)).toEqual(['The result\'s add is "test-council"; it names a library entry, <shelf>:<slug>.'])
  })

  it('a field kind it does not know is still refused, now naming the five', () => {
    const d = def()
    d.steps[0].fields[0].kind = 'date'
    expect(validateWizard(d)).toEqual(['Field "name" of step "name" has a kind that is not text, email, choice, addresses or count.'])
  })
})
