import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import build


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "data" / "validation" / "payload_flags_golden.json"


def test_payload_flags_golden_matches_python_detector():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for entry in fixture["bodies"]:
        flags = [flag for flag in build.PAYLOAD_FLAGS if flag in build.detect_payload_flags(entry["input"])]
        assert flags == entry["flags"], entry["name"]
