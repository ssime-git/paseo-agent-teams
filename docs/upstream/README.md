# Native New workspace pill — client extension prototype

The released Paseo 0.11/0.12 client renders plugin composer pills only inside an existing agent panel. Installing a plugin on a remote VM cannot add a new rendering location to that client.

`paseo-new-workspace-pill.patch` adds an optional `addNewWorkspaceComposerPill` API and renders its pills immediately above the native New workspace chat composer. The plugin in this repository feature-detects this API. Existing clients keep the sidebar entry and session pills.

The patch targets upstream Paseo commit `fc775b6db5e99ce4e0b1b3718250a023284557da`. It is a proposed client/SDK change, **not an API available in a released Paseo version**. No daemon or protocol changes are required.

## Try the prototype

In a separate Paseo checkout:

```sh
git checkout fc775b6db5e99ce4e0b1b3718250a023284557da
git apply /absolute/path/to/paseo-agent-teams/docs/upstream/paseo-new-workspace-pill.patch
npm ci
npm run build:web --workspace=@getpaseo/app
```

Serve `packages/app/dist` using an HTTP server with an SPA fallback. Connect this client to the daemon on your VM, with Agent Teams installed there. If you serve the web client from a custom origin, add that specific origin to the test daemon's `daemon.cors.allowedOrigins` configuration. Retain the usual connection authentication.

Choose the VM and project on New workspace. The pill appears only for the selected host's installation. Clicking **Mode agent** opens the role/model configuration and copies the native draft text. Opening this configuration only opens/reuses a workspace; agents start when you launch the team. The native chat send button keeps its existing behavior. V1 uses the selected source directory, as the rest of the plugin does.

Web clients can use this compiled bundle. Electron and iOS/Android apps need a build containing the patch; updating only the VM's daemon/plugin will not update those installed clients.

## Verified

- Upstream SDK and web client build, app typecheck, lint and changed-file formatting.
- 53 targeted upstream tests: host scoping, missing-host matching, lifecycle cleanup, duplicate registrations and existing plugin evaluation behavior.
- 68 plugin tests, including optional API detection, remote workspace failure/retry and draft transfer without an agents API.
- Real Chromium: native New workspace pill, opening the real configuration, transferring native draft text, desktop and compact mobile viewports.
- The browser connected over WebSocket to a separate isolated daemon process with the plugin installed. This was not a provisioned VM or a physical iOS test.
- Patch application checked against the upstream base index.

Screenshots in `../screenshots/native-new-workspace-*.png` show this modified client. Other README screenshots show the released client.
