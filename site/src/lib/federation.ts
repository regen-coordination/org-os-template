import federation from "../data/federation.json";

export interface FederationNode {
  id: string; name: string; type: string; maturity: string | null;
  role: string | null; network: string | null; frameworkVersion: string | null;
  packages: string[]; drift: string[]; repo: string | null; notes: string;
  localPath: string | null; available: boolean;
  counts: { members?: number; projects?: number };
}
export interface FederationEdge { from: string; to: string; kind: "framework" | "federation"; }
export interface Federation { root: FederationNode; nodes: FederationNode[]; edges: FederationEdge[]; generatedAt: string; }

export const federationData = federation as unknown as Federation;
