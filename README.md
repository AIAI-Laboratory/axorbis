<p align="center">
  <img src="img/banner.png" alt="Axorbis — An evidence-first AI research workspace built on the Feynman research engine" width="100%" />
</p>

<h1 align="center">Axorbis</h1>

<p align="center">
  <strong>An evidence-first AI research workspace built on the Feynman research engine.</strong><br/>
  Questions · Sources · Claims · Experiments · Outputs — all in one local, auditable workspace.
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick Start</strong></a> · 
  <a href="#research-workflows"><strong>Workflows</strong></a> · 
  <a href="#features"><strong>Features</strong></a> · 
  <a href="#repository-layout"><strong>Repo Layout</strong></a> · 
  <a href="LICENSE"><strong>MIT License</strong></a>
</p>

---

## Why Axorbis?

Research tools scatter your work across tabs, PDFs, notebooks, and chat windows. Axorbis brings everything into one workspace where every claim is traceable back to its source.

- **Evidence-first** — Claims are linked to sources. Verification is built in, not bolted on.
- **Desktop-native** — Your data stays local. Provider secrets are encrypted at rest.
- **Workflow-rich** — 12 research modes from literature review to replication planning, all accessible from one composer.

---

## Features

<table>
  <tr>
    <td width="50%">

**🔬 Research Workspace**
- Projects with focused research questions
- Ask & Deep Research with streamed activity
- Plan-then-approve workflow for Deep Research
- Sources, claims, and evidence inspection

</td>
    <td width="50%">

**📊 Research Workflows**
- Literature review, summarize, compare
- Audit, recipe, replicate, auto research
- Draft generation, review, watch
- All modes accessible from the composer

</td>
  </tr>
  <tr>
    <td width="50%">

**🔐 AI Provider Management**
- BYOK for Anthropic, OpenAI, Gemini, OpenRouter, LM Studio, Ollama, LiteLLM, and custom providers
- Encrypted credentials, never returned to UI
- Token/cost tracking, monthly budgets, hard stops

</td>
    <td width="50%">

**🖥️ Desktop Native**
- Tauri-powered native application
- Workspace selection, auto-startup, tray
- Localhost-bound with tokenized sessions
- Managed backend lifecycle

</td>
  </tr>
</table>

---

## Research Workflows

The composer provides **12 research modes**, each mapping to a Feynman engine workflow:

| Mode | Command | Description |
|---|---|---|
| **Ask** | *(free-form)* | Ask anything about the current research question |
| **Deep Research** | `/deepresearch` | Source-heavy investigation with inline citations |
| **Literature Review** | `/lit` | Review papers by topic, lab, PI, or author |
| **Summarize** | `/summarize` | Summarize a paper, report, or artifact |
| **Compare** | `/compare` | Source-grounded comparison matrix |
| **Audit** | `/audit` | Compare claims against public code for reproducibility |
| **Recipe** | `/recipe` | Find ranked, implementable ML training recipes |
| **Replicate** | `/replicate` | Plan a replication workflow for a paper or claim |
| **Auto Research** | `/autoresearch` | Bounded experiment loop with hypothesis testing |
| **Watch** | `/watch` | Create a research watch baseline with follow-ups |
| **Draft** | `/draft` | Turn findings into a polished paper-style draft |
| **Review** | `/review` | Internal critique with objections and revision plan |

> **Tip:** When you select any workflow mode (except Ask), just press Enter — Axorbis automatically uses your research question as the input. Type in the composer to override.

---

## Quick Start

### Requirements

- Node.js 22.22–25.x, npm
- Rust and [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)

### Run from source

```bash
git clone https://github.com/AIAI-Laboratory/axorbis.git
cd axorbis
nvm use || nvm install
npm ci
npm ci --prefix app
npm run desktop:dev
```

### Configure a model

```bash
npm run dev -- setup
```

Or use **Settings → AI Providers** in the app to add your API keys.

---

## Build & Release

```bash
# Type check and verify
npm run typecheck
npm run desktop:check

# Development build
npm run desktop:build

# Self-contained release with native installer
npm run desktop:release-build
```

---

## Repository Layout

```text
engine/       Feynman research engine, CLI, and Workbench backend
web/          UI source bundled into the desktop application
app/          Tauri host, native commands, icons, and packaging
prompts/      Research workflow prompt definitions
extensions/   Pi research tools and integration extensions
img/          Axorbis icon and banner assets
scripts/      Build, staging, and verification scripts
tests/        Engine, Workbench, and desktop tests
website/      Documentation site sources
```

---

## Security

- Research state, artifacts, and sessions remain local to your workspace
- Provider secrets are encrypted at rest and never returned to the UI
- The desktop backend is bound to `localhost` with a tokenized session URL
- No telemetry, no cloud sync — your research stays yours

---

## Project Direction

Axorbis preserves Feynman's open research engine while focusing product development on a reliable native research workspace. Every feature must improve **discovery, reading, evidence ranking, verification, reproduction, synthesis, or research observability**.

---

<p align="center">
  <img src="img/icon.png" alt="Axorbis" width="48" /><br/>
  <sub>Released under the <a href="LICENSE">MIT License</a>.</sub><br/>
  <sub>Open source for a more truthful tomorrow.</sub>
</p>
