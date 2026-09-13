from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import html
import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from types import MappingProxyType


ID_PATTERN = re.compile(r"^[0-9a-f]{8}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
LEGACY_SOURCE_COMMIT = "e694240"
LEGACY_SOURCE_COMMIT_OID = "e694240b04821ed6b83a82baa0183b26269318e7"
PINNED_RUN_ID = "provisional-20260912T230949Z-004252d8"
IMPORT_LOCK_FIELDS = {
    "canonical_capture_v2",
    "checksums_sha256",
    "exchanges_jsonl_sha256",
    "historical_source_oid",
    "network_recapture",
    "private_id_serialization",
    "private_listing_sha256",
    "private_universe_id_sha256",
    "public_selection_sha256",
    "run_id",
    "run_json_sha256",
    "schema_version",
    "source_format",
}
TRUSTED_IMPORT_LOCK = {
    "canonical_capture_v2": False,
    "checksums_sha256": "7e0bda393531383a0d7576391e6380fbbfc43be2ee4897707b664c4df9c5b698",
    "exchanges_jsonl_sha256": "d6d9abebf420febe3677ecb2b16bf9f0f094234ec56dd08378b46df8681b35bb",
    "historical_source_oid": LEGACY_SOURCE_COMMIT_OID,
    "network_recapture": False,
    "private_id_serialization": "sorted-lowercase-utf8-one-per-line-final-lf",
    "private_listing_sha256": "3d978016cb0ff6e25e3266d03f89af61733aefaebfc0bef99c25bfb10e6d9121",
    "private_universe_id_sha256": "96ea0ce2b479d0c672b33274d49cc6b3ddb1cda39a4ebd41ac040ad4a93c5f98",
    "public_selection_sha256": "838543d5e2b4b1cae66988f493436f890fa2b264d4a00ee20ce3f5e857586265",
    "run_id": PINNED_RUN_ID,
    "run_json_sha256": "9cade0bcf43cd90e6f59632de08fa715cb3bbe57a3f3f40ec993d91b67ef33b3",
    "schema_version": 1,
    "source_format": "provisional-v1-import",
}
PINNED_PRIVATE_UNIVERSE_COUNT = 146
EXPECTED_LIST_OFFSETS = (0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150)
EXPECTED_ROLE_COUNTS = {"list": 11, "raw": 146, "view": 146}
EXPECTED_TOTAL_EXCHANGES = 303
EXPECTED_PUBLIC_SELECTION_COUNT = 88
RUN_FIELDS = {"run_id", "source", "status", "started_at", "ended_at", "discovered_listing_ids", "exchange_count", "failures", "successes", "semantics", "stable_inventory_seed", "target_records"}
EXCHANGE_FIELDS = {"attempt", "body_bytes", "body_path", "body_sha256", "duration_ms", "ended_at", "error", "exchange_id", "final_url", "list_offset", "method", "paste_id", "request_headers", "response_headers", "role", "started_at", "status", "url"}
ISO_TIMESTAMP = re.compile(r"^2026-09-12T23:\d{2}:\d{2}\.\d{3}Z$")
WHEN_PATTERN = re.compile(r"^(\d+) (Minute|Hour|Day|Week|Month|Year)s? ago\.$")
LIST_ROW_PATTERN = re.compile(
    r'<td class="first"><a href="https://anna\.fyi/view/([0-9a-f]{8})">(.*?)</a></td>\s*'
    r"<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>",
    re.DOTALL,
)
TITLE_PATTERN = re.compile(r'<h1 class="pagetitle right">(.*?)</h1>', re.DOTALL)
META_PATTERN = re.compile(r'<span class="detail by">(.*?)</span>', re.DOTALL)
PARENT_PATTERN = re.compile(
    r'This paste is a reply to <a href="https://anna\.fyi/view/([0-9a-f]{8})">(.*?)</a> from',
    re.DOTALL,
)
PHP_BANNER_START = b'\n<div style="border:1px solid #990000;padding-left:20px;margin:0 0 10px 0;">'
PHP_BANNER_MARKERS = (
    b"<h4>A PHP Error was encountered</h4>",
    b"<p>Severity: 8192</p>",
    b"<p>Message:  Function create_function() is deprecated</p>",
    b"<p>Filename: geshi/geshi.php</p>",
    b"<p>Line Number: 4698</p>",
)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json_line(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return value


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError(f"{path.name} must contain JSON objects")
    return rows


def load_import_lock(path: Path) -> dict[str, Any]:
    lock = _read_json(path)
    if set(lock) != IMPORT_LOCK_FIELDS:
        raise ValueError("invalid import lock fields")
    if lock != TRUSTED_IMPORT_LOCK:
        raise ValueError("import lock constant mismatch")
    return lock


def _private_universe_digest(path: Path) -> str:
    ids: list[str] = []
    for row in _read_jsonl(path):
        paste_id = row.get("hash")
        if not isinstance(paste_id, str) or not ID_PATTERN.fullmatch(paste_id):
            raise ValueError("invalid private listing paste ID")
        ids.append(paste_id.lower())
    if len(ids) != PINNED_PRIVATE_UNIVERSE_COUNT:
        raise ValueError("private listing must contain exactly 146 rows")
    if len(set(ids)) != PINNED_PRIVATE_UNIVERSE_COUNT:
        raise ValueError("private listing contains duplicate IDs")
    serialized = "".join(f"{paste_id}\n" for paste_id in sorted(ids)).encode("utf-8")
    return _sha256(serialized)


def _validate_import_inputs(run_dir: Path, private_listing_path: Path, import_lock_path: Path) -> dict[str, Any]:
    lock = load_import_lock(import_lock_path)
    paths = {
        "run_json_sha256": run_dir / "run.json",
        "exchanges_jsonl_sha256": run_dir / "exchanges.jsonl",
        "checksums_sha256": run_dir / "checksums.sha256",
        "private_listing_sha256": private_listing_path,
    }
    mismatches: list[tuple[str, Path]] = []
    for field, path in paths.items():
        if _sha256(path.read_bytes()) != lock[field]:
            mismatches.append((field, path))
    if mismatches:
        if any(field == "private_listing_sha256" for field, _ in mismatches) and _private_universe_digest(private_listing_path) != lock["private_universe_id_sha256"]:
            raise ValueError("private universe digest mismatch")
        field, path = mismatches[0]
        raise ValueError(f"locked {path.name} hash mismatch")
    if _private_universe_digest(private_listing_path) != lock["private_universe_id_sha256"]:
        raise ValueError("private universe digest mismatch")
    return lock


def _load_source_body(run_dir: Path, exchange: dict[str, Any]) -> bytes:
    relative = exchange.get("body_path")
    if not isinstance(relative, str):
        raise ValueError(f"exchange {exchange.get('exchange_id')} has no body path")
    path = (run_dir / relative).resolve()
    if not path.is_relative_to(run_dir.resolve()):
        raise ValueError("exchange body path escapes the run directory")
    body = path.read_bytes()
    if len(body) != exchange.get("body_bytes") or _sha256(body) != exchange.get("body_sha256"):
        raise ValueError(f"exchange {exchange.get('exchange_id')} body integrity mismatch")
    return body


@dataclass(frozen=True)
class ImportedRun:
    run: Any
    exchanges: tuple[Any, ...]
    listing_rows: tuple[Any, ...]
    raw_exchanges: Any
    view_exchanges: Any
    source_bodies: Any


def _checksum_manifest(run_dir: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in (run_dir / "checksums.sha256").read_text(encoding="ascii").splitlines():
        parts = line.split("  ", 1)
        if len(parts) != 2 or not SHA256_PATTERN.fullmatch(parts[0]) or not parts[1].startswith("source/"):
            raise ValueError("invalid checksums manifest entry")
        if parts[1] in result:
            raise ValueError("duplicate checksums manifest path")
        result[parts[1]] = parts[0]
    return result


def _freeze(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _validate_provisional_row(row: dict[str, Any], line_number: int) -> None:
    if set(row) != EXCHANGE_FIELDS:
        raise ValueError("invalid provisional exchange fields")
    exchange_id = row["exchange_id"]
    if exchange_id != f"ex-{line_number:06d}":
        raise ValueError("exchange ID does not match line order")
    if row["body_path"] != f"source/{exchange_id}.body":
        raise ValueError("invalid exchange body path")
    if row["role"] not in {"list", "raw", "view"}:
        raise ValueError("unknown exchange role")
    if row["method"] != "GET":
        raise ValueError("invalid exchange method")
    if type(row["attempt"]) is not int or row["attempt"] < 1:
        raise ValueError("invalid exchange attempt")
    if type(row["duration_ms"]) is not int or row["duration_ms"] < 0:
        raise ValueError("invalid exchange duration")
    if type(row["status"]) is not int or row["status"] != 200 or row["error"] is not None:
        raise ValueError("run contains unsuccessful exchanges")
    if not isinstance(row["body_bytes"], int) or isinstance(row["body_bytes"], bool) or row["body_bytes"] < 0:
        raise ValueError("invalid body byte count")
    if not isinstance(row["body_sha256"], str) or not SHA256_PATTERN.fullmatch(row["body_sha256"]):
        raise ValueError("invalid body digest")
    if not isinstance(row["started_at"], str) or not ISO_TIMESTAMP.fullmatch(row["started_at"]):
        raise ValueError("invalid exchange timestamp")
    if not isinstance(row["ended_at"], str) or not ISO_TIMESTAMP.fullmatch(row["ended_at"]) or row["ended_at"] < row["started_at"]:
        raise ValueError("invalid exchange timestamp")
    for header_name in ("request_headers", "response_headers"):
        headers = row[header_name]
        if not isinstance(headers, list) or any(not isinstance(pair, list) or len(pair) != 2 or any(not isinstance(part, str) for part in pair) for pair in headers):
            raise ValueError("invalid exchange headers")
    if row["role"] == "list":
        if row["paste_id"] is not None or type(row["list_offset"]) is not int or row["list_offset"] not in EXPECTED_LIST_OFFSETS:
            raise ValueError("invalid list exchange")
    else:
        paste_id = row["paste_id"]
        if not isinstance(paste_id, str) or not ID_PATTERN.fullmatch(paste_id) or row["list_offset"] is not None:
            raise ValueError("invalid raw/view paste ID")
    expected_url = f"https://anna.fyi/lists/{row['list_offset']}" if row["role"] == "list" else f"https://anna.fyi/view/{'raw/' if row['role'] == 'raw' else ''}{row['paste_id']}"
    if row["url"] != expected_url or row["final_url"] != expected_url:
        raise ValueError(f"canonical {row['role']} URL mismatch")


def import_provisional_run(run_dir: Path, private_listing_path: Path, import_lock_path: Path) -> ImportedRun:
    run_dir = run_dir.resolve()
    import_lock = _validate_import_inputs(run_dir, private_listing_path, import_lock_path)
    run = _read_json(run_dir / "run.json")
    if set(run) != RUN_FIELDS:
        raise ValueError("invalid provisional run fields")
    if not isinstance(run["run_id"], str) or run["source"] != "https://anna.fyi" or run["status"] != "COMPLETE" or run["semantics"] != "urllib response entity body; automatic redirects; no content/text decoding or transforms":
        raise ValueError("invalid provisional run fields")
    for field in ("started_at", "ended_at"):
        if not isinstance(run[field], str) or not ISO_TIMESTAMP.fullmatch(run[field]):
            raise ValueError("invalid provisional run timestamp")
    if datetime.fromisoformat(run["started_at"].replace("Z", "+00:00")) >= datetime.fromisoformat(run["ended_at"].replace("Z", "+00:00")):
        raise ValueError("run timestamps are not ordered")
    for field in ("discovered_listing_ids", "exchange_count", "failures", "stable_inventory_seed", "target_records"):
        if type(run[field]) is not int or run[field] < 0:
            raise ValueError("invalid provisional run counts")
    if run["stable_inventory_seed"] != PINNED_PRIVATE_UNIVERSE_COUNT or run["target_records"] != PINNED_PRIVATE_UNIVERSE_COUNT:
        raise ValueError("invalid provisional inventory counts")
    if not isinstance(run["successes"], dict) or set(run["successes"]) != {"list", "raw", "view"} or any(type(value) is not int or value < 0 for value in run["successes"].values()):
        raise ValueError("invalid provisional run successes")
    if run.get("run_id") != import_lock.get("run_id") or run.get("run_id") != PINNED_RUN_ID:
        raise ValueError("run ID does not match import lock")
    if run.get("status") != "COMPLETE":
        raise ValueError("run is not complete")
    if run.get("failures") != 0:
        raise ValueError("run has failures")
    exchanges = _read_jsonl(run_dir / "exchanges.jsonl")
    if run.get("exchange_count") != len(exchanges):
        raise ValueError("run/exchange count mismatch")
    if len(exchanges) != EXPECTED_TOTAL_EXCHANGES:
        raise ValueError("unexpected exchange count")
    ids: set[str] = set()
    paths: set[str] = set()
    source_root = run_dir / "source"
    source_paths: set[str] = set()
    for path in source_root.rglob("*"):
        if path.is_symlink() or not path.is_file() or path.parent != source_root:
            raise ValueError("invalid source tree entry")
        source_paths.add(path.relative_to(run_dir).as_posix())
    checksums = _checksum_manifest(run_dir)
    source_bodies: dict[str, bytes] = {}
    for line_number, row in enumerate(exchanges, 1):
        _validate_provisional_row(row, line_number)
        exchange_id = row.get("exchange_id")
        if not isinstance(exchange_id, str) or exchange_id in ids:
            raise ValueError("duplicate or invalid exchange ID")
        ids.add(exchange_id)
        role = row.get("role")
        relative = row.get("body_path")
        if relative != f"source/{exchange_id}.body" or relative in paths:
            raise ValueError("duplicate or reused body path")
        paths.add(relative)
        try:
            body = _load_source_body(run_dir, row)
        except (OSError, UnicodeError) as exc:
            raise ValueError("source body is missing or unreadable") from exc
        source_bodies[exchange_id] = body
        if relative not in checksums or checksums[relative] != _sha256(body):
            raise ValueError("body disagrees with checksums manifest")
    if paths != source_paths or set(checksums) != source_paths:
        raise ValueError("source body closure mismatch")
    if len(checksums) != len(exchanges):
        raise ValueError("checksum/body count mismatch")
    counts = {role: sum(row.get("role") == role for row in exchanges) for role in ("list", "raw", "view")}
    if counts != EXPECTED_ROLE_COUNTS:
        raise ValueError("actual role counts do not match expected closure")
    if run.get("successes") != counts:
        raise ValueError("actual role counts disagree with run summary")
    offsets = sorted(row["list_offset"] for row in exchanges if row.get("role") == "list")
    if offsets != list(EXPECTED_LIST_OFFSETS):
        raise ValueError("invalid list offsets")
    listing_rows = _parse_listing(run_dir, exchanges)
    listing_by_id = {row["hash"]: row for row in listing_rows}
    private_ids = {row["hash"] for row in _read_jsonl(private_listing_path)}
    if len(listing_by_id) != PINNED_PRIVATE_UNIVERSE_COUNT or set(listing_by_id) != private_ids:
        raise ValueError("private universe closure mismatch")
    if run.get("discovered_listing_ids") != len(listing_rows):
        raise ValueError("run/listing count mismatch")
    raw_exchanges = _successful_exchanges(exchanges, "raw")
    view_exchanges = _successful_exchanges(exchanges, "view")
    if set(raw_exchanges) != set(listing_by_id) or set(view_exchanges) != set(listing_by_id):
        raise ValueError("raw/view ID closure mismatch")
    return ImportedRun(_freeze(run), tuple(_freeze(row) for row in exchanges), tuple(_freeze(row) for row in listing_rows), _freeze(raw_exchanges), _freeze(view_exchanges), MappingProxyType(source_bodies))


def _load_selection(path: Path, *, expected_count: int | None = None) -> tuple[dict[str, Any], dict[str, str]]:
    selection = _read_json(path)
    records = selection.get("records")
    if (
        selection.get("schema_version") != 1
        or selection.get("selection_version") != 1
        or selection.get("source_commit") != LEGACY_SOURCE_COMMIT
        or selection.get("source_commit_oid") != LEGACY_SOURCE_COMMIT_OID
        or not isinstance(records, list)
        or selection.get("count") != len(records)
    ):
        raise ValueError("invalid selection manifest")
    if expected_count is not None and selection["count"] != expected_count:
        raise ValueError(f"selection count must be {expected_count}")
    approved: dict[str, str] = {}
    for record in records:
        if not isinstance(record, dict) or set(record) != {"paste_id", "approved_raw_sha256"}:
            raise ValueError("invalid selection record")
        paste_id = record["paste_id"]
        digest = record["approved_raw_sha256"]
        if not isinstance(paste_id, str) or not ID_PATTERN.fullmatch(paste_id):
            raise ValueError("invalid selected paste ID")
        if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
            raise ValueError("invalid approved raw hash")
        if paste_id in approved:
            raise ValueError("duplicate selected paste ID")
        approved[paste_id] = digest
    if list(approved) != sorted(approved):
        raise ValueError("selection records must be sorted by paste ID")
    return selection, approved


def _successful_exchanges(rows: list[dict[str, Any]], role: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.get("role") != role or row.get("status") != 200 or row.get("error") is not None:
            continue
        paste_id = row.get("paste_id")
        if not isinstance(paste_id, str) or not ID_PATTERN.fullmatch(paste_id) or paste_id in result:
            raise ValueError(f"invalid or duplicate successful {role} exchange")
        result[paste_id] = row
    return result


def _parse_listing(run_dir: Path, exchanges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    list_exchanges = sorted(
        (
            row
            for row in exchanges
            if row.get("role") == "list" and row.get("status") == 200 and row.get("error") is None
        ),
        key=lambda row: row.get("list_offset", -1),
    )
    if not list_exchanges:
        raise ValueError("run has no successful list exchanges")
    parsed: list[dict[str, Any]] = []
    seen: set[str] = set()
    for exchange in list_exchanges:
        offset = exchange.get("list_offset")
        if not isinstance(offset, int) or offset < 0:
            raise ValueError("invalid list offset")
        text = _load_source_body(run_dir, exchange).decode("utf-8", "strict")
        for paste_id, title, author, language, when in LIST_ROW_PATTERN.findall(text):
            if paste_id in seen:
                raise ValueError(f"duplicate listing paste ID: {paste_id}")
            seen.add(paste_id)
            parsed.append(
                {
                    "hash": paste_id,
                    "title": html.unescape(title),
                    "author": html.unescape(author),
                    "language": html.unescape(language),
                    "when": html.unescape(when),
                    "list_offset": offset,
                }
            )
    return parsed


def _parse_view(body: bytes, listing: dict[str, Any], allowlist: set[str], listing_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    text = body.decode("utf-8", "strict")
    title_match = TITLE_PATTERN.search(text)
    meta_match = META_PATTERN.search(text)
    if not title_match or not meta_match:
        raise ValueError(f"view metadata missing for {listing['hash']}")
    title = html.unescape(title_match.group(1))
    if title != listing["title"]:
        raise ValueError(f"view/list title mismatch for {listing['hash']}")

    meta = " ".join(html.unescape(meta_match.group(1)).split())
    prefix = f"From {listing['author']}, {listing['when'].removesuffix('.')}, written in {listing['language']}, viewed "
    if not meta.startswith(prefix) or not meta.endswith(" times."):
        raise ValueError(f"view/list metadata mismatch for {listing['hash']}")
    views_text = meta[len(prefix) : -len(" times.")]
    if not re.fullmatch(r"[0-9][0-9,]*", views_text):
        raise ValueError(f"invalid view count for {listing['hash']}")

    parent = None
    parent_match = PARENT_PATTERN.search(text)
    if "This paste is a reply to" in text and not parent_match:
        raise ValueError(f"malformed parent relation for {listing['hash']}")
    if parent_match and parent_match.group(1) in allowlist:
        parent_id = parent_match.group(1)
        parent_listing = listing_by_id[parent_id]
        if html.unescape(parent_match.group(2)) != parent_listing["title"]:
            raise ValueError(f"parent title mismatch for {listing['hash']}")
        parent = {
            "hash": parent_id,
            "title": parent_listing["title"],
            "author": parent_listing["author"],
        }

    paste_id = listing["hash"]
    diff_url = f"https://anna.fyi/view/{paste_id}/diff"
    rss_url = f"https://anna.fyi/view/rss/{paste_id}"
    return {
        "views": int(views_text.replace(",", "")),
        "parent": parent,
        "diff_url": diff_url if f'href="{diff_url}"' in text else None,
        "rss_url": rss_url if f'href="{rss_url}"' in text else None,
    }


def _calendar_months(later: datetime, earlier: datetime) -> int:
    months = (later.year - earlier.year) * 12 + (later.month - earlier.month)
    if later.day < earlier.day:
        months -= 1
    return months


def _check_time_consistency(when: str, anchor_iso: str, published_iso: str) -> None:
    match = WHEN_PATTERN.fullmatch(when)
    if not match:
        raise ValueError(f"unrecognized relative time: {when}")
    count, unit = int(match.group(1)), match.group(2)
    anchor = datetime.fromisoformat(anchor_iso.replace("Z", "+00:00"))
    published = datetime.fromisoformat(published_iso.replace("Z", "+00:00"))
    if published >= anchor:
        raise ValueError(f"published time is not before the capture anchor: {when}")
    seconds = (anchor - published).total_seconds()
    if unit == "Minute":
        consistent = count * 60 <= seconds < (count + 1) * 60
    elif unit == "Hour":
        consistent = count * 3600 <= seconds < (count + 1) * 3600
    elif unit == "Day":
        consistent = count * 86400 <= seconds < (count + 1) * 86400
    elif unit == "Week":
        consistent = count * 604800 <= seconds < (count + 1) * 604800
    elif unit == "Month":
        consistent = _calendar_months(anchor, published) == count
    else:
        years = anchor.year - published.year - (1 if (anchor.month, anchor.day) < (published.month, published.day) else 0)
        consistent = years == count
    if not consistent:
        raise ValueError(f"published time is inconsistent with displayed {when}")


def _load_times(path: Path, allowlist: set[str]) -> dict[str, str]:
    data = _read_json(path)
    if (
        set(data) != {"schema_version", "source", "fetched_at", "count", "times"}
        or data.get("schema_version") != 1
        or not isinstance(data.get("times"), dict)
        or data.get("count") != len(data["times"])
    ):
        raise ValueError("invalid published-times manifest")
    times = data["times"]
    if set(times) != allowlist:
        raise ValueError("published times do not cover the public selection")
    result: dict[str, str] = {}
    for paste_id, value in times.items():
        if type(value) is not int or value <= 0:
            raise ValueError("invalid published time value")
        result[paste_id] = datetime.fromtimestamp(value, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return result


def _derive_payload(body: bytes) -> tuple[bytes, str]:
    if not body.startswith(PHP_BANNER_START):
        return body, "identity"
    boundary = body.find(b"</div>")
    if boundary < 0 or boundary > 32768:
        raise ValueError("malformed leading Stikked diagnostic")
    banner = body[: boundary + len(b"</div>")]
    if not all(marker in banner for marker in PHP_BANNER_MARKERS):
        raise ValueError("unrecognized leading Stikked diagnostic")
    return body[boundary + len(b"</div>") :], "strip-leading-stikked-diagnostic-v1"


def _public_exchange(paste_id: str, role: str, exchange: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": 2,
        "paste_id": paste_id,
        "role": role,
        "exchange_id": exchange["exchange_id"],
        "url": exchange["url"],
        "final_url": exchange["final_url"],
        "started_at": exchange["started_at"],
        "ended_at": exchange["ended_at"],
        "status": exchange["status"],
        "body_bytes": exchange["body_bytes"],
        "body_sha256": exchange["body_sha256"],
    }


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def _write_checksums(root: Path) -> None:
    paths = sorted(
        (path for path in root.rglob("*") if path.is_file() and path.name != "SHA256SUMS"),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    _write_text(
        root / "SHA256SUMS",
        "".join(f"{_sha256(path.read_bytes())}  {path.relative_to(root).as_posix()}\n" for path in paths),
    )


def _withheld_metadata_canaries(listing_rows: list[dict[str, Any]], allowlist: set[str]) -> tuple[list[str], list[str]]:
    selected_names = {
        " ".join(value.split()).casefold()
        for row in listing_rows
        if row["hash"] in allowlist
        for value in (row["title"], row["author"])
        if value.split()
    }
    titles: list[str] = []
    authors: list[str] = []
    for row in listing_rows:
        if row["hash"] in allowlist:
            continue
        for values, kind in ((titles, "title"), (authors, "author")):
            normalized = " ".join(row[kind].split()).casefold()
            if len(normalized) >= 8 and normalized not in selected_names and normalized not in values:
                values.append(normalized)
    return titles, authors


def _scan_public_privacy(root: Path, withheld_ids: set[str], title_canaries: list[str], author_canaries: list[str]) -> None:
    for path in (path for path in root.rglob("*") if path.is_file()):
        content = path.read_bytes().lower()
        lowered_relative = path.relative_to(root).as_posix().lower().encode()
        if any(paste_id.encode() in content or paste_id.encode() in lowered_relative for paste_id in withheld_ids):
            raise ValueError("withheld paste ID leaked into public output")
        for kind, needles in (("title", title_canaries), ("author", author_canaries)):
            if any(needle.encode() in content for needle in needles):
                raise ValueError(f"withheld {kind} metadata leaked into public output at {path.relative_to(root).as_posix()}")


def export_snapshot(
    run_dir: Path,
    private_listing_path: Path,
    selection_path: Path,
    import_lock_path: Path,
    times_path: Path,
    output: Path,
) -> dict[str, int | str]:
    run_dir = run_dir.resolve()
    output = output.resolve()
    if output == run_dir or output.is_relative_to(run_dir):
        raise ValueError("output cannot be inside the private run")

    imported = import_provisional_run(run_dir, private_listing_path, import_lock_path)
    lock = _read_json(import_lock_path)
    if _sha256(selection_path.read_bytes()) != lock["public_selection_sha256"]:
        raise ValueError("locked selection.json hash mismatch")
    selection, approved = _load_selection(selection_path, expected_count=EXPECTED_PUBLIC_SELECTION_COUNT)
    run = imported.run
    exchanges = list(imported.exchanges)
    listing_rows = list(imported.listing_rows)
    listing_by_id = {row["hash"]: row for row in listing_rows}
    raw_exchanges = imported.raw_exchanges
    view_exchanges = imported.view_exchanges
    discovered = set(listing_by_id)
    allowlist = set(approved)
    if not allowlist <= discovered:
        raise ValueError("selection is not contained in the captured listing")
    if len(allowlist) != EXPECTED_PUBLIC_SELECTION_COUNT:
        raise ValueError("selection count does not match expected public closure")
    published_times = _load_times(times_path, allowlist)

    source: dict[str, bytes] = {}
    views: dict[str, bytes] = {}
    for paste_id in sorted(allowlist):
        raw_body = imported.source_bodies[raw_exchanges[paste_id]["exchange_id"]]
        if _sha256(raw_body) != approved[paste_id]:
            raise ValueError(f"approved raw hash mismatch for {paste_id}")
        source[paste_id] = raw_body
        views[paste_id] = imported.source_bodies[view_exchanges[paste_id]["exchange_id"]]

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        records: list[dict[str, Any]] = []
        public_exchanges: list[dict[str, Any]] = []
        for listing in listing_rows:
            paste_id = listing["hash"]
            if paste_id not in allowlist:
                continue
            raw_body = source[paste_id]
            transform = _derive_payload(raw_body)[1]
            view_metadata = _parse_view(views[paste_id], listing, allowlist, listing_by_id)
            raw_exchange = raw_exchanges[paste_id]
            view_exchange = view_exchanges[paste_id]
            published_utc = published_times[paste_id]
            _check_time_consistency(listing["when"], view_exchange["started_at"], published_utc)
            raw_path = f"raw/{paste_id}.txt"
            (staging / raw_path).parent.mkdir(parents=True, exist_ok=True)
            (staging / raw_path).write_bytes(raw_body)

            records.append(
                {
                    "hash": paste_id,
                    "title": listing["title"],
                    "author": listing["author"],
                    "language": listing["language"],
                    "when": listing["when"],
                    "published_utc": published_utc,
                    **view_metadata,
                    "canonical_url": f"https://anna.fyi/view/{paste_id}",
                    "raw_bytes": len(raw_body),
                    "raw_sha256": _sha256(raw_body),
                    "raw_has_diagnostic_banner": transform != "identity",
                }
            )
            public_exchanges.extend(
                (
                    _public_exchange(paste_id, "raw", raw_exchange),
                    _public_exchange(paste_id, "view", view_exchange),
                )
            )

        if len(records) != len(allowlist) or len(public_exchanges) != len(allowlist) * 2:
            raise ValueError("public output closure is incomplete")
        capture = {
            "schema_version": 2,
            "source": run.get("source"),
            "source_run_id": run.get("run_id"),
            "started_at": run.get("started_at"),
            "ended_at": run.get("ended_at"),
            "source_body_semantics": "HTTP response entity bytes before content/text decoding or transforms",
            "discovered_pastes": len(discovered),
            "included_pastes": len(allowlist),
            "excluded_pastes": len(discovered - allowlist),
            "selection_version": selection["selection_version"],
            "selection_source_commit": selection.get("source_commit"),
            "selection_source_commit_oid": selection.get("source_commit_oid"),
            "raw_hashes_matched_approved_selection": len(allowlist),
            "public_raw_exchanges": len(allowlist),
            "public_view_metadata_exchanges": len(allowlist),
            "raw_diagnostic_banner_files": sum(row["raw_has_diagnostic_banner"] for row in records),
            "published_times_source": "https://anna.fyi/api/paste/<id> (created field)",
            "published_times_sha256": _sha256(times_path.read_bytes()),
        }
        readme = f"""# anna.fyi research snapshot

Curated public subset of pastes captured from https://anna.fyi, a Stikked pastebin
that agents used as a relay and coordination channel in 2026.

- Captured live from anna.fyi: {run.get('started_at')} to {run.get('ended_at')}
- Discovered: {len(discovered)} pastes; included here: {len(allowlist)}; withheld: {len(discovered - allowlist)}
- Exact publish times: fetched from the site's `/api/paste/<id>` endpoint and
  cross-checked against the relative dates displayed during capture
- Inclusion basis: previously reviewed allowlist at commit
  `{selection.get('source_commit_oid')}`, reduced during curation by removing
  non-agent records

Files:

- `raw/<id>.txt` - exact `/view/raw/<id>` response entity bytes from the live site,
  no decoding or transforms. Four files begin with a Stikked PHP diagnostic banner;
  `raw_has_diagnostic_banner` in `records.jsonl` marks them.
- `records.jsonl` - one row per paste: title, author, language, view count, public
  reply link, byte size, SHA-256. `when` is the relative date as displayed by the site;
  `published_utc` is the exact publish time.
- `exchanges.public.jsonl` - sanitized capture provenance for the {len(allowlist)} raw and
  {len(allowlist)} view requests: URL, timestamps, status, body hash.
- `capture.json` - source, run ID, timestamps, counts, selection basis.
- `SHA256SUMS` - checksums for every file above.

Withheld records are site-owner personal pastes and non-agent junk (YouTube link
dumps, chatbot transcripts, micro-tests, pastebin meta); they are not published.

Verify from this directory with `sha256sum -c SHA256SUMS`. The committed exporter
rebuilds this package offline from the frozen capture (private inputs):
`python data/scripts/export_anna_fyi_snapshot.py --private-run <run-dir> --private-listing <listing.jsonl> --selection <selection.json> --import-lock <lock.json> --times <published-times.json> --output <dir>`.
"""
        _write_text(staging / "records.jsonl", "".join(_json_line(row) for row in sorted(records, key=lambda row: row["hash"])))
        _write_text(staging / "exchanges.public.jsonl", "".join(_json_line(row) for row in public_exchanges))
        _write_text(staging / "capture.json", json.dumps(capture, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        _write_text(staging / "README.md", readme)
        _write_text(
            staging / ".gitattributes",
            ".gitattributes text eol=lf\nraw/*.txt -text\n*.json text eol=lf\n*.jsonl text eol=lf\nSHA256SUMS text eol=lf\nREADME.md text eol=lf\n",
        )

        withheld = discovered - allowlist
        title_canaries, author_canaries = _withheld_metadata_canaries(listing_rows, allowlist)
        _scan_public_privacy(staging, withheld, title_canaries, author_canaries)
        _write_checksums(staging)

        if output.exists():
            if output.is_file():
                raise ValueError("output path is a file")
            shutil.rmtree(output)
        os.replace(staging, output)
    except BaseException:
        if staging.exists():
            shutil.rmtree(staging)
        raise

    return {
        "source_run_id": str(run.get("run_id")),
        "discovered": len(discovered),
        "included": len(allowlist),
        "withheld": len(discovered - allowlist),
        "raw_diagnostic_banner_files": sum(_derive_payload(source[paste_id])[1] != "identity" for paste_id in allowlist),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the public anna.fyi research snapshot from a frozen private run")
    parser.add_argument("--private-run", required=True, type=Path)
    parser.add_argument("--private-listing", required=True, type=Path)
    parser.add_argument("--selection", required=True, type=Path)
    parser.add_argument("--import-lock", required=True, type=Path)
    parser.add_argument("--times", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(export_snapshot(args.private_run, args.private_listing, args.selection, args.import_lock, args.times, args.output), sort_keys=True))


if __name__ == "__main__":
    main()
