// Final review I3: the dashboard reads federation.yaml's networks as validate:schemas does, top level or nested.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const script = resolve(import.meta.dirname, '../scripts/initialize.mjs')
const { loadFederation, loadFederationReader } = await import(script)

test('importing initialize does not run the dashboard', () => {
  assert.equal(typeof loadFederation, 'function')
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(script)})`], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '')
})

test('the framework reader is found from this checkout', async () => {
  const read = await loadFederationReader()
  assert.equal(typeof read, 'function')
  assert.equal(await loadFederationReader('/nonexistent/scripts'), null)
})

test('top-level networks are read, with their hub as url', async () => {
  const read = await loadFederationReader()
  const f = loadFederation({ identity: { type: 'LocalNode' }, networks: [{ name: 'net-a', hub: 'https://hub.example.org', role: 'node' }] }, read)
  assert.deepEqual(f.networks, [{ name: 'net-a', role: 'node', url: 'https://hub.example.org' }])
  assert.equal(f.identityType, 'LocalNode')
})

test('nested federation.networks with url still read the same, and network keeps its old value', async () => {
  const read = await loadFederationReader()
  const f = loadFederation({ federation: { network: 'net-a', networks: [{ name: 'net-a', role: 'primary', url: 'https://github.com/net-a-org' }] } }, read)
  assert.deepEqual(f.networks, [{ name: 'net-a', role: 'primary', url: 'https://github.com/net-a-org' }])
  assert.equal(f.network, 'net-a')
})

test('with no reader, the old logic: only nested networks', () => {
  const f = loadFederation({ networks: [{ name: 'net-a' }], federation: { networks: [{ name: 'net-b', url: 'https://b.example.org' }] } })
  assert.deepEqual(f.networks, [{ name: 'net-b', role: null, url: 'https://b.example.org' }])
})

test('the dashboard still runs as a script', () => {
  const r = spawnSync(process.execPath, [script, '--format=json'], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.length > 0)
})
