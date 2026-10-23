# Agent Teams

Agent Teams adds **Team Auto** to Paseo's model picker. Describe a mission and a Plan → Code → Tests → Review loop runs in that single thread: the orchestrator speaks in normal messages, each role turn is a native sub-agent row, the plan is a native task list and verification runs are Shell rows. Role sessions are child agents of the thread and appear in Paseo's subagents list.

Paseo Settings → Plugins → Agent Teams sets the default team (model per role, validation mode, automatic corrections) and the interface language: French by default, or English. An advanced panel in the Command Center keeps Manual Switch, full configuration, repositories, history and recovery tools.

Requires Paseo >=0.11.2 <0.13.0, Node.js >=22.15.0 and configured coding providers on the daemon host. Git preparation requires npm and fetches the locked production SDK dependency with dependency lifecycle scripts disabled.

Workflow prompts, repository context and tool results are sent to the selected coding providers under their configured accounts. Workflow state and history are stored on the daemon host. The Code role can modify workspace files and run commands with the selected provider permissions. Read-only enforcement for Plan and Review depends on the provider; instruction-only mode detects repository changes but cannot prevent writes.

See [README.md](README.md) for installation, operation, recovery configuration and verification limits.
