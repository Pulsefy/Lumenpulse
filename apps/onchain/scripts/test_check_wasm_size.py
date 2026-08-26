import json
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("check-wasm-size.py")
SPEC = importlib.util.spec_from_file_location("check_wasm_size", SCRIPT)
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class WasmSizeGateTest(unittest.TestCase):
    def run_gate(self, size, budget):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_dir = root / "artifacts"
            artifact_dir.mkdir()
            (artifact_dir / "demo.wasm").write_bytes(b"x" * size)
            (root / "budgets.json").write_text(json.dumps({"max_bytes": budget, "contracts": {"demo": {}}}))
            return subprocess.run(
                [sys.executable, str(SCRIPT), "--config", str(root / "budgets.json"), "--artifact-dir", str(artifact_dir), "--report", str(root / "report.md")],
                capture_output=True,
                text=True,
            )

    def test_accepts_artifact_within_budget_and_reports_size(self):
        result = self.run_gate(12, 12)
        self.assertEqual(result.returncode, 0)
        self.assertIn("12 bytes", result.stdout)

    def test_rejects_artifact_over_budget(self):
        result = self.run_gate(13, 12)
        self.assertEqual(result.returncode, 1)
        self.assertIn("demo: 13 > 12 bytes", result.stderr)

    def test_rejects_missing_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "budgets.json").write_text(json.dumps({"max_bytes": 12, "contracts": {"demo": {}}}))
            result = subprocess.run([sys.executable, str(SCRIPT), "--config", str(root / "budgets.json"), "--artifact-dir", str(root)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("missing WASM artifact", result.stderr)

    def test_reports_delta_from_base(self):
        report = CHECKER.markdown({"demo": 14}, {"demo": 20}, {"demo": 11})
        self.assertIn("+3 bytes", report)


if __name__ == "__main__":
    unittest.main()