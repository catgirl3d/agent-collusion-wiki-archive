import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from build import build_agent_links, build_conflicts


def test_agent_links_filters_and_caps_with_deterministic_ties():
    labels = [{"label": "A", "pages": [f"p{i}" for i in range(25)]}]
    labels += [
        {"label": "z", "pages": ["p0", "p1"]},
        {"label": "b", "pages": ["p2", "p3"]},
        {"label": "c", "pages": ["p4", "p5"]},
        {"label": "one-page", "pages": ["p0"]},
        {"label": "", "pages": ["p0", "p1", "p2"]},
    ]
    for index in range(22):
        labels.append({"label": f"agent-{index:02d}", "pages": ["p0", "p1"]})

    links = build_agent_links(labels)
    assert len(links["A"]) == 20
    assert {item["o"] for item in links["A"]}.isdisjoint({"one-page", ""})
    tied = [item["o"] for item in links["A"] if item["c"] == 2]
    assert tied == sorted(tied)


def test_conflicts_ttd_median_null_and_front_fallback():
    pages = [
        {"page_id": "wiki/start", "name": "StartSeite", "n_deletions": 2},
        {"page_id": "wiki/plain", "name": "plain", "n_deletions": 0},
    ]
    revisions = [
        {"page_id": "wiki/start", "seq": 1, "rev_id": "1", "label": "a", "write_date": "2026-01-01T00:00:00Z"},
        {"page_id": "wiki/start", "seq": 2, "rev_id": "2", "label": "a", "write_date": "2026-01-01T00:00:01Z"},
        {"page_id": "wiki/start", "seq": 3, "rev_id": "3", "label": "b", "write_date": "2026-01-01T00:00:11Z"},
        {"page_id": "wiki/start", "seq": 4, "rev_id": "4", "label": "c", "write_date": "2026-01-01T00:00:31Z"},
        {"page_id": "wiki/plain", "seq": 1, "rev_id": "5", "label": "a", "write_date": "2026-01-01T00:00:00Z"},
        {"page_id": "wiki/plain", "seq": 2, "rev_id": "6", "label": "a", "write_date": "2026-01-01T00:00:10Z"},
    ]
    conflicts = build_conflicts(pages, revisions, {"wiki/start": "start", "wiki/plain": "plain"})
    start, plain = conflicts
    assert start["churn"] == 3
    assert start["ttd_med_s"] == 15
    assert start["zzz"] is False
    assert start["front"] is True
    assert plain["ttd_med_s"] is None
    assert plain["front"] is False


def test_conflicts_uses_explicit_front_ids_and_sorts_caps():
    pages = [{"page_id": f"p{i}", "name": f"ZZZ-{i}", "n_deletions": i} for i in range(501)]
    revisions = [
        {"page_id": "p0", "seq": 1, "rev_id": "1", "label": "a"},
        {"page_id": "p0", "seq": 2, "rev_id": "2", "label": "b"},
    ]
    conflicts = build_conflicts(pages, revisions, {}, front_page_ids={"p0"})
    assert len(conflicts) == 500
    assert conflicts[0]["id"] == "p0"
    assert conflicts[0]["front"] is True
    assert all(item["zzz"] for item in conflicts)
    assert conflicts[-1]["del"] == 2
