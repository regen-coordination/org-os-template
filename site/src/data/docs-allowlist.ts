// The curated docs surfaced on-site. `file` matches the markdown filename (without .md)
// in org-os/docs/. The long tail stays repo-only until promoted here.
export interface DocEntry { file: string; slug: string; title: string; group: string; }
export const DOCS_ALLOWLIST: DocEntry[] = [
  { file: "ARCHITECTURE",         slug: "architecture",          title: "Architecture",            group: "Concepts" },
  { file: "MODULES",              slug: "modules",               title: "Modules",                 group: "Concepts" },
  { file: "AGENTIC-ARCHITECTURE", slug: "agentic-architecture",  title: "Agentic Architecture",    group: "Concepts" },
  { file: "FEDERATION",           slug: "federation",            title: "Federation",              group: "Concepts" },
  { file: "ECOSYSTEM",            slug: "ecosystem",             title: "Ecosystem",               group: "Concepts" },
  { file: "DATA-MODEL",           slug: "data-model",            title: "Data Model",              group: "Reference" },
  { file: "EIP4824-GUIDE",        slug: "eip4824",               title: "EIP-4824 Guide",          group: "Reference" },
  { file: "PACKAGE-LIFECYCLE",    slug: "package-lifecycle",     title: "Package Lifecycle",       group: "Reference" },
  { file: "OPERATOR-GUIDE",       slug: "operator-guide",        title: "Operator Guide",          group: "Operating" },
  { file: "RAD-ORG-OS",           slug: "rad-org-os",            title: "rad-org-os",              group: "Modules" },
];
export const docBySlug = (slug: string) => DOCS_ALLOWLIST.find((d) => d.slug === slug);
export const docByFile = (file: string) =>
  DOCS_ALLOWLIST.find((d) => d.file.toLowerCase() === file.toLowerCase());
