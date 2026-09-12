import gzip
import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import build
from build import _body_tokens, _domains, build_conflicts, build_fts_index, build_payload_index, build_search_index, detect_payload_flags


def _page(page_id, name):
    return {"page_id": page_id, "name": name}


def _revision(page_id, seq, body):
    return {"page_id": page_id, "seq": seq, "rev_id": str(seq), "body": body}


def test_search_index_uses_page_caps_and_body_frequency_threshold():
    pages = [_page(f"w/p{i}", f"Name{i}") for i in range(5)]
    revisions = [_revision("w/p0", 1, "rarebody shared shared")]
    revisions += [_revision(f"w/p{i}", 1, "shared") for i in range(1, 5)]
    revisions += [_revision("w/p0", 2, "rarebody")]
    index = build_search_index(pages, revisions, {p["page_id"]: p["page_id"] for p in pages}, token_limit=2, slug_limit=1)
    assert index["meta"]["n_tokens"] == 2
    assert "shared" not in index["tokens"]
    assert index["tokens"]["name0"] == ["w/p0"]

    many_pages = [_page(f"w/p{i}", "Needle") for i in range(3)]
    body = []
    capped = build_search_index(many_pages, body, {p["page_id"]: p["page_id"] for p in many_pages}, slug_limit=2)
    assert capped["tokens"]["needlE".lower()] == ["w/p0", "w/p1"]


def test_search_index_filters_numeric_and_stop_words_only_from_body():
    pages = [_page("w/p0", "2026 Willkommen bypass"), _page("w/p1", "123 agent"), _page("w/p2", "ZZZRoot")]
    revisions = [_revision("w/p0", 1, "2026 the"), _revision("w/p1", 1, "und")]
    index = build_search_index(pages, revisions, {p["page_id"]: p["page_id"] for p in pages})
    assert "2026" in index["tokens"]
    assert "123" in index["tokens"]
    assert "the" not in index["tokens"]
    assert "und" not in index["tokens"]
    assert {"bypass", "agent", "willkommen", "zzz"} <= index["tokens"].keys()
    assert index["tokens"]["zzz"] == ["w/p2"]


def test_payload_detectors_cover_base64_hex_script_inject_and_case_rules():
    valid = "SGVsbG8g" * 12
    assert "b64" in detect_payload_flags(valid)
    assert "b64" not in detect_payload_flags("A" * 80)
    assert "hex" in detect_payload_flags("0x" + "a" * 64)
    assert "hex" in detect_payload_flags("0x1f")  # Short 0x literal with digits is a valid hex
    assert "hex" not in detect_payload_flags("A" * 64)
    # Bare 0x without digits (units like ~10x) is not hex; RawSlice2020x0 -> '0x0' is technically 0x literal
    assert "hex" not in detect_payload_flags("clock.wait accelerates ~10x.")
    assert "hex" not in detect_payload_flags("2026-06-10x")
    flags = detect_payload_flags('<script onerror="x">javascript:</script> SYSTEM: Ignore previous')
    assert {"script", "inject"} <= flags
    # case-insensitive: lowercase variants are also detected (mirrors utils/payload.ts)
    assert {"script", "inject"} <= set(detect_payload_flags("system: ignore previous <SCRIPT>"))


def test_payload_detectors_cover_homoglyph_entropy_and_domains():
    # Main vector: cyrillic letter inside a latin word (NFKC does NOT change it)
    assert "homoglyph" in detect_payload_flags("pаypal")  # Cyrillic а inside latin word
    assert "homoglyph" in detect_payload_flags("pаypal Ａ")  # + fullwidth A
    # Pure latin or pure cyrillic is not a homoglyph
    assert "homoglyph" not in detect_payload_flags("hello мир")
    entropy = "".join(chr(33 + ((i * 37) % 90)) for i in range(240))
    assert "high-entropy" in detect_payload_flags(entropy)
    assert "high-entropy" in detect_payload_flags(entropy + " https://markdown.new/x")
    assert build_payload_index([_page("w/entropy", "Entropy")], [_revision("w/entropy", 1, entropy)], {}) == []
    flags = detect_payload_flags("https://x.pinggy.io/a https://r.jina.ai/http://x")
    assert {"tunnel", "redirect"} <= flags


def test_payload_structure_aggregates_revisions_and_sorts_domains_and_slugs():
    pages = [_page("w/b", "B"), _page("w/a", "A")]
    revisions = [
        _revision("w/b", 1, "https://www.example.com/old https://old.test"),
        _revision("w/b", 2, "Ignore previous https://example.com/new"),
        _revision("w/a", 1, "https://z.test https://a.test https://a.test https://markdown.new/x"),
    ]
    index = build_payload_index(pages, revisions, {"w/b": "b", "w/a": "a"})
    assert [entry["s"] for entry in index] == ["a", "b"]
    assert index[0] == {"s": "a", "id": "w/a", "u": ["a.test", "markdown.new", "z.test"], "f": ["redirect"]}
    entry = index[1]
    assert entry == {"s": "b", "id": "w/b", "u": ["example.com", "old.test"], "f": ["inject"]}


def test_payload_index_keeps_all_domains_and_ranks_by_occurrence():
    pages = [_page("w/p", "P")]
    domains = " ".join(f"https://host{index}.test" for index in range(11))
    revisions = [_revision("w/p", 1, domains + " Ignore previous"), _revision("w/p", 2, "https://host10.test")]
    entry = build_payload_index(pages, revisions, {})[0]
    assert len(entry["u"]) == 11
    assert entry["u"][0] == "host10.test"


def test_domains_match_shared_url_golden_fixture():
    golden = json.loads((Path(__file__).resolve().parents[1] / "validation" / "url_golden.json").read_text(encoding="utf-8"))
    for entry in golden["urls"]:
        assert _domains(entry["input"]) == entry["domains"], entry["input"]


def test_fts_is_body_only_with_integer_sorted_unique_postings_and_no_frequency_filter():
    pages = [_page("w/name-only", "Needle"), _page("w/body", "Other"), _page("w/all", "Third")]
    revisions = [_revision("w/body", 1, "needle needle"), _revision("w/all", 1, "needle"),
                 _revision("w/body", 2, "needle"), _revision("w/all", 2, "needle")]
    index = build_fts_index(pages, revisions)
    assert set(index["meta"]) == {
        "pages", "n_tokens", "postings_cap", "truncated_tokens", "truncated_totals", "tokenizer", "built_from",
    }
    assert index["meta"]["pages"] == "pages.json"
    assert index["meta"]["tokenizer"] == "build.py::_body_tokens"
    assert index["tokens"]["needle"] == [1, 2]
    assert "name-only" not in index["tokens"]
    assert all(isinstance(value, int) for values in index["tokens"].values() for value in values)
    assert all(values == sorted(set(values)) for values in index["tokens"].values())
    assert all(0 <= value < len(pages) for values in index["tokens"].values() for value in values)


def test_fts_keeps_full_postings_for_common_tokens():
    pages = [_page(f"w/p{index}", "Page") for index in range(600)]
    revisions = [_revision(page["page_id"], 1, "common") for page in pages]
    index = build_fts_index(pages, revisions)
    assert index["meta"]["postings_cap"] is None
    assert index["meta"]["truncated_tokens"] == 0
    assert index["meta"]["truncated_totals"] == {}
    assert index["tokens"]["common"] == list(range(600))


def test_fts_preserves_tokens_present_on_every_page():
    pages = [_page(f"w/p{index}", "Page") for index in range(3)]
    revisions = [_revision(page["page_id"], 1, "everywhere") for page in pages]
    assert "everywhere" in build_fts_index(pages, revisions)["tokens"]


def test_fts_includes_tokens_from_older_revisions():
    pages = [_page("w/p0", "Page")]
    revisions = [_revision("w/p0", 1, "oldertoken"), _revision("w/p0", 2, "newertoken")]
    assert {"oldertoken", "newertoken"} <= build_fts_index(pages, revisions)["tokens"].keys()


def test_fts_budget_guard_fails_closed_when_uncapped_index_is_too_large(monkeypatch):
    monkeypatch.setattr(build, "FTS_BUDGET_BYTES", 1)
    with pytest.raises(RuntimeError, match="without a postings cap"):
        build_fts_index([_page("w/p0", "Page")], [_revision("w/p0", 1, "token")])


def test_timeline_is_time_desc_with_deterministic_tie_breakers():
    revisions = [
        {"page_id": "w/b", "seq": 2, "rev_id": "b2", "wiki": "w", "write_date": "2026-01-02T00:00:00Z", "label": "x", "request_action": "edit", "ip16": None, "body_len": 2},
        {"page_id": "w/a", "seq": 1, "rev_id": "a1", "wiki": "w", "write_date": "2026-01-02T00:00:00Z", "label": None, "request_action": None, "ip16": "10.0", "body_len": 1},
        {"page_id": "w/a", "seq": 3, "rev_id": "a3", "wiki": "w", "write_date": "2026-01-03T00:00:00Z", "label": "y", "request_action": "create", "ip16": None, "body_len": 3},
        {"page_id": "w/c", "seq": None, "rev_id": "c0", "wiki": "w", "time": "2026-01-01T00:00:00Z", "label": "z", "body_len": 0},
    ]
    timeline = build.build_timeline(revisions, {"w/a": "a~", "w/b": "b~", "w/c": "c~"}, "2026-01-04T00:00:00Z")
    assert timeline["meta"] == {
        "schema_version": 1,
        "export_generated_at": "2026-01-04T00:00:00Z",
        "count": 4,
        "order": "time_desc",
    }
    assert [row["t"] for row in timeline["r"]] == [
        "2026-01-03T00:00:00Z",
        "2026-01-02T00:00:00Z",
        "2026-01-02T00:00:00Z",
        "2026-01-01T00:00:00Z",
    ]
    assert [row["id"] for row in timeline["r"][1:3]] == ["w/a", "w/b"]
    assert timeline["r"][0] == {
        "t": "2026-01-03T00:00:00Z", "w": "w", "id": "w/a", "s": "a~", "seq": 3,
        "x": "y", "a": "create", "ip": None, "l": 3,
    }
    assert timeline["r"][3]["seq"] is None


def test_corpus_metadata_hashes_compressed_and_decoded_bytes(tmp_path):
    payload = b'{"page_id": "w/p"}\n{"page_id": "w/q"}\n'
    path = tmp_path / "revisions.jsonl.gz"
    with gzip.open(path, "wb") as stream:
        stream.write(payload)
    meta = build.build_corpus_metadata(path, 2)
    assert meta["path"] == "corpus/revisions.jsonl.gz"
    assert meta["revisions"] == 2
    assert meta["compressed_bytes"] == path.stat().st_size
    assert meta["decoded_bytes"] == len(payload)
    assert meta["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert meta["decoded_sha256"] == hashlib.sha256(payload).hexdigest()


def test_conflicts_are_not_truncated_to_old_top_500():
    pages = [_page(f"w/p{index}", f"Page{index}") for index in range(501)]
    revisions = [_revision(page["page_id"], 1, "body") for page in pages]
    conflicts = build_conflicts(pages, revisions, {})
    assert len(conflicts) == 501
    assert conflicts[-1]["id"] == "w/p500"


def test_token_golden_fixture_matches_tokenizer_and_regeneration(tmp_path):
    fixture = Path(__file__).resolve().parents[1] / "validation" / "token_golden.json"
    golden = json.loads(fixture.read_text(encoding="utf-8"))
    assert golden["_meta"]["source"] == "build.py::_body_tokens"
    for case in golden["cases"]:
        assert case["tokens"] == sorted(_body_tokens(case["text"]))
    output = tmp_path / "token_golden.json"
    build.write_token_golden(output)
    assert output.read_bytes() == fixture.read_bytes()
