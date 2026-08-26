import fs from "node:fs";
import path from "node:path";
import { emptyState, type Fact, type State } from "./domain.js";
import { asAgentId, asThreadId } from "./ids.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseState(raw: unknown): State {
  const base = emptyState();
  if (!isRecord(raw)) return base;
  try {
    const currentThreadId =
      raw.currentThreadId == null ? null : asThreadId(raw.currentThreadId);
    const threads = Array.isArray(raw.threads)
      ? raw.threads.flatMap((t) => {
          if (!isRecord(t) || typeof t.name !== "string") return [];
          return [{ id: asThreadId(t.id), name: t.name }];
        })
      : [];
    const agents = Array.isArray(raw.agents)
      ? raw.agents.flatMap((a) => {
          if (!isRecord(a) || typeof a.name !== "string") return [];
          return [{ id: asAgentId(a.id), name: a.name, threadId: asThreadId(a.threadId) }];
        })
      : [];
    const memory: State["memory"] = {};
    if (isRecord(raw.memory)) {
      for (const [key, value] of Object.entries(raw.memory)) {
        if (!Array.isArray(value)) continue;
        const facts: Fact[] = value.flatMap((f) => {
          if (!isRecord(f) || typeof f.text !== "string") return [];
          return [{ text: f.text, at: typeof f.at === "string" ? f.at : "" }];
        });
        memory[asAgentId(key)] = facts;
      }
    }
    const computerUrl = typeof raw.computerUrl === "string" ? raw.computerUrl : null;
    return { currentThreadId, threads, agents, memory, computerUrl };
  } catch {
    return base;
  }
}

export function createStore(args: { home: string }) {
  const dir = path.resolve(args.home);
  const file = path.join(dir, "state.json");
  fs.mkdirSync(dir, { recursive: true });

  function load(): State {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      return parseState(parsed);
    } catch {
      return emptyState();
    }
  }

  function save(state: State): void {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }

  return { dir, file, load, save };
}
