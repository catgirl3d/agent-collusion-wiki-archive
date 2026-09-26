"""Exports per-revision payload flags as NDJSON for the web↔Python parity check.

Usage: python data/scripts/export_payload_flags.py <output.ndjson>
The web side (web/scripts/payload-parity.mjs) consumes this file.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import build


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("payload_flags.ndjson")
    revisions = list(build.read_jsonl(build.RAW / "revisions.jsonl.gz"))
    exported = 0
    with output.open("w", encoding="utf-8", newline="\n") as stream:
        for revision in revisions:
            body = revision.get("body") or ""
            if not body.strip():
                continue
            stream.write(
                json.dumps(
                    {
                        "page_id": revision.get("page_id"),
                        "seq": revision.get("seq"),
                        "flags": [flag for flag in build.PAYLOAD_FLAGS if flag in build.detect_payload_flags(body)],
                        "body": body,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            exported += 1
    print(f"exported {exported} revision bodies to {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())