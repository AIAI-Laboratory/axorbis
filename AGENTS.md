# Repository conventions

This repository is the Axorbis Literature Review desktop app. Its only product workflow is a SynthScholar powered systematic literature review.

- Keep the desktop UI focused on defining a protocol, running or stopping a review, tracking progress, and inspecting outputs.
- The Python bridge is `integration/review_runner.py`. Pin SynthScholar in `integration/requirements.txt` and validate its current public API before changing integration behavior.
- The Tauri commands are in `app/src-tauri/src/commands.rs`. Pass API keys only to the Python process through stdin. Never persist keys in a review folder, browser storage, logs, or process arguments.
- Review outputs go under the user selected workspace in a unique `<slug>-<timestamp>` folder. Preserve Markdown, structured JSON, BibTeX, protocol, status, and the runtime log.
- Keep `README.md` and `app/README.md` aligned with setup and user visible behavior.
- Do not reintroduce the retired Feynman/Pi runtime or unrelated productivity features.
- Preserve existing user generated files and unrelated working tree changes.
