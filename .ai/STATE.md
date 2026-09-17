# Current State

## Current Phase
Axorbis researcher-first workspace, redesigned V1 vertical slice

## Last Completed
- Inspected upstream Feynman at `dfdcb7cf2c73183cff7b10aa8ea8ce370c8b152c` and retained its research engine, persisted projects/sessions, artifacts, provenance, compute, and tools.
- Replaced the served workbench with the Axorbis red `#FF3B30`, white, and black Home, Projects, project overview, and question workspace. Both `/` and `/app-shell/` use the new UI; the old frontend is no longer bundled.
- Connected question composer to existing `/api/chat/message/stream` and `/api/chat/abort`, including Ask and `/deepresearch`, activity, source/claim views, optional evidence inspector, light/dark/system theme, mobile pane overlays, and Cmd/Ctrl+K.
- Updated README, release notes, website workbench docs, CLI metadata, and the `axorbis` command alias in package metadata. The npm package identity and persistence paths remain upstream Feynman for runtime compatibility.
- Typecheck, build, architecture check, and targeted HTTP/React shell tests pass. Live localhost browser displayed the Axorbis Home after rebuilding and restarting the server.
- Rewrote the root README for Axorbis: source quick start, current UI capabilities, accurate roadmap boundary, development checks, and Feynman attribution. Removed outdated upstream installation and feature claims from the project landing page.

## In Progress
- No code unit in progress. `main` was first pushed to `https://github.com/AIAI-Laboratory/axorbis.git` at `4f52c8e`; this state update follows it.

## Next
1. Adapt specialized paper readers, notes, notebooks/compute, and detailed provenance views into the new UI in subsequent units.
2. Introduce a dedicated question record only when session-backed titles/plans cannot express scope or status.

## Changed Files
- `.ai/STATE.md`, `.ai/DECISIONS.md`, `CHANGELOG.md`, README and public workbench docs/release notes/CLI metadata
- `workbench-web/src/research-app.tsx`, `research-app.css`, `research-session.ts`, `workbench-web/research.html`
- `workbench.vite.config.ts`, `src/workbench/static-shell.ts`, `tests/workbench-react-shell.test.ts`, `package.json`, `package-lock.json`
- `README.md` (Axorbis landing page rewrite)
- Previous first-slice files recorded in the earlier lab notebook entry.

## Known Issues
- This imported workspace started without Git metadata. The new Axorbis Git history will begin from this complete source tree unless upstream history is explicitly imported later.
- The underlying CLI/package still carries Feynman technical identity; `axorbis` is a source package bin alias. No Axorbis npm or native release has been published.
- Specialized control-plane viewers are not yet adapted to the simplified UI. Research tools and records remain in the backend.
- A configured model is required for live AI research; this workspace has no completed model setup.
- Upstream GitHub Actions workflows were removed from this new repository because they target Feynman publishing/deployment and the available token cannot push workflow changes. Axorbis CI can be added separately.

## Run / Test
- `npm run typecheck`
- `npm run build`
- `npm run architecture:check`
- `node --import tsx --test tests/workbench-react-shell.test.ts` (localhost bind requires approval in this environment)
- `npm run dev -- serve --no-open` and browser at localhost showed Axorbis Home. Separate disposable project verified the question layout before the final branding.
- README rewrite: `git diff --check` passed; all five local Markdown links resolve and documented npm scripts exist.

## Resume Instruction
Complete the first unfinished item under Next. Preserve the engine and use this file and `.ai/DECISIONS.md` as project memory.
