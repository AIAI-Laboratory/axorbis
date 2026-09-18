# Current State

## Current phase

Axorbis-only web and desktop interface, with the Feynman research engine retained underneath. Source organization and release readiness are the current focus.

## Layout

- `engine/`: research engine, CLI, workbench backend, Pi integration
- `web/`: the only product interface and Vite entry
- `app/`: Tauri desktop host, native packaging, staged runtime
- `website/`: separate public documentation site
- `docs/`: long-form product documents; see `docs/README.md`
- `extensions/`, `prompts/`, `skills/`, `.feynman/`: engine/runtime inputs that stay at the root

## Implemented

- Axorbis Home, Projects, and question workspace replace the old workbench UI at `/` and `/app-shell/`.
- The desktop host opens the same Axorbis interface through an authenticated localhost server, manages backend lifecycle, and has native menu, tray, and startup recovery.
- The workspace announces newer stable GitHub releases without automatically installing them. The macOS release workflow and standalone runtime packaging are configured, but public publishing still requires signing credentials and a release run.
- Source directories are organized by engine, web, and app. Obsolete UI assets and the orphaned Ketcher sketcher integration were removed; root entry points and runtime paths are preserved.

## Verification

See `outputs/.plans/axorbis-project-layout.md` and the latest `CHANGELOG.md` entry for checks on this reorganization. A build or workflow definition does not by itself confirm a public installer was published.

## Next

1. Complete source-layout tests and native packaging checks.
2. Publish a signed/notarized release when repository access and Apple credentials are available.
3. Adapt specialized research capabilities into the Axorbis UI only where they serve a concrete research job.

## Resume instruction

Preserve engine compatibility and the Axorbis-only UI. Read this file, `.ai/DECISIONS.md`, `AGENTS.md`, and the current plan before extending the work.
