# Agent Teams

Agent Teams contributes a workspace panel, a Command Center action and native progress cards. Its daemon-side engine coordinates three persistent provider sessions through the public Paseo SDK.

The panel provides Manual Switch and Auto Workflow, model discovery, approval checkpoints, test output and restart recovery. Configuration and execution state are separate: exported configuration has no conversation history or credentials.

Requires Paseo >=0.11.2 <0.13.0, Node.js >=22.15.0 and configured coding providers on the daemon host. Git preparation requires npm and fetches the locked production SDK dependency with dependency lifecycle scripts disabled.

Workflow prompts, repository context and tool results are sent to the selected coding providers under their configured accounts. Workflow state and history are stored on the daemon host. Builder sessions can modify workspace files and run commands with the selected provider permissions. Read-only enforcement for Planner and Reviewer depends on the provider; instruction-only mode detects repository changes but cannot prevent writes.

See [README.md](README.md) for installation, operation, recovery configuration and verification limits.
