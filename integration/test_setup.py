from pathlib import Path
from unittest import TestCase

from setup import pip_command


class SetupTests(TestCase):
    def test_pip_install_tolerates_slow_runtime_downloads(self) -> None:
        command = pip_command(Path("python"))

        self.assertEqual(command[:4], ["python", "-m", "pip", "install"])
        self.assertIn("--prefer-binary", command)
        self.assertEqual(command[command.index("--retries") + 1], "10")
        self.assertEqual(command[command.index("--timeout") + 1], "120")
