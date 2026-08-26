import path from "node:path";

export type AgentId = string & { readonly __brand: "AgentId" };
export type ThreadId = string & { readonly __brand: "ThreadId" };

export function asAgentId(raw: unknown): AgentId {
  if (typeof raw !== "string" || !raw || raw !== path.basename(raw) || raw === "." || raw === "..") {
    throw new Error("invalid agent id");
  }
  return raw as AgentId;
}

export function asThreadId(raw: unknown): ThreadId {
  if (typeof raw !== "string" || !raw) {
    throw new Error("invalid thread id");
  }
  return raw as ThreadId;
}
