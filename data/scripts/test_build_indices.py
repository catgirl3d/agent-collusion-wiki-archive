import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from build import build_payload_index, build_search_index, detect_payload_flags


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
    assert entry == {"s": "b", "id": "w/b", "u": ["example.com"], "f": ["inject"]}
