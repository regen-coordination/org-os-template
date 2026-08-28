import type { APIRoute } from "astro";
import { DOCS_ALLOWLIST } from "../data/docs-allowlist";

export const GET: APIRoute = ({ site }) => {
  const base = site?.toString().replace(/\/$/, "") ?? "";
  const lines = [
    "# org-os",
    "> The agent-native org operating system — framework, standards, and orchestration hub for a federation of regenerative organizations.",
    "",
    "## Pages",
    `- [Home](${base}/): what org-os is`,
    `- [Modules](${base}/modules): v0.5 module roadmap`,
    `- [rad-org-os](${base}/modules/rad-org-os): sovereign Radicle-native distribution`,
    `- [Federation](${base}/federation): live network of instances`,
    `- [Get started](${base}/get-started): spin up an instance`,
    `- [About](${base}/about): mission and federation model`,
    "",
    "## Docs",
    ...DOCS_ALLOWLIST.map((d) => `- [${d.title}](${base}/docs/${d.slug}): ${d.group}`),
    "",
    "## Machine-readable",
    `- [Federation data](${base}/federation.json): aggregated instance registry + edges`,
    `- [.well-known/](${base}/.well-known/): EIP-4824 schemas`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
