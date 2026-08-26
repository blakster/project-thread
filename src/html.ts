import { currentThread, type State } from "./domain.js";
import type { AgentId } from "./ids.js";

export type ListedFile = { path: string; abs: string };

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    :root {
      --bg: #f4efe6;
      --ink: #1c1914;
      --muted: #6b6458;
      --paper: #fffaf3;
      --line: #ddd4c6;
      --accent: #2f5d50;
      --accent-ink: #f4efe6;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      background: var(--bg);
      color: var(--ink);
    }
    main { max-width: 52rem; margin: 0 auto; padding: 2.25rem 1.25rem 4rem; }
    h1 { font-size: 1.75rem; font-weight: 600; margin: 0 0 0.35rem; letter-spacing: -0.02em; }
    h2 { font-size: 1.15rem; margin: 0 0 0.75rem; }
    p { margin: 0 0 1rem; }
    .muted { color: var(--muted); }
    form { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0 0 0.85rem; }
    input {
      flex: 1 1 10rem;
      font: inherit;
      padding: 0.45rem 0.6rem;
      border: 1px solid var(--line);
      background: var(--paper);
      color: var(--ink);
    }
    button {
      font: inherit;
      padding: 0.45rem 0.85rem;
      border: 0;
      background: var(--accent);
      color: var(--accent-ink);
      cursor: pointer;
    }
    button:hover { filter: brightness(1.08); }
    .bar {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.25rem;
    }
    .chip {
      font-size: 0.85rem;
      padding: 0.2rem 0.55rem;
      border: 1px solid var(--line);
      background: var(--paper);
    }
    .chip.on { border-color: var(--accent); color: var(--accent); }
    .agent {
      background: var(--paper);
      border: 1px solid var(--line);
      padding: 1rem 1.1rem 0.85rem;
      margin: 0 0 1rem;
    }
    .files, .facts { margin: 0.4rem 0 0.8rem; padding: 0; list-style: none; }
    .files li, .facts li {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.85rem;
      padding: 0.2rem 0;
      border-bottom: 1px solid var(--line);
    }
    .label { font-size: 0.8rem; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin: 0.6rem 0 0.25rem; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

export function createScreen(): string {
  return page(
    "Hearth",
    `<main data-screen="create">
  <h1>Hearth</h1>
  <p class="muted">Create a named project thread. No hosted account.</p>
  <form method="post" action="/create">
    <input name="name" placeholder="Project name" autofocus>
    <button type="submit">Create project</button>
  </form>
</main>`
  );
}

export function threadScreen(
  state: State,
  filesByAgent: Partial<Record<AgentId, ListedFile[]>> = {}
): string {
  const thread = currentThread(state);
  if (!thread) return createScreen();
  const agents = state.agents.filter((a) => a.threadId === thread.id);
  const connected = Boolean(state.computerUrl);
  const agentBlocks = agents
    .map((a) => {
      const facts = state.memory[a.id] ?? [];
      const files = filesByAgent[a.id] ?? [];
      const factList = facts.length
        ? `<ul class="facts">${facts.map((f) => `<li>${esc(f.text)}</li>`).join("")}</ul>`
        : `<p class="muted">No remembered facts yet.</p>`;
      const fileList = files.length
        ? `<ul class="files">${files.map((f) => `<li title="${esc(f.abs)}">${esc(f.path)}</li>`).join("")}</ul>`
        : `<p class="muted">${connected ? "No files yet." : "Connect a computer to write files."}</p>`;
      return `<section class="agent" data-agent="${esc(a.name)}">
    <h2>${esc(a.name)}</h2>
    <p class="label">Files</p>
    ${fileList}
    <form method="post" action="/agents/${esc(a.id)}/files">
      <input name="path" placeholder="notes/idea.txt" required>
      <input name="content" placeholder="contents">
      <button type="submit">Write file</button>
    </form>
    <p class="label">Memory</p>
    ${factList}
    <form method="post" action="/agents/${esc(a.id)}/memory">
      <input name="fact" placeholder="fact to remember" required>
      <button type="submit">Remember</button>
    </form>
  </section>`;
    })
    .join("\n");

  return page(
    thread.name,
    `<main data-screen="project-thread">
  <div class="bar">
    <div>
      <h1 class="thread-name">${esc(thread.name)}</h1>
      <p class="muted">Project thread with named teammates.</p>
    </div>
    <span class="chip${connected ? " on" : ""}">Computer: ${connected ? "connected" : "not connected"}</span>
  </div>
  <form method="post" action="/computer/connect">
    <input name="url" placeholder="http://127.0.0.1:7421" value="${esc(state.computerUrl ?? "")}">
    <button type="submit">Connect computer</button>
  </form>
  <form method="post" action="/agents">
    <input name="name" placeholder="Teammate name" required>
    <button type="submit">Add teammate</button>
  </form>
  ${agentBlocks || `<p class="muted">No teammates yet.</p>`}
</main>`
  );
}
