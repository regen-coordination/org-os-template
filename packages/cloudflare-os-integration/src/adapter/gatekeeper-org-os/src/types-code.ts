// GENERATED from types.d.ts by `pnpm run sync:types` — do not edit by hand.
const TYPES_CODE = `/** Where a piece of data came from: the exact commit it was read at. */
export interface OrgOsProvenance {
  /** Instance id, e.g. "org-os". */
  instance: string;
  /** Commit SHA the data was read at. */
  sha: string;
  /** Commit date, ISO 8601. */
  date: string;
  /** True when the live source was unreachable and cached data was served instead. */
  stale: boolean;
}

/** One org-os instance reachable through this gatekeeper. */
export interface OrgOsInstanceRef {
  /** Stable id used to address this instance. */
  id: string;
  /** Owning GitHub account or organization. */
  owner: string;
  /** Repository name. */
  repo: string;
}

/** Pages that can be rendered for an instance. */
export type OrgOsPageId =
  | "dashboard"
  | "projects"
  | "tasks"
  | "instances"
  | "decisions"
  | "plans"
  | "this-week";

/** A rendered page of an instance's operational state. */
export interface OrgOsPage {
  pageId: OrgOsPageId;
  /** Markdown, ready to display. */
  markdown: string;
  provenance: OrgOsProvenance;
}

/** A parsed registry, federation config, or descriptor, with its provenance. */
export interface OrgOsDocument<T = unknown> {
  data: T;
  provenance: OrgOsProvenance;
}

/**
 * A single org-os instance. Read-only.
 *
 * Every method reads live from the instance's repository, so results reflect
 * committed state and carry the commit they were read at.
 */
export interface OrgOsInstance {
  /**
   * Renders a page of the instance's current state as markdown.
   *
   * @param pageId Which page to render.
   * @throws If \`pageId\` is not one of the supported pages.
   */
  getPage(pageId: OrgOsPageId): Promise<OrgOsPage>;

  /**
   * Reads a structured registry from the instance's \`data/\` directory.
   *
   * @param name Registry name without extension, e.g. "projects", "members",
   *   "meetings". Lowercase letters, digits and hyphens only.
   * @throws If the registry does not exist or cannot be parsed.
   */
  getRegistry(name: string): Promise<OrgOsDocument>;

  /** Reads the instance's federation topology: peers, upstream, network. */
  getFederation(): Promise<OrgOsDocument>;

  /**
   * Reads a \`.well-known\` EIP-4824 descriptor.
   *
   * @param name Descriptor name without extension, e.g. "dao", "projects".
   * @throws If the descriptor does not exist or is not valid JSON.
   */
  getSchema(name: string): Promise<OrgOsDocument>;

  /**
   * Loads the instance's identity, agent rules, memory index, recent decisions
   * and core registry snapshots. Call this at the start of a conversation to
   * ground answers in the organization's actual state.
   */
  getContextBundle(): Promise<OrgOsDocument>;
}

/** The org-os federation reachable from this deployment. */
export interface OrgOsSession {
  /** Lists the instances this deployment is configured to read. */
  listInstances(): Promise<OrgOsInstanceRef[]>;

  /**
   * Returns a handle to one instance.
   *
   * @param id An id from \`listInstances()\`.
   * @throws If no such instance is configured.
   */
  instance(id: string): Promise<OrgOsInstance>;
}
`;

export default TYPES_CODE;
