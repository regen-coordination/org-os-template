// tokens.mjs — pure planner: a brand.yaml-shaped token map → Paper design
// tokens. No I/O beyond loadBrand. Nothing here knows any org's palette.
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

export const PAPER_TYPES = [
  "breakpoint",
  "color",
  "container",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "radius",
  "spacing",
];

// Families Paper has no token type for. Listed, never silently dropped.
const UNSUPPORTED_FAMILIES = new Set(["glow", "glass"]);
const FAMILY_TYPE = {
  font: "fontFamily",
  weight: "fontWeight",
  space: "spacing",
  radius: "radius",
  text: "fontSize",
};

export function loadBrand(yamlPath) {
  const doc = yaml.load(readFileSync(yamlPath, "utf8"));
  const tokens = doc?.tokens;
  const prefix = doc?.stylesheet?.prefix;
  if (!tokens || typeof tokens !== "object")
    throw new Error(`${yamlPath}: no top-level \`tokens:\` map`);
  if (typeof prefix !== "string")
    throw new Error(`${yamlPath}: no \`stylesheet.prefix\``);
  return {
    prefix,
    tokens: Object.fromEntries(
      Object.entries(tokens).map(([k, v]) => [k, String(v)]),
    ),
    source: yamlPath,
  };
}

export function isColor(value) {
  const v = String(value).trim();
  return (
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
    /^(rgba?|hsla?|oklch|oklab|color)\(/i.test(v)
  );
}

function lengthToPx(term, { width, rootPx }) {
  const t = term.trim();
  let m;
  if ((m = t.match(/^(-?[\d.]+)px$/))) return Number(m[1]);
  if ((m = t.match(/^(-?[\d.]+)rem$/))) return Number(m[1]) * rootPx;
  if ((m = t.match(/^(-?[\d.]+)vw$/))) return (Number(m[1]) * width) / 100;
  if (/^-?[\d.]+$/.test(t)) return Number(t);
  return null;
}

const fmt = (n) => `${Math.round(n * 100) / 100}px`;

export function toPx(value, { width = 1080, rootPx = 16 } = {}) {
  const v = String(value).trim();
  if (/^-?[\d.]+px$/.test(v)) return { px: v, converted: false };
  const clamp = v.match(/^clamp\((.+),(.+),(.+)\)$/);
  if (clamp) {
    const [lo, mid, hi] = clamp
      .slice(1)
      .map((t) => lengthToPx(t, { width, rootPx }));
    if ([lo, mid, hi].some((n) => n === null)) return null;
    return {
      px: `${Math.round(Math.min(Math.max(mid, lo), hi))}px`,
      converted: true,
      from: v,
    };
  }
  const n = lengthToPx(v, { width, rootPx });
  if (n === null) return null;
  return { px: fmt(n), converted: true, from: v };
}

function firstFamily(stack) {
  const first = String(stack).split(",")[0].trim();
  return first.replace(/^["']|["']$/g, "");
}

export function planTokens(brand, { canvasWidth = 1080 } = {}) {
  const tokens = [];
  const skipped = [];
  const converted = [];
  for (const [shortName, rawValue] of Object.entries(brand.tokens)) {
    const name = `--${brand.prefix}${shortName}`;
    const family = shortName.split("-")[0];
    const base = `brand.yaml ${shortName}`;
    if (UNSUPPORTED_FAMILIES.has(family)) {
      skipped.push({
        name,
        reason: `no Paper token type for shadow/blur values (${rawValue})`,
      });
      continue;
    }
    if (isColor(rawValue)) {
      tokens.push({ type: "color", name, value: rawValue, description: base });
      continue;
    }
    const type = FAMILY_TYPE[family];
    if (type === "fontFamily") {
      tokens.push({
        type,
        name,
        value: firstFamily(rawValue),
        description: `${base} · stack: ${rawValue}`,
      });
      continue;
    }
    if (type === "fontWeight") {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) {
        skipped.push({
          name,
          reason: `fontWeight must be numeric (${rawValue})`,
        });
        continue;
      }
      tokens.push({ type, name, value: n, description: base });
      continue;
    }
    if (type === "spacing" || type === "radius" || type === "fontSize") {
      const px = toPx(rawValue, { width: canvasWidth });
      if (!px) {
        skipped.push({ name, reason: `unconvertible length (${rawValue})` });
        continue;
      }
      const description = px.converted
        ? `${base} · from ${px.from}${px.from.startsWith("clamp(") ? ` at ${canvasWidth}px` : ""}`
        : base;
      if (px.converted) converted.push({ name, from: px.from, to: px.px });
      tokens.push({ type, name, value: px.px, description });
      continue;
    }
    skipped.push({
      name,
      reason: `unclassified family "${family}" (${rawValue})`,
    });
  }
  return { tokens, skipped, converted };
}

export function normalizeValue(type, value) {
  if (type === "fontWeight") return String(Number(value));
  let v = String(value).trim();
  if (type === "color") {
    v = v.toLowerCase().replace(/\s+/g, "");
    if (/^#[0-9a-f]{3}$/.test(v))
      v = "#" + [...v.slice(1)].map((c) => c + c).join("");
  }
  return v;
}

export function diffTokens(planned, existing, { prefix }) {
  const byName = new Map(existing.map((t) => [t.name, t]));
  const create = [];
  const update = [];
  const unchanged = [];
  const plannedNames = new Set();
  for (const t of planned) {
    plannedNames.add(t.name);
    const cur = byName.get(t.name);
    if (!cur) create.push(t);
    else if (
      normalizeValue(t.type, cur.value) !== normalizeValue(t.type, t.value)
    )
      update.push({ name: t.name, value: t.value, description: t.description });
    else unchanged.push(t.name);
  }
  const extra = existing
    .map((t) => t.name)
    .filter((n) => n.startsWith(`--${prefix}`) && !plannedNames.has(n));
  return { create, update, unchanged, extra };
}
