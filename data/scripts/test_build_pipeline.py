import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import build


def _write_gzip_jsonl(path: Path, rows: list[dict]) -> None:
    with gzip.open(path, "wt", encoding="utf-8", newline="") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")


def _write_gzip_json(path: Path, value: dict) -> None:
    with gzip.open(path, "wt", encoding="utf-8", newline="") as stream:
        json.dump(value, stream, ensure_ascii=False)


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_main_builds_golden_outputs_and_syncs_public(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    out = tmp_path / "processed"
    public = tmp_path / "public" / "data"
    raw.mkdir()

    colliding_ids = ["wiki~Page A", "wiki~Page_A"]
    revisions = [
        {
            "page_id": colliding_ids[1],
            "seq": 2,
            "rev_id": "r2",
            "wiki": "wiki",
            "write_date": "2026-02-03T04:05:06Z",
            "label": "agent-b",
            "ip16": "203.0",
            "change_summary": "second",
            "body_len": 12,
            "body": "second body",
            "request_action": "edit",
            "round_id": ["round-2"],
        },
        {
            "page_id": colliding_ids[0],
            "seq": 2,
            "rev_id": "r1b",
            "wiki": "wiki",
            "write_date": "2026-02-02T03:04:05Z",
            "label": "agent-a",
            "ip16": "198.51",
            "change_summary": None,
            "body_len": 5,
            "body": "later",
            "request_action": None,
            "round_id": None,
        },
        {
            "page_id": colliding_ids[0],
            "seq": 1,
            "rev_id": "r1a",
            "wiki": "wiki",
            "write_date": "2026-02-01T01:02:03Z",
            "label": "agent-a",
            "ip16": "198.51",
            "change_summary": "first",
            "body_len": 7,
            "body": "first",
            "request_action": "create",
            "round_id": ["round-1"],
        },
    ]
    pages = [
        {
            "page_id": colliding_ids[0],
            "wiki": "wiki",
            "name": "Page A",
            "n_revs": 2,
            "first_write": "2026-02-01T01:02:03Z",
            "last_write": "2026-02-02T03:04:05Z",
            "deleted_live": False,
            "n_deletions": 1,
            "page_family": None,
            "n_labels": 10,
            "labels": [f"label-{index}" for index in range(10)],
        },
        {
            "page_id": colliding_ids[1],
            "wiki": "wiki",
            "name": "Page_A",
            "n_revs": 1,
            "first_write": "2026-02-03T04:05:06Z",
            "last_write": "2026-02-03T04:05:06Z",
            "deleted_live": True,
            "n_deletions": 2,
            "page_family": "family",
            "n_labels": 1,
            "labels": ["agent-b"],
        },
    ]
    events = [
        {
            "event_type": "save",
            "time": "2026-02-03T04:05:00Z",
            "wiki": "wiki",
            "page": "Page_A",
            "request_action": "edit",
            "ip16": "2001:db8::/64",
            "revision_ref": "r2",
            "param_family": "family",
            "success_observed": True,
            "related_event_id": "e0",
            "actor_label": "agent-b",
        },
        {
            "event_type": "delete",
            "time": "2026-02-03T14:00:00Z",
            "page_id": "wiki/Page_A",
            "page": "Page_A",
        },
        {"event_type": "revert", "time": "2026-02-02T23:59:59Z", "wiki": "wiki", "page": "Page A"},
        {"event_type": "probe", "time": "2026-02-01T01:00:00Z", "wiki": "wiki", "page": "Page A"},
        {"event_type": "other", "time": "2026-02-01T00:00:00Z", "wiki": "wiki"},
        {"event_type": "save", "time": "2026-02-01T00:00:00Z", "page_id": "other/Page"},
    ]
    labels = [
        {"label": "agent-a", "stored_revisions": 2, "first_write": "2026-02-01T01:02:03Z", "last_write": "2026-02-02T03:04:05Z", "stored_revision_pages": ["wiki/Page A"], "is_human_handle": False, "wikis": ["wiki"], "pages": [f"page-{index}" for index in range(2001)]},
        {"label": "agent-b", "stored_revisions": 1, "first_write": "2026-02-03T04:05:06Z", "last_write": "2026-02-03T04:05:06Z", "stored_revision_pages": ["wiki/Page_A"], "is_human_handle": True, "wikis": ["wiki"], "pages": ["wiki/Page_A"]},
        {"label": "", "stored_revisions": 1, "first_write": "2026-02-01T00:00:00Z", "last_write": "2026-02-01T00:00:00Z", "stored_revision_pages": [], "pages": []},
    ]
    manifest = {"generated_at": "2026-02-04T00:00:00Z", "per_wiki": {"wiki": {"pages": 2}}}

    _write_gzip_jsonl(raw / "revisions.jsonl.gz", revisions)
    _write_gzip_jsonl(raw / "pages.jsonl.gz", pages)
    _write_gzip_jsonl(raw / "events.jsonl.gz", events)
    _write_gzip_jsonl(raw / "labels.jsonl.gz", labels)
    _write_gzip_json(raw / "manifest.json.gz", manifest)
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", out)
    monkeypatch.setattr(build, "PUBLIC", public)
    stale = out / "revisions"
    stale.mkdir(parents=True)
    (stale / "stale.json").write_text("[]", encoding="utf-8")

    assert build.main() == 0

    expected_files = {
        "summary.json",
        "activity_by_day.json",
        "activity_by_hour.json",
        "pages.json",
        "labels.json",
        "labels_ip16.json",
        "recent_events.json",
        "events_head.json",
        "timeline.json",
        "agent_links.json",
        "conflicts.json",
        "search_index.json",
        "payload_index.json",
        "fts_index.json",
    }
    assert {path.name for path in out.iterdir() if path.is_file()} == expected_files
    revision_files = sorted(path.name for path in (out / "revisions").iterdir())
    assert revision_files[0] == "wiki~Page_A.json"
    assert re.fullmatch(r"wiki~Page_A_h[0-9a-f]{8}\.json", revision_files[1])
    assert not (out / "revisions" / "stale.json").exists()
    out_paths = {path.relative_to(out).as_posix() for path in out.rglob("*") if path.is_file()}
    public_paths = {path.relative_to(public).as_posix() for path in public.rglob("*") if path.is_file()}
    assert public_paths == out_paths | {"corpus/revisions.jsonl.gz"}
    for relative_path in out_paths:
        assert (out / relative_path).read_bytes() == (public / relative_path).read_bytes()
    corpus_copy = public / "corpus" / "revisions.jsonl.gz"
    assert corpus_copy.read_bytes() == (raw / "revisions.jsonl.gz").read_bytes()

    slug_map = _read_json(out / "pages.json")["p"]
    first_slug = next(page["s"] for page in slug_map if page["id"] == colliding_ids[0])
    second_slug = next(page["s"] for page in slug_map if page["id"] == colliding_ids[1])
    assert first_slug == "wiki~Page_A"
    assert second_slug == f"wiki~Page_A_h{hashlib.sha1(colliding_ids[1].encode()).hexdigest()[:8]}"
    first_revisions = _read_json(out / "revisions" / f"{first_slug}.json")
    assert [first_revisions[0]["seq"], first_revisions[1]["seq"]] == [1, 2]
    assert [row["round"] for row in first_revisions] == [["round-1"], None]

    timeline = _read_json(out / "timeline.json")
    assert timeline["meta"] == {
        "schema_version": 1,
        "export_generated_at": "2026-02-04T00:00:00Z",
        "count": 3,
        "order": "time_desc",
    }
    assert [row["t"] for row in timeline["r"]] == [
        "2026-02-03T04:05:06Z",
        "2026-02-02T03:04:05Z",
        "2026-02-01T01:02:03Z",
    ]
    assert timeline["r"][0]["id"] == colliding_ids[1]
    assert timeline["r"][0]["s"] == second_slug

    assert _read_json(out / "activity_by_day.json") == [
        {"date": "2026-02-01", "wiki": "other", "saves": 1, "deletes": 0, "reverts": 0, "probes": 0, "bytes": 0},
        {"date": "2026-02-01", "wiki": "wiki", "saves": 0, "deletes": 0, "reverts": 0, "probes": 1, "bytes": 7},
        {"date": "2026-02-02", "wiki": "wiki", "saves": 0, "deletes": 0, "reverts": 1, "probes": 0, "bytes": 5},
        {"date": "2026-02-03", "wiki": "wiki", "saves": 1, "deletes": 1, "reverts": 0, "probes": 0, "bytes": 12},
    ]
    hourly = _read_json(out / "activity_by_hour.json")
    assert hourly == [{"hour": "00", "saves": 1}, {"hour": "04", "saves": 1}]
    assert all(set(entry) == {"hour", "saves"} for entry in hourly)
    assert _read_json(out / "recent_events.json")[0] == {
        "t": "2026-02-03T14:00:00Z", "type": "delete", "wiki": "", "page": "Page_A", "action": None, "ip16": None,
    }
    assert _read_json(out / "recent_events.json")[-1]["type"] == "save"
    assert all(event["type"] != "other" for event in _read_json(out / "recent_events.json"))

    events_full = _read_json(out / "recent_events.json")
    events_head = _read_json(out / "events_head.json")
    assert events_head == events_full[: build.EVENTS_HEAD_LIMIT]
    assert len(events_head) == min(build.EVENTS_HEAD_LIMIT, len(events_full))

    page_index = _read_json(out / "pages.json")["p"]
    assert page_index[0]["labs"] == [f"label-{index}" for index in range(8)]
    label_index = _read_json(out / "labels.json")
    assert label_index["n_anon"] == 1
    assert len(label_index["l"][0]["pgs"]) == 2000
    assert label_index["l"][0]["pgs"] == [f"page-{index}" for index in range(2000)]
    # Per-label weight sums must equal the label index counts, so the viewer never
    # shows contradictory revision totals on one page.
    assert _read_json(out / "labels_ip16.json") == {
        "meta": {"schema_version": 1, "prefixes": 2},
        "prefixes": {
            "198.51": {
                "r": 2,
                "l": [["agent-a", 2]],
                "w": ["wiki"],
                "f": "2026-02-01T01:02:03Z",
                "t": "2026-02-02T03:04:05Z",
            },
            "203.0": {
                "r": 1,
                "l": [["agent-b", 1]],
                "w": ["wiki"],
                "f": "2026-02-03T04:05:06Z",
                "t": "2026-02-03T04:05:06Z",
            },
        },
    }

    summary = _read_json(out / "summary.json")
    corpus = summary.pop("corpus")
    assert summary == {
        "source": "https://collusion.wiki/explorer/download.html",
        "export_generated_at": "2026-02-04T00:00:00Z",
        "counts": {"revisions": 3, "pages": 2, "labels": 2, "events": {"save": 2, "delete": 1, "revert": 1, "probe": 1}},
        "per_wiki": {"wiki": {"pages": 2}},
        "days": 3,
        "max_day": {"date": "2026-02-03", "saves": 1},
    }
    assert sum(entry["saves"] for entry in hourly) == summary["counts"]["events"]["save"]
    assert corpus["path"] == "corpus/revisions.jsonl.gz"
    assert corpus["revisions"] == 3
    raw_corpus = (raw / "revisions.jsonl.gz").read_bytes()
    decoded_corpus = gzip.decompress(raw_corpus)
    assert corpus["sha256"] == hashlib.sha256(raw_corpus).hexdigest()
    assert corpus["compressed_bytes"] == len(raw_corpus)
    assert corpus["decoded_bytes"] == len(decoded_corpus)
    assert corpus["decoded_sha256"] == hashlib.sha256(decoded_corpus).hexdigest()


def test_label_ip16_index_counts_only_accepted_prefixes_and_labeled_revisions():
    revisions = [
        {"page_id": "wiki/A", "wiki": "wiki", "label": "agent-b", "ip16": "20.165", "write_date": "2026-05-14T13:54:53Z"},
        {"page_id": "wiki/A", "wiki": "wiki", "label": "agent-a", "ip16": "20.165", "write_date": "2026-05-10T00:00:00Z"},
        {"page_id": "wiki/B", "wiki": "wiki", "label": "agent-a", "ip16": "20.165", "time": "2026-06-01T00:00:00Z"},
        {"page_id": "wiki/B", "wiki": "wiki", "label": "agent-a", "ip16": "2.202", "write_date": "2026-06-02T00:00:00Z"},
        {"page_id": "wiki/C", "wiki": "wiki", "label": "agent-a", "ip16": "192.0.2.1", "write_date": "2026-06-03T00:00:00Z"},
        {"page_id": "wiki/C", "wiki": "wiki", "label": "agent-b", "ip16": None, "write_date": "2026-06-03T00:00:00Z"},
        {"page_id": "wiki/C", "wiki": "wiki", "label": None, "ip16": "20.94", "write_date": "2026-06-03T00:00:00Z"},
        {"page_id": "wiki/C", "wiki": "wiki", "label": "", "ip16": "20.94", "write_date": "2026-06-03T00:00:00Z"},
        {"page_id": "other/D", "wiki": "other", "label": None, "ip16": "192.0.2", "time": "2026-06-04T00:00:00Z", "partial": True},
    ]

    index = build.build_label_ip16_index(revisions)

    assert index["meta"] == {"schema_version": 1, "prefixes": 2}
    assert list(index["prefixes"]) == ["2.202", "20.165"]
    assert index["prefixes"]["20.165"] == {
        "r": 3,
        "l": [["agent-a", 2], ["agent-b", 1]],
        "w": ["wiki"],
        "f": "2026-05-10T00:00:00Z",
        "t": "2026-06-01T00:00:00Z",
    }
    assert index["prefixes"]["2.202"] == {
        "r": 1,
        "l": [["agent-a", 1]],
        "w": ["wiki"],
        "f": "2026-06-02T00:00:00Z",
        "t": "2026-06-02T00:00:00Z",
    }


def test_label_ip16_index_orders_label_weights_desc_then_name():
    revisions = [
        {"page_id": "wiki/A", "wiki": "wiki", "label": "zeta", "ip16": "10.1", "write_date": "2026-05-11T00:00:00Z"},
        {"page_id": "wiki/A", "wiki": "wiki", "label": "alpha", "ip16": "10.1", "write_date": "2026-05-11T00:00:00Z"},
        {"page_id": "wiki/A", "wiki": "wiki", "label": "alpha", "ip16": "10.1", "write_date": "2026-05-11T00:00:00Z"},
    ]

    index = build.build_label_ip16_index(revisions)

    assert index["prefixes"]["10.1"]["l"] == [["alpha", 2], ["zeta", 1]]


def test_label_ip16_index_is_empty_without_labeled_prefixes():
    index = build.build_label_ip16_index([
        {"page_id": "wiki/A", "wiki": "wiki", "label": None, "ip16": "20.94"},
        {"page_id": "wiki/A", "wiki": "wiki", "label": "agent-a", "ip16": "not-an-ip"},
    ])

    assert index == {"meta": {"schema_version": 1, "prefixes": 0}, "prefixes": {}}


def test_main_rejects_label_ip16_index_disagreeing_with_label_counts(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    out = tmp_path / "processed"
    public = tmp_path / "public" / "data"
    raw.mkdir()
    revision = {"page_id": "wiki/Page", "seq": 1, "rev_id": "r1", "wiki": "wiki",
                "write_date": "2026-05-11T00:00:00Z", "label": "agent-a", "ip16": "20.1",
                "change_summary": None, "body_len": 1, "body": "x", "request_action": None, "round_id": None}
    page = {"page_id": "wiki/Page", "wiki": "wiki", "name": "Page", "n_revs": 1,
            "first_write": revision["write_date"], "last_write": revision["write_date"],
            "deleted_live": False, "n_deletions": 0, "page_family": None, "n_labels": 1, "labels": ["agent-a"]}
    # The label index claims two stored revisions while the revision dump carries one.
    labels = [{"label": "agent-a", "stored_revisions": 2, "first_write": "2026-05-10T00:00:00Z",
               "last_write": "2026-05-11T00:00:00Z", "stored_revision_pages": ["wiki/Page"],
               "is_human_handle": False, "wikis": ["wiki"], "pages": ["wiki/Page"]}]
    for name, rows in (("revisions.jsonl.gz", [revision]), ("pages.jsonl.gz", [page]),
                       ("events.jsonl.gz", []), ("labels.jsonl.gz", labels)):
        _write_gzip_jsonl(raw / name, rows)
    _write_gzip_json(raw / "manifest.json.gz", {"generated_at": "2026-05-12T00:00:00Z", "per_wiki": {}})
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", out)
    monkeypatch.setattr(build, "PUBLIC", public)

    import pytest
    with pytest.raises(RuntimeError, match="disagree on per-label revision counts"):
        build.main()
    # Validation runs before any output write, so a failed build leaves no partial artifacts.
    assert not (out / "labels_ip16.json").exists()
    assert not (out / "revisions").exists()


def test_main_rejects_labeled_revision_without_accepted_ip16(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    out = tmp_path / "processed"
    public = tmp_path / "public" / "data"
    raw.mkdir()
    revision = {"page_id": "wiki/Page", "seq": 1, "rev_id": "r1", "wiki": "wiki",
                "write_date": "2026-05-11T00:00:00Z", "label": "agent-a", "ip16": "192.0.2.1",
                "change_summary": None, "body_len": 1, "body": "x", "request_action": None, "round_id": None}
    page = {"page_id": "wiki/Page", "wiki": "wiki", "name": "Page", "n_revs": 1,
            "first_write": revision["write_date"], "last_write": revision["write_date"],
            "deleted_live": False, "n_deletions": 0, "page_family": None, "n_labels": 1, "labels": ["agent-a"]}
    # Raw inputs agree on one revision, but its ip16 is malformed and cannot be indexed.
    labels = [{"label": "agent-a", "stored_revisions": 1, "first_write": "2026-05-11T00:00:00Z",
               "last_write": "2026-05-11T00:00:00Z", "stored_revision_pages": ["wiki/Page"],
               "is_human_handle": False, "wikis": ["wiki"], "pages": ["wiki/Page"]}]
    for name, rows in (("revisions.jsonl.gz", [revision]), ("pages.jsonl.gz", [page]),
                       ("events.jsonl.gz", []), ("labels.jsonl.gz", labels)):
        _write_gzip_jsonl(raw / name, rows)
    _write_gzip_json(raw / "manifest.json.gz", {"generated_at": "2026-05-12T00:00:00Z", "per_wiki": {}})
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", out)
    monkeypatch.setattr(build, "PUBLIC", public)

    import pytest
    with pytest.raises(RuntimeError, match="accepted ip16"):
        build.main()
    assert not (out / "revisions").exists()


def test_main_accepts_zero_revision_label_rows(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    out = tmp_path / "processed"
    public = tmp_path / "public" / "data"
    raw.mkdir()
    revision = {"page_id": "wiki/Page", "seq": 1, "rev_id": "r1", "wiki": "wiki",
                "write_date": "2026-05-11T00:00:00Z", "label": "agent-a", "ip16": "20.1",
                "change_summary": None, "body_len": 1, "body": "x", "request_action": None, "round_id": None}
    page = {"page_id": "wiki/Page", "wiki": "wiki", "name": "Page", "n_revs": 1,
            "first_write": revision["write_date"], "last_write": revision["write_date"],
            "deleted_live": False, "n_deletions": 0, "page_family": None, "n_labels": 1, "labels": ["agent-a"]}
    labels = [
        {"label": "agent-a", "stored_revisions": 1, "first_write": revision["write_date"],
         "last_write": revision["write_date"], "stored_revision_pages": ["wiki/Page"],
         "is_human_handle": False, "wikis": ["wiki"], "pages": ["wiki/Page"]},
        # A declared label without revisions agrees with the revision dump at count zero.
        {"label": "agent-zero", "stored_revisions": 0, "first_write": "", "last_write": "",
         "stored_revision_pages": [], "is_human_handle": False, "wikis": [], "pages": []},
    ]
    for name, rows in (("revisions.jsonl.gz", [revision]), ("pages.jsonl.gz", [page]),
                       ("events.jsonl.gz", []), ("labels.jsonl.gz", labels)):
        _write_gzip_jsonl(raw / name, rows)
    _write_gzip_json(raw / "manifest.json.gz", {"generated_at": "2026-05-12T00:00:00Z", "per_wiki": {}})
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", out)
    monkeypatch.setattr(build, "PUBLIC", public)

    assert build.main() == 0
    index = _read_json(out / "labels_ip16.json")
    assert index["prefixes"] == {
        "20.1": {"r": 1, "l": [["agent-a", 1]], "w": ["wiki"],
                 "f": "2026-05-11T00:00:00Z", "t": "2026-05-11T00:00:00Z"},
    }
    label_rows = {row["x"]: row["r"] for row in _read_json(out / "labels.json")["l"]}
    assert label_rows == {"agent-a": 1, "agent-zero": 0}


def test_main_rejects_duplicate_label_rows(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    out = tmp_path / "processed"
    public = tmp_path / "public" / "data"
    raw.mkdir()
    revision = {"page_id": "wiki/Page", "seq": 1, "rev_id": "r1", "wiki": "wiki",
                "write_date": "2026-05-11T00:00:00Z", "label": "agent-a", "ip16": "20.1",
                "change_summary": None, "body_len": 1, "body": "x", "request_action": None, "round_id": None}
    page = {"page_id": "wiki/Page", "wiki": "wiki", "name": "Page", "n_revs": 1,
            "first_write": revision["write_date"], "last_write": revision["write_date"],
            "deleted_live": False, "n_deletions": 0, "page_family": None, "n_labels": 1, "labels": ["agent-a"]}
    label_row = {"label": "agent-a", "stored_revisions": 1, "first_write": "2026-05-11T00:00:00Z",
                 "last_write": "2026-05-11T00:00:00Z", "stored_revision_pages": ["wiki/Page"],
                 "is_human_handle": False, "wikis": ["wiki"], "pages": ["wiki/Page"]}
    for name, rows in (("revisions.jsonl.gz", [revision]), ("pages.jsonl.gz", [page]),
                       ("events.jsonl.gz", []), ("labels.jsonl.gz", [label_row, label_row])):
        _write_gzip_jsonl(raw / name, rows)
    _write_gzip_json(raw / "manifest.json.gz", {"generated_at": "2026-05-12T00:00:00Z", "per_wiki": {}})
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", out)
    monkeypatch.setattr(build, "PUBLIC", public)

    import pytest
    with pytest.raises(RuntimeError, match="duplicate"):
        build.main()
    assert not (out / "revisions").exists()


def test_main_merges_recovered_layer_and_is_idempotent(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    out = tmp_path / "processed"
    public = tmp_path / "public" / "data"
    raw.mkdir()
    revision = {"page_id": "wiki/Canonical", "seq": 1, "rev_id": "r1", "wiki": "wiki",
                "write_date": "2026-05-11T00:00:00Z", "label": "a", "ip16": "10.0",
                "change_summary": None, "body_len": 1, "body": "x", "request_action": None, "round_id": None}
    page = {"page_id": "wiki/Canonical", "wiki": "wiki", "name": "Canonical", "n_revs": 1,
            "first_write": revision["write_date"], "last_write": revision["write_date"],
            "deleted_live": False, "n_deletions": 0, "page_family": None, "n_labels": 1, "labels": ["a"]}
    labels = [{"label": "a", "stored_revisions": 1, "first_write": revision["write_date"],
               "last_write": revision["write_date"], "stored_revision_pages": ["wiki/Canonical"],
               "is_human_handle": False, "wikis": ["wiki"], "pages": ["wiki/Canonical"]}]
    for name, rows in (("revisions.jsonl.gz", [revision]), ("pages.jsonl.gz", [page]),
                       ("events.jsonl.gz", []), ("labels.jsonl.gz", labels)):
        _write_gzip_jsonl(raw / name, rows)
    _write_gzip_json(raw / "manifest.json.gz", {"generated_at": "2026-05-12T00:00:00Z", "per_wiki": {}})
    supplement = {"pages": [{"page_id": "other/Recovered", "wiki": "other", "name": "Recovered",
                              "revisions": [{"seq": 4, "time": "2026-05-11T01:00:00Z", "ip16": "192.0.2",
                                             "added": ["added"], "removed": ["removed"]}]}]}
    _write_gzip_json(raw / "other-wikis.json.gz", supplement)
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", out)
    monkeypatch.setattr(build, "PUBLIC", public)
    assert build.main() == 0
    first = {p.relative_to(out).as_posix(): p.read_bytes() for p in out.rglob("*") if p.is_file()}
    pages = _read_json(out / "pages.json")["p"]
    assert pages[0]["id"] == "wiki/Canonical"
    assert pages[1]["id"] == "other/Recovered" and pages[1]["partial"] is True
    timeline = _read_json(out / "timeline.json")
    assert timeline["meta"]["count"] == 2 and timeline["meta"]["supplement_count"] == 1
    assert [row["t"] for row in timeline["r"]] == ["2026-05-11T01:00:00Z", "2026-05-11T00:00:00Z"]
    assert _read_json(out / "activity_by_day.json")[0]["rec"] == 1
    assert _read_json(out / "recent_events.json")[0]["partial"] is True
    assert _read_json(out / "events_head.json")[0]["partial"] is True
    recovered = _read_json(out / "revisions" / "other_Recovered~.json")[0]
    assert recovered["body"] == "" and recovered["added"] == ["added"] and recovered["removed"] == ["removed"]
    assert recovered["append"] is None
    summary = _read_json(out / "summary.json")
    assert summary["supplement"]["counts"] == {"pages": 1, "revisions": 1}
    assert summary["combined"] == {"pages": 2, "revisions": 2}
    assert build.main() == 0
    second = {p.relative_to(out).as_posix(): p.read_bytes() for p in out.rglob("*") if p.is_file()}
    assert first == second
    assert (public / "other-wikis.json.gz").read_bytes() == (raw / "other-wikis.json.gz").read_bytes()
    public_paths = {path.relative_to(public).as_posix() for path in public.rglob("*") if path.is_file()}
    assert "other-wikis.json.gz" in public_paths


def test_events_head_is_a_truncated_prefix_of_the_full_event_set(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    out = tmp_path / "processed"
    public = tmp_path / "public" / "data"
    raw.mkdir()
    for name in ("revisions.jsonl.gz", "pages.jsonl.gz", "labels.jsonl.gz"):
        _write_gzip_jsonl(raw / name, [])
    events = [
        {
            "event_type": "save",
            "time": f"2026-05-11T00:{index // 60:02d}:{index % 60:02d}Z",
            "wiki": "wiki",
            "page": f"Page{index}",
        }
        for index in range(build.EVENTS_HEAD_LIMIT + 5)
    ]
    _write_gzip_jsonl(raw / "events.jsonl.gz", events)
    _write_gzip_json(raw / "manifest.json.gz", {"generated_at": "2026-05-12T00:00:00Z", "per_wiki": {}})
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", out)
    monkeypatch.setattr(build, "PUBLIC", public)

    assert build.main() == 0

    full = _read_json(out / "recent_events.json")
    head = _read_json(out / "events_head.json")
    assert len(full) == build.EVENTS_HEAD_LIMIT + 5
    assert len(head) == build.EVENTS_HEAD_LIMIT
    assert head == full[: build.EVENTS_HEAD_LIMIT]
    assert (public / "events_head.json").read_bytes() == (out / "events_head.json").read_bytes()


def test_main_rejects_recovered_page_overlap(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    raw.mkdir()
    base = {"page_id": "wiki/Page", "wiki": "wiki", "name": "Page", "n_revs": 0,
            "first_write": "", "last_write": "", "deleted_live": False, "n_deletions": 0,
            "page_family": None, "n_labels": 0, "labels": []}
    _write_gzip_jsonl(raw / "pages.jsonl.gz", [base])
    _write_gzip_jsonl(raw / "revisions.jsonl.gz", [])
    _write_gzip_jsonl(raw / "events.jsonl.gz", [])
    _write_gzip_jsonl(raw / "labels.jsonl.gz", [])
    _write_gzip_json(raw / "manifest.json.gz", {})
    _write_gzip_json(raw / "other-wikis.json.gz", {"pages": [{"page_id": "wiki/Page", "wiki": "wiki", "name": "Page", "revisions": []}]})
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", tmp_path / "out")
    monkeypatch.setattr(build, "PUBLIC", tmp_path / "public")
    import pytest
    with pytest.raises(RuntimeError, match="reconcile"):
        build.main()


def test_main_rejects_duplicate_recovered_page_ids(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    raw.mkdir()
    _write_gzip_jsonl(raw / "pages.jsonl.gz", [])
    _write_gzip_jsonl(raw / "revisions.jsonl.gz", [])
    _write_gzip_jsonl(raw / "events.jsonl.gz", [])
    _write_gzip_jsonl(raw / "labels.jsonl.gz", [])
    _write_gzip_json(raw / "manifest.json.gz", {})
    duplicate = {"pages": [
        {"page_id": "other/Dup", "wiki": "other", "name": "Dup", "revisions": []},
        {"page_id": "other/Dup", "wiki": "other", "name": "Dup copy", "revisions": []},
    ]}
    _write_gzip_json(raw / "other-wikis.json.gz", duplicate)
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", tmp_path / "out")
    monkeypatch.setattr(build, "PUBLIC", tmp_path / "public")
    import pytest
    with pytest.raises(RuntimeError, match="duplicate page_id"):
        build.main()


def test_main_rejects_oversized_recovered_supplement(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    raw.mkdir()
    _write_gzip_jsonl(raw / "pages.jsonl.gz", [])
    _write_gzip_jsonl(raw / "revisions.jsonl.gz", [])
    _write_gzip_jsonl(raw / "events.jsonl.gz", [])
    _write_gzip_jsonl(raw / "labels.jsonl.gz", [])
    _write_gzip_json(raw / "manifest.json.gz", {})
    (raw / "other-wikis.json.gz").write_bytes(b"x" * (build._SUPPLEMENT_MAX_BYTES + 1))
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", tmp_path / "out")
    monkeypatch.setattr(build, "PUBLIC", tmp_path / "public")
    import pytest
    with pytest.raises(RuntimeError, match="exceeds"):
        build.main()


def test_main_rejects_supplement_that_expands_beyond_decoded_limit(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    raw.mkdir()
    _write_gzip_jsonl(raw / "pages.jsonl.gz", [])
    _write_gzip_jsonl(raw / "revisions.jsonl.gz", [])
    _write_gzip_jsonl(raw / "events.jsonl.gz", [])
    _write_gzip_jsonl(raw / "labels.jsonl.gz", [])
    _write_gzip_json(raw / "manifest.json.gz", {})
    monkeypatch.setattr(build, "_SUPPLEMENT_MAX_DECODED_CHARS", 256)
    _write_gzip_json(raw / "other-wikis.json.gz", {"pages": [
        {"page_id": "other/Big", "wiki": "other", "name": "x" * 1024, "revisions": []},
    ]})
    monkeypatch.setattr(build, "RAW", raw)
    monkeypatch.setattr(build, "OUT", tmp_path / "out")
    monkeypatch.setattr(build, "PUBLIC", tmp_path / "public")
    import pytest
    with pytest.raises(RuntimeError, match="decoded size"):
        build.main()
