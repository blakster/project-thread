import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(APP_ROOT, "dist", "index.js");

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function spawnProc(args, extraEnv = {}) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: APP_ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child._buf = "";
  child.stdout.on("data", (d) => {
    child._buf += d;
  });
  child.stderr.on("data", (d) => {
    child._buf += d;
  });
  return child;
}

function waitReady(child, kind, ms = 8000) {
  const tag = kind === "computer" ? "COMPUTER_READY" : "HEARTH_READY";
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const m = child._buf.match(new RegExp(`${tag} (http://127\\.0\\.0\\.1:\\d+)`));
      if (m) return resolve(m[1]);
      if (child.exitCode !== null) {
        return reject(new Error(`${kind} exited ${child.exitCode}: ${child._buf}`));
      }
      if (Date.now() - started > ms) {
        return reject(new Error(`${kind} ready timeout: ${child._buf}`));
      }
      setTimeout(check, 25);
    };
    check();
  });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stop(child) {
  if (!child || !child.pid) return;
  const pid = child.pid;
  try { child.kill("SIGKILL"); } catch {}
  try { process.kill(pid, "SIGKILL"); } catch {}
  const start = Date.now();
  while (pidAlive(pid) && Date.now() - start < 4000) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function jsonReq(url, pathname, { method = "GET", body } = {}) {
  const res = await fetch(url + pathname, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function diskContains(dir, token) {
  return walkFiles(dir).some((f) => {
    try {
      return fs.readFileSync(f, "utf8").includes(token);
    } catch {
      return false;
    }
  });
}

test("createsNamedProjectThreadLocallyInOneAction", async (t) => {
  const home = tmp("hearth-create-");
  const app = spawnProc(["start", "--port", "0", "--home", home]);
  t.after(() => stop(app));
  const url = await waitReady(app, "app");

  const first = await fetch(url + "/");
  const firstHtml = await first.text();
  assert.equal(first.status, 200);
  assert.match(firstHtml, /data-screen="create"/);
  assert.doesNotMatch(firstHtml, /<input[^>]*type=["']password/i);
  assert.doesNotMatch(firstHtml, />Sign In</i);
  assert.doesNotMatch(firstHtml, /data-screen="rooms-index"/);
  assert.doesNotMatch(firstHtml, />Channels</i);
  assert.doesNotMatch(firstHtml, /channel list/i);

  const empty = await fetch(url + "/create", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=",
  });
  const emptyHtml = await empty.text();
  assert.match(emptyHtml, /data-screen="create"/);
  const afterEmpty = await jsonReq(url, "/api/state");
  assert.equal(afterEmpty.data.thread, null);

  const space = await fetch(url + "/create", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=+++".replaceAll("+", " "),
  });
  const spaceHtml = await space.text();
  assert.match(spaceHtml, /data-screen="create"/);
  const afterSpace = await jsonReq(url, "/api/state");
  assert.equal(afterSpace.data.thread, null);

  const created = await fetch(url + "/create", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=" + encodeURIComponent("Atlas Lab"),
  });
  const createdHtml = await created.text();
  assert.equal(created.status, 200);
  assert.match(createdHtml, /data-screen="project-thread"/);
  assert.match(createdHtml, /class="thread-name">Atlas Lab</);
  assert.doesNotMatch(createdHtml, /data-screen="rooms-index"/);
  assert.doesNotMatch(createdHtml, /data-screen="create"/);
  assert.doesNotMatch(createdHtml, />Channels</i);
  assert.doesNotMatch(createdHtml, /channel list/i);

  const homeAgain = await fetch(url + "/");
  const homeHtml = await homeAgain.text();
  assert.match(homeHtml, /data-screen="project-thread"/);
  assert.match(homeHtml, /Atlas Lab/);
  assert.doesNotMatch(homeHtml, /data-screen="rooms-index"/);

  const state = await jsonReq(url, "/api/state");
  assert.equal(state.data.screen, "project-thread");
  assert.equal(state.data.thread.name, "Atlas Lab");
});

test("agentsWriteIsolatedFilesOnConnectedComputer", async (t) => {
  const home = tmp("hearth-files-");
  const computerRoot = tmp("hearth-comp-");
  assert.ok(!computerRoot.startsWith(APP_ROOT));
  assert.ok(!path.resolve(computerRoot).startsWith(path.resolve(APP_ROOT)));

  const noCompHome = tmp("hearth-noconnect-");
  const noCompApp = spawnProc(["start", "--port", "0", "--home", noCompHome]);
  t.after(() => stop(noCompApp));
  const noCompUrl = await waitReady(noCompApp, "app");
  await jsonReq(noCompUrl, "/create", { method: "POST", body: { name: "No Connect" } });
  const added = await jsonReq(noCompUrl, "/agents", { method: "POST", body: { name: "Ada" } });
  const adaNo = added.data.agent;
  const token = `noconnect-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const writeNo = await jsonReq(noCompUrl, `/agents/${adaNo.id}/files`, {
    method: "POST",
    body: { path: "should-not-exist.txt", content: token },
  });
  assert.equal(writeNo.status, 409);
  assert.equal(writeNo.data.wrote, false);
  assert.equal(diskContains(noCompHome, token), false);
  assert.equal(diskContains(APP_ROOT, token), false);
  assert.equal(diskContains(computerRoot, token), false);

  const computer = spawnProc(["computer", "--port", "0", "--root", computerRoot]);
  t.after(() => stop(computer));
  const computerUrl = await waitReady(computer, "computer");

  const app = spawnProc(["start", "--port", "0", "--home", home]);
  t.after(() => stop(app));
  const url = await waitReady(app, "app");

  await jsonReq(url, "/create", { method: "POST", body: { name: "Forge" } });
  const a = await jsonReq(url, "/agents", { method: "POST", body: { name: "Ada" } });
  const b = await jsonReq(url, "/agents", { method: "POST", body: { name: "Beau" } });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const ada = a.data.agent;
  const beau = b.data.agent;
  assert.equal(ada.name, "Ada");
  assert.equal(beau.name, "Beau");
  assert.notEqual(ada.id, beau.id);

  const connected = await jsonReq(url, "/computer/connect", {
    method: "POST",
    body: { url: computerUrl },
  });
  assert.equal(connected.status, 200);

  const adaWrite = await jsonReq(url, `/agents/${ada.id}/files`, {
    method: "POST",
    body: { path: "ada-only.txt", content: "ada-secret" },
  });
  const beauWrite = await jsonReq(url, `/agents/${beau.id}/files`, {
    method: "POST",
    body: { path: "beau-only.txt", content: "beau-secret" },
  });
  assert.equal(adaWrite.status, 200);
  assert.equal(beauWrite.status, 200);

  const adaAbs = adaWrite.data.abs;
  const beauAbs = beauWrite.data.abs;
  assert.ok(adaAbs.startsWith(path.resolve(computerRoot)));
  assert.ok(beauAbs.startsWith(path.resolve(computerRoot)));
  assert.equal(adaAbs.startsWith(path.resolve(APP_ROOT)), false);
  assert.equal(beauAbs.startsWith(path.resolve(APP_ROOT)), false);
  assert.equal(adaAbs.startsWith(path.resolve(home)), false);
  assert.ok(fs.existsSync(adaAbs));
  assert.ok(fs.existsSync(beauAbs));
  assert.equal(fs.readFileSync(adaAbs, "utf8"), "ada-secret");
  assert.equal(fs.readFileSync(beauAbs, "utf8"), "beau-secret");

  const adaList = await jsonReq(url, `/agents/${ada.id}/files`);
  const beauList = await jsonReq(url, `/agents/${beau.id}/files`);
  const adaPaths = adaList.data.files.map((f) => f.path);
  const beauPaths = beauList.data.files.map((f) => f.path);
  assert.ok(adaPaths.includes("ada-only.txt"));
  assert.equal(adaPaths.includes("beau-only.txt"), false);
  assert.ok(beauPaths.includes("beau-only.txt"));
  assert.equal(beauPaths.includes("ada-only.txt"), false);
  for (const f of adaList.data.files) {
    assert.ok(f.abs.startsWith(path.resolve(computerRoot)));
    assert.equal(f.abs.startsWith(path.resolve(APP_ROOT)), false);
  }
  for (const f of beauList.data.files) {
    assert.ok(f.abs.startsWith(path.resolve(computerRoot)));
    assert.equal(f.abs.startsWith(path.resolve(APP_ROOT)), false);
  }
});

test("agentFilesAndMemorySurviveRelaunch", async (t) => {
  const home = tmp("hearth-relaunch-");
  const computerRoot = tmp("hearth-relaunch-comp-");
  const computer = spawnProc(["computer", "--port", "0", "--root", computerRoot]);
  t.after(() => stop(computer));
  const computerUrl = await waitReady(computer, "computer");

  const app1 = spawnProc(["start", "--port", "0", "--home", home], {
    HEARTH_COMPUTER_URL: computerUrl,
  });
  const url1 = await waitReady(app1, "app");
  const pid1 = app1.pid;
  assert.ok(pid1 > 0);

  await jsonReq(url1, "/create", { method: "POST", body: { name: "Keep" } });
  const a = await jsonReq(url1, "/agents", { method: "POST", body: { name: "Ada" } });
  const b = await jsonReq(url1, "/agents", { method: "POST", body: { name: "Beau" } });
  const ada = a.data.agent;
  const beau = b.data.agent;

  await jsonReq(url1, "/computer/connect", { method: "POST", body: { url: computerUrl } });
  await jsonReq(url1, `/agents/${ada.id}/files`, {
    method: "POST",
    body: { path: "ada-keep.txt", content: "ada-file-survives" },
  });
  await jsonReq(url1, `/agents/${beau.id}/files`, {
    method: "POST",
    body: { path: "beau-keep.txt", content: "beau-file-survives" },
  });

  const adaFact = "Ada favorite color is teal";
  const beauFact = "Beau city is Lisbon";
  const memA = await jsonReq(url1, `/agents/${ada.id}/memory`, {
    method: "POST",
    body: { fact: adaFact },
  });
  const memB = await jsonReq(url1, `/agents/${beau.id}/memory`, {
    method: "POST",
    body: { fact: beauFact },
  });
  assert.equal(memA.status, 201);
  assert.equal(memB.status, 201);
  assert.ok(memA.data.memory.length > 0);
  assert.ok(memB.data.memory.length > 0);
  assert.ok(memA.data.memory.some((f) => f.text === adaFact));
  assert.ok(memB.data.memory.some((f) => f.text === beauFact));

  await stop(app1);
  assert.equal(pidAlive(pid1), false);

  const adaAbs = path.join(computerRoot, "agents", ada.id, "ada-keep.txt");
  const beauAbs = path.join(computerRoot, "agents", beau.id, "beau-keep.txt");
  assert.equal(fs.readFileSync(adaAbs, "utf8"), "ada-file-survives");
  assert.equal(fs.readFileSync(beauAbs, "utf8"), "beau-file-survives");

  const app2 = spawnProc(["start", "--port", "0", "--home", home], {
    HEARTH_COMPUTER_URL: computerUrl,
  });
  t.after(() => stop(app2));
  const url2 = await waitReady(app2, "app");
  const pid2 = app2.pid;
  assert.ok(pid2 > 0);
  assert.notEqual(pid2, pid1);

  const state = await jsonReq(url2, "/api/state");
  assert.equal(state.data.thread.name, "Keep");
  const adaMem = await jsonReq(url2, `/agents/${ada.id}/memory`);
  const beauMem = await jsonReq(url2, `/agents/${beau.id}/memory`);
  assert.ok(adaMem.data.memory.length > 0, "vacuous empty memory fails");
  assert.ok(beauMem.data.memory.length > 0, "vacuous empty memory fails");
  const adaTexts = adaMem.data.memory.map((f) => f.text).filter(Boolean);
  const beauTexts = beauMem.data.memory.map((f) => f.text).filter(Boolean);
  assert.ok(adaTexts.includes(adaFact));
  assert.ok(beauTexts.includes(beauFact));
  assert.equal(adaTexts.includes(beauFact), false);
  assert.equal(beauTexts.includes(adaFact), false);

  const adaList = await jsonReq(url2, `/agents/${ada.id}/files`);
  const beauList = await jsonReq(url2, `/agents/${beau.id}/files`);
  assert.ok(adaList.data.files.some((f) => f.path === "ada-keep.txt"));
  assert.equal(adaList.data.files.some((f) => f.path === "beau-keep.txt"), false);
  assert.ok(beauList.data.files.some((f) => f.path === "beau-keep.txt"));
  assert.equal(fs.readFileSync(adaAbs, "utf8"), "ada-file-survives");
  assert.equal(fs.readFileSync(beauAbs, "utf8"), "beau-file-survives");
});
