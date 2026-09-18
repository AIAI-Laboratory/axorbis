# Axorbis Desktop

The desktop app is a Tauri host for the Axorbis interface backed by the same local, authenticated workbench served by `feynman serve`.

## Development

From the repository root:

```bash
npm ci
npm ci --prefix app
npm run desktop:dev
```

The launcher uses the same visual system as the web interface, lets you select a research workspace, starts Feynman on an available localhost port, waits for the tokenized URL, and then opens the workbench. Closing the window keeps it available in the system tray; use **Quit Axorbis** to stop the app and its managed server.

## Build and checks

```bash
npm run desktop:check
npm run desktop:build
```

`desktop:build` is a developer build and may rely on a separately installed CLI. To build a standalone app for this machine, run `npm run desktop:release-build` from the repository root. It first creates the existing verified native Feynman bundle, stages that runtime in `app/runtime/`, and then builds Tauri. The release preflight refuses missing or version-mismatched runtime files and non-portable links. A local DMG without Apple Developer ID signing and notarization is for testing, not public distribution.

The [Axorbis GitHub release workflow](../.github/workflows/axorbis-desktop-release.yml) builds a macOS Apple Silicon DMG from a `v<package-version>` tag and publishes it only after the runtime, code signature, and notarization are verified. Configure the repository secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` first. Do not commit signing material. The tagged commit must contain the matching version in the root package, `app/package.json`, Tauri config, and Cargo manifest. Additional platforms need their own built and verified runtime before they can be added to the release matrix.

When a newer stable release is published, the running Axorbis workspace shows a dismissible update announcement with a link to that GitHub Release. It checks at startup and every six hours while visible. It does not silently download or install updates; Tauri's automatic installer requires a separate signing key and signed updater artifacts.

Development builds use this checkout's `bin/feynman.js`. A packaged launcher resolves the runtime in this order:

1. `FEYNMAN_DESKTOP_CLI`, for an explicit launcher or `bin/feynman.js` path.
2. A bundled `runtime/feynman` resource, supplied by `desktop:release-build`.
3. A standard user installation such as `~/.local/bin/feynman`, Homebrew, or `feynman` on `PATH`.

`FEYNMAN_DESKTOP_NODE` can select Node when `FEYNMAN_DESKTOP_CLI` points to a JavaScript entrypoint. `FEYNMAN_DESKTOP_WORKSPACE` changes the first suggested workspace.
