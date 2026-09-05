#!/usr/bin/env python3
"""Строит processed/ (и копию в web/public/data/) из raw/ выгрузок collusion.wiki.

Вход:  data/raw/{revisions,pages,events,labels,manifest}.jsonl(.gz)
Выход: data/processed/
  summary.json            — общая статистика (из manifest + вычисленная)
  activity_by_day.json    — [{"date","wiki","saves","deletes","reverts","probes","bytes"}]
  activity_by_hour.json   — [{"hour","saves"}]  (часы UTC)
  pages.json              — индекс страниц (лёгкий, без тел)
  labels.json             — индекс агентов
  recent_events.json      — последние события (лимит)
  revisions/<slug>.json   — по одной странице: ревизии с полным текстом
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import re
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "processed"
PUBLIC = ROOT.parent / "web" / "public" / "data"

REV_LIMIT_EVENTS = 2000
EVENT_TYPES = {"save", "delete", "revert", "probe"}

_SLUG_SAFE = re.compile(r"[^A-Za-z0-9_.\-]")


def open_maybe_gz(path: Path, mode: str = "rt", encoding: str = "utf-8"):
    if path.suffix == ".gz":
        return gzip.open(path, mode, encoding=encoding, newline="")
    return open(path, mode, encoding=encoding)


def read_jsonl(path: Path):
    with open_maybe_gz(path) as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def read_json(path: Path):
    with open_maybe_gz(path) as f:
        return json.load(f)


def slugify(page_key: str) -> str:
    wiki, _, name = page_key.partition("~")
    return f"{_SLUG_SAFE.sub('_', wiki)}~{_SLUG_SAFE.sub('_', name)}"


def is_slug_collision(page_id: str, page_key: str, used: dict[str, str]) -> bool:
    return slugify(page_key) in used and used[slugify(page_key)] != page_id


def build_revision_files(revisions: list[dict]) -> tuple[dict[str, int], dict[str, str]]:
    """Группирует ревизии по страницам и пишет processed/revisions/<slug>.json.

    Возвращает: ({page_key: число ревизий}, {page_id: slug}).
    """
    by_page: dict[str, list[dict]] = {}
    for r in revisions:
        by_page.setdefault(r["page_id"], []).append(r)

    used: dict[str, str] = {}
    slug_map: dict[str, str] = {}
    (OUT / "revisions").mkdir(parents=True, exist_ok=True)
    for stale in (OUT / "revisions").iterdir():
        if stale.is_file():
            stale.unlink()
    n_pages = 0

    for page_id, revs in sorted(by_page.items()):
        slug = slugify(page_id)
        revs_sorted = sorted(revs, key=lambda r: (r["seq"] if r.get("seq") is not None else 0, r["rev_id"]))
        payload = []
        for r in revs_sorted:
            payload.append({
                "seq": r.get("seq"),
                "time": r.get("write_date") or r.get("time"),
                "label": r.get("label"),
                "ip16": r.get("ip16"),
                "summary": r.get("change_summary"),
                "len": r.get("body_len"),
                "body": r.get("body", ""),
                "action": r.get("request_action"),
                "round": r.get("round_id"),
            })
        # коллизии по slug в т.ч. при case-insensitive ФС (Windows/macOS)
        if any(k in used and used[k] != page_id for k in (slug, slug.lower())):
            slug = f"{slug}_h{hashlib.sha1(page_id.encode()).hexdigest()[:8]}"
        used[slug.lower()] = page_id
        used[slug] = page_id
        slug_map[page_id] = slug
        (OUT / "revisions" / f"{slug}.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
        n_pages += 1

    print(f"revisions: {sum(len(v) for v in by_page.values())} -> {n_pages} files")
    return {k: len(v) for k, v in by_page.items()}, slug_map


def main() -> int:
    revisions = list(read_jsonl(RAW / "revisions.jsonl.gz"))
    pages = list(read_jsonl(RAW / "pages.jsonl.gz"))
    events = list(read_jsonl(RAW / "events.jsonl.gz"))
    labels = list(read_jsonl(RAW / "labels.jsonl.gz"))
    manifest = read_json(RAW / "manifest.json.gz")

    rev_counts, slug_map = build_revision_files(revisions)

    # --- активность по дням и часам из событий ---
    day: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"saves": 0, "deletes": 0, "reverts": 0, "probes": 0, "bytes": 0}
    )
    hour = Counter()
    by_type: Counter[str] = Counter()

    for e in events:
        etype = e.get("event_type")
        wiki = e.get("wiki") or (e.get("page_id") or "").partition("/")[0]
        day_key = (e.get("time", "")[:10], wiki)
        if etype in EVENT_TYPES:
            by_type[etype] += 1
            if etype == "save":
                day[day_key]["saves"] += 1
            elif etype == "delete":
                day[day_key]["deletes"] += 1
            elif etype == "revert":
                day[day_key]["reverts"] += 1
            elif etype == "probe":
                day[day_key]["probes"] += 1
        hour[e.get("time", "")[11:13] or "?"] += 1

    for r in revisions:
        d = (r.get("write_date") or r.get("time") or "")[:10]
        if d:
            day[(d, r.get("wiki", ""))]["bytes"] += r.get("body_len") or 0

    activity_by_day = [
        {"date": date, "wiki": wiki, **counts}
        for (date, wiki), counts in sorted(day.items())
    ]
    activity_by_hour = [
        {"hour": h, "saves": hour[h]} for h in sorted(hour, key=lambda x: (x == "?", x))
    ]

    # --- индекс страниц (компактные ключи) ---
    pages_index = {
        "p": [{
            "id": p["page_id"],
            "s": slug_map.get(p["page_id"], slugify(p["page_id"])),
            "w": p["wiki"],
            "n": p["name"],
            "r": p["n_revs"],
            "f": p["first_write"][:10],
            "l": p["last_write"][:10],
            "d": p["deleted_live"],
            "del": p["n_deletions"],
            "fam": p.get("page_family") or "",
            "lb": p["n_labels"],
            "labs": p["labels"][:8],
        } for p in pages],
        "order": "last_write desc",
    }

    # --- индекс агентов ---
    labels_index = {
        "l": [{
            "x": lab["label"],
            "r": lab["stored_revisions"],
            "f": lab["first_write"][:10],
            "t": lab["last_write"][:10],
            "p": lab["stored_revision_pages"],
            "h": lab.get("is_human_handle", False),
            "w": lab.get("wikis", []),
            "pgs": lab.get("pages", [])[:2000],
        } for lab in labels if lab["label"]],
        "n_anon": sum(1 for lab in labels if not lab["label"]),
    }

    # --- последние события ---
    recent = []
    for e in events:
        if e.get("event_type") not in EVENT_TYPES:
            continue
        recent.append({
            "t": e.get("time"),
            "type": e.get("event_type"),
            "wiki": e.get("wiki") or (e.get("page_id") or "").partition("/")[0],
            "page": e.get("page_id") or "",
            "action": e.get("request_action"),
            "ip16": e.get("ip16"),
        })
    recent.sort(key=lambda e: e["t"] or "", reverse=True)
    recent_events = recent[:REV_LIMIT_EVENTS]

    # --- сводка ---
    n_revs_total = sum(rev_counts.values())
    summary = {
        "source": "https://collusion.wiki/explorer/download.html",
        "export_generated_at": manifest.get("generated_at"),
        "counts": {
            "revisions": n_revs_total,
            "pages": len(pages),
            "labels": len(labels_index["l"]),
            "events": by_type,
        },
        "per_wiki": manifest.get("per_wiki", {}),
        "days": len(set(k[0] for k in day)),
        "max_day": {
            "date": max(day, key=lambda k: day[k]["saves"])[0],
            "saves": max(v["saves"] for v in day.values()),
        },
    }

    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in [
        ("summary.json", summary),
        ("activity_by_day.json", activity_by_day),
        ("activity_by_hour.json", activity_by_hour),
        ("pages.json", pages_index),
        ("labels.json", labels_index),
        ("recent_events.json", recent_events),
    ]:
        (OUT / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"wrote processed/{name}")

    # --- синк в web/public/data ---
    if PUBLIC != OUT:
        PUBLIC.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(PUBLIC, ignore_errors=True)
        shutil.copytree(OUT, PUBLIC)
        print(f"synced {OUT} -> {PUBLIC}")

    return 0


if __name__ == "__main__":
    sys.exit(main())