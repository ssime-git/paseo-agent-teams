# Paseo 0.13 migration

Agent Teams now requires **Paseo >=0.13.0 <0.14.0**, for both daemon and app. The client and plugin SDKs are pinned together to 0.13.0, the latest official stable release verified on 25 October 2026. The installed CLI being current does not upgrade a daemon that is already running.

The change preserves V1 workflow files, operations, plan versions, approvals and graph checkpoints. It does not reset workflows, delete repository reservations, move tags or publish a release. Historical V1 plan-version normalization remains unchanged.

## API change

In 0.13 the official `agent.turn_ended` lifecycle hook always supplies an empty `timeline`. The plugin now fetches history through `context.paseo`, using the native turn ID from the hook. Reads are bounded to ten pages of 100 entries. The operation stays pending when history is incomplete, ambiguous, from another workspace/turn or unavailable. It is never resent to recover missing evidence. The same adapter feeds V1 and graph receipt capture.

Sources: [official plugin reference](https://paseo.sh/docs/plugins/reference), the installed `@getpaseo/plugin@0.13.0` lifecycle declarations, and the official server 0.13.0 lifecycle implementation. The SDK declaration explicitly marks the embedded timeline as deprecated and always empty.

## Primary daemon rollout

Check the running daemon separately from the CLI:

```sh
paseo --version
paseo daemon status --json
paseo ls --global --json
paseo plugin ls --json
```

Before any rollout, ensure other repository editors and the plugin's workflow operations are inactive, and back up the daemon home and plugin data outside the repository. The plugin data defaults to `~/.local/state/paseo-agent-teams`, or the configured `PASEO_AGENT_TEAMS_DATA_DIR`. Keep existing state and locks intact.

A 0.11 daemon with an installed 0.13 plugin-child runtime cannot be repaired by reloading only this plugin: its protocol rejects `requiresConfiguration`. The daemon and runtime must be aligned. **Primary cutover completed on 25 October 2026 after the user explicitly authorized this restart.** The primary daemon is now 0.13.0, the plugin is running and Team Auto is available. The four workflow file hashes and scheduled task identities/statuses were preserved. This authorization applies to this migration; it does not authorize unrelated future primary restarts. No global downgrade was performed.

After an authorized alignment to 0.13, verify that the plugin is `running`, Team Auto is listed, persisted workflow state is retained, and its real sessions still match their workspaces. Reload only the plugin if it needs loading after the daemon alignment and its agents are inactive. Do not launch test missions against the user's main repositories.

## Evidence

See [isolated validation](isolated-validation.md) and the 25 October migration entry in [the roadmap journal](scheduled-roadmap.md). Browser viewport checks are distinct from physical iOS/Android tests. The user must also update older app clients to the supported range.
