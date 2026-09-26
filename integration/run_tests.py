"""Run integration tests with the Python environment installed by setup.py."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
candidate = root / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
python = candidate if candidate.is_file() else Path(sys.executable)
raise SystemExit(subprocess.call([str(python), "-W", "ignore::DeprecationWarning", "-m", "unittest", "discover", "-s", str(root / "integration"), "-p", "test_*.py"]))
