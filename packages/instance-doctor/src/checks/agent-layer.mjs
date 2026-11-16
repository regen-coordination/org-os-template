/**
 * B8 — the agent layer (DAO-OS L6 spec §14, Q72, Q76).
 *
 * The agent layer's files — memory/**, MEMORY.md, HEARTBEAT.md, docs/plans/**, docs/agent-plans/** — are workspace,
 * kept in git, so every member reads them. This check lists each with that level and, per file, how much of what it
 * holds looks like personal data, by kind: e-mail addresses, 0x addresses, phone-like numbers, and the names
 * data/members.yaml lists. Counts only: no value is ever kept in the snapshot, put in a finding or printed. A file with
 * any is a WARN; with --before-widening (run before membership widens, Q67) a BLOCKER. With a private store present the
 * check also counts the Council memory entries (the store's `council-memory` collection): a number, never a title.
 *
 * Pure: snapshot.mjs reads the files and the store, and calls personalMarkers on each text.
 */

import { result, finding } from '../lib/finding.mjs';

/** The level every agent-layer file is kept at: it is in git (rule 4: nothing stricter enters git). */
export const AGENT_LAYER_LEVEL = 'members';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** An address is 40 hex digits after 0x and no more: a 32-byte hash (a transaction, a hat id) is not one. */
const ADDRESS = /(?<![0-9A-Za-z])0x[0-9a-fA-F]{40}(?![0-9A-Za-z])/g;
/**
 * Phone-like: an international number (+, a country code, groups of digits), a North American one ((555) 555-0100,
 * 555-555-0100), or a local one (555-0100). A bare run of digits, a date, a time, a count or a version is not one; a
 * range written 120-1234 reads as one (R-L6-T15-7: counted rather than missed).
 */
const PHONES = [
  /(?<![\w+])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,5}(?![\w-])/g,
  /(?<![\w(+-])(?:\(\d{3}\)\s?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\w-])/g,
  /(?<![\w(+.-])\d{3}-\d{4}(?![\w-])/g,
];
const digitsIn = (s) => (s.match(/\d/g) ?? []).length;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What in `text` looks like personal data, by kind, as counts: never the values.
 * @param {string} text
 * @param {readonly string[]} memberNames  the names data/members.yaml lists
 * @returns {{ emails: number, addresses: number, phones: number, names: number }}
 */
export function personalMarkers(text, memberNames = []) {
  const s = typeof text === 'string' ? text : '';
  const emails = (s.match(EMAIL) ?? []).length;
  const addresses = (s.match(ADDRESS) ?? []).length;
  // A phone is counted once, whichever form finds it first.
  const taken = [];
  let phones = 0;
  for (const re of PHONES) {
    for (const m of s.matchAll(re)) {
      const from = m.index;
      const to = from + m[0].length;
      if (taken.some(([a, b]) => from < b && to > a)) continue;
      const n = digitsIn(m[0]);
      if (n < 7 || n > 15) continue;
      taken.push([from, to]);
      phones += 1;
    }
  }
  let names = 0;
  const seen = new Set();
  for (const raw of memberNames) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (name.length < 2 || seen.has(name)) continue;
    seen.add(name);
    names += (s.match(new RegExp(`(?<![\\p{L}\\p{N}_])${escape(name)}(?![\\p{L}\\p{N}_])`, 'gu')) ?? []).length;
  }
  return { emails, addresses, phones, names };
}

const KINDS = [
  ['emails', 'e-mail address', 'e-mail addresses'],
  ['addresses', 'address', 'addresses'],
  ['phones', 'phone-like number', 'phone-like numbers'],
  ['names', "member's name", "members' names"],
];

/** "2 e-mail addresses, 1 address": the kinds a file holds, with their counts. */
function counted(markers) {
  return KINDS.filter(([k]) => (markers?.[k] ?? 0) > 0)
    .map(([k, one, many]) => `${markers[k]} ${markers[k] === 1 ? one : many}`)
    .join(', ');
}

const holdsAny = (markers) => KINDS.some(([k]) => (markers?.[k] ?? 0) > 0);

/** §14's sentence for a file holding what looks like personal data. */
export const PERSONAL_DATA = (path, markers) =>
  `${path} holds what looks like personal data (${counted(markers)}): move what is Steward-only to the private store before membership widens.`;

/**
 * @param {{ agentLayer?: { path: string, level?: string, markers: object | null }[], councilMemory?: number | null, beforeWidening?: boolean }} snapshot
 */
export function checkAgentLayer(snapshot) {
  const files = (snapshot.agentLayer ?? []).map((f) => ({ path: f.path, level: AGENT_LAYER_LEVEL, markers: f.markers ?? null }));
  const strict = Boolean(snapshot.beforeWidening);
  const findings = [];
  for (const f of files) {
    if (f.markers === null) {
      const message = `${f.path} could not be read, so whether it holds personal data is not known: read it before membership widens.`;
      findings.push(strict ? finding.blocker('agent-layer-unread', message) : finding.warn('agent-layer-unread', message));
      continue;
    }
    if (!holdsAny(f.markers)) continue;
    const message = PERSONAL_DATA(f.path, f.markers);
    findings.push(
      strict
        ? finding.blocker('agent-layer-personal-data', message, 'membership is about to widen: every member will read this file; keep only what all of them may read')
        : finding.warn('agent-layer-personal-data', message, 'Council entries go through the Hub: npm run memory -- add --level <hat or role> …'),
    );
  }
  const councilMemory = typeof snapshot.councilMemory === 'number' ? snapshot.councilMemory : null;
  return { ...result('agent-layer', 'Agent layer', findings), files, councilMemory };
}

/** The scorecard's lines for the check: how many files, at what level; the Council memory's count. */
export function agentLayerLines(check) {
  const n = check.files?.length ?? 0;
  const files = n === 0
    ? 'no agent-layer files'
    : `${n} agent-layer ${n === 1 ? 'file' : 'files'}, each kept in git at ${AGENT_LAYER_LEVEL} (every member reads ${n === 1 ? 'it' : 'them'})`;
  const c = check.councilMemory;
  const council = c === null || c === undefined
    ? 'Council memory: no private store here'
    : `Council memory: ${c} ${c === 1 ? 'entry' : 'entries'} in the private store`;
  return [files, council];
}
