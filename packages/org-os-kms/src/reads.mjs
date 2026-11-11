// src/reads.mjs — when each knowledge peer was last read, in a sidecar: { version: 1, reads: { <connector>: { ok_at, attempt_at, error } } }.
// Pages say "read 3 d ago" / "couldn't read" from this. The time is always passed in (no clock in here).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from './atomic-write.mjs';

export const READS_PATH = 'data/kms-reads.json';

export function readReads(dir) {
  const p = join(dir, READS_PATH);
  if (!existsSync(p)) return {};
  let doc;
  try { doc = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`${READS_PATH} is not valid JSON (${e.message}); fix or remove it.`); }
  if (!doc || typeof doc.reads !== 'object' || doc.reads === null || Array.isArray(doc.reads)) {
    throw new Error(`${READS_PATH} must look like { "version": 1, "reads": { "<connector>": { "ok_at", "attempt_at", "error" } } }`);
  }
  return doc.reads;
}

// ok_at moves only on success; a failure keeps the last ok_at and records the error.
export function recordRead(dir, connector, { at, error = null }) {
  const reads = readReads(dir);
  const prev = reads[connector] || {};
  const next = { ...reads, [connector]: { ok_at: error ? (prev.ok_at ?? null) : at, attempt_at: at, error: error ? String(error) : null } };
  atomicWrite(join(dir, READS_PATH), `${JSON.stringify({ version: 1, reads: next }, null, 2)}\n`);
}
