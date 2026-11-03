# Agent Teams

Run a team of coding agents in one Paseo thread. Choose **Agent Teams → Team Auto** as the model and describe a mission: Plan proposes a plan, Code implements it, the plugin runs the tests and Review checks the result. Failures go back to Code, up to a correction limit. Each role can use a different harness and model discovered by your daemon.

Settings → Plugins → Agent Teams sets the model of each role, the validation mode, the correction limit and the interface language (French or English).

New historical-pipeline missions save the host language setting at launch and use it for agent explanations and questions, including later follow-ups. Changing the setting updates the interface and future missions; an existing mission keeps its saved response language. Older missions without a saved language keep their original behavior. Custom graph prompts and the official client app locale are not yet connected to this policy.

Requires Paseo >=0.13.0 <0.14.0 and an authenticated coding harness on the daemon host. Prompts, repository context and tool results are sent to the selected providers under their accounts. Workflow state is stored on the daemon host. The Code role can modify workspace files and run commands with its provider's permissions.

See [README.md](README.md).
