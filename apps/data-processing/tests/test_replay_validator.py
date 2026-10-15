import json

from src.replay_validator import identity, load_records, replay, select_records


def test_replays_bounded_ledger_slice_and_reports_nested_difference(tmp_path):
    input_path = tmp_path / "history.jsonl"
    input_path.write_text(
        "\n".join(
            [
                json.dumps({"id": "a", "ledger": 10, "value": 1}),
                json.dumps({"id": "b", "ledger": 20, "value": 2}),
                json.dumps({"id": "c", "ledger": 30, "value": 3}),
            ]
        ),
        encoding="utf-8",
    )

    records = select_records(load_records(str(input_path)), start_ledger=20, end_ledger=30)
    report = replay(records, identity, lambda record: {**record, "value": record["value"] + 1})

    assert report["status"] == "differences"
    assert report["compared"] == 2
    assert report["difference_count"] == 2
    assert report["differences"][0]["path"] == "$.value"


def test_identical_replay_matches():
    report = replay([{"id": "a", "ledger": 1}], identity, identity)

    assert report["status"] == "match"
    assert report["difference_count"] == 0
    assert report["failure_count"] == 0