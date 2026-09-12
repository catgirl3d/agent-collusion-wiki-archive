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
            "ip16": "2001:db8::/64",
            "change_summary": "second",
            "body_len": 12,
            "body": "second body",
            "request_action": "edit",
            "round_id": "round-2",
        },
        {
            "page_id": colliding_ids[0],
            "seq": 2,
            "rev_id": "r1b",
            "wiki": "wiki",
            "write_date": "2026-02-02T03:04:05Z",
            "label": "agent-a",
            "ip16": None,
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
            "ip16": "192.0.2.1",
            "change_summary": "first",
            "body_len": 7,
            "body": "first",
            "request_action": "create",
            "round_id": "round-1",
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
        "recent_events.json",
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
    assert public_paths == out_paths
    for relative_path in out_paths:
        assert (out / relative_path).read_bytes() == (public / relative_path).read_bytes()

    slug_map = _read_json(out / "pages.json")["p"]
    first_slug = next(page["s"] for page in slug_map if page["id"] == colliding_ids[0])
    second_slug = next(page["s"] for page in slug_map if page["id"] == colliding_ids[1])
    assert first_slug == "wiki~Page_A"
    assert second_slug == f"wiki~Page_A_h{hashlib.sha1(colliding_ids[1].encode()).hexdigest()[:8]}"
    assert [_read_json(out / "revisions" / f"{first_slug}.json")[0]["seq"], _read_json(out / "revisions" / f"{first_slug}.json")[1]["seq"]] == [1, 2]

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

    page_index = _read_json(out / "pages.json")["p"]
    assert page_index[0]["labs"] == [f"label-{index}" for index in range(8)]
    label_index = _read_json(out / "labels.json")
    assert label_index["n_anon"] == 1
    assert len(label_index["l"][0]["pgs"]) == 2000
    assert label_index["l"][0]["pgs"] == [f"page-{index}" for index in range(2000)]

    summary = _read_json(out / "summary.json")
    assert summary == {
        "source": "https://collusion.wiki/explorer/download.html",
        "export_generated_at": "2026-02-04T00:00:00Z",
        "counts": {"revisions": 3, "pages": 2, "labels": 2, "events": {"save": 2, "delete": 1, "revert": 1, "probe": 1}},
        "per_wiki": {"wiki": {"pages": 2}},
        "days": 3,
        "max_day": {"date": "2026-02-03", "saves": 1},
    }
    assert sum(entry["saves"] for entry in hourly) == summary["counts"]["events"]["save"]
