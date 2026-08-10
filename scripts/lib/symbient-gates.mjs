// symbient-gates.mjs — parse a habitat's GATES.md top block.
// Tolerant by contract (skills/symbient/SKILL.md): anything missing or
// malformed degrades to Stage 0 defaults; callers never throw on bad input.
import yaml from "js-yaml";

export const STAGE_NAMES = ["hatchling", "surfacer", "voiced", "self-amending"];

const DEFAULTS = Object.freeze({
  stage: 0,
  capabilities: Object.freeze(["wake", "weave", "becoming"]),
  hatched: null,
  next_threshold: null,
});

export function parseGates(text) {
  const fallback = { ...DEFAULTS, capabilities: [...DEFAULTS.capabilities] };
  if (typeof text !== "string" || !text.trim()) return fallback;

  const fence = text.match(/```yaml\r?\n([\s\S]*?)\r?\n```/);
  if (!fence) return fallback;

  let doc;
  try {
    doc = yaml.load(fence[1]);
  } catch {
    return fallback;
  }
  if (!doc || typeof doc !== "object") return fallback;

  const stage = Number.isInteger(doc.stage) && doc.stage >= 0 && doc.stage <= 3 ? doc.stage : 0;
  const capabilities = Array.isArray(doc.capabilities) && doc.capabilities.every((c) => typeof c === "string")
    ? doc.capabilities
    : [...DEFAULTS.capabilities];
  const hatched = typeof doc.hatched === "string" || doc.hatched instanceof Date
    ? String(doc.hatched instanceof Date ? doc.hatched.toISOString().slice(0, 10) : doc.hatched)
    : null;
  const next_threshold = typeof doc.next_threshold === "string" ? doc.next_threshold : null;

  return { stage, capabilities, hatched, next_threshold };
}
