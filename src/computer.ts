import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { asAgentId } from "./ids.js";

function agentHome(root: string, agentId: string): string {
  return path.resolve(root, "agents", asAgentId(agentId));
}

function resolveInHome(home: string, rel: string): string {
  if (typeof rel !== "string" || !rel.trim()) throw new Error("invalid path");
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.split("/").some((p) => p === ".." || p === "")) {
    throw new Error("invalid path");
  }
  const full = path.resolve(home, normalized);
  const prefix = home.endsWith(path.sep) ? home : home + path.sep;
  if (full !== home && !full.startsWith(prefix)) throw new Error("path escapes home");
  return full;
}

function listFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function send(res: http.ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(data);
}

function isWriteBody(body: unknown): body is { agentId: unknown; path: unknown; content?: unknown } {
  return typeof body === "object" && body !== null && "agentId" in body && "path" in body;
}

export function startComputer(args: { port?: number; root: string }): Promise<{
  server: http.Server;
  url: string;
  pid: number;
  root: string;
}> {
  const { port = 0, root } = args;
  if (!root) throw new Error("computer root is required");
  const computerRoot = path.resolve(root);
  fs.mkdirSync(computerRoot, { recursive: true });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, pid: process.pid, root: computerRoot });
      }
      if (req.method === "GET" && url.pathname === "/files") {
        const home = agentHome(computerRoot, url.searchParams.get("agentId") ?? "");
        const files = listFiles(home).map((rel) => ({
          path: rel,
          abs: path.join(home, rel),
        }));
        return send(res, 200, { agentId: url.searchParams.get("agentId"), root: home, files });
      }
      if (req.method === "POST" && url.pathname === "/write") {
        const body = await readBody(req);
        if (!isWriteBody(body) || typeof body.path !== "string") {
          return send(res, 400, { error: "invalid write" });
        }
        const home = agentHome(computerRoot, String(body.agentId));
        const dest = resolveInHome(home, body.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, String(body.content ?? ""), "utf8");
        return send(res, 200, { ok: true, abs: dest, path: body.path });
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(res, 400, { error: message });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("computer listen failed");
      const url = `http://127.0.0.1:${addr.port}`;
      process.stdout.write(`COMPUTER_READY ${url} pid=${process.pid} root=${computerRoot}\n`);
      resolve({ server, url, pid: process.pid, root: computerRoot });
    });
  });
}
