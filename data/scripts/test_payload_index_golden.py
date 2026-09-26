import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import build


def _load_committed_index() -> list[dict]:
    return json.loads((build.ROOT / "processed" / "payload_index.json").read_text(encoding="utf-8"))


def _diff_message(rebuilt: list[dict], committed: list[dict]) -> str:
    if len(rebuilt) != len(committed):
        return f"payload index length changed: rebuilt {len(rebuilt)} vs committed {len(committed)}"
    for left, right in zip(rebuilt, committed):
        if left != right:
            return (
                "first payload index difference at "
                f"{left.get('id')}: rebuilt flags={left.get('f')} committed flags={right.get('f')}"
            )
    return "payload index differs but no differing entry was found"


def test_payload_index_matches_committed_artifact():
    """Pins every page-level payload verdict: recomputing from data/raw must reproduce
    data/processed/payload_index.json. Any rule change fails here until the artifact is
    rebuilt in the same change."""
    revisions = list(build.read_jsonl(build.RAW / "revisions.jsonl.gz"))
    pages = list(build.read_jsonl(build.RAW / "pages.jsonl.gz"))
    _, supplement_revisions = build.read_supplement(build.RAW / "other-wikis.json.gz")

    slug_map = build.build_slug_map(revisions + supplement_revisions)
    rebuilt = build.build_payload_index(pages, revisions, slug_map)

    committed = _load_committed_index()
    assert rebuilt == committed, _diff_message(rebuilt, committed)