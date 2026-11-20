# Agent Teams

Run a team of coding agents in one Paseo thread. Choose **Agent Teams → Team Auto** as the model and describe a mission: Plan proposes a plan, Code implements it, the plugin runs the tests and Review checks the result. Failures go back to Code, up to a correction limit. Each role can use a different harness and model discovered by your daemon.

Settings → Plugins → Agent Teams sets the model of each role, the validation mode, the correction limit and the fallback language (French or English). Team follows the official client app locale when available.

Talk to Team in plain language. While the plan awaits approval, questions and requested changes go directly to the Reviewer. A proposal shows its tasks, acceptance criteria and tests; reply “yes” or “this plan works for me” to select it. Approval of the selected plan remains separate when required by your policy, and missing tests always require explicit acceptance. Say “pause” or “resume” to control the workflow. An inline activity card shows the working agent, its model and the subtasks for that step; completed work remains in the native sub-agent rows. Automatic handoffs use scoped artifacts and decisions instead of copying the full transcript.

New historical-pipeline missions save their response language at launch, including for later questions and follow-ups. In a native Team conversation, choose Response language before the first message: Français, English, or Host fallback (the default). The server API does not provide the client locale for native creation, so this choice is explicit. Custom graphs instead save the effective client language shown in their confirmed preview. Changing an interface or host language never changes an existing mission’s response language. Older missions without a saved language keep their original behavior.

Requires Paseo >=0.13.0 <0.17.0 and an authenticated coding harness on the daemon host. Prompts, repository context and tool results are sent to the selected providers under their accounts. Workflow state is stored on the daemon host. The Code role can modify workspace files and run commands with its provider's permissions.

See [README.md](README.md).
