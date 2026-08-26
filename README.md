# Hearth

Local named teammates in a project thread, plus a connected computer
process that keeps each agent's files isolated. No hosted login.

This is not a Slack-style rooms list, not a Grok Bot clone, and not a Rakazo fork.

## Run locally

Two processes. No account.

1. Connected computer (files live under --root, outside this repo):

Computer process: node src/index.js computer --root "$HOME/.hearth-computer" --port 7421

2. App (thread + remembered facts):

App process: HEARTH_COMPUTER_URL=http://127.0.0.1:7421 HEARTH_HOME="$HOME/.hearth" node src/index.js start --port 3456

Then open http://127.0.0.1:3456

Type a non-empty project name and create. The first screen is that named
project thread, not a rooms or channels index.

Add at least two named teammates. Each writes only into its own folder on
the connected computer. If the computer is not connected, writes do not
land on disk.

## Tests

Test command is the test script in package.json
(node --test test/slice1.test.js).

Named gates:

- createsNamedProjectThreadLocallyInOneAction
- agentsWriteIsolatedFilesOnConnectedComputer
- agentFilesAndMemorySurviveRelaunch
