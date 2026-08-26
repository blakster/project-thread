import { startApp } from "./app.js";
import { startComputer } from "./computer.js";
import os from "node:os";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const cmd = process.argv[2] === "computer" ? "computer" : "start";

if (cmd === "computer") {
  const root = arg("root", path.join(os.homedir(), ".hearth-computer"));
  const port = Number(arg("port", process.env.HEARTH_COMPUTER_PORT || "7421"));
  await startComputer({ port, root });
} else {
  const home = arg("home", process.env.HEARTH_HOME || path.join(os.homedir(), ".hearth"));
  const port = Number(arg("port", process.env.HEARTH_PORT || "3456"));
  const computerUrl = arg("computer-url", process.env.HEARTH_COMPUTER_URL || null);
  await startApp({ port, home, computerUrl });
}
