export type NoticeLevel = "info" | "warn" | "error";
export type Notice = { level: NoticeLevel; text: string };
export type PageRef = { page: string; id?: string; workspace?: string };
export type TableRow = { key: string; cells: string[]; target?: PageRef };
export type ListItem = { key: string; label: string; detail?: string; badge?: string; target?: PageRef };
export type Block =
  | { kind: "table"; heading?: string; columns: string[]; rows: TableRow[] }
  | { kind: "list"; heading?: string; items: ListItem[] }
  | { kind: "kv"; heading?: string; pairs: [string, string][] }
  | { kind: "markdown"; text: string }
  | { kind: "notice"; level: NoticeLevel; text: string };
export type ActionRef = { id: string; label: string };
export type PageData = { ref: PageRef; title: string; subtitle?: string; blocks: Block[]; actions: ActionRef[]; sources: string[]; errors: string[] };
export type WorkspaceKind = "hub" | "framework" | "instance" | "extra";
export type WorkspaceInfo = { id: string; label: string; root: string; kind: WorkspaceKind; exists: boolean; drift: number };
export type GitStatus = { branch: string | null; dirty: boolean; ahead: number; behind: number; lastCommit: string | null };
export type WorkspaceSummary = { id: string; name: string; type: string | null; git: GitStatus | null; openTasks: number; urgentTasks: number; lastMemory: string | null; errors: string[] };
export type HostId = "claude" | "pi" | "opencode";
export const HOSTS: HostId[] = ["claude", "pi", "opencode"];
export type Placement = "split" | "tab";
export type LifecycleCommand = "initialize" | "close" | "sync" | "commit" | "handoff";
export const LIFECYCLE_COMMANDS: LifecycleCommand[] = ["initialize", "close", "sync", "commit", "handoff"];
export type LaunchStrategy = "herdr" | "tmux" | "zellij" | "ghostty" | "suspend";
export type AgentStatus = "idle" | "working" | "blocked" | "error";
export type AgentEvent =
  | { type: "status"; status: AgentStatus; detail?: string }
  | { type: "user"; text: string }
  | { type: "text_delta"; delta: string }
  | { type: "assistant_end"; text: string }
  | { type: "tool_start"; callId: string; tool: string; summary: string }
  | { type: "tool_end"; callId: string; ok: boolean; summary: string }
  | { type: "notice"; level: NoticeLevel; text: string };
export type PermissionAnswer = "once" | "session" | "deny";
export type PermissionRequest = { id: string; workspace: string; tool: string; summary: string; input: Record<string, unknown> };
export type HerdrAgent = { paneId: string; workspaceId: string; name: string | null; agent: string | null; status: string; cwd: string | null; title: string | null };
export type ForegroundEffect = { type: "foreground"; cmd: string; args: string[]; cwd: string };
export type Command =
  | { type: "select-workspace"; id: string }
  | { type: "open-page"; ref: PageRef }
  | { type: "back" }
  | { type: "refresh" }
  | { type: "run-action"; actionId: string }
  | { type: "launch"; host: HostId; placement: Placement; paneCols?: number }
  | { type: "agent-prompt"; text: string }
  | { type: "agent-command"; name: LifecycleCommand; args?: string }
  | { type: "agent-abort" }
  | { type: "agent-new-session" }
  | { type: "permission-answer"; id: string; answer: PermissionAnswer };
