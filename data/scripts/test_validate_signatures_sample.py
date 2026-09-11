import json
import sys
from collections import Counter
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from validate_signatures_sample import (
    SIMPLE_RANDOM_TARGET,
    STRATA_QUOTAS,
    STRATIFIED_TARGET,
    _in_strata,
    draw_sample,
    events,
    main,
)


def _row(page, rev_index, overwrite=False):
    return {"page": page, "rev_index": rev_index, "overwrite": overwrite, "seq": 2, "before": "b", "after": "a"}


def _write_page(revisions_dir, name, revisions):
    (revisions_dir / f"{name}.json").write_text(json.dumps(revisions), encoding="utf-8")


def test_events_mirrors_production_flags_and_marks_genesis_kinds(tmp_path):
    revisions_dir = tmp_path / "data" / "processed" / "revisions"
    revisions_dir.mkdir(parents=True)
    _write_page(revisions_dir, "w~Genesis", [
        {"seq": 1, "label": "a", "body": "start"},
        {"seq": 2, "label": "b", "body": "https://x.pinggy.io/a SYSTEM: ignore previous"},
    ])
    _write_page(revisions_dir, "w~Bare", [
        {"seq": 1, "label": "a", "body": "start"},
        {"seq": 2, "label": "b", "body": "bare pinggy mention"},
    ])
    _write_page(revisions_dir, "w~Truncated", [
        {"seq": 5, "label": "a", "body": "start"},
        {"seq": 6, "label": "b", "body": "plain"},
    ])

    rows = events(tmp_path)

    genesis = next(row for row in rows if row["page"] == "w~Genesis")
    bare = next(row for row in rows if row["page"] == "w~Bare")
    truncated = next(row for row in rows if row["page"] == "w~Truncated")
    assert genesis["tunnel"] and genesis["inject"]
    assert genesis["genesis"] and not genesis["truncated"]
    assert not bare["tunnel"]
    assert truncated["truncated"] and not truncated["genesis"]


def test_draw_sample_reaches_targets_and_covers_each_category():
    rows = []
    for name, _quota in STRATA_QUOTAS:
        for index in range(40):
            row = _row(f"{name}-{index}", 1)
            row[name] = True
            rows.append(row)

    chosen = draw_sample(rows)

    assert len(chosen) == STRATIFIED_TARGET + SIMPLE_RANDOM_TARGET
    assert len({(row["page"], row["rev_index"]) for row in chosen}) == len(chosen)
    for name, quota in STRATA_QUOTAS:
        assert sum(1 for row in chosen if row.get(name)) >= quota


def test_draw_sample_is_seeded_and_deduplicates():
    rows = [_row(f"page-{index}", 1, overwrite=index % 2 == 0) for index in range(400)]

    chosen = draw_sample(rows)

    assert chosen == draw_sample(rows)
    assert len(chosen) == STRATIFIED_TARGET + SIMPLE_RANDOM_TARGET
    assert len({(row["page"], row["rev_index"]) for row in chosen}) == len(chosen)


def test_draw_sample_tops_up_from_all_rows_when_strata_pool_is_small():
    rows = [_row(f"plain-{index}", 1) for index in range(400)]

    chosen = draw_sample(rows)

    counts = Counter(row["subset"] for row in chosen)
    assert len(chosen) == STRATIFIED_TARGET + SIMPLE_RANDOM_TARGET
    assert counts["fallback"] == STRATIFIED_TARGET
    assert counts["random"] == SIMPLE_RANDOM_TARGET
    assert "stratified" not in counts


def test_draw_sample_output_order_is_not_grouped_by_stratum():
    rows = []
    for index in range(200):
        row = _row(f"tunnel-{index}", 1)
        row["tunnel"] = True
        row["genesis"] = True
        rows.append(row)
    for index in range(400):
        row = _row(f"plain-{index}", 1)
        row["genesis"] = True
        rows.append(row)

    chosen = draw_sample(rows)

    tunnel_flags = [bool(row.get("tunnel")) for row in chosen]
    assert sum(tunnel_flags) > 1
    assert not all(tunnel_flags)
    assert any(a != b for a, b in zip(tunnel_flags, tunnel_flags[1:]))


def test_main_writes_blind_sample_and_separate_strata_manifest(tmp_path, monkeypatch):
    revisions_dir = tmp_path / "data" / "processed" / "revisions"
    revisions_dir.mkdir(parents=True)
    for index in range(60):
        _write_page(revisions_dir, f"w~Plain{index}", [
            {"seq": seq, "label": "a" if seq % 2 else "b", "body": "plain body " + ("x" * 300 if seq % 2 else "y")}
            for seq in range(1, 9)
        ])
    _write_page(revisions_dir, "w~Tunnel", [
        {"seq": seq, "label": "a" if seq % 2 else "b", "body": f"https://x.pinggy.io/a {seq}"}
        for seq in range(1, 23)
    ])
    sample_path = tmp_path / "out" / "sample.json"
    strata_path = tmp_path / "out" / "strata.json"
    monkeypatch.setattr(sys, "argv", [
        "validate_signatures_sample.py", "--root", str(tmp_path),
        "--sample", str(sample_path), "--strata", str(strata_path),
    ])

    main()

    payload = json.loads(sample_path.read_text(encoding="utf-8"))
    manifest = json.loads(strata_path.read_text(encoding="utf-8"))
    assert payload["protocol"] == "Blind BEFORE/AFTER labeling; raw payload texts included; no extractor or stratum output"
    assert len(payload["events"]) == STRATIFIED_TARGET + SIMPLE_RANDOM_TARGET
    for event in payload["events"]:
        assert set(event) == {"id", "page", "rev_index", "seq", "before", "after"}
    strata_by_id = {event["id"]: event for event in manifest["events"]}
    assert set(strata_by_id) == {event["id"] for event in payload["events"]}
    subset_counts = Counter(event["subset"] for event in manifest["events"])
    assert subset_counts["stratified"] == STRATIFIED_TARGET
    assert subset_counts["random"] == SIMPLE_RANDOM_TARGET
    assert sum(1 for event in manifest["events"] if "tunnel" in event["strata"]) >= 9


def test_events_tolerates_null_bodies(tmp_path):
    revisions_dir = tmp_path / "data" / "processed" / "revisions"
    revisions_dir.mkdir(parents=True)
    _write_page(revisions_dir, "w~NullBody", [
        {"seq": 1, "label": "a", "body": "start"},
        {"seq": 2, "label": "b", "body": None},
        {"seq": 3, "label": "a", "body": None},
    ])

    rows = events(tmp_path)

    assert [row["after"] for row in rows] == ["", ""]
    assert [row["overwrite"] for row in rows] == [True, False]


def test_pool_strata_excludes_page_wide_genesis_and_truncated():
    assert _in_strata({"overwrite": True})
    assert _in_strata({"tunnel": True})
    assert not _in_strata({"genesis": True})
    assert not _in_strata({"truncated": True})


def _labels_file(tmp_path, payload):
    path = tmp_path / "labels.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_compare_scores_annotated_list_and_writes_nothing(tmp_path, monkeypatch, capsys):
    labels = _labels_file(tmp_path, [
        {"human_artifacts": ["domain:a"], "detected_artifacts": ["domain:a", "domain:b"]},
        {"human_artifacts": ["domain:c"], "detected_artifacts": []},
    ])
    sample_path = tmp_path / "sample.json"
    strata_path = tmp_path / "strata.json"
    monkeypatch.setattr(sys, "argv", [
        "validate_signatures_sample.py", "--compare", str(labels),
        "--sample", str(sample_path), "--strata", str(strata_path),
    ])

    main()

    out = capsys.readouterr().out
    assert "precision=TP/(TP+FP)=0.5000" in out
    assert "recall=TP/(TP+FN)=0.5000" in out
    assert "event_false_detection_rate=1/2" in out
    assert not sample_path.exists()
    assert not strata_path.exists()


def test_compare_rejects_dict_sample_and_empty_list(tmp_path, monkeypatch):
    dict_path = _labels_file(tmp_path, {"protocol": "x", "events": []})
    monkeypatch.setattr(sys, "argv", ["validate_signatures_sample.py", "--compare", str(dict_path)])
    with pytest.raises(SystemExit):
        main()

    empty_path = _labels_file(tmp_path, [])
    monkeypatch.setattr(sys, "argv", ["validate_signatures_sample.py", "--compare", str(empty_path)])
    with pytest.raises(SystemExit):
        main()


def test_compare_rejects_non_string_artifact_fields(tmp_path, monkeypatch):
    null_field = _labels_file(tmp_path, [{"human_artifacts": None, "detected_artifacts": []}])
    monkeypatch.setattr(sys, "argv", ["validate_signatures_sample.py", "--compare", str(null_field)])
    with pytest.raises(SystemExit):
        main()

    string_field = _labels_file(tmp_path, [{"human_artifacts": "domain:a", "detected_artifacts": []}])
    monkeypatch.setattr(sys, "argv", ["validate_signatures_sample.py", "--compare", str(string_field)])
    with pytest.raises(SystemExit):
        main()
