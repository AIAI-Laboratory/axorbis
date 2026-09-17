# Decisions

- Reuse the upstream Node/Pi workbench runtime and APIs; do not replace research agents, tools, provenance, persistence, or compute.
- Present persisted workbench sessions as research questions in the first UI slice. Keep the underlying session available through Advanced until a dedicated question model is added.
- Serve the Axorbis research interface at root and `/app-shell/` so old deep links open the new visual system. Bundle only the research HTML entry point; retain backend research capabilities and source helpers for incremental UI adaptation.
- Use `#FF3B30`, white, black, and neutral grays for the interface, with light/dark/system theme support and disclosure of question list and evidence inspector on demand.
- Expose an `axorbis` CLI alias while retaining the upstream package name, `feynman` command, and persisted data paths until a separately verified distribution migration is ready.
- Use existing workbench project/session creation APIs; keep theme globally and pane display preferences per project in local storage until user settings support them.
