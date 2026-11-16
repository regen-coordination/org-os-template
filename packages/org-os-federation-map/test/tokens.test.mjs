// The component's fallback tokens (src/house-tokens.mjs, generated): the house values, for exactly
// the tokens map.css reads, with the three old --fedmap-* properties as aliases (spec §5.2, P-5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOUSE_TOKENS_CSS } from '../src/house-tokens.mjs';
import { KMS_TOKENS, MAP_CSS_PATH, ALIASES, tokensUsed, parseKmsTokens, buildTokensCss, moduleText } from '../scripts/sync-tokens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MAP_CSS = readFileSync(MAP_CSS_PATH, 'utf8');
const SIBLING = existsSync(KMS_TOKENS);

// `:host{…}@media (prefers-color-scheme: dark){:host{…}}` → { light: Map, dark: Map }
function blocks(css) {
  const m = css.match(/^:host\{([^}]*)\}@media \(prefers-color-scheme: dark\)\{:host\{([^}]*)\}\}$/);
  assert.ok(m, 'one :host block, then one dark @media :host block');
  const decls = (b) => new Map([...b.matchAll(/(--[\w-]+):([^;]+);/g)].map((x) => [x[1], x[2]]));
  return { light: decls(m[1]), dark: decls(m[2]) };
}
const unalias = (v) => v.replace(/^var\(--fedmap-[\w-]+, (.*)\)$/, '$1');

test('HOUSE_TOKENS_CSS values equal kms\'s house-tokens.css', { skip: !SIBLING && 'kms not present beside this package' }, () => {
  const kms = parseKmsTokens(readFileSync(KMS_TOKENS, 'utf8'));
  const ours = blocks(HOUSE_TOKENS_CSS);
  for (const [n, v] of ours.light) assert.equal(unalias(v), kms.light.get(n), `light ${n}`);
  for (const [n, v] of ours.dark) assert.equal(unalias(v), kms.dark.get(n), `dark ${n}`);
  for (const n of ours.light.keys()) if (kms.dark.has(n)) assert.ok(ours.dark.has(n), `dark ${n} carried`);
  // and the committed module is what the script writes today
  const fresh = moduleText(buildTokensCss(readFileSync(KMS_TOKENS, 'utf8'), MAP_CSS));
  assert.equal(readFileSync(join(here, '..', 'src', 'house-tokens.mjs'), 'utf8'), fresh, 'run scripts/sync-tokens.mjs');
});

test('it defines every token map.css uses, and only those (with what their values read)', async () => {
  const { light } = blocks(HOUSE_TOKENS_CSS);
  const used = tokensUsed(MAP_CSS);
  for (const n of used) assert.ok(light.has(n), `missing ${n}`);
  const { COMPONENT_CSS } = await import('../src/element.mjs');
  for (const n of tokensUsed(COMPONENT_CSS)) assert.ok(light.has(n), `component css reads ${n}`);
  const closure = new Set(used);
  for (const v of light.values()) for (const n of tokensUsed(v)) closure.add(n);
  for (const n of light.keys()) assert.ok(closure.has(n), `${n} is not used by map.css`);
});

test('the three aliases are present and no other --fedmap-*', () => {
  const { light, dark } = blocks(HOUSE_TOKENS_CSS);
  assert.match(light.get('--sunken'), /^var\(--fedmap-bg, [^)]+\)$/);
  assert.match(light.get('--ink'), /^var\(--fedmap-text, [^)]+\)$/);
  assert.match(light.get('--sans'), /^var\(--fedmap-font, .+\)$/);
  assert.match(dark.get('--sunken'), /^var\(--fedmap-bg, [^)]+\)$/);
  const fedmap = [...HOUSE_TOKENS_CSS.matchAll(/--fedmap-[\w-]+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(fedmap)].sort(), Object.values(ALIASES).sort());
  for (const n of [...light.keys(), ...dark.keys()]) assert.ok(!n.startsWith('--fedmap-'), `${n} is defined, not read`);
});
