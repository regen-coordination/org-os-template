/**
 * QUILT view model — maps registry data to patch/pod specs.
 * Hand-authored prose (taglines, overrides, garden groups) lives HERE as
 * template constants; everything numeric/status comes from data.
 */

export const SHADE_MATURITY = { production: "█", beta: "▓", alpha: "▒" };
export const SHADE_PROJECT = { Develop: "▓", Discovery: "▒" };

export function instanceShade(maturity) {
  const s = SHADE_MATURITY[maturity];
  if (!s) console.warn(`quilt: unknown maturity "${maturity}" — rendering ▒`);
  return s ?? "▒";
}

/** Short display id: strip -os suffix, refi-/regen- prefixes kept readable. */
export const shortId = (id) =>
  id.replace(/-os$/, "").replace(/^regen-coordination$/, "regen-coord");

export function monthsAgo(iso, now) {
  if (!iso) return null;
  return (now - new Date(iso)) / (30 * 86400000);
}

/** Round to nearest half month: 2mo, 3.5mo; null → ∅ */
export function fmtAge(months) {
  if (months == null) return "∅";
  const h = Math.round(months * 2) / 2;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}mo`;
}

const mmdd = (iso) => iso.slice(5);

/** One federation patch spec {title, lines} from an instances.yaml entry. */
export function instancePatch(inst) {
  const shade = instanceShade(inst.maturity);
  const head =
    ` ${inst.type}·${inst.maturity}` +
    (inst.federation_role === "hub" ? "·hub" : "") + " ";
  const pkgsLine =
    ` pkgs ×${(inst.packages ?? []).length}` +
    ((inst.skills_extra ?? []).length ? ` · +${inst.skills_extra.length} skills` : "") + " ";
  const drift = (inst.drift ?? []).length ? `drift ☓${inst.drift.length}` : "drift ✓";
  const syncLine = inst.maturity === "alpha" && !(inst.drift ?? []).length
    ? ` sync ${inst.last_sync ? mmdd(inst.last_sync) : "∅"} `
    : ` sync ${inst.last_sync ? mmdd(inst.last_sync) : "∅"} · ${drift} `;
  const lines = inst.maturity === "production"
    ? [head, pkgsLine, syncLine]
    : [head, syncLine];
  return { title: `${shortId(inst.id)} ${shade}`, lines };
}

/** `ledger: freshest Nmo » … » never ∅` — freshest first, null last. */
export function syncLedger(instances, now) {
  const parts = [...instances]
    .map((i) => ({ id: shortId(i.id), m: monthsAgo(i.last_sync, now) }))
    .sort((a, b) => (a.m ?? Infinity) - (b.m ?? Infinity))
    .map((x) => `${x.id} ${fmtAge(x.m)}`);
  return "ledger: " + parts.join(" » ");
}
