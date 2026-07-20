import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed-node');
const read = (f) => readFileSync(join(dir, f), 'utf8');

test('all seed-node artifacts exist', () => {
  for (const f of ['Dockerfile', 'compose.yml', 'compose.tor.yml', 'seeding-policy.md', 'README.md']) {
    assert.ok(existsSync(join(dir, f)), `${f} exists`);
  }
});

test('Dockerfile installs radicle and the node listens on 8776', () => {
  const d = read('Dockerfile');
  assert.match(d, /radicle\.dev\/install|rad/i);
  assert.match(d, /8776/);
});

test('compose runs a node and an httpd read gateway', () => {
  // Assert real structure, not a comment: the node daemon is started by the Dockerfile,
  // and compose.yml wires a `node:` service that builds it plus an httpd gateway.
  assert.match(read('Dockerfile'), /rad node start/);
  const c = read('compose.yml');
  assert.match(c, /^\s*node:/m);
  assert.match(c, /^\s*node:[\s\S]*?\n\s*build:/m);
  assert.match(c, /radicle-httpd|httpd/i);
});

test('tor profile adds a tor service (no-trusted-seed path)', () => {
  assert.match(read('compose.tor.yml'), /tor/i);
});

test('seeding-policy states the honest at-rest caveat', () => {
  assert.match(read('seeding-policy.md'), /not encrypted at rest/i);
  assert.match(read('seeding-policy.md'), /rad seed|rad unseed/i);
});
