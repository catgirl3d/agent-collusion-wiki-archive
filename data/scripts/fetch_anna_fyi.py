import json
import re
import sys
import time
import html
import pathlib
import urllib.request

BASE = "https://anna.fyi"
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
RAW = OUT / "raw"
RAW.mkdir(parents=True, exist_ok=True)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) research-capture/1.0"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


row_re = re.compile(
    r'<td class="first"><a href="https://anna\.fyi/view/([0-9a-f]+)">(.*?)</a></td>\s*'
    r'<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>',
    re.S,
)

rows = []
for off in range(0, 300, 15):
    page = get(f"{BASE}/lists/{off}").decode("utf-8", "replace")
    found = row_re.findall(page)
    if not found:
        print(f"offset {off}: empty, stop")
        break
    for h, t, a, l, w in found:
        rows.append({
            "hash": h,
            "title": html.unescape(t),
            "author": html.unescape(a),
            "language": l,
            "when": w,
            "list_offset": off,
        })
    print(f"offset {off}: {len(found)} rows")
    time.sleep(0.3)

seen = {}
for r in rows:
    seen.setdefault(r["hash"], r)

downloaded = 0
failed = []
for h in seen:
    p = RAW / f"{h}.txt"
    if p.exists():
        continue
    try:
        body = get(f"{BASE}/view/raw/{h}")
        p.write_bytes(body)
        downloaded += 1
        time.sleep(0.3)
    except Exception as e:
        failed.append({"hash": h, "error": str(e)})
        print(f"FAIL {h}: {e}")

recs = []
for h, r in seen.items():
    p = RAW / f"{h}.txt"
    r["raw_bytes"] = p.stat().st_size if p.exists() else None
    recs.append(r)

with open(OUT / "listing.jsonl", "w", encoding="utf-8") as f:
    for r in recs:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

if failed:
    with open(OUT / "failures.json", "w", encoding="utf-8") as f:
        json.dump(failed, f, ensure_ascii=False, indent=2)

print(f"done: {len(rows)} listing rows, {len(seen)} unique pastes, {downloaded} downloaded, {len(failed)} failed")
