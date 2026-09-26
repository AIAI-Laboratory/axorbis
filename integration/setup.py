"""Install a small SynthScholar runtime in this checkout's .venv."""

from __future__ import annotations

import subprocess
import sys
import venv
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".venv"


def main() -> None:
    if sys.version_info < (3, 11):
        raise SystemExit("Python 3.11 or newer is required.")
    if not ENV.exists():
        venv.create(ENV, with_pip=True)
    python = ENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    pip = [str(python), "-m", "pip", "install", "--disable-pip-version-check"]
    subprocess.run(pip + ["-r", str(ROOT / "integration/requirements.txt")], check=True)
    # The upstream meta-package installs every Pydantic AI provider. Register
    # exact package versions after installing the OpenAI compatible backend.
    subprocess.run(pip + ["--no-deps", "pydantic-ai==1.94.0", "synthscholar==0.0.11"], check=True)
    subprocess.run([str(python), "-c", "import synthscholar.pipeline, synthscholar.export"], check=True)
    print(f"SynthScholar is ready in {ENV}")


if __name__ == "__main__":
    main()
