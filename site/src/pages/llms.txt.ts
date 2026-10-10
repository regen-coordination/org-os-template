import type { APIRoute } from "astro";
import { SECTIONS, pagesBySection } from "../data/docs-manifest.mjs";
import { withBase } from "../lib/base";

export const GET: APIRoute = ({ site }) => {
  // `site` is the origin only — Astro keeps `base` out of it — so every path
  // still has to go through withBase or these URLs 404 on the project page.
  const origin = site?.toString().replace(/\/$/, "") ?? "";
  const url = (path: string) => `${origin}${withBase(path)}`;
  const docs = SECTIONS.flatMap((s) => {
    const pages = pagesBySection(s.id);
    if (pages.length === 0) return [];
    return [`### ${s.title}`, ...pages.map((p) => `- [${p.title}](${url(`/docs/${p.slug}`)}): ${p.summary}`), ""];
  });
  const lines = [
    "# org-os",
    "> The agent-native org operating system — framework, standards, and orchestration hub for a federation of regenerative organizations.",
    "",
    "## Pages",
    `- [Home](${url("/")}): the front door to the documentation`,
    `- [Modules](${url("/modules")}): the module catalog with each module's status`,
    `- [rad-org-os](${url("/modules/rad-org-os")}): sovereign Radicle-native distribution`,
    `- [Federation](${url("/federation")}): live network of instances`,
    "",
    "## Docs",
    "",
    ...docs,
    "## Machine-readable",
    `- [Federation data](${url("/federation.json")}): aggregated instance registry + edges`,
    `- [dao.json](${url("/.well-known/dao.json")}): the EIP-4824 entry point; its sibling schemas sit beside it`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
