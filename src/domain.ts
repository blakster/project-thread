import type { AgentId, ThreadId } from "./ids.js";

export type Thread = {
  id: ThreadId;
  name: string;
};

export type Agent = {
  id: AgentId;
  name: string;
  threadId: ThreadId;
};

export type Fact = {
  text: string;
  at: string;
};

export type Screen =
  | { kind: "create" }
  | { kind: "project-thread"; thread: Thread };

export type State = {
  currentThreadId: ThreadId | null;
  threads: Thread[];
  agents: Agent[];
  memory: Partial<Record<AgentId, Fact[]>>;
  computerUrl: string | null;
};

export function emptyState(): State {
  return {
    currentThreadId: null,
    threads: [],
    agents: [],
    memory: {},
    computerUrl: null,
  };
}

export function screenOf(state: State): Screen {
  const thread = state.threads.find((t) => t.id === state.currentThreadId);
  if (!thread) return { kind: "create" };
  return { kind: "project-thread", thread };
}

export function currentThread(state: State): Thread | null {
  const screen = screenOf(state);
  return screen.kind === "project-thread" ? screen.thread : null;
}

export function parseTrimmedName(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  if (!("name" in body)) return null;
  const name = body.name;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseComputerUrl(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  if (!("url" in body)) return null;
  const url = body.url;
  if (typeof url !== "string") return null;
  const trimmed = url.trim().replace(/\/$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

export function parseFileWrite(body: unknown): { path: string; content: string } | null {
  if (typeof body !== "object" || body === null) return null;
  if (!("path" in body)) return null;
  const rel = body.path;
  if (typeof rel !== "string" || !rel.trim()) return null;
  const content = "content" in body && body.content != null ? String(body.content) : "";
  return { path: rel, content };
}

export function parseFact(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const raw =
    "fact" in body && typeof body.fact === "string"
      ? body.fact
      : "text" in body && typeof body.text === "string"
        ? body.text
        : null;
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function exhaustive(_x: never): never {
  throw new Error("unhandled variant");
}
