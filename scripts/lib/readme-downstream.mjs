// readme-downstream.mjs — the README's "Active downstream instances" list, from data/instances.yaml.
//
// The README is a public list of registered instances, so it follows the registry's `listed` flag as the
// site does: an entry with `listed: false` is left out. Each entry shows its `maturity` when the registry
// gives one, and nothing in its place when it does not; the registry has no `status` field, which is why
// the list once said "unknown" for every instance.

/** The entries to print: `{ name, type, maturity }`, in the registry's order. */
export function downstreamList(instancesYaml) {
  const entries = Array.isArray(instancesYaml?.instances) ? instancesYaml.instances : [];
  return entries
    .filter((i) => i && i.listed !== false)
    .map((i) => ({
      name: i.id || i.name,
      type: i.type || "instance",
      maturity: typeof i.maturity === "string" && i.maturity.trim() !== "" ? i.maturity.trim() : "",
    }))
    .filter((i) => i.name);
}
