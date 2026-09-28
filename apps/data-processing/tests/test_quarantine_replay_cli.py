"""
tests/test_quarantine_replay_cli.py

CLI tests for the quarantine replay command (issue #1453).

Covers:
- Exit code 2 on invalid arguments (bad timestamps, negative limit).
- Exit code 0 with a readable summary on success and dry run.
- Exit code 1 on unexpected errors.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.ingestion import quarantine_replay_cli
from src.ingestion.quarantine_replay_cli import main


@pytest.fixture()
def quarantine_file(tmp_path: Path) -> str:
    return str(tmp_path / "quarantine.jsonl")


def _seed(store_path: str, payload: dict) -> None:
    store = quarantine_replay_cli.QuarantineStore(quarantine_path=store_path)
    store.add(payload, reason="validation_failed", source="news_fetcher")


class TestInvalidArguments:
    def test_bad_since_returns_2(self, capsys):
        assert main(["--since", "not-a-date"]) == 2
        assert "--since" in capsys.readouterr().err

    def test_bad_until_returns_2(self, capsys):
        assert main(["--until", "yesterday"]) == 2
        assert "--until" in capsys.readouterr().err

    def test_negative_limit_returns_2(self, capsys):
        assert main(["--limit", "-1"]) == 2
        assert "--limit" in capsys.readouterr().err


class TestSuccessRuns:
    def test_happy_path_prints_summary_and_returns_0(self, quarantine_file, capsys):
        _seed(
            quarantine_file,
            {
                "id": "n1",
                "title": "T",
                "content": "C",
                "published_at": "2026-01-01T00:00:00+00:00",
                "source": "unit-test",
                "url": "https://example.com/a",
            },
        )
        sink_path = str(Path(quarantine_file).with_name("sink.jsonl"))

        exit_code = main(
            [
                "--quarantine-path",
                quarantine_file,
                "--sink-path",
                sink_path,
                "--limit",
                "10",
            ]
        )

        assert exit_code == 0
        out = capsys.readouterr().out
        assert "scanned: 1" in out
        assert "replayed: 1" in out
        assert Path(sink_path).exists()

    def test_dry_run_reports_without_writing(self, quarantine_file, capsys):
        _seed(quarantine_file, {"id": "bad", "published_at": ""})
        sink_path = str(Path(quarantine_file).with_name("sink.jsonl"))

        exit_code = main(
            [
                "--quarantine-path",
                quarantine_file,
                "--sink-path",
                sink_path,
                "--dry-run",
            ]
        )

        assert exit_code == 0
        out = capsys.readouterr().out
        assert "dry run" in out
        assert "still failing: 1" in out
        assert not Path(sink_path).exists()

    def test_source_filter_narrows_cli_run(self, quarantine_file, capsys):
        _seed(
            quarantine_file,
            {
                "id": "n1",
                "title": "T",
                "content": "C",
                "published_at": "2026-01-01T00:00:00+00:00",
                "source": "unit",
                "url": None,
            },
        )
        store = quarantine_replay_cli.QuarantineStore(quarantine_path=quarantine_file)
        store.add(
            {"metric": True}, reason="validation_failed", source="stellar_fetcher"
        )

        exit_code = main(
            [
                "--quarantine-path",
                quarantine_file,
                "--sink-path",
                str(Path(quarantine_file).with_name("sink.jsonl")),
                "--source",
                "stellar_fetcher",
            ]
        )

        assert exit_code == 0
        out = capsys.readouterr().out
        assert "scanned: 1" in out

    def test_empty_store_returns_0_with_zero_summary(self, quarantine_file, capsys):
        exit_code = main(["--quarantine-path", quarantine_file])

        assert exit_code == 0
        out = capsys.readouterr().out
        assert "scanned: 0" in out
        assert "replayed: 0" in out


class TestUnexpectedErrors:
    def test_unreadable_quarantine_file_returns_1(self, tmp_path, capsys):
        bad_dir = tmp_path / "blocked"
        bad_dir.mkdir(mode=0o500)
        bad_path = str(bad_dir / "quarantine.jsonl")

        try:
            exit_code = main(["--quarantine-path", bad_path])
        finally:
            bad_dir.chmod(0o700)

        if exit_code == 0:
            pytest.skip("running as root, permission test not effective")
        assert exit_code == 1
        assert "error:" in capsys.readouterr().err

    def test_summary_details_line_contains_outcome(self, quarantine_file, capsys):
        _seed(quarantine_file, {"id": "bad", "published_at": ""})

        exit_code = main(["--quarantine-path", quarantine_file])

        assert exit_code == 0
        out = capsys.readouterr().out
        assert "still_failing" in out

    def test_seed_helper_writes_valid_jsonl(self, quarantine_file):
        payload = {"id": "n1"}
        _seed(quarantine_file, payload)
        line = Path(quarantine_file).read_text().strip().splitlines()[0]
        assert json.loads(line)["payload"] == payload
