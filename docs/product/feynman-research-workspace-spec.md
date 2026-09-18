# Feynman Research Workspace — Product & UI/UX Spec

> Purpose: Rebuild the Feynman UI around researcher workflows while preserving Feynman as the research/runtime engine.
> Platforms: macOS, Windows, Web.
> Principle: evidence-first, local-first, keyboard-first, inspectable AI.

---

## 0. Upstream Source

Primary upstream repository:

- https://github.com/companion-inc/feynman

This repository is the technical source of truth for the existing Feynman implementation.

Implementation agents should inspect the upstream repository before making architecture assumptions, especially for:
- current frontend/workbench structure
- runtime boundaries
- project/session/artifact models
- research workflows
- agent/tool integration
- provenance and persistence
- compute integrations
- existing APIs and reusable components

Do not replace existing Feynman capabilities when they can be reused or adapted behind the new researcher-first UI.

---

## 1. Product Goal

Build a professional research workspace, not another AI chat app.

The product should help a researcher move through:

**Question → Sources → Evidence → Claims → Notes → Experiments → Output**

Feynman remains the engine for research agents, tools, literature workflows, provenance, compute, replication, review, and writing.  
The new product layer should hide implementation details unless the user explicitly opens advanced/debug views.

### Product positioning

**Research Workspace — AI-assisted, evidence-first, local-first.**

Primary user:
- academic researcher
- independent researcher
- ML/AI researcher
- technical analyst
- research engineer

Secondary user:
- student doing serious literature work
- scientific writer
- research team lead

---

## 2. Core UX Principles

1. **Research state > chat history**
   - Conversation is only one interaction surface.
   - The actual persistent state is questions, sources, claims, evidence, notes, experiments, and outputs.

2. **Evidence before conclusions**
   - Important AI-generated conclusions should be represented as claims.
   - Claims must be traceable to supporting and contradicting sources.

3. **Progressive disclosure**
   - Default UI shows researcher concepts.
   - Agent names, tool traces, prompts, runtime configuration, and raw provenance live under Advanced.

4. **High information density**
   - Optimize for long work sessions.
   - Avoid oversized cards and excessive whitespace.
   - Tables, split panes, keyboard shortcuts, and compact metadata are first-class.

5. **Inspectable AI**
   - Users should be able to answer:
     - What is the AI doing?
     - Why does it believe this?
     - Which source supports this?
     - What changed?

6. **Desktop-first power, web-compatible**
   - Desktop can expose filesystem, local runtime, Docker, notifications, and local models.
   - Web uses remote runtime/compute and should degrade capabilities explicitly instead of pretending parity.

---

## 3. Product Information Architecture

### Global Navigation

- Home
- Projects
- Library
- Watches
- Compute
- Settings

Do not expose these as top-level navigation:
- agents
- skills
- sessions
- frames
- tools
- traces

They belong to Advanced / Developer views.

---

## 4. Core Domain Model

The UI should use this model:

```text
Project
 ├─ Research Question
 │   ├─ Subquestions
 │   ├─ Sources
 │   ├─ Claims
 │   │   ├─ Supporting Evidence
 │   │   └─ Contradicting Evidence
 │   ├─ Notes
 │   ├─ Experiments
 │   └─ Outputs
 └─ Collections
```

Backend compatibility concepts such as sessions, frames, jobs, agents, and artifacts may remain internally but should be mapped to the model above.

### Core objects

**Project**
- title
- description
- goals
- status
- created/updated
- research questions
- collections

**Research Question**
- question
- scope
- status
- plan
- subquestions
- open gaps
- related sources
- claims
- outputs

**Source**
- type: paper / webpage / dataset / code / note
- title
- authors
- year
- URL / DOI / local file
- relevance
- reading status
- highlights
- linked claims

**Claim**
- text
- status: proposed / accepted / rejected / needs evidence
- confidence: low / medium / high
- support count
- contradiction count
- linked evidence
- author: human / AI
- provenance

**Evidence**
- source
- excerpt / result
- relation: supports / contradicts / contextual
- strength
- notes

**Experiment**
- hypothesis
- protocol
- environment
- runs
- metrics
- results
- conclusion
- linked claims

**Output**
- note
- report
- draft
- review
- replication plan
- export

---

## 5. Main Application Shell

Use a compact desktop-style shell.

```text
┌─────────────────────────────────────────────────────────────┐
│ Logo   Search / Command                               User │
├──────────────┬──────────────────────────────────────────────┤
│ Home         │                                              │
│ Projects     │                Workspace                     │
│ Library      │                                              │
│ Watches      │                                              │
│ Compute      │                                              │
│              │                                              │
│ Recent       │                                              │
│ Project A    │                                              │
│ Project B    │                                              │
│              │                                              │
│ Settings     │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

### Shell behavior

- collapsible sidebar
- global command palette: `Cmd/Ctrl + K`
- global search
- project quick switcher
- theme: light / dark / system
- keyboard-first navigation
- desktop native shortcuts where available

---

## 6. Project Workspace

Project tabs:

- Overview
- Research
- Sources
- Evidence
- Artifacts
- Experiments

Use a 3-pane adaptive layout:

```text
┌───────────────┬──────────────────────────┬───────────────────┐
│ Research Tree │      Main Workspace      │ Context Inspector │
│               │                          │                   │
│ Questions     │                          │ Source / Claim    │
│ Collections   │                          │ Metadata          │
│ Notes         │                          │ Actions           │
└───────────────┴──────────────────────────┴───────────────────┘
```

Rules:
- left pane can collapse
- right inspector can collapse
- center pane is always primary
- layout persists per user/project

---

## 7. Home

Home should show work state, not a generic chat prompt.

Sections:
- Continue researching
- Research inbox
- New papers from watches
- Claims needing verification
- Completed / failed experiments
- Recent projects

Example:

```text
Good evening

Continue researching
Mechanistic Interpretability
12 new sources · 3 unresolved claims

Research inbox
8 new papers
3 claims need verification
1 experiment completed
```

Primary CTA:
- New Project
- New Research Question

---

## 8. Research Workspace

This is the main product surface.

For a research question display:

- question title
- scope
- research status
- current plan
- subquestions
- findings
- open questions
- source coverage
- recent research activity

Example:

```text
Sparse Autoencoders and Interpretability

Status: Evidence gathering
18 sources · 7 claims

Research Plan
✓ Define evaluation criteria
✓ Survey foundational literature
● Compare evaluation methods
○ Identify contradictory findings
○ Assess reproducibility

Current Findings
01 Feature splitting appears at larger dictionary sizes
   Moderate · 6 sources

02 Evaluation methods vary significantly
   Strong · 8 sources

Open Questions
→ Are semantic metrics stable across seeds?
```

Chat/composer stays at the bottom but is context-aware.

---

## 9. Composer

Do not use only “Ask anything”.

Use:

```text
Ask Feynman about this research...

[ + Context ] [ Research Mode ▾ ]

Sources: Project + Web
Model: Auto
Tools: Auto
```

Modes:
- Ask
- Search
- Deep Research
- Review
- Write
- Experiment

These modes map internally to existing Feynman commands/workflows.

Advanced users may enter slash commands directly.

---

## 10. Claim Ledger

Claim Ledger is a key differentiator.

Views:
- All
- Accepted
- Needs Evidence
- Contradicted
- Rejected

Claim detail:

```text
Sparse autoencoders can exhibit feature splitting
at higher dictionary sizes.

Status: Needs review
Confidence: Moderate

Supporting Evidence
- Paper A — direct experiment
- Paper B — related result

Contradicting Evidence
- Paper C — failed replication under different setup
```

Actions:
- Accept
- Reject
- Needs evidence
- Rewrite
- Find supporting evidence
- Find contradictory evidence
- Attach source
- Add note

Draft generation should preferably use accepted claims by default.

---

## 11. Library

The Library is a research memory layer, not a file browser.

Views:
- All Sources
- Papers
- Web
- Datasets
- Code
- Collections
- Reading Queue

Paper/source card metadata:
- title
- authors
- year
- relevance
- reading status
- linked projects
- notes count
- claims count

Reading states:
- Inbox
- Skim
- Read
- Important
- Ignore

Support:
- BibTeX import/export
- RIS import/export
- PDF import
- DOI/URL ingestion
- future: Zotero integration

---

## 12. Paper Reader

Three-pane reading experience:

```text
┌──────────────┬──────────────────────┬───────────────────────┐
│ Outline      │ PDF / Document       │ Research Context      │
│              │                      │                       │
│ Abstract     │                      │ Summary               │
│ Method       │                      │ Key Claims            │
│ Experiments  │                      │ Related Sources       │
│ Conclusion   │                      │ Contradictions        │
│              │                      │ Notes                 │
└──────────────┴──────────────────────┴───────────────────────┘
```

Text selection actions:
- Add note
- Create claim
- Find supporting evidence
- Find contradicting evidence
- Explain
- Compare with…
- Ask about selection

---

## 13. Compare Workspace

Allow selecting 2–10 sources.

Generate an editable comparison matrix:

- research question
- method
- dataset
- metrics
- assumptions
- findings
- limitations
- reproducibility
- contradictions

AI can propose cells, but user can edit all cells.

---

## 14. Research Map

A focused graph, not a generic knowledge graph.

Nodes:
- research question
- claim
- source
- experiment
- open question

Edges:
- supports
- contradicts
- derived from
- tests
- related to

Primary purpose:
**“Why do I believe this?”**

Do not show every note or every artifact by default.

---

## 15. Experiments

Experiment flow:

```text
Hypothesis
↓
Protocol
↓
Environment
↓
Run
↓
Metrics
↓
Results
↓
Conclusion
↓
Linked Claims
```

Support existing Feynman execution options where available:
- local
- Docker
- Modal
- RunPod
- remote runtime

The UI should show availability by platform.

---

## 16. Research Activity

Do not personify agents.

Avoid:
- “Researcher agent is thinking”
- “Reviewer joined”

Use job-oriented status:

```text
Searching literature          ✓ 34 papers
Screening relevance           ✓ 12 selected
Extracting evidence           ✓ 21 claims
Checking citations            ● running
Reviewing methodology         ○ queued
```

Detailed trace is available under:
**View Trace / Advanced**

---

## 17. Watches

Research Watches monitor:
- topic
- author
- lab
- keyword
- query
- publication venue

Watch result flow:

```text
Watch
↓
New Sources
↓
Research Inbox
↓
Skim / Read / Ignore
↓
Attach to Project
```

Notifications:
- desktop notification
- in-app inbox
- optional email later

---

## 18. Command Palette

Shortcut:
- macOS: `Cmd + K`
- Windows/Web: `Ctrl + K`

Commands:
- New project
- New research question
- Search papers
- Deep research
- Compare selected sources
- Review draft
- Find contradictions
- Create replication plan
- Open claim
- Open source
- Switch project
- Run experiment
- Export report

---

## 19. Advanced Layer

Hidden by default.

Contains:
- agent configuration
- model selection
- skills
- tools
- prompts
- raw provenance
- execution trace
- runtime logs
- token/cost metrics
- compute configuration

Goal:
preserve Feynman power without making the default UX intimidating.

---

## 20. Platform Architecture

### Shared frontend

Recommended:
- React
- Vite
- shared component library
- responsive desktop-first layout

Suggested structure:

```text
apps/
  web/
  desktop/

packages/
  ui/
  research-domain/
  workspace/
  paper-reader/
  editor/
  api-client/
```

### Desktop

Recommended shell:
- Tauri

Desktop adds:
- filesystem access
- native menus
- notifications
- local runtime
- local models where supported
- Docker integration
- local PDF/file handling

### Web

Web uses:
- remote Feynman runtime
- remote storage
- cloud compute

Capabilities unavailable in-browser should be shown as unavailable or remote-only.

---

## 21. Visual Direction

Reference feeling:
- Linear
- Zotero
- Notion
- VS Code, but less technical

Design rules:
- compact density
- minimal borders
- subtle hierarchy
- excellent tables
- strong split-pane behavior
- clear selected states
- strong keyboard support
- light and dark mode
- restrained use of cards
- avoid large marketing-style whitespace inside working screens

Use semantic status styling:
- success
- warning
- error
- neutral
- running

Do not overuse color.

---

## 22. V1 Scope

Build only this vertical slice first:

```text
Project
↓
Research Question
↓
Deep Research
↓
Sources
↓
Claims / Evidence
↓
Paper Reader
↓
Notes
↓
Draft / Export
```

Also include:
- Home
- Library
- Command Palette
- Watches
- Settings

Defer:
- complex graph editing
- team collaboration
- marketplace
- plugin ecosystem UI
- full agent builder
- extensive compute admin

---

## 23. Initial Screens to Implement

1. App Shell
2. Home
3. Projects List
4. Project Overview
5. Research Workspace
6. Source/Library List
7. Paper Reader
8. Claim Ledger
9. Compare Workspace
10. Watches
11. Experiments
12. Settings
13. Advanced Trace Viewer

Build in that order unless dependencies require otherwise.

---

# 24. Implementation Rules for Coding Agents

The coding agent must:

1. Read this file before making product decisions.
2. Treat `https://github.com/companion-inc/feynman` as the upstream technical source of truth and inspect the actual code before assuming how Feynman works.
3. Prefer existing Feynman capabilities over rebuilding engine logic.
4. Keep UI-domain concepts separate from runtime implementation concepts.
5. Build reusable components, not page-specific duplicates.
6. Preserve cross-platform behavior.
7. Avoid adding dependencies unless necessary.
8. Keep accessibility and keyboard navigation intact.
9. Never silently remove existing Feynman capabilities.
10. Hide unsupported features instead of faking functionality.
11. Update project state after every meaningful implementation step.

---

# 25. SAVE / RESTART PROTOCOL

This project may span many AI sessions. Do not rely on chat history.

Create and maintain:

```text
.ai/
  STATE.md
  DECISIONS.md
```

These two files are generated during development; this spec remains the permanent source of truth.

## `.ai/STATE.md`

Keep it under ~120 lines.

Format:

```text
# Current State

## Current Phase
Research Workspace

## Last Completed
- App shell
- Sidebar
- Project navigation

## In Progress
- Research question workspace

## Next
1. Research plan component
2. Findings list
3. Context inspector

## Changed Files
- src/...

## Known Issues
- ...

## Run / Test
- npm run dev
- npm run test

## Resume Instruction
Continue with the first unfinished item under Next.
```

## `.ai/DECISIONS.md`

Only record decisions that future sessions must remember.

Example:

```text
# Decisions

- Use Feynman runtime as backend; do not reimplement research engine.
- Sessions/frames are not exposed in default UI.
- Claim is a first-class UI-domain entity.
- Tauri is the desktop shell.
```

Keep this file concise.

## Before stopping work

The agent MUST:
1. finish the smallest safe unit of work
2. run relevant checks
3. update `.ai/STATE.md`
4. update `.ai/DECISIONS.md` only if a durable decision changed
5. leave the project in a runnable state

## When restarting

The agent MUST read in this order:

1. this specification
2. `.ai/STATE.md`
3. `.ai/DECISIONS.md`
4. only the source files relevant to the current task

Do NOT reread the whole repository unless necessary.

If `.ai/STATE.md` is missing, inspect the repository once and create it.

---

# 26. Definition of Done for V1

V1 is complete when a researcher can:

1. create/open a project
2. create a research question
3. start a Feynman research workflow
4. see research progress without reading raw agent traces
5. review sources
6. read and annotate a paper
7. create/review claims
8. connect evidence to claims
9. compare papers
10. write/export a research output
11. close the app and resume later without losing research state
12. use the same core workflow on macOS, Windows, and Web

---

# 27. Product North Star

At every design decision ask:

> Does this help a researcher understand, verify, organize, or extend their knowledge?

If not, it probably belongs in Advanced or should not be built yet.
