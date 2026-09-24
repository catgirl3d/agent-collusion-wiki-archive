import gzip
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from catalog_ip16 import (
    _csv_cell,
    build_catalog,
    build_label_networks,
    main,
    verify_catalog,
    verify_networks,
    write_network_outputs,
    write_outputs,
)


def _revision(prefix, wiki="dse", label="AgentA", page="dse/Page", time="2026-06-01T10:00:00Z"):
    return {"ip16": prefix, "wiki": wiki, "label": label, "page_id": page, "time": time}


def _event(prefix, etype, wiki="dse", page="Page", time="2026-06-02T10:00:00Z"):
    return {"ip16": prefix, "event_type": etype, "wiki": wiki, "page": page, "time": time}


def test_build_catalog_aggregates_revisions_events_and_ignores_invalid_prefixes():
    revisions = [
        _revision("20.12", label="AgentA", page="dse/P1", time="2026-06-01T10:00:00Z"),
        _revision("20.12", label="AgentB", page="dse/P2", time="2026-06-03T10:00:00Z"),
        _revision("4.255", wiki="probier", label="AgentA", page="probier/P1", time="2026-06-02T10:00:00Z"),
        {"ip16": None, "wiki": "dse", "label": "AgentA", "page_id": "dse/P3"},
        {"ip16": "not-an-ip", "wiki": "dse", "label": "AgentA", "page_id": "dse/P4"},
    ]
    events = [
        _event("20.12", "save", time="2026-06-02T10:00:00Z"),
        _event("20.12", "delete", time="2026-06-04T10:00:00Z"),
        _event("2.202", "delete", page="P9", time="2026-06-05T10:00:00Z"),
    ]

    result = build_catalog(revisions, events)

    assert result["distinct"] == 3
    assert result["totals"] == {"rows": 6, "revisions": 3, "events": 3}

    by_prefix = {row["prefix"]: row for row in result["catalog"]}
    assert by_prefix["20.12"]["rows"] == 4
    assert by_prefix["20.12"]["revisions"] == 2
    assert by_prefix["20.12"]["events"] == 2
    assert by_prefix["20.12"]["save"] == 1
    assert by_prefix["20.12"]["delete"] == 1
    assert by_prefix["20.12"]["labels"] == 2
    assert by_prefix["20.12"]["pages"] == 2
    assert by_prefix["20.12"]["event_pages"] == 1
    assert by_prefix["20.12"]["wikis"] == ["dse"]
    assert by_prefix["20.12"]["first_utc"] == "2026-06-01T10:00:00Z"
    assert by_prefix["20.12"]["last_utc"] == "2026-06-04T10:00:00Z"

    assert by_prefix["4.255"]["revisions"] == 1
    assert by_prefix["4.255"]["events"] == 0
    assert by_prefix["2.202"]["revisions"] == 0
    assert by_prefix["2.202"]["delete"] == 1

    groups = {group["octet8"]: group for group in result["groups"]}
    assert groups["20"]["prefixes"] == 1
    assert groups["20"]["rows"] == 4
    assert groups["2"]["rows"] == 1


def test_build_catalog_accepts_legacy_event_keys():
    events = [{"ip16": "20.12", "type": "delete", "t": "2026-06-01T00:00:00Z", "wiki": "dse", "page": "P"}]

    result = build_catalog([], events)

    row = result["catalog"][0]
    assert row["events"] == 1
    assert row["delete"] == 1
    assert row["last_utc"] == "2026-06-01T00:00:00Z"


def test_build_catalog_prefers_primary_time_fields_when_fallbacks_are_present():
    revisions = [{
        "ip16": "20.12",
        "wiki": "dse",
        "label": "AgentA",
        "page_id": "dse/Page",
        "time": "2026-06-03T10:00:00Z",
        "write_date": "2026-06-01T10:00:00Z",
    }]
    events = [{
        "ip16": "20.12",
        "event_type": "delete",
        "wiki": "dse",
        "page": "Page",
        "t": "2026-06-04T10:00:00Z",
        "time": "2026-06-02T10:00:00Z",
    }]

    row = build_catalog(revisions, events)["catalog"][0]

    assert row["first_utc"] == "2026-06-03T10:00:00Z"
    assert row["last_utc"] == "2026-06-04T10:00:00Z"


def test_write_outputs_preview_mode_when_distinct_exceeds_threshold(tmp_path):
    revisions = [_revision(f"20.{n}") for n in range(5)]
    result = build_catalog(revisions, [])

    written = write_outputs(result, tmp_path, max_distinct=3, top=2, sources=["revisions.jsonl.gz"])

    assert written["mode"] == "preview"
    assert written["csv"] is None
    assert not (tmp_path / "ip16_catalog.csv").exists()
    payload = json.loads((tmp_path / "ip16_groups.json").read_text(encoding="utf-8"))
    assert payload["meta"]["mode"] == "preview"
    assert payload["meta"]["distinct_prefixes"] == 5
    assert len(payload["catalog_preview"]) == 2


def test_write_outputs_full_mode_writes_csv_with_every_prefix(tmp_path):
    revisions = [_revision("20.12"), _revision("4.255", wiki="probier")]
    result = build_catalog(revisions, [])

    written = write_outputs(result, tmp_path, max_distinct=400, top=1, sources=["revisions.jsonl.gz"])

    assert written["mode"] == "full"
    csv_text = (tmp_path / "ip16_catalog.csv").read_text(encoding="utf-8").splitlines()
    assert csv_text[0].startswith("prefix,octet8,rows")
    assert len(csv_text) == 3
    payload = json.loads((tmp_path / "ip16_groups.json").read_text(encoding="utf-8"))
    assert len(payload["catalog_preview"]) == 1


def test_main_writes_only_the_five_analytical_artifacts(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    fixtures = {
        "revisions.jsonl.gz": [
            _revision("20.12", label="Shared"),
            _revision("4.255", label="Shared"),
        ],
        "events.jsonl.gz": [_event("20.12", "delete")],
    }
    for name, rows in fixtures.items():
        with gzip.open(raw / name, "wt", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row) + "\n")

    out = tmp_path / "out"
    assert main(["--raw-dir", str(raw), "--out-dir", str(out)]) == 0

    assert {path.name for path in out.iterdir()} == {
        "ip16_groups.json",
        "ip16_catalog.csv",
        "ip16_label_networks.json",
        "ip16_label_edges.csv",
        "ip16_label_pairs.csv",
    }


def test_build_label_networks_tracks_multi_network_labels_and_shared_pairs():
    revisions = [
        _revision("20.12", label="Shared"),
        _revision("20.12", label="Shared"),
        _revision("20.12", label="LocalA"),
        _revision("4.255", label="Shared"),
        _revision("4.255", label="LocalB"),
        _revision("57.154", label="LocalC"),
        _revision("57.154", label="LocalC"),
        {"ip16": "20.12", "wiki": "dse", "label": None, "page_id": "dse/P5"},
    ]

    result = build_label_networks(revisions)

    assert result["totals"] == {
        "edges": 5, "labels": 4, "multi_labels": 1, "prefixes": 3, "pairs_with_shared_labels": 1,
    }
    assert result["distribution"] == {1: 3, 2: 1}

    multi = {row["label"]: row for row in result["labels"] if row["prefixes"] > 1}
    assert list(multi) == ["Shared"]
    assert multi["Shared"]["rows"] == 3
    assert multi["Shared"]["top_prefixes"][0] == {"prefix": "20.12", "rows": 2}

    hubs = {row["prefix"]: row for row in result["hubs"]}
    assert hubs["20.12"]["labels"] == 2
    assert hubs["20.12"]["rows"] == 3
    assert hubs["57.154"]["labels"] == 1

    assert result["pairs"] == [("20.12", "4.255", 1)]


def test_write_network_outputs_preview_mode_skips_csv_when_edges_exceed_threshold(tmp_path):
    revisions = [_revision("20.12", label="Shared"), _revision("4.255", label="Shared")]
    result = build_label_networks(revisions)

    written = write_network_outputs(result, tmp_path, max_edges=1, sources=["revisions.jsonl.gz"])

    assert written["mode"] == "preview"
    assert written["edges"] is None
    assert written["pairs"] is None
    assert not (tmp_path / "ip16_label_edges.csv").exists()
    payload = json.loads((tmp_path / "ip16_label_networks.json").read_text(encoding="utf-8"))
    assert payload["meta"]["mode"] == "preview"
    assert payload["totals"]["edges"] == 2
    assert payload["top_shared_pairs"] == [{"prefix_a": "20.12", "prefix_b": "4.255", "shared_labels": 1}]


def test_write_network_outputs_full_mode_writes_edges_and_pairs(tmp_path):
    revisions = [
        _revision("20.12", label="Shared"),
        _revision("20.12", label="LocalA"),
        _revision("4.255", label="Shared"),
    ]
    result = build_label_networks(revisions)

    written = write_network_outputs(result, tmp_path, max_edges=30000, sources=["revisions.jsonl.gz"])

    assert written["mode"] == "full"
    edge_lines = (tmp_path / "ip16_label_edges.csv").read_text(encoding="utf-8").splitlines()
    assert edge_lines[0] == "prefix,label,rows"
    assert len(edge_lines) == 4
    pair_lines = (tmp_path / "ip16_label_pairs.csv").read_text(encoding="utf-8").splitlines()
    assert pair_lines[1] == "20.12,4.255,1"


def test_processed_json_outputs_are_byte_stable_for_identical_inputs(tmp_path):
    revisions = [_revision("20.12", label="Shared"), _revision("4.255", label="Shared")]
    catalog = build_catalog(revisions, [])
    networks = build_label_networks(revisions)

    write_outputs(catalog, tmp_path, max_distinct=400, top=1, sources=["revisions.jsonl.gz"])
    write_network_outputs(networks, tmp_path, max_edges=30000, sources=["revisions.jsonl.gz"])
    first = {
        name: (tmp_path / name).read_bytes()
        for name in ["ip16_groups.json", "ip16_label_networks.json"]
    }
    assert "generated_at" not in json.loads(first["ip16_groups.json"])["meta"]
    assert "generated_at" not in json.loads(first["ip16_label_networks.json"])["meta"]

    write_outputs(catalog, tmp_path, max_distinct=400, top=1, sources=["revisions.jsonl.gz"])
    write_network_outputs(networks, tmp_path, max_edges=30000, sources=["revisions.jsonl.gz"])

    assert first == {
        name: (tmp_path / name).read_bytes()
        for name in ["ip16_groups.json", "ip16_label_networks.json"]
    }


def test_multi_network_preview_breaks_prefix_ties_by_rows_before_label(tmp_path):
    revisions = [
        _revision("20.12", label="Alpha"),
        _revision("4.255", label="Alpha"),
        _revision("20.12", label="Zulu"),
        _revision("20.12", label="Zulu"),
        _revision("4.255", label="Zulu"),
    ]
    result = build_label_networks(revisions)

    write_network_outputs(result, tmp_path, max_edges=30000, sources=["revisions.jsonl.gz"])

    payload = json.loads((tmp_path / "ip16_label_networks.json").read_text(encoding="utf-8"))
    assert [row["label"] for row in payload["top_multi_network_labels"][:2]] == ["Zulu", "Alpha"]


def test_verify_functions_accept_consistent_results_and_reject_corruption():
    revisions = [_revision("20.12", label="Shared"), _revision("4.255", label="Shared")]
    events = [_event("2.202", "delete")]
    catalog = build_catalog(revisions, events)
    networks = build_label_networks(revisions)
    verify_catalog(catalog)
    verify_networks(networks)

    catalog["catalog"][0]["rows"] += 1
    with pytest.raises(AssertionError, match="rows != revisions \\+ events"):
        verify_catalog(catalog)

    networks["pairs"] = [("20.12", "20.12", 1)]
    with pytest.raises(AssertionError, match="self-pair"):
        verify_networks(networks)

    networks = build_label_networks(revisions)
    networks["pairs"] = []
    with pytest.raises(AssertionError, match="pair projection is incomplete"):
        verify_networks(networks)


def test_preview_thresholds_are_inclusive_and_modes_are_independent(tmp_path):
    revisions = [_revision("20.12", label="Shared"), _revision("4.255", label="Shared")]
    catalog = build_catalog(revisions, [])
    networks = build_label_networks(revisions)

    assert write_outputs(catalog, tmp_path, max_distinct=2, top=1, sources=[])["mode"] == "full"
    assert write_outputs(catalog, tmp_path, max_distinct=1, top=1, sources=[])["mode"] == "preview"
    assert write_network_outputs(networks, tmp_path, max_edges=2, sources=[])["mode"] == "full"
    assert write_network_outputs(networks, tmp_path, max_edges=1, sources=[])["mode"] == "preview"

    mixed_catalog = write_outputs(catalog, tmp_path, max_distinct=2, top=1, sources=[])
    mixed_networks = write_network_outputs(networks, tmp_path, max_edges=1, sources=[])
    assert (mixed_catalog["mode"], mixed_networks["mode"]) == ("full", "preview")


def test_preview_run_keeps_stale_csv_and_warns(tmp_path, capsys):
    revisions = [_revision("20.12", label="Shared"), _revision("4.255", label="Shared")]
    catalog = build_catalog(revisions, [])
    networks = build_label_networks(revisions)

    full = write_outputs(catalog, tmp_path, max_distinct=400, top=1, sources=[])
    full_networks = write_network_outputs(networks, tmp_path, max_edges=30000, sources=[])
    assert full["csv"] and full_networks["edges"]
    capsys.readouterr()

    preview = write_outputs(catalog, tmp_path, max_distinct=1, top=1, sources=[])
    preview_networks = write_network_outputs(networks, tmp_path, max_edges=1, sources=[])
    warning = capsys.readouterr().out
    assert preview["mode"] == "preview" and preview_networks["mode"] == "preview"
    assert "stale" in warning
    assert (tmp_path / "ip16_catalog.csv").exists()


def test_csv_cells_neutralize_formula_leading_labels(tmp_path):
    assert _csv_cell("=cmd|'/c calc'!A0") == "'=cmd|'/c calc'!A0"
    assert _csv_cell("+1+1") == "'+1+1"
    assert _csv_cell("-2+3") == "'-2+3"
    assert _csv_cell("@malicious") == "'@malicious"
    assert _csv_cell("AgentA") == "AgentA"
    assert _csv_cell("") == ""

    revisions = [
        _revision("20.12", label="=evil"),
        _revision("20.12", label="AgentA"),
    ]
    networks = build_label_networks(revisions)
    write_network_outputs(networks, tmp_path, max_edges=30000, sources=["revisions.jsonl.gz"])
    edge_lines = (tmp_path / "ip16_label_edges.csv").read_text(encoding="utf-8").splitlines()
    assert "'=evil" in edge_lines[1] or "'=evil" in edge_lines[2]

    catalog = build_catalog(revisions, [])
    write_outputs(catalog, tmp_path, max_distinct=400, top=5, sources=["revisions.jsonl.gz"])
    catalog_text = (tmp_path / "ip16_catalog.csv").read_text(encoding="utf-8")
    assert "'=evil" in catalog_text
