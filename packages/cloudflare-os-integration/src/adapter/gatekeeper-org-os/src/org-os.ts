// gatekeeper-org-os — exposes org-os instances (registries, pages, federation, context) to a
// Cloudflare OS workspace as read-only capabilities.
//
// All the meaning lives in the vendored core under vendor/org-os-core (canonical copy:
// org-os/packages/cloudflare-os-integration/src, 86 tests). This file is the adapter: it turns
// the core's `handle(name, args)` envelope dispatcher into the capability-shaped Session API the
// platform expects, and satisfies the platform's contracts (observation authorization, observer
// verification, auto-provisioning).
//
// Read-only by construction: there is no action path at all, so applyAction/revertAction throw.
// Writes are M3 and will arrive as PR-only actions through the approval queue.

import { DurableObject, RpcStub, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  AccountDescription,
  ApprovalQueue,
  Gatekeeper,
  GatekeeperConnectCallback,
  GatekeeperConnectOptions,
  GatekeeperUser,
  GatekeeperUserVerifier,
  ResourceConfiguratorFrame,
  ResourceDescription,
  SupportedResource,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import type {
  OrgOsDocument,
  OrgOsInstance,
  OrgOsInstanceRef,
  OrgOsPage,
  OrgOsPageId,
  OrgOsSession,
} from "./types.js";
import TYPES_CODE from "./types-code.js";
import { createGatekeeper } from "../vendor/org-os-core/gatekeeper/capabilities.mjs";
import { GitHubSubstrate } from "../vendor/org-os-core/substrate/github-substrate.mjs";

// ── the vendored core's contract, restated ───────────────────────────────────
// The core is plain JavaScript, so these describe the seam rather than import it. They must stay
// in step with org-os/packages/cloudflare-os-integration/src/gatekeeper/capabilities.mjs — that
// package's 86 tests are the real contract; these types only stop the adapter misusing it.

interface CoreProvenance {
  instance: string;
  sha: string;
  date: string;
  stale: boolean;
}

type CoreEnvelope =
  | { ok: true; data: unknown; provenance: CoreProvenance }
  | { ok: false; error: { code: string; message: string; detail?: string } };

interface CoreInstance {
  id: string;
  owner: string;
  repo: string;
  ref?: string;
  trust?: string;
}

interface CoreGatekeeper {
  handle(name: string, args: Record<string, unknown>): Promise<CoreEnvelope>;
}

const ORG_OS_ICON = {
  url:
    "data:image/svg+xml," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='none' stroke='currentColor' stroke-width='16'><circle cx='128' cy='128' r='36'/><circle cx='128' cy='40' r='20'/><circle cx='204' cy='172' r='20'/><circle cx='52' cy='172' r='20'/><path d='M128 92V60M147 147l40 15M109 147l-40 15'/></svg>",
    ),
};

const SUPPORTED_PAGE_IDS: readonly OrgOsPageId[] = [
  "dashboard",
  "projects",
  "tasks",
  "instances",
  "decisions",
  "plans",
  "this-week",
];

// Only the slice of ApprovalQueue this gatekeeper uses. Every capability here is a read, so
// authorizeObservation is the whole surface — there is no submitAction call anywhere.
type ObservationQueue = Pick<ApprovalQueue, "authorizeObservation"> &
  Partial<{ [Symbol.dispose](): void }>;

// ORG_OS_INSTANCES comes from wrangler vars and is already on the generated Cloudflare.Env
// (as a string literal type); only the secret needs declaring here.
interface OrgOsEnv extends Cloudflare.Env {
  /** Fine-grained GitHub PAT, contents:read. Wrangler secret — never in config. */
  ORG_OS_GITHUB_TOKEN?: string;
}

function parseInstances(env: OrgOsEnv): CoreInstance[] {
  const raw: string | undefined = env.ORG_OS_INSTANCES;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CoreInstance[]) : [];
  } catch {
    // A malformed registry must not take the worker down at construction; the failure surfaces
    // as "no instances configured" on the first call, which names the real problem to the operator.
    return [];
  }
}

/**
 * Unwraps a core envelope. `ok:false` becomes a thrown Error carrying the operator-facing
 * message only — `detail` holds raw upstream bodies and parser output and must never reach a
 * display surface (see the core's capabilities.mjs header).
 */
function unwrap(envelope: CoreEnvelope): { data: unknown; provenance: OrgOsDocument["provenance"] } {
  if (!envelope.ok) {
    throw new Error(envelope.error.message);
  }
  return { data: envelope.data, provenance: envelope.provenance };
}

@validateRpc()
export class OrgOsInstanceImpl extends RpcTarget implements OrgOsInstance {
  readonly #approvalQueue: ObservationQueue;
  readonly #core: CoreGatekeeper;
  readonly #instanceId: string;

  constructor(approvalQueue: ObservationQueue, core: CoreGatekeeper, instanceId: string) {
    super();
    this.#approvalQueue = approvalQueue;
    this.#core = core;
    this.#instanceId = instanceId;
  }

  // Authorize before reading, not after: an observation the user would deny should not cause an
  // upstream fetch at all. The description names the instance and the exact resource so the
  // approver can judge it without guessing.
  async #observe(title: string, description: string): Promise<void> {
    await this.#approvalQueue.authorizeObservation({ title, description });
  }

  async #call(capability: string, args: Record<string, unknown>) {
    return unwrap(await this.#core.handle(capability, { instance: this.#instanceId, ...args }));
  }

  async getPage(pageId: OrgOsPageId): Promise<OrgOsPage> {
    if (!SUPPORTED_PAGE_IDS.includes(pageId)) {
      throw new Error(
        `"${String(pageId)}" isn't a page this gatekeeper can render — try one of: ${SUPPORTED_PAGE_IDS.join(", ")}.`,
      );
    }
    await this.#observe(
      `Read the ${pageId} page of ${this.#instanceId}`,
      `Render the **${pageId}** page for org-os instance \`${this.#instanceId}\`, reading its registries, heartbeat, decisions and plan queue from the organization's repository.`,
    );
    const { data, provenance } = await this.#call("get_page", { page_id: pageId });
    const page = data as { page_id: OrgOsPageId; markdown: string };
    return { pageId: page.page_id, markdown: page.markdown, provenance };
  }

  async getRegistry(name: string): Promise<OrgOsDocument> {
    await this.#observe(
      `Read the ${name} registry of ${this.#instanceId}`,
      `Read \`data/${name}.yaml\` from org-os instance \`${this.#instanceId}\`.`,
    );
    return this.#call("get_registry", { name });
  }

  async getFederation(): Promise<OrgOsDocument> {
    await this.#observe(
      `Read the federation topology of ${this.#instanceId}`,
      `Read \`federation.yaml\` from org-os instance \`${this.#instanceId}\` — its peers, upstream and network.`,
    );
    return this.#call("get_federation", {});
  }

  async getSchema(name: string): Promise<OrgOsDocument> {
    await this.#observe(
      `Read the ${name} descriptor of ${this.#instanceId}`,
      `Read \`.well-known/${name}.json\` from org-os instance \`${this.#instanceId}\`.`,
    );
    return this.#call("get_schema", { name });
  }

  async getContextBundle(): Promise<OrgOsDocument> {
    await this.#observe(
      `Load organizational context for ${this.#instanceId}`,
      `Read the identity, agent rules, memory index, recent decisions and core registries of org-os instance \`${this.#instanceId}\`.`,
    );
    return this.#call("get_context_bundle", {});
  }

  [Symbol.dispose](): void {
    this.#approvalQueue[Symbol.dispose]?.();
  }
}

@validateRpc()
export class OrgOsSessionImpl extends RpcTarget implements OrgOsSession {
  readonly #approvalQueue: ObservationQueue;
  readonly #core: CoreGatekeeper;
  readonly #instances: CoreInstance[];

  constructor(approvalQueue: ObservationQueue, core: CoreGatekeeper, instances: CoreInstance[]) {
    super();
    this.#approvalQueue = approvalQueue;
    this.#core = core;
    this.#instances = instances;
  }

  async listInstances(): Promise<OrgOsInstanceRef[]> {
    // Listing what is configured reveals repository coordinates, so it is an observation like
    // any other read — cheap, but not free of information.
    await this.#approvalQueue.authorizeObservation({
      title: "List configured org-os instances",
      description: "List the org-os instances this deployment is configured to read.",
    });
    return this.#instances.map(({ id, owner, repo }) => ({ id, owner, repo }));
  }

  async instance(id: string): Promise<OrgOsInstance> {
    const found = this.#instances.find((i) => i.id === id);
    if (!found) {
      throw new Error(`"${String(id)}" isn't a configured org-os instance.`);
    }
    return new OrgOsInstanceImpl(this.#approvalQueue, this.#core, found.id);
  }

  [Symbol.dispose](): void {
    this.#approvalQueue[Symbol.dispose]?.();
  }
}

@validateRpc()
export class OrgOsGatekeeperImpl
  extends DurableObject<OrgOsEnv>
  implements Gatekeeper<OrgOsSession>
{
  // Substrate cache lives on the DO instance. A Durable Object is single-threaded and
  // long-lived, so an in-memory Map gives real ETag/TTL reuse across requests without the
  // async round-trip DO storage would add on every read. It is lost when the DO evicts, which
  // costs one revalidation, not correctness.
  readonly #cache = new Map<string, unknown>();
  #core: CoreGatekeeper | undefined;

  #instances(): CoreInstance[] {
    return parseInstances(this.env);
  }

  #gatekeeper(): CoreGatekeeper {
    const existing = this.#core;
    if (existing) return existing;

    const token = this.env.ORG_OS_GITHUB_TOKEN;
    const created = createGatekeeper({
      instances: this.#instances(),
      substrateFor: (instance: CoreInstance) =>
        new GitHubSubstrate({
          owner: instance.owner,
          repo: instance.repo,
          ref: instance.ref,
          token,
          fetchImpl: globalThis.fetch.bind(globalThis),
          cache: this.#cache,
        }),
    });

    // The core is plain JavaScript, so TypeScript widens its envelope's `ok` to boolean and the
    // discriminated union stops narrowing. This is the one place that gap is crossed; the shape
    // itself is guaranteed by the core's own tests, not by this assertion.
    this.#core = created as unknown as CoreGatekeeper;
    return this.#core;
  }

  async describe(): Promise<ResourceDescription> {
    return {
      url: "orgos://federation",
      title: "org-os federation",
      snippet: "Read projects, tasks, decisions, federation and context from org-os instances.",
      suggestedBindingName: "ORG_OS",
      tsType: "OrgOsSession",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  async getAutoApprovableActions(): Promise<[]> {
    return [];
  }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<OrgOsSession> {
    return new OrgOsSessionImpl(approvalQueue.dup(), this.#gatekeeper(), this.#instances());
  }

  // Observer policy.
  //
  // This gatekeeper is auto-provisioned and reads through ONE deployment-level GitHub token, not
  // per-user OAuth. So every authenticated workspace user already has exactly the same access to
  // exactly the same repositories — there is no per-user authority to compare against, and an
  // observer can never see data a peer could not have read themselves through this same
  // gatekeeper. Verification is therefore unconditional, and correct *given that model*.
  //
  // The security boundary is workspace membership, enforced upstream at sign-in. That means a
  // PRIVATE instance's contents are readable by every workspace user. That is a deliberate,
  // documented property of the deployment-token design (see docs/integrations/cloudflare-os.md
  // §D7) — NOT an oversight. If the federation ever needs per-user access differentiation, this
  // must become per-user OAuth and this method must gain a real check.
  async addObserver(_id: string, _user: Fetcher<GatekeeperUserVerifier>): Promise<void> {}
  async removeObserver(_id: string): Promise<void> {}

  async applyAction(action: number): Promise<void> {
    throw new Error(`gatekeeper-org-os is read-only; writes arrive in M3 (${action}).`);
  }

  async rejectAction(_action: number): Promise<void> {}

  async revertAction(_action: number): Promise<void> {
    throw new Error("gatekeeper-org-os is read-only; there are no actions to revert.");
  }
}

@validateRpc()
export class OrgOsAccount extends WorkerEntrypoint<OrgOsEnv> implements GatekeeperUser {
  async describe(): Promise<AccountDescription> {
    return {
      displayName: "org-os",
      avatar: ORG_OS_ICON,
      // The singleton is what makes org context ambient in chat: the agent receives the session
      // as a named binding and can call getContextBundle() at the start of a conversation.
      singleton: { tsType: "OrgOsSession" },
    };
  }

  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<OrgOsSession>>> {
    return this.ctx.exports.OrgOsGatekeeperImpl({});
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return [];
  }

  getGatekeeperClassFor(_url: string): never {
    throw new Error("gatekeeper-org-os exposes the federation as a singleton, not URL resources.");
  }

  startResourceConfigurator(_resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    throw new Error("gatekeeper-org-os has no URL-addressed resources.");
  }

  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    return {};
  }

  async revoke(): Promise<void> {}

  reconnect(): Promise<{ url: string }> {
    throw new Error("gatekeeper-org-os is auto-provisioned and has no credentials to reconnect.");
  }

  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.OrgOsVerifier({});
  }
}

@validateRpc()
export class OrgOsVerifier
  extends WorkerEntrypoint<OrgOsEnv>
  implements GatekeeperUserVerifier
{
  verify(): void {}
}

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<OrgOsEnv> {
  async describe(): Promise<VendorDescription> {
    return {
      displayName: "org-os",
      url: "https://github.com/regen-coordination/org-os-template",
      logo: ORG_OS_ICON,
      color: "#eef7f0",
      tagline: "Your organization's operational state, from git",
      description:
        "Read projects, tasks, decisions, federation topology and organizational context from org-os instances. Every answer carries the commit it was read at.",
      autoProvisionsAccount: true,
      providesAuth: false,
    };
  }

  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    return this.ctx.exports.OrgOsAccount({});
  }

  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions,
  ): Promise<{ url: string }> {
    throw new Error("gatekeeper-org-os is auto-provisioned and has no connect flow.");
  }

  async getSupportedResources(_options?: { userId?: string }): Promise<SupportedResource[]> {
    return [];
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("gatekeeper-org-os worker is running.", {
      headers: { "content-type": "text/plain" },
    });
  },
};
