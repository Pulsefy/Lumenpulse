import os
import time

import pytest

import src.ml.model_registry as registry
import src.ml.model_registry_gc as gc

DAY = 86400


@pytest.fixture(autouse=True)
def isolated_registry(monkeypatch, tmp_path):
    monkeypatch.setattr(registry, "_MODELS_ROOT", tmp_path)
    monkeypatch.setattr(registry, "_live_models", {})
    monkeypatch.setattr(registry, "_live_versions", {})
    monkeypatch.setattr(registry, "_shadow_models", {})
    monkeypatch.setattr(registry, "_shadow_versions", {})
    return tmp_path


def save(version, age_days=100, model_type="test", metadata=False):
    """Save a version and backdate its files."""
    registry.save_model(
        model_type, {"v": version}, version=version, metadata={"k": 1} if metadata else None
    )
    stamp = time.time() - age_days * DAY
    for f in (registry._MODELS_ROOT / model_type).glob(f"{version}.*"):
        os.utime(f, (stamp, stamp))
    return version


def remaining(model_type="test"):
    return {
        p.stem for p in (registry._MODELS_ROOT / model_type).glob("v*.pkl")
    }


def policy(keep_last=2, max_age_days=0):
    return gc.RetentionPolicy(keep_last=keep_last, max_age_days=max_age_days)


def test_removes_versions_beyond_keep_last():
    for i in range(5):
        save(f"v1.{i}")

    report = gc.collect_garbage(policy(keep_last=2))

    assert remaining() == {"v1.3", "v1.4"}
    assert [v.version for _, v in report.removed] == ["v1.2", "v1.1", "v1.0"]


def test_orders_versions_numerically_not_lexically():
    for v in ("v1.2", "v1.9", "v1.10", "v1.11"):
        save(v)

    gc.collect_garbage(policy(keep_last=2))

    assert remaining() == {"v1.10", "v1.11"}


def test_never_removes_live_previous_or_shadow():
    for i in range(6):
        save(f"v1.{i}")
    registry.promote_model("test", "v1.0")
    registry.promote_model("test", "v1.1")  # live=v1.1, previous=v1.0
    registry.register_shadow("test", "v1.2")

    report = gc.collect_garbage(policy(keep_last=1))

    # newest (v1.5) by policy; v1.1 live, v1.0 previous, v1.2 shadow protected
    assert remaining() == {"v1.5", "v1.1", "v1.0", "v1.2"}
    assert {v.version for _, v in report.removed} == {"v1.3", "v1.4"}
    assert report.kept["test"]["v1.1"] == "protected (live)"
    assert report.kept["test"]["v1.0"] == "protected (previous)"
    assert report.kept["test"]["v1.2"] == "protected (shadow)"


def test_previous_falls_back_to_preceding_version_without_history(tmp_path):
    for i in range(4):
        save(f"v1.{i}")
    # Live pointer written directly, as for registries predating previous.json.
    (tmp_path / "test" / "current.json").write_text('{"version":"v1.2"}')

    gc.collect_garbage(policy(keep_last=1))

    assert remaining() == {"v1.3", "v1.2", "v1.1"}


def test_promote_records_previous_version(tmp_path):
    save("v1.0")
    save("v1.1")
    registry.promote_model("test", "v1.0")
    registry.promote_model("test", "v1.1")

    assert (tmp_path / "test" / "previous.json").read_text() == '{"version":"v1.0"}'


def test_dry_run_deletes_nothing_and_lists_candidates():
    for i in range(4):
        save(f"v1.{i}")

    report = gc.collect_garbage(policy(keep_last=1), dry_run=True)

    assert remaining() == {"v1.0", "v1.1", "v1.2", "v1.3"}
    assert [v.version for _, v in report.removed] == ["v1.2", "v1.1", "v1.0"]
    assert any(line.startswith("Would remove v1.2 of test") for line in report.lines())
    assert report.reclaimed_bytes > 0


def test_removes_sidecars_and_reports_reclaimed_space(tmp_path):
    save("v1.0", metadata=True)
    (tmp_path / "test" / "v1.0.card.json").write_text("{}")
    save("v1.1")
    expected = sum(
        f.stat().st_size for f in (tmp_path / "test").glob("v1.0.*")
    )

    report = gc.collect_garbage(policy(keep_last=1))

    assert not list((tmp_path / "test").glob("v1.0.*"))
    assert report.reclaimed_bytes == expected > 0


def test_removed_versions_are_logged_with_reclaimed_space(monkeypatch):
    save("v1.0")
    save("v1.1")
    messages = []
    monkeypatch.setattr(
        gc.logger, "info", lambda msg, *args: messages.append(msg % args)
    )

    gc.collect_garbage(policy(keep_last=1))

    assert any(
        "removed: type=test version=v1.0 reclaimed=" in m for m in messages
    )


def test_age_rule_keeps_recent_versions_beyond_keep_last():
    save("v1.0", age_days=90)
    save("v1.1", age_days=10)  # older than newest 1, but within 30 days
    save("v1.2", age_days=1)

    gc.collect_garbage(policy(keep_last=1, max_age_days=30))
    assert remaining() == {"v1.1", "v1.2"}

    gc.collect_garbage(policy(keep_last=1, max_age_days=0))  # age rule off
    assert remaining() == {"v1.2"}


def test_leaves_unmanaged_files_and_other_types_alone(tmp_path):
    save("v1.0")
    save("v1.1")
    (tmp_path / "test" / "vnotes.pkl").write_bytes(b"x")
    (tmp_path / "test" / "current.json").write_text('{"version":"v1.1"}')
    save("v1.0", model_type="other")

    gc.collect_garbage(policy(keep_last=1), model_type="test")

    assert (tmp_path / "test" / "vnotes.pkl").exists()
    assert remaining("other") == {"v1.0"}


def test_dry_run_does_not_create_directories_or_migrate_pointers(tmp_path):
    save("v1.0")
    target = tmp_path / "test" / "v1.0.pkl"
    (tmp_path / "test" / "current").symlink_to(target.name)

    gc.collect_garbage(policy(keep_last=1), dry_run=True)

    assert not (tmp_path / "test" / "shadow").exists()
    assert (tmp_path / "test" / "current").is_symlink()
    assert not (tmp_path / "test" / "current.json").exists()


def test_legacy_symlink_counts_as_live(tmp_path):
    for i in range(3):
        save(f"v1.{i}")
    (tmp_path / "test" / "current").symlink_to("v1.0.pkl")

    gc.collect_garbage(policy(keep_last=1))

    assert "v1.0" in remaining()


def test_policy_validation_and_env(monkeypatch):
    with pytest.raises(ValueError):
        gc.RetentionPolicy(keep_last=0)
    with pytest.raises(ValueError):
        gc.RetentionPolicy(max_age_days=-1)
    monkeypatch.setenv("MODEL_RETENTION_KEEP_LAST", "7")
    monkeypatch.setenv("MODEL_RETENTION_MAX_AGE_DAYS", "12")
    assert gc.RetentionPolicy.from_env() == gc.RetentionPolicy(7, 12)


def test_cli_dry_run_prints_plan_and_deletes_nothing(capsys):
    for i in range(3):
        save(f"v1.{i}")

    code = gc.main(["--dry-run", "--keep-last", "1", "--max-age-days", "0"])

    out = capsys.readouterr().out
    assert code == 0
    assert "Would remove v1.1 of test" in out
    assert remaining() == {"v1.0", "v1.1", "v1.2"}


def test_cli_removes_and_rejects_bad_arguments(capsys):
    for i in range(3):
        save(f"v1.{i}")

    assert gc.main(["--keep-last", "1", "--max-age-days", "0"]) == 0
    assert remaining() == {"v1.2"}
    with pytest.raises(SystemExit):
        gc.main(["--keep-last", "0"])


def test_delete_failure_is_reported_and_other_versions_still_processed(monkeypatch):
    for i in range(4):
        save(f"v1.{i}")
    real_unlink = gc.Path.unlink

    def flaky(self, *a, **k):
        if self.name.startswith("v1.1."):
            raise PermissionError("denied")
        return real_unlink(self, *a, **k)

    monkeypatch.setattr(gc.Path, "unlink", flaky)

    report = gc.collect_garbage(policy(keep_last=1))

    assert len(report.errors) == 1 and "v1.1" in report.errors[0]
    assert "v1.0" not in remaining() and "v1.1" in remaining()
    assert gc.main(["--keep-last", "1", "--max-age-days", "0"]) == 1
