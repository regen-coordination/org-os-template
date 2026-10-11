// registry-leaks.mjs — PURE parts of the verifier's registry guard: which text in
// data/instances.yaml is private, and whether any of it is in a built file.
import { PUBLIC_FIELDS } from "./federation-aggregate.mjs";

// Shorter than this, a fragment ("Not yet pushed") could be anyone's words.
const MIN_LENGTH = 16;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", rarr: "→", hellip: "…" };

function decode(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

// One form for a page and for a private sentence: entities decoded, JSON escapes
// undone, whitespace collapsed.
function normalize(text) {
  return decode(text).replace(/\\n/g, " ").replace(/\\(["\\/])/g, "$1").replace(/\s+/g, " ").trim();
}

function freeText(value) {
  if (typeof value === "string") return /\s/.test(value.trim()) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(freeText);
  if (value && typeof value === "object") return Object.values(value).flatMap(freeText);
  return [];
}

// Every sentence of free text (a string with a space in it) held in a field
// outside the public list. Single tokens — a maturity, a package name, a drift
// flag — are left out: the docs use those words on their own account.
export function privateTexts(entries) {
  const texts = new Set();
  for (const entry of entries) {
    for (const [field, value] of Object.entries(entry)) {
      if (PUBLIC_FIELDS.includes(field)) continue;
      for (const text of freeText(value)) {
        for (const sentence of normalize(text).split(/(?<=[.!?])\s+/)) {
          const bare = sentence.replace(/[.!?]+$/, "").trim();
          if (bare.length >= MIN_LENGTH) texts.add(bare);
        }
      }
    }
  }
  return [...texts];
}

export function findLeaks(builtText, texts) {
  const haystack = normalize(builtText);
  return texts.filter((text) => haystack.includes(text));
}

export function visibleText(html) {
  return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

// The whole text of one instance on the federation page.
export const REPOSITORY_LABEL = "repository";
export function instanceLine(node) {
  return [node.name, node.type, node.repo ? REPOSITORY_LABEL : null].filter(Boolean).join(" ");
}
