import http from "node:http";
import { randomUUID } from "node:crypto";
import { createStore } from "./store.js";
import { createScreen, threadScreen } from "./html.js";

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function parseBody(req, raw) {
  const type = req.headers["content-type"] || "";
  if (type.includes("application/json")) {
    return raw ? JSON.parse(raw) : {};
  }
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

function send(res, code, body, headers = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, headers);
  res.end(data);
}

function html(res, code, body) {
  send(res, code, body, { "content-type": "text/html; charset=utf-8" });
}

function json(res, code, body) {
  send(res, code, body, { "content-type": "application/json" });
}

function wantsJson(req) {
  const accept = req.headers.accept || "";
  const type = req.headers["content-type"] || "";
  return type.includes("application/json") || accept.includes("application/json");
}

function currentThread(state) {
  return state.threads.find((t) => t.id === state.currentThreadId) || null;
}

async function computerFetch(url, pathname, options = {}) {
  const res = await fetch(url.replace(/\/$/, "") + pathname, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `computer ${res.status}`);
  return body;
}

export function startApp({ port = 0, home, computerUrl = null }) {
  const store = createStore(home);
  let state = store.load();
  if (computerUrl) {
    state.computerUrl = computerUrl;
    store.save(state);
  }

  function persist() {
    store.save(state);
    state = store.load();
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const method = req.method;
      const raw = method === "GET" ? "" : await readBody(req);
      const body = method === "GET" ? {} : parseBody(req, raw);

      if (method === "GET" && (url.pathname === "/" || url.pathname === "/thread")) {
        const thread = currentThread(state);
        if (!thread) return html(res, 200, createScreen());
        return html(res, 200, threadScreen(state));
      }

      if (method === "POST" && (url.pathname === "/create" || url.pathname === "/api/threads")) {
        const name = String(body.name || "").trim();
        if (!name) {
          if (wantsJson(req)) return json(res, 400, { error: "name required", created: false });
          return html(res, 200, createScreen());
        }
        const thread = { id: randomUUID(), name };
        state.threads.push(thread);
        state.currentThreadId = thread.id;
        persist();
        if (wantsJson(req)) {
          return json(res, 201, { thread, screen: "project-thread" });
        }
        return html(res, 200, threadScreen(state));
      }

      if (method === "GET" && url.pathname === "/api/state") {
        return json(res, 200, {
          pid: process.pid,
          thread: currentThread(state),
          agents: state.agents,
          memory: state.memory,
          computerUrl: state.computerUrl,
          screen: currentThread(state) ? "project-thread" : "create",
        });
      }

      if (method === "POST" && url.pathname === "/agents") {
        const thread = currentThread(state);
        if (!thread) return json(res, 400, { error: "no project thread" });
        const name = String(body.name || "").trim();
        if (!name) return json(res, 400, { error: "name required" });
        const agent = { id: randomUUID(), name, threadId: thread.id };
        state.agents.push(agent);
        if (!state.memory[agent.id]) state.memory[agent.id] = [];
        persist();
        if (wantsJson(req)) return json(res, 201, { agent });
        return html(res, 200, threadScreen(state));
      }

      if (method === "POST" && url.pathname === "/computer/connect") {
        const next = String(body.url || "").trim();
        if (!next) return json(res, 400, { error: "url required" });
        await computerFetch(next, "/health");
        state.computerUrl = next.replace(/\/$/, "");
        persist();
        if (wantsJson(req)) return json(res, 200, { computerUrl: state.computerUrl });
        return html(res, 200, threadScreen(state));
      }

      const fileMatch = url.pathname.match(/^\/agents\/([^/]+)\/files$/);
      if (fileMatch && method === "POST") {
        const agent = state.agents.find((a) => a.id === fileMatch[1]);
        if (!agent) return json(res, 404, { error: "unknown agent" });
        if (!state.computerUrl) {
          return json(res, 409, { error: "no computer connected", wrote: false });
        }
        const written = await computerFetch(state.computerUrl, "/write", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agentId: agent.id,
            path: body.path,
            content: body.content ?? "",
          }),
        });
        if (wantsJson(req)) return json(res, 200, written);
        return html(res, 200, threadScreen(state));
      }
      if (fileMatch && method === "GET") {
        const agent = state.agents.find((a) => a.id === fileMatch[1]);
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
        const agent = state.agents.find((a) => a.id === memMatch[1]);
        if (!agent) return json(res, 404, { error: "unknown agent" });
        const text = String(body.fact ?? body.text ?? "").trim();
        if (!text) return json(res, 400, { error: "fact required" });
        if (!state.memory[agent.id]) state.memory[agent.id] = [];
        state.memory[agent.id].push({ text, at: new Date().toISOString() });
        persist();
        if (wantsJson(req)) return json(res, 201, { memory: state.memory[agent.id] });
        return html(res, 200, threadScreen(state));
      }
      if (memMatch && method === "GET") {
        const agent = state.agents.find((a) => a.id === memMatch[1]);
        if (!agent) return json(res, 404, { error: "unknown agent" });
        return json(res, 200, { memory: state.memory[agent.id] || [] });
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: err.message || String(err) });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${addr.port}`;
      process.stdout.write(`HEARTH_READY ${url} pid=${process.pid} home=${store.dir}\n`);
      resolve({ server, url, pid: process.pid, home: store.dir });
    });
  });
}
