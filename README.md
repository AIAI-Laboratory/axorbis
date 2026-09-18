# Axorbis

**A research workspace that keeps the question, evidence, and work in one place.**

Axorbis is a new interface built on the [Feynman](https://github.com/advaitpaliwal/feynman) research engine. It organizes work as **Projects → Research questions → Sources and claims**, while the existing Feynman runtime handles agents, tools, sessions, artifacts, and provenance.

This repository is an early, runnable product slice. The interface uses `#FF3B30`, white, and black, with light and dark themes.

## Project layout

```text
engine/     Feynman research engine, CLI, and workbench server
web/        Axorbis web interface (also used inside the desktop app)
app/        Tauri desktop host and native packaging
website/    Public documentation site
extensions/ Pi research tools and integration extensions
scripts/    Build, packaging, and verification scripts
tests/      Engine, web, and desktop tests
docs/       Product and architecture documents
```

The desktop app hosts the same web interface; `website/` is a separate documentation site. Runtime inputs such as `prompts/`, `skills/`, and `.feynman/` remain at the repository root because the engine resolves them there.

## What works today

- **Home and Projects:** find recent work, create a project, and add a research question.
- **Question workspace:** keep a question list, research plan, findings, sources, claims, and activity together. Open the evidence panel when you need detail.
- **Ask and Deep research:** send a request from the question workspace and follow the streamed answer and tool activity. Deep research uses Feynman's existing `/deepresearch` workflow.
- **Local research state:** projects and questions reuse Feynman's persisted project and session records; artifacts and claims come from its workbench state.
- **Focused navigation:** `⌘K` / `Ctrl+K` opens search and commands. The layout adapts to smaller screens and supports light, dark, and system themes.

The question workspace can show linked files, text previews, downloads, and recorded claim evidence. A configured model is required to run AI research.

## Run from source

You need Node.js **22.22–25.x** (the repository pins Node `24.20.0` in `.nvmrc`) and npm.

```bash
git clone https://github.com/AIAI-Laboratory/axorbis.git
cd axorbis
nvm use || nvm install
npm ci
npm run build
npm run dev -- serve --no-open
```

Open the authenticated localhost URL printed in the terminal. `--no-open` only prevents the browser from opening automatically. To choose a model before using Ask or Deep research, run:

```bash
npm run dev -- setup
```

The current package still uses Feynman's runtime and data paths. If you install this source package as a CLI, both `axorbis` and `feynman` point to the same runtime. **There is no published Axorbis npm package or native installer yet.** Installing the upstream Feynman package does not install this Axorbis interface.

### Run the desktop app from source

The Tauri desktop host provides workspace selection, an authenticated dynamic localhost launch, native menu and tray behavior, startup error recovery, and managed backend shutdown:

```bash
npm ci --prefix app
npm run desktop:dev
```

Use `npm run desktop:check` for Rust formatting, compile, and unit tests, or `npm run desktop:build` for a development package. A self-contained release requires `npm run desktop:release-build`, which builds and stages a verified native runtime before packaging. See [`app/README.md`](app/README.md) for signing and release prerequisites. Native installers are not published yet.

Axorbis checks the repository's latest stable GitHub Release when the workspace opens and periodically while it is in use. If a newer version exists, it shows a dismissible announcement linking to the release download. This is an update announcement, not unattended installation.

## How to use the workspace

1. Create a project for a research topic.
2. Add a focused question to that project.
3. Choose **Ask** for a direct request or **Deep research** for a longer investigation.
4. Review the activity, plan, sources, claims, and linked evidence as the work develops.

The left question list and right evidence panel can be closed to leave more room for reading. The former `/app-shell/` address opens the new Axorbis interface too.

## Current scope

| Available in the Axorbis UI | Still being adapted |
| --- | --- |
| Home, Projects, question workspace | Dedicated paper reader and library |
| Ask, Deep research, streamed activity | Notes, experiments, and draft/export screens |
| Plans, linked sources, claims, basic evidence inspection | Detailed provenance and specialized artifact viewers |
| Responsive layout, themes, command palette | Full settings and compute control panels |

The underlying Feynman capabilities remain in the codebase. This table describes what the **new interface** currently exposes.

## Development

```bash
npm run typecheck
npm run build
npm run architecture:check
node --import tsx --test tests/workbench-axorbis-shell.test.ts
node --import tsx --test tests/workbench-update-announcement.test.ts tests/desktop-release.test.ts
```

The HTTP test binds to localhost, so some sandboxed environments require permission for it. The app is served locally by `engine/workbench/server.ts`. `web/index.html` is the sole web entry, and Axorbis lives in `web/src/app/research-app.tsx` and `web/src/styles/research-app.css`.

Product direction and other long-form documents are indexed in [`docs/README.md`](docs/README.md). Persistent implementation state and decisions live in [`.ai/STATE.md`](.ai/STATE.md) and [`.ai/DECISIONS.md`](.ai/DECISIONS.md).

## Upstream and license

Axorbis preserves and builds on the open source Feynman project. The research engine, CLI internals, tools, and much of the supporting documentation still carry Feynman's technical names. The Axorbis interface and repository are being developed separately by AIAI Laboratory.

Released under the [MIT License](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) for repository guidance.
