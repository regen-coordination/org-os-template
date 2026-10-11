// registry-leaks.mjs — PURE parts of the verifier's registry guard: which text in
// data/instances.yaml is private, and whether any of it is in a built file.
//
// Three things are looked for, each as exactly as its length allows:
//   a sentence  whole, with its punctuation: a short phrase is evidence only when
//               it is the same phrase;
//   a passage   any run of RUN_LENGTH letters and digits of a longer note,
//               whatever stands between them: this is what an excerpt leaves;
//   a token     a one-word value no one would write by chance: a flag, a path.
// A built file is read twice, as written and with its markup removed, so text in
// an attribute and text with tags between its words are both seen.
import { PUBLIC_FIELDS } from "./federation-aggregate.mjs";

// Shorter than this, a fragment ("Not yet pushed") could be anyone's words.
const MIN_LENGTH = 16;
// A run of this many letters and digits shared with a private note is an excerpt
// of it: about fifty characters of prose. It cannot be much shorter while the
// framework's documents describe the same instances in their own words: measured
// on 2026-10-11, the longest run a built page shares with a note is 39 letters
// (docs/ECOSYSTEM.md, "acceptance-test instance for clone:framework"), then 32.
export const RUN_LENGTH = 40;
// A one-word value is looked for when it has a `_` or a `/` in it and is at least
// this long: a drift flag (no_masterplan), a local path (../refi-bcn-os).
const TOKEN_MIN_LENGTH = 8;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", rarr: "→", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };

function decode(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole);
}

function codePoint(n) {
  return n <= 0x10ffff ? String.fromCodePoint(n) : " ";
}

// The escapes a script or a JSON file writes text in.
function unescape(text) {
  return text
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\[nrt]/g, " ")
    .replace(/\\(["'\\/])/g, "$1");
}

// The typographer's characters, as the plain ones a note is typed with.
function plainPunctuation(text) {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...");
}

// One form for a page and for a private note: entities decoded, whitespace collapsed.
function normalize(text) {
  return decode(text).replace(/\s+/g, " ").trim();
}
// What two texts are compared by: case dropped, punctuation plain.
const fold = (text) => plainPunctuation(text).toLowerCase();
// Letters and digits only: what is left of a passage however it was set.
const squeeze = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function strings(value) {
  if (typeof value === "string") return [value.trim()];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

// A passage with, for each letter of its squeezed form, where that letter is in
// the passage, so a leak can be reported in the registry's own words.
function passage(text) {
  const lower = text.toLowerCase();
  const source = lower.length === text.length ? text : lower;
  let squeezed = "";
  const at = [];
  for (let i = 0; i < lower.length; i++) {
    if (/[\p{L}\p{N}]/u.test(lower[i])) { squeezed += lower[i]; at.push(i); }
  }
  return { source, squeezed, at };
}

// What is private in the registry: everything in a field outside the public list.
//   sentences  each sentence of free text (a string with a space in it);
//   tokens     the one-word values with a `_` or a `/`;
//   and, for findLeaks, the passages and the index of their runs.
// One-word values that are ordinary words — a maturity, a package name, a date —
// are left out: the docs use those words on their own account.
export function registryGuard(entries) {
  const sentences = new Set();
  const tokens = new Set();
  const passages = [];
  for (const entry of entries) {
    for (const [field, value] of Object.entries(entry)) {
      if (PUBLIC_FIELDS.includes(field)) continue;
      for (const raw of strings(value)) {
        if (!/\s/.test(raw)) {
          if (raw.length >= TOKEN_MIN_LENGTH && /[_/]/.test(raw)) tokens.add(raw.toLowerCase());
          continue;
        }
        const text = normalize(raw);
        for (const sentence of text.split(/(?<=[.!?])\s+/)) {
          const bare = sentence.replace(/[.!?]+$/, "").trim();
          if (bare.length >= MIN_LENGTH) sentences.add(bare);
        }
        const p = passage(text);
        if (p.squeezed.length >= RUN_LENGTH) passages.push(p);
      }
    }
  }
  const runs = new Map();
  for (const [index, p] of passages.entries()) {
    for (let i = 0; i + RUN_LENGTH <= p.squeezed.length; i++) {
      const run = p.squeezed.slice(i, i + RUN_LENGTH);
      if (!runs.has(run)) runs.set(run, { index, i });
    }
  }
  return { sentences: [...sentences], tokens: [...tokens], passages, runs };
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function hasToken(text, token) {
  for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + 1)) {
    const before = text[i - 1], after = text[i + token.length];
    if (!(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after))) return true;
  }
  return false;
}

// The excerpts of private passages in a squeezed text, each in the registry's words.
function excerptsIn(squeezed, guard) {
  const found = [];
  for (let i = 0; i + RUN_LENGTH <= squeezed.length; i++) {
    const hit = guard.runs.get(squeezed.slice(i, i + RUN_LENGTH));
    if (!hit) continue;
    const p = guard.passages[hit.index];
    let length = RUN_LENGTH;
    while (hit.i + length < p.squeezed.length && squeezed[i + length] === p.squeezed[hit.i + length]) length++;
    found.push(p.source.slice(p.at[hit.i], p.at[hit.i + length - 1] + 1));
    i += length - 1;
  }
  return found;
}

// Every private thing found in one built file: [{ kind, text }], each once.
export function findLeaks(builtText, guard) {
  const leaks = new Map();
  const add = (kind, text) => leaks.set(`${kind}\n${text}`, { kind, text });
  const written = unescape(builtText);
  const readings = [written];
  if (written.includes("<")) readings.push(written.replace(/<[^>]*>/g, " "));
  const whole = new Set();
  for (const reading of readings) {
    const text = normalize(reading);
    const folded = fold(text);
    for (const sentence of guard.sentences) {
      if (folded.includes(fold(sentence))) { add("sentence", sentence); whole.add(squeeze(sentence)); }
    }
    for (const token of guard.tokens) if (hasToken(folded, token)) add("token", token);
  }
  for (const reading of readings) {
    // A passage that is a whole sentence already reported is not reported twice.
    for (const excerpt of excerptsIn(squeeze(normalize(reading)), guard)) {
      if (![...whole].some((s) => s.includes(squeeze(excerpt)))) add("passage", excerpt);
    }
  }
  return [...leaks.values()];
}

export function visibleText(html) {
  return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

// The whole text of one instance on the federation page.
export const REPOSITORY_LABEL = "repository";
export function instanceLine(node) {
  return [node.name, node.type, node.repo ? REPOSITORY_LABEL : null].filter(Boolean).join(" ");
}
