import http from "node:http";
import { randomUUID } from "node:crypto";
import { createStore } from "./store.js";
import { createScreen, threadScreen } from "./html.js";
import {
  currentThread,
  parseComputerUrl,
  parseFact,
  parseFileWrite,
  parseTrimmedName,
  screenOf,
  type State,
} from "./domain.js";
import { asAgentId, asThreadId, type AgentId } from "./ids.js";

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseBody(req: http.IncomingMessage, raw: string): unknown {
  const type = req.headers["content-type"] || "";
  if (type.includes("application/json")) {
    if (!raw) return {};
    return JSON.parse(raw) as unknown;
  }
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

function send(
  res: http.ServerResponse,
  code: number,
  body: string | unknown,
  headers: http.OutgoingHttpHeaders = {}
): void {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, headers);
  res.end(data);
}

function html(res: http.ServerResponse, code: number, body: string): void {
  send(res, code, body, { "content-type": "text/html; charset=utf-8" });
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  send(res, code, body, { "content-type": "application/json" });
}

function wantsJson(req: http.IncomingMessage): boolean {
  const accept = req.headers.accept || "";
  const type = req.headers["content-type"] || "";
  return type.includes("application/json") || accept.includes("application/json");
}

async function computerFetch(
  url: string,
  pathname: string,
  options: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(url.replace(/\/$/, "") + pathname, options);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err =
      typeof body === "object" && body !== null && "error" in body
        ? String(body.error)
        : `computer ${res.status}`;
    throw new Error(err);
  }
  return body;
}

export function startApp(args: {
  port?: number;
  home: string;
  computerUrl?: string | null;
}): Promise<{ server: http.Server; url: string; pid: number; home: string }> {
  const { port = 0, home, computerUrl = null } = args;
  const store = createStore({ home });
  let state: State = store.load();
  if (computerUrl) {
    state.computerUrl = computerUrl;
    store.save(state);
  }

  function persist(): void {
    store.save(state);
    state = store.load();
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const method = req.method;
      const raw = method === "GET" ? "" : await readBody(req);
      const body: unknown = method === "GET" ? {} : parseBody(req, raw);

      if (method === "GET" && (url.pathname === "/" || url.pathname === "/thread")) {
        const screen = screenOf(state);
        if (screen.kind === "create") return html(res, 200, createScreen());
        return html(res, 200, threadScreen(state));
      }

      if (method === "POST" && (url.pathname === "/create" || url.pathname === "/api/threads")) {
        const name = parseTrimmedName(body);
        if (!name) {
          if (wantsJson(req)) return json(res, 400, { error: "name required", created: false });
          return html(res, 200, createScreen());
        }
        const thread = { id: asThreadId(randomUUID()), name };
        state.threads.push(thread);
        state.currentThreadId = thread.id;
        persist();
        if (wantsJson(req)) {
          return json(res, 201, { thread, screen: "project-thread" });
        }
        return html(res, 200, threadScreen(state));
      }

      if (method === "GET" && url.pathname === "/api/state") {
        const screen = screenOf(state);
        return json(res, 200, {
          pid: process.pid,
          thread: currentThread(state),
          agents: state.agents,
          memory: state.memory,
          computerUrl: state.computerUrl,
          screen: screen.kind === "project-thread" ? "project-thread" : "create",
        });
      }

      if (method === "POST" && url.pathname === "/agents") {
        const thread = currentThread(state);
        if (!thread) return json(res, 400, { error: "no project thread" });
        const name = parseTrimmedName(body);
        if (!name) return json(res, 400, { error: "name required" });
        const agent = { id: asAgentId(randomUUID()), name, threadId: thread.id };
        state.agents.push(agent);
        if (!state.memory[agent.id]) state.memory[agent.id] = [];
        persist();
        if (wantsJson(req)) return json(res, 201, { agent });
        return html(res, 200, threadScreen(state));
      }

      if (method === "POST" && url.pathname === "/computer/connect") {
        const next = parseComputerUrl(body);
        if (!next) return json(res, 400, { error: "url required" });
        await computerFetch(next, "/health");
        state.computerUrl = next;
        persist();
        if (wantsJson(req)) return json(res, 200, { computerUrl: state.computerUrl });
        return html(res, 200, threadScreen(state));
      }

      const fileMatch = url.pathname.match(/^\/agents\/([^/]+)\/files$/);
      if (fileMatch && method === "POST") {
        let agentId: AgentId;
        try {
          agentId = asAgentId(fileMatch[1]);
        } catch {
          return json(res, 404, { error: "unknown agent" });
        }
        const agent = state.agents.find((a) => a.id === agentId);
        if (!agent) return json(res, 404, { error: "unknown agent" });
        if (!state.computerUrl) {
          return json(res, 409, { error: "no computer connected", wrote: false });
        }
        const write = parseFileWrite(body);
        if (!write) return json(res, 400, { error: "path required" });
        const written = await computerFetch(state.computerUrl, "/write", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agentId: agent.id,
            path: write.path,
            content: write.content,
          }),
        });
        if (wantsJson(req)) return json(res, 200, written);
        return html(res, 200, threadScreen(state));
      }
      if (fileMatch && method === "GET") {
        let agentId: AgentId;
        try {
          agentId = asAgentId(fileMatch[1]);
        } catch {
          return json(res, 404, { error: "unknown agent" });
        }
        const agent = state.agents.find((a) => a.id === agentId);
        if (!agent) return json(res, 404, { error: "unknown agent" });
        if (!state.computerUrl) return json(res, 409, { error: "no computer connected", files: [] });
        const listed = await computerFetch(
          state.computerUrl,
          `/files?agentId=${encodeURIComponent(agent.id)}`
        );
        return json(res, 200, listed);
      }

      const memMatch = url.pathname.match(/^\/agents\/([^/]+)\/memory$/);
      if (memMatch && method === "POST") {
        let agentId: AgentId;
        try {
          agentId = asAgentId(memMatch[1]);
        } catch {
          return json(res, 404, { error: "unknown agent" });
        }
        const agent = state.agents.find((a) => a.id === agentId);
        if (!agent) return json(res, 404, { error: "unknown agent" });
        const text = parseFact(body);
        if (!text) return json(res, 400, { error: "fact required" });
        const existing = state.memory[agent.id] ?? [];
        existing.push({ text, at: new Date().toISOString() });
        state.memory[agent.id] = existing;
        persist();
        if (wantsJson(req)) return json(res, 201, { memory: state.memory[agent.id] });
        return html(res, 200, threadScreen(state));
      }
      if (memMatch && method === "GET") {
        let agentId: AgentId;
        try {
          agentId = asAgentId(memMatch[1]);
        } catch {
          return json(res, 404, { error: "unknown agent" });
        }
        const agent = state.agents.find((a) => a.id === agentId);
        if (!agent) return json(res, 404, { error: "unknown agent" });
        return json(res, 200, { memory: state.memory[agent.id] ?? [] });
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      json(res, 500, { error: message });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("app listen failed");
      const url = `http://127.0.0.1:${addr.port}`;
      process.stdout.write(`HEARTH_READY ${url} pid=${process.pid} home=${store.dir}\n`);
      resolve({ server, url, pid: process.pid, home: store.dir });
    });
  });
}
