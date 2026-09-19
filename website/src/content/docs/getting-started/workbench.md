---
title: Axorbis Research Workspace
description: Run the local Axorbis interface for projects, research questions, sources, claims, and activity.
section: Getting Started
order: 3
---

The science workbench is the local app behind `feynman serve`. It gives Feynman a browser-based research control plane while keeping app-owned settings, sessions, uploads, snapshots, memory, OAuth tokens, and compute logs under `~/.feynman/orgs/<org_uuid>/workbench/workspaces/<workspace-id>/`. It also refreshes an org-level SQLite mirror at `~/.feynman/orgs/<org_uuid>/feynman-workbench.db` for core project, frame, message, artifact, execution, verification, memory, note, annotation, read-cursor, artifact-folder, compute-provider, MCP-grant, memory-category, routine-schedule, managed-endpoint, and capability-setting records, plus compact table envelopes for the remaining reference-shaped workbench ledgers Feynman already owns in state. Compute-provider rows include egress policy and Modal environment fields, existing local databases are upgraded in place, and connector ledgers include split science attachments, split MCP grants, and custom MCP resource identifiers. Research artifacts remain ordinary workspace files under `.axorbis/artifacts/projects/<project-id>/`.

```bash
feynman serve
```

The command starts a local server, prints an authenticated localhost URL, and opens the workbench. The URL token is local to that server process. For trusted local testing, run `feynman serve --no-auth` to print a plain localhost URL with no token.

## Desktop host

The source repository also contains a Tauri desktop host for the same workbench. Its bootstrap first shows a minimal loading screen, checks model setup through the local backend, and on first launch collects an inference key and model before asking for a workspace folder. The key is encrypted by the backend and never returned to the UI. Later launches use the remembered workspace, start Feynman on an available localhost port, wait for the authenticated URL, and keep the backend tied to the desktop app lifecycle. Closing the window leaves the app in the system tray; **Quit Axorbis** stops the managed server.

```bash
npm ci --prefix desktop
npm run desktop:dev
```

`npm run desktop:dev` serves the workbench through Vite, so edits under `web/` hot reload in the desktop window. Use `npm run desktop:check` to validate the Rust host and `npm run desktop:build` for a developer package. `npm run desktop:release-build` stages the verified native runtime and builds a standalone app. The macOS Apple Silicon release workflow requires Apple signing and notarization secrets before publishing a `v<version>` GitHub Release. There is not yet a published Axorbis desktop installer. Once releases exist, Axorbis checks for a newer stable version at startup and every six hours, then displays a dismissible link to its download page; it does not install updates automatically.

The Axorbis workspace opens a researcher-first Home and Projects view with a red (`#FF3B30`), white, and black interface. Open a project, add a research question, and investigate through Ask or Deep research in the same workspace. The question is backed by a persisted Feynman session; the workspace shows streaming activity, its plan, sources, claims, and linked evidence. Replies and Markdown file previews use formatted headings, lists, code, links, and tables. Project pages group linked research files under the question that produced or linked them. Selecting a file opens a focused reader modal over the question overview; search, type filters, download, display-name editing, starring, and a recoverable move-to-trash action remain available. The question list and evidence inspector open when needed, and `/app-shell/` opens the same redesigned interface. Existing Pi agents, research tools, compute, and provenance remain available through the Feynman runtime; some specialized control-plane views are still being adapted to the new UI.

## What Axorbis shows

- **Home and Projects** — Create a project, return to recent research, and organize questions.
- **Question workspace** — Continue a Pi-backed session with Ask or Deep research, streamed replies, tool activity, and the associated plan.
- **Evidence** — Browse linked sources and claims in a question; inspect all project research files from the project page, with formatted Markdown or text preview and download. Other file types can be downloaded for reading in their native apps.
- **Navigation** — Search projects and questions with the command palette; use responsive layouts and light or dark themes.
- **AI Providers** — Open **Settings → AI Providers** to configure Anthropic, OpenAI, Gemini, OpenRouter, LM Studio, Ollama, LiteLLM, or a custom HTTP-compatible provider. Inference keys and optional admin/usage keys are separate, encrypted at rest, and never returned to the browser. Hosted providers can record token/cost usage and enforce per-session or monthly guards; local providers show resource limits instead of billing quotas.

Axorbis is the sole web and desktop interface. The previous workbench's specialized scientific viewers, full artifact content editing controls, and notebook/compute panels are not present in this UI. The Feynman backend still owns its research tools, APIs, sessions, provenance, local state, and workspace files; those capabilities are not all directly surfaced here yet.

## Standalone boundary

The workbench does not require another local app to be installed. Its visible connectors are Feynman-owned resources such as Feynman Bio Tools, and its durable app records live under Feynman's active local org in `~/.feynman/orgs/<org_uuid>/workbench` plus the owned org database `~/.feynman/orgs/<org_uuid>/feynman-workbench.db` while generated research artifacts remain in the active workspace.

Debug-only reference inspection can be enabled by developers through explicit environment configuration, but ordinary onboarding, chat, settings, connectors, artifacts, notebooks, compute, memory, and provenance paths are Feynman-owned.

## Setup state

The first-run workbench onboarding creates a Feynman project and session, selects an appropriate specialist, records chosen setup scopes, suggests seed workflows, and stores intent declarations derived from the user's own research context. Those intent declarations let later sessions understand the user's setup choices without hardcoding a reference-product dependency.

Skill source rows and license-assent rows are audit records for Feynman's owned local skill pack, not a dependency on an external marketplace service.

Watch routine rows are audit records for `/watch` plans and baselines. They stay disabled with a blocked reason when scheduling tooling was unavailable, so the workbench does not pretend a recurring job exists.

Setup decision rows record public scientific API contact-email consent and provider credential readiness. Contact-email rows use configured NCBI/Entrez/Crossref mailto environment variables, and credential-ask rows derive from redacted provider availability instead of storing raw secret values.

Project rows expose Feynman's durable project spine: local owner id, created and updated timestamps, context text, memory-enabled state, upload-frame id, run slugs, artifact paths, session counts, and artifact counts.

Review feedback rows are audit records for user-requested reviewer passes. They are keyed by frame, user, and feedback type and store bounded context such as the reviewed artifact path and reviewer response id.

Frame rows are control-plane records for Feynman-owned chat sessions, artifact runs, and project upload areas. They expose root frame ids, project ids, agent/delegate names, status, bounded input/output/context JSON, model and compute settings, artifact references, timestamps, and source ownership through local state.

Frame message rows are audit records for persisted chat turns. They are derived from Feynman session files and expose frame id, message index, UUID, role, status, timestamp, and structured message JSON through the local workbench state.

Frame backfill health rows are empty in clean workspaces and appear only when Feynman's own state records a failed historical frame import. They expose frame id, failure count, terminal state, reason, and updated timestamp without depending on another local app.

Compute poller lease rows are current audit records for active compute jobs and pending compute terminations. They mirror the single-writer polling guard shape and disappear when no compute polling work is active.

Credential rows are availability records, not secret dumps. They point to Feynman settings, provider environment variables, or Pi auth storage and store only redacted references.

## Output locations

The workbench follows the same output conventions as the CLI:

- Each project's research files go in `.axorbis/artifacts/projects/<project-id>/`
- Paper-style drafts go in `.axorbis/artifacts/projects/<project-id>/.papers/`
- Session notes go in `.axorbis/artifacts/projects/<project-id>/.notes/`
- Long-running plans go in `.axorbis/artifacts/projects/<project-id>/.plans/`
- The chronological lab notebook is `CHANGELOG.md`

Generated reports and provenance files remain ordinary workspace files, so they can be inspected from the app, terminal, editor, or git.

Deep Research writes a plan under the active project's `.axorbis/artifacts/projects/<project-id>/.plans/` directory and asks for approval before gathering evidence or creating report files. Reply `yes` in the same question to continue, or describe the changes you want in the plan.

When Deep Research completes, the chat response summarizes the final report's findings and caveats rather than only listing generated artifacts. Every artifact path in that response is clickable and opens the corresponding local file preview; this includes the report, provenance sidecar, plan, and supporting research or verification files.

Workbench control-plane records such as chat session JSON, settings, memory rows, annotations, OAuth token references, uploads, notebook execution logs, Modal job scripts, managed Python/R environments, artifact snapshots, and cloud-export audit logs live under `~/.feynman/orgs/<org_uuid>/workbench/workspaces/<workspace-id>/`. The served workbench also refreshes `~/.feynman/orgs/<org_uuid>/feynman-workbench.db`, which mirrors core tables for projects, frames, frame messages, artifacts, artifact versions, execution logs, verification checks, memories, and notes plus control-plane tables for annotations, frame read cursors, artifact folders, compute providers, MCP tool grants, memory categories, routine schedules, managed endpoints, and capability settings. The database also contains physical table envelopes for Feynman's other owned reference-shaped ledgers such as agents, skills, credentials, OAuth tokens, events, notifications, session activity, claims, host logs, marketplace rows, and archive rows. Existing home-level `~/.feynman/workbench` records and checkout-local `.feynman/workbench` records are copied into that app-data location on first access.
