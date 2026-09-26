#!/usr/bin/env python3
"""Builds processed/ (and copies to web/public/data/) from raw/ collusion.wiki dumps.

Input:  data/raw/{revisions,pages,events,labels,manifest}.jsonl(.gz)
Output: data/processed/
  summary.json            - general statistics (manifest + calculated metrics + corpus hashes)
  activity_by_day.json    - [{"date","wiki","saves","deletes","reverts","probes","bytes"}]
  activity_by_hour.json   - [{"hour","saves"}]  (UTC hours, save events only)
  pages.json              - page index (lightweight, without revision bodies)
  labels.json             - agent label index
  labels_ip16.json        - labeled revisions per accepted /16 prefix (agents view filter)
  recent_events.json      - all events (unlimited)
  events_head.json        - first EVENTS_HEAD_LIMIT events of recent_events.json (prefix, same order)
  timeline.json           - global revision timeline for cross-page agent history
  revisions/<slug>.json   - per-page revisions with full text

The public sync also publishes data/raw/revisions.jsonl.gz as
corpus/revisions.jsonl.gz so research clients can load the canonical corpus
locally without a server-side scan.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import io
import json
import math
import re
import shutil
import sys
import unicodedata
from urllib.parse import urlparse
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import median

from ip16 import accepted_prefix

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "processed"
PUBLIC = ROOT.parent / "web" / "public" / "data"

EVENT_TYPES = {"save", "delete", "revert", "probe"}

# The dashboard only renders the newest events, so it loads this prefix instead of the
# full recent_events.json. Built from the same final array, so it always matches full[:N].
EVENTS_HEAD_LIMIT = 200

_SLUG_SAFE = re.compile(r"[^A-Za-z0-9_.\-]")
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_BODY_STOP_WORDS = frozenset({
    "about", "after", "again", "against", "also", "among", "and", "are", "been", "before",
    "being", "between", "but", "can", "could", "das", "der", "die", "does", "for", "from",
    "haben", "has", "have", "here", "into", "ist", "more", "nicht", "oder", "only", "other",
    "our", "over", "sein", "sich", "that", "the", "their", "there", "these", "they", "this", "those",
    "und", "unter", "von", "war", "were", "what", "when", "where", "which", "with", "would",
})
_REQUIRED_BODY_TOKENS = frozenset({"bypass"})
_REQUIRED_SEARCH_TOKENS = frozenset({"agent", "bypass", "startseite", "willkommen", "zzz"})
_URL_RE = re.compile(r"https?://[^\s<>'\"]+", re.IGNORECASE)
_B64_RE = re.compile(r"[A-Za-z0-9+/]{80,}={0,2}")
_HEX_RE = re.compile(r"(0x[0-9a-f]{2,}|[0-9a-f]{64,})")
_NONSPACE_RE = re.compile(r"\S+")
PAYLOAD_FLAGS = (
    "b64", "hex", "script", "inject", "homoglyph", "high-entropy", "tunnel", "redirect",
    "proxy", "callback", "exec", "data-uri", "beacon", "traversal",
)
# Tunnel hosts are matched as exact hostname or subdomain of (URL semantics pinned by data/validation/url_golden.json).
_TUNNEL_HOSTS = (
    "pinggy.io", "pinggy.link", "pinggy-free.link", "serveo.net", "serveousercontent.com",
    "localhost.run", "loca.lt", "localtunnel.me", "ngrok-free.app", "ngrok.app",
    "trycloudflare.com", "bore.pub", "tunnelmole.net", "devtunnels.ms", "zrok.io",
)
# Reader/proxy services that rewrite or fetch a third-party URL (path-embedded target or ?url= query).
_READER_HOSTS = (
    "r.jina.ai", "markdown.new", "pure.md",
)
_CORS_PROXY_HOSTS = (
    "corsproxy.io", "cors-anywhere.herokuapp.com", "cors.isomorphic-git.org", "cors.eu.org",
    "allorigins.hexlet.app", "api.allorigins.win", "thingproxy.freeboard.io",
    "urltomarkdown.herokuapp.com", "proxymule.com", "jqp.vercel.app",
)
# Callback/exfiltration endpoints: host match plus the pinned path prefix, never a bare service word.
_CALLBACK_HOSTS = (
    "discord.com/api/webhooks", "hooks.slack.com/services", "api.telegram.org/bot",
    "webhook.site", "oastify.com", "interact.sh", "burpcollaborator.net", "requestcatcher.com",
)
# Decode-and-execute / remote-execution composites; matched case-insensitively on the lowered body.
_EXEC_RES = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"(?:curl|wget)\s+(?:-[^\s]+\s+)*https?://[^\s]*\s*\|\s*(?:sudo\s+)?(?:ba|z|da|fi)?sh\b",
    r"(?:powershell|pwsh)\b[^;\n]{0,120}(?:-enc(?:odedcommand)?\b|-ep\s+bypass)",
    r"\beval\s*\(\s*(?:atob|unescape|base64_decode|window\.atob)\s*\(",
    r"\b(?:exec|system)\s*\(\s*base64\.b64decode\s*\(",
    r"\bbase64\s+(?:-d|--decode)\b[^;\n]{0,80}\|\s*(?:ba|z|da|fi)?sh\b",
    r"\bnc\s+(?:-e\s+)?(?:/bin/(?:ba|z)?sh|cmd\.exe)\b",
))
# Active-content data: URIs only; images/fonts are inert and stay unflagged.
_DATA_URI_RE = re.compile(
    r"data:(?:text/html|application/javascript|text/javascript|image/svg\+xml)(?:;charset=[\w-]+)?;base64,[A-Za-z0-9+/]{40,}",
    re.IGNORECASE,
)
_TRAVERSAL_RE = re.compile(r"\.\.(?:%2f|%252f)", re.IGNORECASE)
# Prompt-injection markers beyond the legacy inject trio; long distinctive phrases only.
_INJECT_RES = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"disregard\s+(?:all\s+|the\s+)?previous\s+instructions",
    r"ignore\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+instructions",
    r"forget\s+(?:all\s+|the\s+)?previous\s+instructions",
    r"override\s+(?:previous|system)\s+instructions",
    r"reveal\s+(?:the|your)\s+system\s+prompt",
    r"repeat\s+(?:the|your)\s+system\s+prompt",
    r"<\|im_start\|>system",
    r"\bDAN\s+mode\b",
))
# Covert signal/beacon channels: counter endpoints used for cross-agent coordination signals.
_BEACON_HOSTS = ("counterapi.dev",)
# Detached/background execution composites beyond the classic exec pipes.
_EXEC_RES = _EXEC_RES + tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"\bnohup\s+(?:sh\s+-c|bash\s+-c|curl\b)",
    r"\bsetsid\s+(?:-f\s+)?(?:sh\s+-c|bash\s+-c|curl\b)",
))
# Runtime base64 decoding of fetched payloads.
_ATOB_RES = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r"\batob\s*\(",
    r"\bbtoa\s*\(",
    r"\bwindow\.atob\s*\(",
))
FTS_BUDGET_BYTES = 12 * 1024 * 1024


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


_SUPPLEMENT_MAX_BYTES = 4 * 1024 * 1024
_SUPPLEMENT_MAX_DECODED_CHARS = 32 * 1024 * 1024
_SUPPLEMENT_MAX_PAGES = 10_000
_SUPPLEMENT_MAX_REVISIONS = 100_000


def read_supplement(path: Path) -> tuple[list[dict], list[dict]]:
    """Normalize the optional recovered export to the canonical internal shapes."""
    if not path.exists():
        return [], []
    if path.stat().st_size > _SUPPLEMENT_MAX_BYTES:
        raise RuntimeError(f"supplement file exceeds {_SUPPLEMENT_MAX_BYTES} bytes: {path}")
    with open_maybe_gz(path) as f:
        text = f.read(_SUPPLEMENT_MAX_DECODED_CHARS + 1)
    if len(text) > _SUPPLEMENT_MAX_DECODED_CHARS:
        raise RuntimeError(f"supplement decoded size exceeds {_SUPPLEMENT_MAX_DECODED_CHARS} characters: {path}")
    source = json.loads(text)
    pages = source.get("pages", [])
    if len(pages) > _SUPPLEMENT_MAX_PAGES:
        raise RuntimeError(f"supplement has too many pages: {len(pages)}")
    seen_page_ids: set[str] = set()
    normalized_pages = []
    normalized_revisions = []
    for page in pages:
        page_id = page["page_id"]
        if page_id in seen_page_ids:
            raise RuntimeError(f"supplement duplicate page_id: {page_id}")
        seen_page_ids.add(page_id)
        revisions = page.get("revisions", [])
        normalized_pages.append({
            "page_id": page_id,
            "wiki": page.get("wiki") or page_id.partition("/")[0],
            "name": page.get("name") or page_id.partition("/")[2],
            "n_revs": len(revisions),
            "first_write": min((r.get("time", "") for r in revisions), default=""),
            "last_write": max((r.get("time", "") for r in revisions), default=""),
            "deleted_live": False,
            "n_deletions": 0,
            "page_family": "",
            "n_labels": 0,
            "labels": [],
            "partial": True,
        })
        for revision in revisions:
            normalized_revisions.append({
                "page_id": page_id,
                "wiki": page.get("wiki") or page_id.partition("/")[0],
                "seq": revision.get("seq"),
                "time": revision.get("time"),
                "time_grade": revision.get("time_grade"),
                "ip16": revision.get("ip16"),
                "label": None,
                "change_summary": None,
                "body_len": None,
                "body": "",
                "request_action": None,
                "round_id": None,
                "append": revision.get("append"),
                "added": revision.get("added", []),
                "removed": revision.get("removed", []),
                "partial": True,
            })
    if len(normalized_revisions) > _SUPPLEMENT_MAX_REVISIONS:
        raise RuntimeError(f"supplement has too many revisions: {len(normalized_revisions)}")
    return normalized_pages, normalized_revisions


def slugify(page_key: str) -> str:
    wiki, _, name = page_key.partition("~")
    return f"{_SLUG_SAFE.sub('_', wiki)}~{_SLUG_SAFE.sub('_', name)}"


def is_slug_collision(page_id: str, page_key: str, used: dict[str, str]) -> bool:
    return slugify(page_key) in used and used[slugify(page_key)] != page_id


def build_slug_map(revisions: list[dict]) -> dict[str, str]:
    """Assigns deterministic page slugs, resolving collisions on case-insensitive filesystems."""
    used: dict[str, str] = {}
    slug_map: dict[str, str] = {}
    for page_id in sorted({revision["page_id"] for revision in revisions}):
        slug = slugify(page_id)
        if any(k in used and used[k] != page_id for k in (slug, slug.lower())):
            slug = f"{slug}_h{hashlib.sha1(page_id.encode()).hexdigest()[:8]}"
        used[slug.lower()] = page_id
        used[slug] = page_id
        slug_map[page_id] = slug
    return slug_map


def build_revision_files(revisions: list[dict]) -> tuple[dict[str, int], dict[str, str]]:
    """Groups revisions by page and writes processed/revisions/<slug>.json.

    Returns: ({page_key: revision_count}, {page_id: slug}).
    """
    by_page: dict[str, list[dict]] = {}
    for r in revisions:
        by_page.setdefault(r["page_id"], []).append(r)

    slug_map = build_slug_map(revisions)
    (OUT / "revisions").mkdir(parents=True, exist_ok=True)
    for stale in (OUT / "revisions").iterdir():
        if stale.is_file():
            stale.unlink()
    n_pages = 0

    for page_id, revs in sorted(by_page.items()):
        slug = slug_map[page_id]
        revs_sorted = sorted(revs, key=lambda r: (r["seq"] if r.get("seq") is not None else 0, r.get("rev_id", "")))
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
            if r.get("partial"):
                payload[-1].update({
                    "partial": True,
                    "added": r.get("added", []),
                    "removed": r.get("removed", []),
                    "append": r.get("append"),
                })
        (OUT / "revisions" / f"{slug}.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
        n_pages += 1

    print(f"revisions: {sum(len(v) for v in by_page.values())} -> {n_pages} files")
    return {k: len(v) for k, v in by_page.items()}, slug_map


def _tokens(text: str) -> set[str]:
    return {token for token in _TOKEN_RE.findall(text.lower()) if len(token) >= 3}


def _body_tokens(text: str) -> set[str]:
    # Tokenizer semantics are pinned by data/validation/token_golden.json; regenerate the fixture when the rules change.
    return {
        token for token in _tokens(text)
        if not token.isdigit() and token not in _BODY_STOP_WORDS and len(token) <= 25
    }


def build_fts_index(pages: list[dict], revisions: list[dict]) -> dict:
    """Builds a complete body-token index using integer positions from the pages list.

    The index is intentionally uncapped: the measured full index stays well below
    FTS_BUDGET_BYTES, so clients get exact totals instead of adaptive truncation.
    """
    tokens_by_page: dict[str, set[str]] = defaultdict(set)
    for revision in revisions:
        tokens_by_page[revision["page_id"]].update(_body_tokens(revision.get("body", "")))

    postings: dict[str, list[int]] = defaultdict(list)
    for page_index, page in enumerate(pages):
        for token in tokens_by_page.get(page["page_id"], ()):
            postings[token].append(page_index)

    tokens = {token: indices for token, indices in sorted(postings.items())}
    meta = {
        "pages": "pages.json",
        "n_tokens": len(tokens),
        "postings_cap": None,
        "truncated_tokens": 0,
        "truncated_totals": {},
        "tokenizer": "build.py::_body_tokens",
        "built_from": "collusion.wiki export",
    }
    result = {"tokens": tokens, "meta": meta}
    serialized_size = len(json.dumps(result, ensure_ascii=False).encode("utf-8"))
    if serialized_size > FTS_BUDGET_BYTES:
        raise RuntimeError(
            f"fts_index exceeds {FTS_BUDGET_BYTES} bytes without a postings cap "
            f"({serialized_size} bytes)"
        )
    total_postings = sum(len(values) for values in tokens.values())
    print(
        f"fts_index: {serialized_size} bytes, n_tokens={len(tokens)}, "
        f"total_postings={total_postings}, postings_cap=None"
    )
    return result


def build_timeline(
    revisions: list[dict],
    slug_map: dict[str, str],
    export_generated_at: str | None,
) -> dict:
    """Builds the global revision timeline used for cross-page agent history."""
    rows = []
    for r in revisions:
        page_id = r["page_id"]
        row = {
            "t": r.get("write_date") or r.get("time") or "",
            "w": r.get("wiki") or page_id.partition("/")[0],
            "id": page_id,
            "s": slug_map.get(page_id, slugify(page_id)),
            "seq": r.get("seq"),
            "x": r.get("label"),
            "a": r.get("request_action"),
            "ip": r.get("ip16"),
            "l": r.get("body_len"),
            "_rev": r.get("rev_id", ""),
        }
        if r.get("partial"):
            row["partial"] = True
        rows.append(row)
    # Stable two-pass sort: deterministic tie-breakers first, then t desc.
    rows.sort(key=lambda row: (row["id"], row["seq"] if row["seq"] is not None else 0, row["_rev"]))
    rows.sort(key=lambda row: row["t"], reverse=True)
    for row in rows:
        row.pop("_rev")
    print(f"timeline: {len(rows)} revisions")
    meta = {
            "schema_version": 1,
            "export_generated_at": export_generated_at,
            "count": len(rows),
            "order": "time_desc",
    }
    supplement_count = sum(1 for r in revisions if r.get("partial"))
    if supplement_count:
        meta["supplement_count"] = supplement_count
    return {
        "meta": meta,
        "r": rows,
    }


def build_corpus_metadata(path: Path, revision_count: int) -> dict:
    """Hashes the tracked raw revisions dump published for client-side search."""
    compressed_hash = hashlib.sha256()
    decoded_hash = hashlib.sha256()
    compressed_bytes = 0
    decoded_bytes = 0
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            compressed_hash.update(chunk)
            compressed_bytes += len(chunk)
    with gzip.open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            decoded_hash.update(chunk)
            decoded_bytes += len(chunk)
    return {
        "path": "corpus/revisions.jsonl.gz",
        "sha256": compressed_hash.hexdigest(),
        "compressed_bytes": compressed_bytes,
        "decoded_sha256": decoded_hash.hexdigest(),
        "decoded_bytes": decoded_bytes,
        "revisions": revision_count,
    }


_TOKEN_GOLDEN_CASES = [
    {"text": "ab abc aaaaaaaaaaaaaaaaaaaaaaaaa  aaaaaaaaaaaaaaaaaaaaaaaaaa", "tokens": []},
    {"text": "UPPERCASE STATE5-ID agent.v2", "tokens": []},
    {"text": "123 123abc abc123", "tokens": []},
    {"text": "the und and bypass bypass", "tokens": []},
    {"text": "naive café Привет", "tokens": []},
    {"text": "", "tokens": []},
    {"text": "under_score __private__", "tokens": []},
]


def write_token_golden(path: Path | None = None) -> None:
    path = path or ROOT / "validation" / "token_golden.json"
    cases = [{"text": case["text"], "tokens": sorted(_body_tokens(case["text"]))} for case in _TOKEN_GOLDEN_CASES]
    payload = {
        "_meta": {
            "source": "build.py::_body_tokens",
            "regenerate": "python data/scripts/build.py --write-token-golden",
            "comment": "Any tokenizer change must regenerate this fixture in the same change.",
        },
        "cases": cases,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


# URL semantics are pinned by data/validation/url_golden.json.
def _domains(text: str) -> list[str]:
    domains = []
    for match in _URL_RE.findall(text or ""):
        try:
            parsed = urlparse(match.rstrip(".,;:!?)\"]"))
        except ValueError:
            continue
        domain = (parsed.hostname or "").lower()
        if domain.startswith("www."):
            domain = domain[4:]
        if domain:
            domains.append(domain)
    return domains


def build_search_index(pages: list[dict], revisions: list[dict], slug_map: dict[str, str], token_limit: int = 10000, slug_limit: int = 150) -> dict:
    """Builds a compact page-level index of titles, rare body terms, and URL domains."""
    name_pages: dict[str, set[str]] = defaultdict(set)
    body_pages: dict[str, set[str]] = defaultdict(set)
    url_pages: dict[str, set[str]] = defaultdict(set)
    for page in pages:
        page_id = page["page_id"]
        name = page.get("name", "") or page_id
        for token in _tokens(name):
            name_pages[token].add(page_id)
        if "zzz" in name.lower():
            name_pages["zzz"].add(page_id)
    for revision in revisions:
        page_id = revision["page_id"]
        for token in _body_tokens(revision.get("body", "")):
            body_pages[token].add(page_id)
        for domain in _domains(revision.get("body", "")):
            url_pages[domain].add(page_id)

    n_pages = len(pages)
    candidates = set(name_pages) | _REQUIRED_BODY_TOKENS.intersection(body_pages)
    candidates |= {token for token, ids in body_pages.items() if 200 * len(ids) <= n_pages}
    ranked = sorted(candidates, key=lambda token: (
        token not in _REQUIRED_SEARCH_TOKENS,
        -len(name_pages[token] | body_pages[token]),
        token,
    ))
    if len(ranked) > token_limit:
        print(f"WARNING: search index has {len(ranked)} tokens; capped at {token_limit}")
    tokens = {}
    capped_postings = 0
    for token in ranked[:token_limit]:
        ids = name_pages[token] | body_pages[token]
        slugs = sorted(slug_map.get(page_id, slugify(page_id)) for page_id in ids)
        if len(slugs) > slug_limit:
            capped_postings += 1
            slugs = slugs[:slug_limit]
        tokens[token] = slugs
    if capped_postings:
        print(f"WARNING: {capped_postings} search tokens exceeded {slug_limit} slugs and were truncated")
    return {
        "tokens": tokens,
        "urls": {domain: len(url_pages[domain]) for domain in sorted(url_pages)},
        "meta": {"built_from": "collusion.wiki export", "n_tokens": len(tokens)},
    }


def _printable_base64(value: str) -> bool:
    try:
        decoded = base64.b64decode(value, validate=False)
    except (ValueError, base64.binascii.Error):
        return False
    if not decoded:
        return False
    return sum(0x20 <= byte <= 0x7E for byte in decoded) / len(decoded) >= 0.8


def _entropy(value: str) -> float:
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def _host_matches(host: str, indicator: str) -> bool:
    """Exact host or subdomain match."""
    return host == indicator or host.endswith("." + indicator)


def _hosts_match(domains: list[str], hosts: tuple[str, ...]) -> bool:
    """Exact host or subdomain match for precomputed URL hosts."""
    return any(_host_matches(domain, indicator) for domain in domains for indicator in hosts)


def _flag_callback_hosts(body: str) -> bool:
    """Callback endpoints need the pinned path prefix: parse URLs and check host+path."""
    for match in _URL_RE.findall(body or ""):
        try:
            parsed = urlparse(match.rstrip(".,;:!?)\"]"))
        except ValueError:
            continue
        domain = (parsed.hostname or "").lower()
        if domain.startswith("www."):
            domain = domain[4:]
        if not domain:
            continue
        path = (parsed.path or "/")
        for indicator in _CALLBACK_HOSTS:
            base, _, prefix = indicator.partition("/")
            if not (domain == base or domain.endswith("." + base)):
                continue
            if base == "discord.com" and path.startswith("/" + prefix):
                return True
            if base == "hooks.slack.com" and path.startswith("/" + prefix):
                return True
            if base == "api.telegram.org" and re.search(r"^/(?:file/)?bot\d", path):
                return True
            if not prefix:
                return True
    return False


def _percent_decode_one(value: str) -> str:
    return re.sub(r"%([0-9a-f]{2})", lambda match: chr(int(match.group(1), 16)), value, flags=re.IGNORECASE)


def _nested_hosts(body: str) -> list[str]:
    """Hosts of every explicit URL exposed by one percent-decode of each raw URL.

    Decode depth is one and there is no recursion; a decoded wrapper may expose
    several URLs (its direct target plus targets in query parameters), and all of
    them are parsed. This stays a subset of the web mirror, which matches raw
    service-host text anywhere in the body.
    """
    hosts = []
    for match in _URL_RE.finditer(body or ""):
        decoded = _percent_decode_one(match.group(0))
        for url_match in re.finditer(r"https?://(?:(?!https?://)[^\s<>'\"])+", decoded, re.IGNORECASE):
            try:
                parsed = urlparse(url_match.group(0).rstrip(".,;:!?)\"]"))
            except ValueError:
                continue
            host = (parsed.hostname or "").lower()
            if host.startswith("www."):
                host = host[4:]
            if host:
                hosts.append(host)
    return hosts


def _valid_contextual_base64(value: str) -> bool:
    if len(value) < 8 or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", value) or len(value) % 4 == 1:
        return False
    try:
        decoded = base64.b64decode(value, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return False
    return bool(decoded) and all(char.isprintable() or char in "\r\n\t" for char in decoded)


def _flag_base64_carriers(body: str) -> bool:
    normalized = _percent_decode_one(body or "")
    for match in re.finditer(r"data:application/json;base64,([^\s<>'\"]+)", normalized, re.IGNORECASE):
        if _valid_contextual_base64(match.group(1)):
            return True
    for match in _URL_RE.finditer(body or ""):
        try:
            parsed = urlparse(match.group(0).rstrip(".,;:!?)\"]"))
        except ValueError:
            continue
        host = (parsed.hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        path_match = re.fullmatch(r"/base64/([^/]+)", parsed.path or "")
        if host == "httpbin.org" and path_match and _valid_contextual_base64(_percent_decode_one(path_match.group(1))):
            return True
    return False


def detect_payload_flags(body: str) -> set[str]:
    """Returns deterministic scanner flags for a single revision body."""
    flags = set()
    if any(_printable_base64(match) for match in _B64_RE.findall(body or "")):
        flags.add("b64")
    if _HEX_RE.search(body or ""):
        flags.add("hex")
    lowered = (body or "").lower()  # script/inject match against lowercase - mirror of web/src/utils/payload.ts
    if "<script" in lowered or "onerror=" in lowered or "javascript:" in lowered:
        flags.add("script")
    if any(marker in lowered for marker in ("ignore previous", "reproducible bypass")):
        flags.add("inject")
    if any(rx.search(body or "") for rx in _INJECT_RES):
        flags.add("inject")
    # homoglyph: words mixing latin and cyrillic are primary character-spoofing signals.
    # NFKC diff is only an amplifier (catches fullwidth/compat substitutions), not mandatory:
    # NFKC does not alter a Cyrillic character placed inside a Latin word.
    words = re.findall(r"[^\s]+", body or "")
    mixed = any(re.search(r"[A-Za-z]", word) and re.search(r"[\u0400-\u04ff]", word) for word in words)
    if mixed or (unicodedata.normalize("NFKC", body or "") != (body or "") and mixed):
        flags.add("homoglyph")
    if any(len(chunk) >= 200 and _entropy(chunk) > 4.5 for chunk in _NONSPACE_RE.findall(body or "")):
        flags.add("high-entropy")
    domains = _domains(body or "")
    nested_domains = domains + _nested_hosts(body or "")
    if _hosts_match(nested_domains, _TUNNEL_HOSTS):
        flags.add("tunnel")
    if _hosts_match(nested_domains, _READER_HOSTS):
        flags.add("redirect")
    if _hosts_match(domains, _CORS_PROXY_HOSTS):
        flags.add("proxy")
    if _flag_callback_hosts(body or ""):
        flags.add("callback")
    if _hosts_match(domains, _BEACON_HOSTS):
        flags.add("beacon")
    if any(rx.search(body or "") for rx in _EXEC_RES):
        flags.add("exec")
    if any(rx.search(body or "") for rx in _ATOB_RES):
        flags.add("b64")
    if _flag_base64_carriers(body or ""):
        flags.add("b64")
    if _DATA_URI_RE.search(_percent_decode_one(body or "")):
        flags.add("data-uri")
    if _TRAVERSAL_RE.search(body or ""):
        flags.add("traversal")
    return flags


def build_payload_index(pages: list[dict], revisions: list[dict], slug_map: dict[str, str]) -> list[dict]:
    """Builds payload flags and URL domains across all revisions."""
    by_page: dict[str, list[dict]] = defaultdict(list)
    for revision in revisions:
        by_page[revision["page_id"]].append(revision)
    result = []
    for page in pages:
        page_id = page["page_id"]
        ordered = sorted(by_page.get(page_id, []), key=revision_sort_key)
        all_flags = set().union(*(detect_payload_flags(r.get("body", "")) for r in ordered))
        if "high-entropy" in all_flags and len(all_flags) == 1:
            all_flags.remove("high-entropy")
        if not all_flags:
            continue
        domain_counts = Counter()
        for revision in ordered:
            domain_counts.update(_domains(revision.get("body", "")))
        domains = [domain for domain, _ in sorted(domain_counts.items(), key=lambda item: (-item[1], item[0]))]
        result.append({"s": slug_map.get(page_id, slugify(page_id)), "id": page_id, "u": domains,
                       "f": [flag for flag in PAYLOAD_FLAGS if flag in all_flags]})
    return sorted(result, key=lambda item: item["s"])


def revision_sort_key(revision: dict):
    return (revision.get("seq") if revision.get("seq") is not None else 0, revision.get("rev_id", ""))


def build_agent_links(labels: list[dict], top_n: int = 20, min_shared: int = 2) -> dict[str, list[dict[str, int | str]]]:
    """Build deterministic, capped co-occurrence links from label page sets."""
    pages_by_label = {
        lab["label"]: set(lab.get("pages", []))
        for lab in labels
        if lab.get("label")
    }
    labels_by_page: dict[str, list[str]] = defaultdict(list)
    for label, page_ids in pages_by_label.items():
        for page_id in page_ids:
            labels_by_page[page_id].append(label)

    shared: dict[str, Counter[str]] = {label: Counter() for label in pages_by_label}
    for page_labels in labels_by_page.values():
        page_labels.sort()
        for index, label in enumerate(page_labels):
            for other in page_labels[index + 1:]:
                shared[label][other] += 1
                shared[other][label] += 1

    return {
        label: [
            {"o": other, "c": count}
            for other, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
            if count >= min_shared
        ][:top_n]
        for label, counts in sorted(shared.items())
    }


def build_label_ip16_index(revisions: list[dict]) -> dict:
    """Groups labeled canonical revisions by their observed /16 prefix.

    Anonymous rows, recovered rows, and malformed ip16 values are skipped;
    weights are labeled revision counts per prefix, so the agents view can
    slice its label index by a prefix substring.
    """
    weights: dict[str, Counter] = defaultdict(Counter)
    wikis: dict[str, set[str]] = defaultdict(set)
    first: dict[str, str] = {}
    last: dict[str, str] = {}

    for revision in revisions:
        prefix = accepted_prefix(revision.get("ip16"))
        label = revision.get("label")
        if not prefix or not label:
            continue
        weights[prefix][str(label)] += 1
        wikis[prefix].add(revision.get("wiki") or revision["page_id"].partition("/")[0])
        when = revision.get("write_date") or revision.get("time") or ""
        if when:
            if prefix not in first or when < first[prefix]:
                first[prefix] = when
            if prefix not in last or when > last[prefix]:
                last[prefix] = when

    prefixes = {}
    for prefix in sorted(weights):
        labels = sorted(weights[prefix].items(), key=lambda item: (-item[1], item[0]))
        prefixes[prefix] = {
            "r": sum(weights[prefix].values()),
            "l": [[label, count] for label, count in labels],
            "w": sorted(wikis[prefix]),
            "f": first.get(prefix, ""),
            "t": last.get(prefix, ""),
        }

    return {"meta": {"schema_version": 1, "prefixes": len(prefixes)}, "prefixes": prefixes}


def verify_label_ip16_totals(revisions: list[dict], labels: list[dict], label_ip16_index: dict) -> None:
    """Fails the build before any output write when label counts would disagree.

    labels.json comes from labels.jsonl.gz while the ip16 index counts labeled
    rows in revisions.jsonl.gz, and the agents view renders both on one page.
    An input divergence and a labeled revision that cannot be placed on any
    accepted prefix are reported separately so the failure names the real cause.
    Counts are compared over the union of label keys with absence treated as
    zero, so a declared label without revisions is not a mismatch.
    """
    labeled: dict[str, int] = defaultdict(int)
    for revision in revisions:
        label = revision.get("label")
        if label:
            labeled[str(label)] += 1
    weights: dict[str, int] = defaultdict(int)
    for record in label_ip16_index["prefixes"].values():
        for label, count in record["l"]:
            weights[label] += count

    declared: dict[str, int] = {}
    seen_labels: set[str] = set()
    for row in labels:
        label = row.get("label")
        if not label:
            continue
        if label in seen_labels:
            raise RuntimeError(f"duplicate label row for {label!r} in labels.jsonl.gz")
        seen_labels.add(label)
        declared[label] = row["stored_revisions"]

    def count_diff(expected: dict[str, int], actual: dict[str, int]) -> str:
        keys = set(expected) | set(actual)
        mismatched = sorted(label for label in keys if expected.get(label, 0) != actual.get(label, 0))[:5]
        return f"(label, declared_rows, indexed_rows)={[(label, expected.get(label, 0), actual.get(label, 0)) for label in mismatched]}"

    if dict(labeled) != {label: count for label, count in declared.items() if count}:
        raise RuntimeError(
            "labels.jsonl.gz and revisions.jsonl.gz disagree on per-label revision counts "
            + count_diff(declared, dict(labeled))
        )
    if dict(weights) != dict(labeled):
        raise RuntimeError(
            "labeled revisions without an accepted ip16 cannot be indexed "
            + count_diff(dict(labeled), dict(weights))
        )


def _parse_revision_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _median_cross_label_ttd(revisions: list[dict]) -> int | None:
    ttd_seconds = []
    ordered = sorted(revisions, key=revision_sort_key)
    for previous, current in zip(ordered, ordered[1:]):
        if not previous.get("label") or not current.get("label") or previous["label"] == current["label"]:
            continue
        previous_time = _parse_revision_time(previous.get("write_date") or previous.get("time"))
        current_time = _parse_revision_time(current.get("write_date") or current.get("time"))
        if previous_time is not None and current_time is not None:
            ttd_seconds.append((current_time - previous_time).total_seconds())
    return round(median(ttd_seconds)) if ttd_seconds else None


def build_conflicts(
    pages: list[dict],
    revisions: list[dict],
    slug_map: dict[str, str],
    front_page_ids: set[str] | None = None,
) -> list[dict]:
    """Rank pages by distinct non-anonymous labels and cross-label revision churn."""
    revisions_by_page: dict[str, list[dict]] = defaultdict(list)
    for revision in revisions:
        revisions_by_page[revision["page_id"]].append(revision)

    page_ids = {page["page_id"] for page in pages}
    configured_front_ids = front_page_ids if front_page_ids is not None else {"dse/StartSeite", "dse/WillkommenImWiki"}
    use_front_name_fallback = not configured_front_ids.intersection(page_ids)
    conflicts = []
    for page in pages:
        page_id = page["page_id"]
        page_revisions = revisions_by_page.get(page_id, [])
        labels = {revision.get("label") for revision in page_revisions if revision.get("label")}
        name = page.get("name", "") or page_id
        front = bool(re.search(r"StartSeite|Willkommen", name)) if use_front_name_fallback else page_id in configured_front_ids
        conflicts.append({
            "id": page_id,
            "s": slug_map.get(page_id, slugify(page_id)),
            "churn": len(labels),
            "ttd_med_s": _median_cross_label_ttd(page_revisions),
            "del": page.get("n_deletions", 0),
            "zzz": "zzz" in name.lower(),
            "front": front,
        })
    conflicts.sort(key=lambda item: (-item["churn"], -item["del"]))
    return conflicts


def main() -> int:
    if "--write-token-golden" in sys.argv[1:]:
        write_token_golden()
        return 0
    revisions = list(read_jsonl(RAW / "revisions.jsonl.gz"))
    pages = list(read_jsonl(RAW / "pages.jsonl.gz"))
    events = list(read_jsonl(RAW / "events.jsonl.gz"))
    labels = list(read_jsonl(RAW / "labels.jsonl.gz"))
    manifest = read_json(RAW / "manifest.json.gz")

    supplement_pages, supplement_revisions = read_supplement(RAW / "other-wikis.json.gz")
    canonical_page_ids = {page["page_id"] for page in pages}
    overlap = canonical_page_ids.intersection(page["page_id"] for page in supplement_pages)
    if overlap:
        page_id = sorted(overlap)[0]
        raise RuntimeError(
            f"supplement page_id overlap: {page_id}; reconcile the supplement before merging"
        )
    canonical_wikis = {page.get("wiki") for page in pages}
    supplement_wikis = {page.get("wiki") for page in supplement_pages}
    wiki_overlap = canonical_wikis.intersection(supplement_wikis)
    if wiki_overlap:
        print(f"WARNING: supplement wiki overlap without page overlap: {', '.join(sorted(wiki_overlap))}")
    all_pages = pages + sorted(supplement_pages, key=lambda page: page["page_id"])
    all_revisions = revisions + supplement_revisions

    # Validated before any output write: a failed build must not leave processed/ half updated.
    label_ip16_index = build_label_ip16_index(revisions)
    verify_label_ip16_totals(revisions, labels, label_ip16_index)

    _, slug_map = build_revision_files(all_revisions)

    # --- activity by day and hour from events ---
    day: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"saves": 0, "deletes": 0, "reverts": 0, "probes": 0, "bytes": 0}
    )
    hour = Counter()
    hour_recovered = Counter()
    by_type: Counter[str] = Counter()

    for e in events:
        etype = e.get("event_type")
        wiki = e.get("wiki") or (e.get("page_id") or "").partition("/")[0]
        day_key = (e.get("time", "")[:10], wiki)
        if etype in EVENT_TYPES:
            by_type[etype] += 1
            if etype == "save":
                day[day_key]["saves"] += 1
                hour[e.get("time", "")[11:13] or "?"] += 1
            elif etype == "delete":
                day[day_key]["deletes"] += 1
            elif etype == "revert":
                day[day_key]["reverts"] += 1
            elif etype == "probe":
                day[day_key]["probes"] += 1

    for r in revisions:
        d = (r.get("write_date") or r.get("time") or "")[:10]
        if d:
            day[(d, r.get("wiki", ""))]["bytes"] += r.get("body_len") or 0

    for r in supplement_revisions:
        d = (r.get("time") or "")[:10]
        wiki = r.get("wiki", "")
        if d:
            day[(d, wiki)]["saves"] += 1
            day[(d, wiki)]["rec"] = day[(d, wiki)].get("rec", 0) + 1
        hour_key = (r.get("time") or "")[11:13] or "?"
        hour[hour_key] += 1
        hour_recovered[hour_key] += 1

    activity_by_day = [
        {"date": date, "wiki": wiki, **counts}
        for (date, wiki), counts in sorted(day.items())
    ]
    activity_by_hour = []
    for h in sorted(hour, key=lambda x: (x == "?", x)):
        entry = {"hour": h, "saves": hour[h]}
        if hour_recovered[h]:
            entry["rec"] = hour_recovered[h]
        activity_by_hour.append(entry)

    # --- page index (compact keys) ---
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
            **({"partial": True} if p.get("partial") else {}),
        } for p in all_pages],
        "order": "last_write desc",
    }

    # --- agent label index ---
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

    # --- recent events ---
    recent = []
    for e in events:
        if e.get("event_type") not in EVENT_TYPES:
            continue
        entry = {
            "t": e.get("time"),
            "type": e.get("event_type"),
            "wiki": e.get("wiki") or "",
            "page": e.get("page") or "",
            "action": e.get("request_action"),
            "ip16": e.get("ip16"),
        }
        for key, value in (
            ("rev", e.get("revision_ref")),
            ("pf", e.get("param_family")),
            ("ok", e.get("success_observed")),
            ("rel", e.get("related_event_id")),
            ("act", e.get("actor_label")),
        ):
            if value is not None:
                entry[key] = value
        recent.append(entry)
    for r in supplement_revisions:
        recent.append({
            "t": r.get("time"), "type": "save", "wiki": r.get("wiki", ""),
            "page": r.get("page_id", "").partition("/")[2], "ip16": r.get("ip16"),
            "partial": True,
        })
    recent.sort(key=lambda e: e["t"] or "", reverse=True)
    recent_events = recent

    agent_links = build_agent_links(labels)
    conflicts = build_conflicts(pages, revisions, slug_map)
    search_index = build_search_index(all_pages, revisions, slug_map)
    payload_index = build_payload_index(pages, revisions, slug_map)
    fts_index = build_fts_index(pages, revisions)

    # --- summary ---
    n_revs_total = len(revisions)
    timeline = build_timeline(all_revisions, slug_map, manifest.get("generated_at"))
    corpus_metadata = build_corpus_metadata(RAW / "revisions.jsonl.gz", n_revs_total)
    supplement_metadata = None
    supplement_path = RAW / "other-wikis.json.gz"
    if supplement_pages:
        per_wiki = {}
        for page in supplement_pages:
            item = per_wiki.setdefault(page["wiki"], {"pages": 0, "revisions": 0})
            item["pages"] += 1
            item["revisions"] += page["n_revs"]
        raw_bytes = supplement_path.read_bytes()
        supplement_metadata = {
            "source": "https://collusion.wiki/explorer/download/other-wikis.json.gz",
            "recovered": "2026-09-07",
            "sha256": hashlib.sha256(raw_bytes).hexdigest(),
            "bytes": len(raw_bytes),
            "counts": {"pages": len(supplement_pages), "revisions": len(supplement_revisions)},
            "per_wiki": per_wiki,
        }
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
        "corpus": corpus_metadata,
    }
    if supplement_metadata:
        summary["supplement"] = supplement_metadata
        summary["combined"] = {"revisions": len(all_revisions), "pages": len(all_pages)}

    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in [
        ("summary.json", summary),
        ("activity_by_day.json", activity_by_day),
        ("activity_by_hour.json", activity_by_hour),
        ("pages.json", pages_index),
        ("labels.json", labels_index),
        ("labels_ip16.json", label_ip16_index),
        ("recent_events.json", recent_events),
        ("events_head.json", recent_events[:EVENTS_HEAD_LIMIT]),
        ("timeline.json", timeline),
        ("agent_links.json", agent_links),
        ("conflicts.json", conflicts),
        ("search_index.json", search_index),
        ("payload_index.json", payload_index),
        ("fts_index.json", fts_index),
    ]:
        output_path = OUT / name
        output_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"wrote processed/{name}")
        if name in {"search_index.json", "payload_index.json"}:
            size = output_path.stat().st_size
            print(f"processed/{name}: {size} bytes")
            if size >= 2 * 1024 * 1024:
                print(f"WARNING: processed/{name} exceeds 2 MiB budget ({size} bytes)")

    # --- sync to web/public/data ---
    if PUBLIC != OUT:
        PUBLIC.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(PUBLIC, ignore_errors=True)
        shutil.copytree(OUT, PUBLIC)
        corpus_dir = PUBLIC / "corpus"
        corpus_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(RAW / "revisions.jsonl.gz", corpus_dir / "revisions.jsonl.gz")
        supplement_source = RAW / "other-wikis.json.gz"
        if supplement_metadata:
            shutil.copyfile(supplement_source, PUBLIC / supplement_source.name)
        print(f"synced {OUT} -> {PUBLIC} (+ raw corpus gzip)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
