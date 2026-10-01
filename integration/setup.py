"""Install a small SynthScholar runtime in this checkout's .venv."""

from __future__ import annotations

import subprocess
import sys
import venv
from argparse import ArgumentParser
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV = ROOT / ".venv"


def pip_command(python: Path) -> list[str]:
    return [
        str(python),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--prefer-binary",
        "--retries",
        "10",
        "--timeout",
        "120",
    ]


def main() -> None:
    parser = ArgumentParser(description="Install the Axorbis SynthScholar runtime.")
    parser.add_argument("--venv", type=Path, default=DEFAULT_ENV)
    args = parser.parse_args()
    environment = args.venv.expanduser().resolve()
    if sys.version_info < (3, 11):
        raise SystemExit("Python 3.11 or newer is required.")
    if not environment.exists():
        environment.parent.mkdir(parents=True, exist_ok=True)
        venv.create(environment, with_pip=True)
    python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    pip = pip_command(python)
    subprocess.run(pip + ["-r", str(ROOT / "integration/requirements.txt")], check=True)
    # The upstream meta-package installs every Pydantic AI provider. Register
    # exact package versions after installing the OpenAI compatible backend.
    subprocess.run(pip + ["--no-deps", "pydantic-ai==1.94.0", "synthscholar==0.0.11"], check=True)
    subprocess.run([str(python), "-c", "import synthscholar.pipeline, synthscholar.export"], check=True)
    print(f"SynthScholar is ready in {environment}")


if __name__ == "__main__":
    main()
