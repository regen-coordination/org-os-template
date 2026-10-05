import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertInsideCommons } from '../../src/planes/safe-write.mjs';

// macOS: /tmp is itself a symlink to /private/tmp. mkdtempSync's return value is realpath'd here
// so a test asserting "no throw" isn't accidentally relying on assertInsideCommons realpath'ing
// one side (outDir) but not needing to for the other (a target already built from the same root).
const mkCommons = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'safe-write-commons-')));

test('an existing target strictly inside the commons is accepted', () => {
  const outDir = mkCommons();
  const nested = path.join(outDir, 'data', 'kb');
  fs.mkdirSync(nested, { recursive: true });
  assert.doesNotThrow(() => assertInsideCommons(outDir, nested));
});

test('the commons root itself is accepted', () => {
  const outDir = mkCommons();
  assert.doesNotThrow(() => assertInsideCommons(outDir, outDir));
});

test('a non-existing but nested target under the commons is accepted', () => {
  const outDir = mkCommons();
  const target = path.join(outDir, 'content', 'sub', 'sources.json');
  assert.doesNotThrow(() => assertInsideCommons(outDir, target));
});

test('a ".." traversal that escapes the commons is refused', () => {
  const outDir = mkCommons();
  const target = path.join(outDir, '..', 'evil');
  assert.throws(() => assertInsideCommons(outDir, target), /refusing to write outside the commons/);
});

test('a symlinked ancestor that escapes the commons is refused, even for a not-yet-existing target', () => {
  const outDir = mkCommons();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-write-outside-'));
  fs.symlinkSync(outside, path.join(outDir, 'content'), 'dir');
  const target = path.join(outDir, 'content', 'sources.json'); // does not exist yet — only its ancestor does
  assert.throws(() => assertInsideCommons(outDir, target), /refusing to write outside the commons/);
});

test('a sibling directory sharing the commons dir name as a prefix is not mistaken for being inside it', () => {
  const outDir = mkCommons();
  const evilSibling = `${outDir}-evil`;
  fs.mkdirSync(evilSibling, { recursive: true });
  const target = path.join(evilSibling, 'sources.json');
  assert.throws(() => assertInsideCommons(outDir, target), /refusing to write outside the commons/);
});

// ROUND C ------------------------------------------------------------------------------------
// fs.existsSync FOLLOWS symlinks, so a dangling link (its target does not exist yet) read as "does
// not exist" and was popped off, re-appended unresolved — exactly the reproduced hole: a dangling
// content/sources.json pointing at <canon>/data/sources.json looked like an ordinary not-yet-
// existing path inside the commons, and writeFileSync then followed the link straight out.

test('ROUND C: a dangling final-component symlink is refused outright', () => {
  const outDir = mkCommons();
  const target = path.join(outDir, 'content', 'sources.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(path.join(outDir, 'this-does-not-exist.json'), target); // dangling: target absent
  assert.throws(() => assertInsideCommons(outDir, target), /dangling symlink/);
});

test('ROUND C: a dangling directory symlink mid-path is refused, naming the offending component', () => {
  const outDir = mkCommons();
  const missingDir = path.join(outDir, 'this-directory-does-not-exist');
  fs.symlinkSync(missingDir, path.join(outDir, 'content'), 'dir'); // dangling: missingDir absent
  const target = path.join(outDir, 'content', 'sources.json'); // never reachable — content/ is broken
  assert.throws(() => assertInsideCommons(outDir, target), /broken symlink/);
});

test('ROUND C: an existing final-component symlink to a file (even one inside the commons) is refused', () => {
  const outDir = mkCommons();
  const realFile = path.join(outDir, 'real.json');
  fs.writeFileSync(realFile, '{}');
  const target = path.join(outDir, 'content', 'sources.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(realFile, target); // exists, resolves inside the commons, but is a symlink to a FILE
  assert.throws(() => assertInsideCommons(outDir, target), /symlink to a non-directory/);
});

test('ROUND C: a directory symlink at the exact target, resolving inside the commons, is still accepted', () => {
  const outDir = mkCommons();
  const realDir = path.join(outDir, 'actual-content');
  fs.mkdirSync(realDir, { recursive: true });
  const target = path.join(outDir, 'content');
  fs.symlinkSync(realDir, target, 'dir'); // exists, is a symlink, but resolves to a DIRECTORY inside the commons
  assert.doesNotThrow(() => assertInsideCommons(outDir, target));
});

test('ROUND C: outDir reached through a symlink (mirroring macOS /tmp -> /private/tmp) with an ordinary target is accepted', () => {
  const rawOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-write-raw-')); // NOT pre-realpath'd
  const target = path.join(rawOutDir, 'data', 'kb', 'resource.yaml');
  assert.doesNotThrow(() => assertInsideCommons(rawOutDir, target));
});

// FINAL REVIEW -------------------------------------------------------------------------------
// A HARD LINK needs no symlink and no traversal: the path really is inside the commons, so every
// containment check passes, and writeFileSync then truncates the shared inode — rewriting the
// canon file on the other end of the link.

test('FINAL REVIEW: a hard link at the write target is refused, and the canon side is untouched', () => {
  const outDir = mkCommons();
  const canonDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'safe-write-canon-')));
  const canonFile = path.join(canonDir, 'resource.yaml');
  const CANON_CONTENT = 'entries:\n  secret: {title: Private}\n';
  fs.writeFileSync(canonFile, CANON_CONTENT);

  const target = path.join(outDir, 'data', 'kb', 'resource.yaml');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.linkSync(canonFile, target); // same inode, no symlink anywhere on the path

  assert.throws(() => assertInsideCommons(outDir, target), /is a hard link/);
  // The refusal is what protects the canon: had the write gone ahead it would have truncated
  // the shared inode, and this assertion would fail.
  assert.equal(fs.readFileSync(canonFile, 'utf8'), CANON_CONTENT);
  assert.equal(fs.lstatSync(target).nlink, 2);
});

test('FINAL REVIEW: the refusal names the path, and an ordinary single-link file is still accepted', () => {
  const outDir = mkCommons();
  const a = path.join(outDir, 'a.yaml');
  const b = path.join(outDir, 'b.yaml');
  fs.writeFileSync(a, 'x');
  assert.doesNotThrow(() => assertInsideCommons(outDir, a)); // nlink 1 — ordinary generated file
  fs.linkSync(a, b); // a link WHOLLY INSIDE the commons is refused too: sharing is the hazard, not the destination
  assert.throws(() => assertInsideCommons(outDir, a), new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.throws(() => assertInsideCommons(outDir, b), /is a hard link/);
});

test('FINAL REVIEW: a directory is exempt — its nlink counts subdirectories, not sharing', () => {
  const outDir = mkCommons();
  const nested = path.join(outDir, 'data', 'kb');
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(nested, 'sub'));
  assert.ok(fs.lstatSync(nested).nlink > 1, 'fixture: a directory with a subdirectory has nlink > 1');
  assert.doesNotThrow(() => assertInsideCommons(outDir, nested));
});
