"""Catalog the published /16 address prefixes (ip16) in the archive export.

Reads the canonical raw export (revisions, events, optional recovered
other-wikis layer) and aggregates every distinct ip16 into a compact catalog
and per-octet (/8) groups. ip16 is a truncated network indicator: this catalog
does not attempt host, organization or person attribution.

Outputs (data/processed):
  ip16_catalog.csv        full per-prefix table, written when distinct <= --max-distinct
  ip16_groups.json        meta, /8 groups and a top-N preview of the catalog
  ip16_label_edges.csv    prefix/label pair counts, written when edges <= --max-edges
  ip16_label_pairs.csv    prefix pairs sharing labels, written when edges <= --max-edges
  ip16_label_networks.json  multi-network labels, top hubs and top shared pairs
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RAW = ROOT / "data" / "raw"
DEFAULT_OUT = ROOT / "data" / "processed"
DEFAULT_MAX_DISTINCT = 400
DEFAULT_TOP = 50
DEFAULT_MAX_EDGES = 30000
TOP_PAIRS = 25
TOP_LABELS = 5
TOP_HUBS = 25
EVENT_TYPES = ("save", "delete", "revert", "probe")
FORMULA_PREFIXES = ("=", "+", "-", "@")


def _csv_cell(value: str) -> str:
    """Neutralize CSV formula injection: prefix external labels starting with =,+,-,@."""
    if value and value[0] in FORMULA_PREFIXES:
        return "'" + value
    return value


def load_jsonl(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def load_other_wikis(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    rows = []
    for page in data.get("pages", []):
        wiki = page.get("wiki") or str(page.get("page_key", "")).partition("~")[0]
        for rev in page.get("revisions", []):
            if rev.get("ip16"):
                rows.append({
                    "wiki": wiki,
                    "page_id": page.get("page_key"),
                    "label": None,
                    "ip16": rev.get("ip16"),
                    "time": rev.get("time"),
                    "partial": True,
                })
    return rows


def _prefix(row: dict) -> str | None:
    value = row.get("ip16")
    if not value:
        return None
    parts = str(value).split(".")
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        return None
    return str(value)


def _time(row: dict, *keys: str) -> str | None:
    for key in keys:
        if row.get(key):
            return str(row[key])
    return None


def build_catalog(revisions: list[dict], events: list[dict], other: list[dict] = ()) -> dict:
    entries: dict[str, dict] = {}

    def entry(prefix: str) -> dict:
        return entries.setdefault(prefix, {
            "prefix": prefix,
            "octet8": prefix.split(".")[0],
            "rows": 0,
            "revisions": 0,
            "events": 0,
            "save": 0,
            "delete": 0,
            "revert": 0,
            "probe": 0,
            "wikis": set(),
            "labels": Counter(),
            "pages": set(),
            "event_pages": set(),
            "first": None,
            "last": None,
        })

    def touch(item: dict, wiki, when) -> None:
        if wiki:
            item["wikis"].add(wiki)
        if when:
            if item["first"] is None or when < item["first"]:
                item["first"] = when
            if item["last"] is None or when > item["last"]:
                item["last"] = when

    for row in revisions:
        prefix = _prefix(row)
        if not prefix:
            continue
        item = entry(prefix)
        item["rows"] += 1
        item["revisions"] += 1
        touch(item, row.get("wiki"), _time(row, "time", "write_date"))
        if row.get("label"):
            item["labels"][row["label"]] += 1
        if row.get("page_id"):
            item["pages"].add(row["page_id"])

    for row in events:
        prefix = _prefix(row)
        if not prefix:
            continue
        item = entry(prefix)
        item["rows"] += 1
        item["events"] += 1
        event_type = row.get("event_type") or row.get("type")
        if event_type in EVENT_TYPES:
            item[event_type] += 1
        touch(item, row.get("wiki"), _time(row, "t", "time"))
        if row.get("page"):
            item["event_pages"].add(row["page"])

    for row in other:
        prefix = _prefix(row)
        if not prefix:
            continue
        item = entry(prefix)
        item["rows"] += 1
        item["revisions"] += 1
        touch(item, row.get("wiki"), _time(row, "time"))
        if row.get("page_id"):
            item["pages"].add(row["page_id"])

    catalog = []
    for prefix in sorted(entries, key=lambda p: (int(p.split(".")[0]), int(p.split(".")[1]))):
        item = entries[prefix]
        catalog.append({
            "prefix": item["prefix"],
            "octet8": item["octet8"],
            "rows": item["rows"],
            "revisions": item["revisions"],
            "events": item["events"],
            "save": item["save"],
            "delete": item["delete"],
            "revert": item["revert"],
            "probe": item["probe"],
            "labels": len(item["labels"]),
            "pages": len(item["pages"]),
            "event_pages": len(item["event_pages"]),
            "wikis": sorted(item["wikis"]),
            "top_labels": [name for name, _ in item["labels"].most_common(TOP_LABELS)],
            "first_utc": item["first"],
            "last_utc": item["last"],
        })
    catalog.sort(key=lambda r: (-r["rows"], r["prefix"]))

    by_octet: dict[str, list[dict]] = defaultdict(list)
    for row in catalog:
        by_octet[row["octet8"]].append(row)
    groups = [{
        "octet8": octet8,
        "prefixes": len(rows),
        "rows": sum(r["rows"] for r in rows),
        "revisions": sum(r["revisions"] for r in rows),
        "events": sum(r["events"] for r in rows),
        "top_prefixes": [{"prefix": r["prefix"], "rows": r["rows"]} for r in rows[:3]],
    } for octet8, rows in by_octet.items()]
    groups.sort(key=lambda g: (-g["rows"], g["octet8"]))

    return {
        "distinct": len(catalog),
        "totals": {
            "rows": sum(r["rows"] for r in catalog),
            "revisions": sum(r["revisions"] for r in catalog),
            "events": sum(r["events"] for r in catalog),
        },
        "catalog": catalog,
        "groups": groups,
    }


def build_label_networks(revisions: list[dict], other: list[dict] = ()) -> dict:
    edges: Counter = Counter()
    for row in revisions:
        prefix = _prefix(row)
        if prefix and row.get("label"):
            edges[(prefix, str(row["label"]))] += 1
    for row in other:
        prefix = _prefix(row)
        if prefix and row.get("label"):
            edges[(prefix, str(row["label"]))] += 1

    by_prefix: dict[str, Counter] = defaultdict(Counter)
    by_label: dict[str, Counter] = defaultdict(Counter)
    for (prefix, label), count in edges.items():
        by_prefix[prefix][label] += count
        by_label[label][prefix] += count

    multi = {label: prefixes for label, prefixes in by_label.items() if len(prefixes) > 1}
    distribution = Counter(len(prefixes) for prefixes in by_label.values())

    labels = [{
        "label": label,
        "prefixes": len(prefixes),
        "rows": sum(prefixes.values()),
        "top_prefixes": [{"prefix": prefix, "rows": count} for prefix, count in prefixes.most_common(3)],
    } for label, prefixes in by_label.items()]
    labels.sort(key=lambda row: (-row["prefixes"], -row["rows"], row["label"]))

    hubs = [{
        "prefix": prefix,
        "labels": len(counter),
        "rows": sum(counter.values()),
        "top_labels": [name for name, _ in counter.most_common(TOP_LABELS)],
    } for prefix, counter in by_prefix.items()]
    hubs.sort(key=lambda row: (-row["labels"], -row["rows"], row["prefix"]))

    label_sets = {prefix: set(counter) for prefix, counter in by_prefix.items()}
    prefixes = sorted(label_sets)
    pairs = []
    for index, prefix_a in enumerate(prefixes):
        for prefix_b in prefixes[index + 1:]:
            shared = len(label_sets[prefix_a] & label_sets[prefix_b])
            if shared:
                pairs.append((prefix_a, prefix_b, shared))
    pairs.sort(key=lambda row: (-row[2], row[0], row[1]))

    return {
        "edges": edges,
        "labels": labels,
        "multi": multi,
        "distribution": dict(sorted(distribution.items())),
        "hubs": hubs,
        "pairs": pairs,
        "totals": {
            "edges": len(edges),
            "labels": len(by_label),
            "multi_labels": len(multi),
            "prefixes": len(by_prefix),
            "pairs_with_shared_labels": len(pairs),
        },
    }


def write_outputs(result: dict, out_dir: Path, max_distinct: int, top: int, sources: list[str]) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    mode = "full" if result["distinct"] <= max_distinct else "preview"
    csv_path = out_dir / "ip16_catalog.csv"
    json_path = out_dir / "ip16_groups.json"

    if mode == "full":
        with csv_path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow([
                "prefix", "octet8", "rows", "revisions", "events", "save", "delete", "revert",
                "probe", "labels", "pages", "event_pages", "wikis", "top_labels", "first_utc", "last_utc",
            ])
            for row in result["catalog"]:
                writer.writerow([
                    row["prefix"], row["octet8"], row["rows"], row["revisions"], row["events"],
                    row["save"], row["delete"], row["revert"], row["probe"], row["labels"],
                    row["pages"], row["event_pages"], "|".join(row["wikis"]),
                    "|".join(_csv_cell(name) for name in row["top_labels"]),
                    row["first_utc"] or "", row["last_utc"] or "",
                ])
    elif csv_path.exists():
        print(f"warning: preview mode; stale {csv_path.name} left untouched and is not part of this run")

    payload = {
        "meta": {
            "sources": sources,
            "mode": mode,
            "distinct_prefixes": result["distinct"],
            "max_distinct": max_distinct,
            "top": top,
            "note": "ip16 is a truncated /16 network indicator; it cannot identify a host, organization or person.",
        },
        "totals": result["totals"],
        "groups": result["groups"],
        "catalog_preview": result["catalog"][:top],
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"mode": mode, "csv": str(csv_path) if mode == "full" else None, "json": str(json_path)}


def write_network_outputs(result: dict, out_dir: Path, max_edges: int, sources: list[str]) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    mode = "full" if result["totals"]["edges"] <= max_edges else "preview"
    edges_path = out_dir / "ip16_label_edges.csv"
    pairs_path = out_dir / "ip16_label_pairs.csv"
    json_path = out_dir / "ip16_label_networks.json"

    if mode == "full":
        with edges_path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["prefix", "label", "rows"])
            for (prefix, label), count in sorted(result["edges"].items(), key=lambda kv: (-kv[1], kv[0])):
                writer.writerow([prefix, _csv_cell(label), count])
        with pairs_path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["prefix_a", "prefix_b", "shared_labels"])
            for prefix_a, prefix_b, shared in result["pairs"]:
                writer.writerow([prefix_a, prefix_b, shared])
    elif edges_path.exists() or pairs_path.exists():
        print(f"warning: preview mode; stale {edges_path.name}/{pairs_path.name} left untouched and not part of this run")

    multi_preview = [row for row in result["labels"] if row["prefixes"] > 1][:TOP_HUBS]

    payload = {
        "meta": {
            "sources": sources,
            "mode": mode,
            "max_edges": max_edges,
            "note": "Label sharing across prefixes is a network-level clue only; it does not establish shared identity, operator or machine.",
        },
        "totals": result["totals"],
        "prefixes_per_label": result["distribution"],
        "top_hub_prefixes": result["hubs"][:TOP_HUBS],
        "top_multi_network_labels": multi_preview,
        "top_shared_pairs": [
            {"prefix_a": prefix_a, "prefix_b": prefix_b, "shared_labels": shared}
            for prefix_a, prefix_b, shared in result["pairs"][:TOP_PAIRS]
        ],
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"mode": mode, "edges": str(edges_path) if mode == "full" else None,
            "pairs": str(pairs_path) if mode == "full" else None, "json": str(json_path)}


def verify_catalog(result: dict) -> None:
    prefixes = [row["prefix"] for row in result["catalog"]]
    if len(prefixes) != len(set(prefixes)):
        raise AssertionError("catalog prefixes are not unique")
    for row in result["catalog"]:
        if row["rows"] != row["revisions"] + row["events"]:
            raise AssertionError(f"{row['prefix']}: rows != revisions + events")
        if row["events"] != row["save"] + row["delete"] + row["revert"] + row["probe"]:
            raise AssertionError(f"{row['prefix']}: events != per-type sum")
    totals = result["totals"]
    if totals["rows"] != sum(row["rows"] for row in result["catalog"]):
        raise AssertionError("totals.rows != sum of catalog rows")
    if totals["revisions"] != sum(row["revisions"] for row in result["catalog"]):
        raise AssertionError("totals.revisions != sum of catalog revisions")
    if totals["events"] != sum(row["events"] for row in result["catalog"]):
        raise AssertionError("totals.events != sum of catalog events")


def verify_networks(result: dict) -> None:
    label_sets: dict[str, set[str]] = defaultdict(set)
    for (prefix, label), count in result["edges"].items():
        if count < 1:
            raise AssertionError(f"edge {prefix} / {label} has no rows")
        label_sets[prefix].add(label)
    if result["totals"]["edges"] != len(result["edges"]):
        raise AssertionError("totals.edges != unique (prefix, label) pairs")
    if result["totals"]["labels"] != len({label for _, label in result["edges"]}):
        raise AssertionError("totals.labels != distinct labels")
    if result["totals"]["prefixes"] != len(label_sets):
        raise AssertionError("totals.prefixes != distinct prefixes with labels")
    seen = set()
    for prefix_a, prefix_b, shared in result["pairs"]:
        if prefix_a == prefix_b:
            raise AssertionError(f"self-pair {prefix_a}")
        key = (prefix_a, prefix_b) if prefix_a < prefix_b else (prefix_b, prefix_a)
        if key in seen:
            raise AssertionError(f"duplicate pair {key}")
        seen.add(key)
        if shared != len(label_sets[prefix_a] & label_sets[prefix_b]):
            raise AssertionError(f"pair {key}: shared != label-set intersection")
    projected = sum(shared for _, _, shared in result["pairs"])
    label_degree: Counter = Counter()
    for labels in label_sets.values():
        for label in labels:
            label_degree[label] += 1
    expected = sum(count * (count - 1) // 2 for count in label_degree.values())
    if projected != expected:
        raise AssertionError(f"pair projection is incomplete: {projected} != {expected}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Catalog published ip16 (/16) prefixes.")
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--max-distinct", type=int, default=DEFAULT_MAX_DISTINCT)
    parser.add_argument("--max-edges", type=int, default=DEFAULT_MAX_EDGES)
    parser.add_argument("--top", type=int, default=DEFAULT_TOP)
    args = parser.parse_args(argv)

    revisions = load_jsonl(args.raw_dir / "revisions.jsonl.gz")
    events = load_jsonl(args.raw_dir / "events.jsonl.gz")
    other = load_other_wikis(args.raw_dir / "other-wikis.json.gz")
    inputs = ["revisions.jsonl.gz", "events.jsonl.gz", "other-wikis.json.gz"]
    result = build_catalog(revisions, events, other)
    networks = build_label_networks(revisions, other)
    verify_catalog(result)
    verify_networks(networks)
    written = write_outputs(result, args.out_dir, args.max_distinct, args.top, inputs)
    network_written = write_network_outputs(networks, args.out_dir, args.max_edges, inputs)

    print(f"distinct ip16: {result['distinct']}")
    print(f"rows: {result['totals']['rows']} (revisions {result['totals']['revisions']}, events {result['totals']['events']})")
    print(f"mode: {written['mode']}")
    for group in result["groups"][:10]:
        print(f"  {group['octet8']}.x: prefixes={group['prefixes']} rows={group['rows']}")
    print(f"json: {written['json']}")
    if written["csv"]:
        print(f"csv: {written['csv']}")

    print(f"label edges: {networks['totals']['edges']} (labels {networks['totals']['labels']}, multi-network {networks['totals']['multi_labels']})")
    print(f"network mode: {network_written['mode']}")
    for hub in networks["hubs"][:5]:
        print(f"  {hub['prefix']}: labels={hub['labels']} rows={hub['rows']}")
    print(f"networks json: {network_written['json']}")
    if network_written["edges"]:
        print(f"edges csv: {network_written['edges']}")
        print(f"pairs csv: {network_written['pairs']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
