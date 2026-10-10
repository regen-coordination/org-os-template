// docs-manifest.mjs — the only place that decides what is on the site.
// The loader, the sidebar, the docs index, llms.txt, the redirects and
// scripts/verify-build.mjs all read this file.
//
// `source` is a path from the repository root and may be outside docs/.
// `verified` is the commit the page was checked against the code at; null
// means not checked yet, which is accepted only while ALLOW_UNVERIFIED is true.
// `covers` (optional) lists the code paths a page describes.
import { sortPages, neighboursOf } from "../lib/manifest.mjs";

/**
 * @typedef {{ source: string, slug: string, title: string, section: string,
 *   order: number, summary: string, verified: string | null, covers?: string[] }} DocPage
 */

export const SECTIONS = [
  { id: "start", title: "Start", summary: "What org-os is and how an instance is set up." },
  { id: "operate", title: "Operate", summary: "Running an instance day to day and keeping it current." },
  { id: "knowledge", title: "Knowledge", summary: "The knowledge management system, its two planes and what it publishes." },
  { id: "modules", title: "Modules", summary: "The catalog of modules and the integrations." },
  { id: "reference", title: "Reference", summary: "The file structure, the data model and the protocols, field by field." },
  { id: "concepts", title: "Concepts", summary: "How the framework is put together, and why." },
];

// Temporary (plan 1). Plan 2 verifies every page and sets this to false; from
// then on a page without a verified commit fails the build.
export const ALLOW_UNVERIFIED = true;

/** @type {DocPage[]} */
export const PAGES = [
  { source: "docs/SETUP.md", slug: "setup", title: "Setup", section: "start", order: 20,
    summary: "Requirements and the steps to set up an instance.", verified: null },
  { source: "docs/ADOPT-WITH-AN-AGENT.md", slug: "adopt-with-an-agent", title: "Adopt with an agent", section: "start", order: 40,
    summary: "The recipe an AI agent follows to create a new instance from the framework.", verified: null },

  { source: "docs/OPERATOR-GUIDE.md", slug: "operator-guide", title: "Operator guide", section: "operate", order: 10,
    summary: "A manual for operators who do not write code.", verified: null },

  { source: "docs/MODULES.md", slug: "modules", title: "Module catalog", section: "modules", order: 10,
    summary: "Every module, what it is, how it works and its status.", verified: null },
  { source: "docs/RAD-ORG-OS.md", slug: "rad-org-os", title: "rad-org-os", section: "modules", order: 30,
    summary: "The Radicle-native distribution of org-os.", verified: null },

  { source: "docs/DATA-MODEL.md", slug: "data-model", title: "Data model", section: "reference", order: 20,
    summary: "The registries under data/ and their fields.", verified: null },
  { source: "docs/FEDERATION.md", slug: "federation", title: "Federation protocol", section: "reference", order: 30,
    summary: "federation.yaml, peers, trust levels and how instances stay in step.", verified: null },
  { source: "docs/EIP4824-GUIDE.md", slug: "eip4824", title: "EIP-4824", section: "reference", order: 40,
    summary: "How an instance publishes EIP-4824 schemas under .well-known/.", verified: null },
  { source: "docs/PACKAGE-LIFECYCLE.md", slug: "package-lifecycle", title: "Package lifecycle", section: "reference", order: 80,
    summary: "How packages are promoted, integrated and retired.", verified: null },

  { source: "docs/ARCHITECTURE.md", slug: "architecture", title: "Architecture", section: "concepts", order: 10,
    summary: "How the framework is put together.", verified: null },
  { source: "docs/AGENTIC-ARCHITECTURE.md", slug: "agentic-architecture", title: "Agentic architecture", section: "concepts", order: 20,
    summary: "How agents operate inside a workspace.", verified: null },
  { source: "docs/ECOSYSTEM.md", slug: "ecosystem", title: "Ecosystem", section: "concepts", order: 60,
    summary: "The projects and repositories around org-os.", verified: null },
];

export const ORDERED = sortPages(PAGES, SECTIONS);
export const sectionById = (id) => SECTIONS.find((s) => s.id === id);
export const pageBySlug = (slug) => PAGES.find((p) => p.slug === slug);
export const pageBySource = (source) => PAGES.find((p) => p.source === source);
export const pagesBySection = (sectionId) => ORDERED.filter((p) => p.section === sectionId);
export const neighbours = (slug) => neighboursOf(PAGES, SECTIONS, slug);
