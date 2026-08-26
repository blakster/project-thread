import fs from "node:fs";
import path from "node:path";

function emptyState() {
  return {
    currentThreadId: null,
    threads: [],
    agents: [],
    memory: {},
    computerUrl: null,
  };
}

export function createStore(home) {
  const dir = path.resolve(home);
  const file = path.join(dir, "state.json");
  fs.mkdirSync(dir, { recursive: true });

  function load() {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      return { ...emptyState(), ...parsed };
    } catch {
      return emptyState();
    }
  }

  function save(state) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }

  return { dir, file, load, save };
}
