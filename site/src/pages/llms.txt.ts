import type { APIRoute } from "astro";
import { DOCS_ALLOWLIST } from "../data/docs-allowlist";
import { withBase } from "../lib/base";

export const GET: APIRoute = ({ site }) => {
  // `site` is the origin only — Astro keeps `base` out of it — so every path
  // still has to go through withBase or these URLs 404 on the project page.
  const origin = site?.toString().replace(/\/$/, "") ?? "";
  const url = (path: string) => `${origin}${withBase(path)}`;
  const lines = [
    "# org-os",
    "> The agent-native org operating system — framework, standards, and orchestration hub for a federation of regenerative organizations.",
    "",
    "## Pages",
    `- [Home](${url("/")}): what org-os is`,
    `- [Modules](${url("/modules")}): v0.5 module roadmap`,
    `- [rad-org-os](${url("/modules/rad-org-os")}): sovereign Radicle-native distribution`,
    `- [Federation](${url("/federation")}): live network of instances`,
    `- [Get started](${url("/get-started")}): spin up an instance`,
    `- [About](${url("/about")}): mission and federation model`,
    "",
    "## Docs",
    ...DOCS_ALLOWLIST.map((d) => `- [${d.title}](${url(`/docs/${d.slug}`)}): ${d.group}`),
    "",
    "## Machine-readable",
    `- [Federation data](${url("/federation.json")}): aggregated instance registry + edges`,
    `- [.well-known/](${url("/.well-known/")}): EIP-4824 schemas`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
