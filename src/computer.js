import http from "node:http";
import fs from "node:fs";
import path from "node:path";

function badId(id) {
  return !id || typeof id !== "string" || id !== path.basename(id) || id === "." || id === "..";
}

function agentHome(root, agentId) {
  if (badId(agentId)) throw new Error("invalid agent id");
  return path.resolve(root, "agents", agentId);
}

function resolveInHome(home, rel) {
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

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function send(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(data);
}

export function startComputer({ port = 0, root }) {
  if (!root) throw new Error("computer root is required");
  const computerRoot = path.resolve(root);
  fs.mkdirSync(computerRoot, { recursive: true });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, pid: process.pid, root: computerRoot });
      }
      if (req.method === "GET" && url.pathname === "/files") {
        const agentId = url.searchParams.get("agentId");
        const home = agentHome(computerRoot, agentId);
        const files = listFiles(home).map((rel) => ({
          path: rel,
          abs: path.join(home, rel),
        }));
        return send(res, 200, { agentId, root: home, files });
      }
      if (req.method === "POST" && url.pathname === "/write") {
        const body = await readBody(req);
        const home = agentHome(computerRoot, body.agentId);
        const dest = resolveInHome(home, body.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, String(body.content ?? ""), "utf8");
        return send(res, 200, { ok: true, abs: dest, path: body.path });
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 400, { error: err.message || String(err) });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${addr.port}`;
      process.stdout.write(`COMPUTER_READY ${url} pid=${process.pid} root=${computerRoot}\n`);
      resolve({ server, url, pid: process.pid, root: computerRoot });
    });
  });
}
