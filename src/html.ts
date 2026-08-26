import { currentThread, type State } from "./domain.js";

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
  <title>${esc(title)}</title>
  <style>
    body { font-family: sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.4rem; }
    form { margin: 0.75rem 0; }
    input { margin-right: 0.4rem; }
    .agent { border: 1px solid #ddd; padding: 0.75rem; margin: 0.75rem 0; }
    .muted { color: #555; }
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

export function threadScreen(state: State): string {
  const thread = currentThread(state);
  if (!thread) return createScreen();
  const agents = state.agents.filter((a) => a.threadId === thread.id);
  const connected = Boolean(state.computerUrl);
  const agentBlocks = agents
    .map((a) => {
      const facts = state.memory[a.id] ?? [];
      const factList = facts.length
        ? `<ul>${facts.map((f) => `<li>${esc(f.text)}</li>`).join("")}</ul>`
        : `<p class="muted">No remembered facts yet.</p>`;
      return `<section class="agent" data-agent="${esc(a.name)}">
    <h2>${esc(a.name)}</h2>
    <form method="post" action="/agents/${esc(a.id)}/files">
      <input name="path" placeholder="file name" required>
      <input name="content" placeholder="contents">
      <button type="submit">Write file</button>
    </form>
    <form method="post" action="/agents/${esc(a.id)}/memory">
      <input name="fact" placeholder="fact to remember" required>
      <button type="submit">Remember</button>
    </form>
    ${factList}
  </section>`;
    })
    .join("\n");

  return page(
    thread.name,
    `<main data-screen="project-thread">
  <h1 class="thread-name">${esc(thread.name)}</h1>
  <p class="muted">Project thread with named teammates.</p>
  <p>Computer: ${connected ? "connected" : "not connected"}</p>
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
