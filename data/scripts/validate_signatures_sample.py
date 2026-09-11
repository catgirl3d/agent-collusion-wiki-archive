#!/usr/bin/env python3
"""Create and compare a deterministic blind validation sample.

Without --compare this reads processed revisions and writes the annotator sample
plus the separate strata manifest (the answer key). With --compare it only scores
an already annotated JSON list and writes nothing. It never writes build outputs
or changes archive data.
"""
import argparse, json, random, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build import detect_payload_flags

SEED = 1788719711256
STRATIFIED_TARGET = 150
SIMPLE_RANDOM_TARGET = 50
STRATA_QUOTAS = (("tunnel", 9), ("redirect", 20), ("inject", 20), ("overwrite", 20), ("genesis", 20), ("truncated", 20))

def events(root):
    rows = []
    for path in sorted((root / "data/processed/revisions").glob("*.json")):
        revisions = json.loads(path.read_text(encoding="utf-8"))
        first_seq = revisions[0].get("seq") if revisions else None
        for i, revision in enumerate(revisions):
            if i == 0: continue
            prior = revisions[i - 1]
            if revision.get("label") and revision.get("label") != prior.get("label"):
                body = revision.get("body") or ""
                prior_body = prior.get("body") or ""
                flags = detect_payload_flags(body)
                rows.append({"page": path.stem, "rev_index": i, "before": prior_body, "after": body, "seq": revision.get("seq"), "tunnel": "tunnel" in flags, "redirect": "redirect" in flags, "inject": "inject" in flags, "overwrite": bool(prior_body) and len(body) < len(prior_body) * .5, "genesis": first_seq == 1, "truncated": first_seq != 1})
    return rows

# Genesis/truncated are page-wide and hold for every row, so they cannot define a meaningful
# top-up pool; they stay as quota buckets only.
POOL_STRATA = ("tunnel", "redirect", "inject", "overwrite")

def _in_strata(row):
    return any(row.get(name) for name in POOL_STRATA)

def _take(bucket, quota, chosen, seen, subset):
    picked = 0
    for row in bucket:
        if picked >= quota: break
        key = (row["page"], row["rev_index"])
        if key not in seen:
            seen.add(key); chosen.append({**row, "subset": subset}); picked += 1

def draw_sample(rows):
    rng = random.Random(SEED)
    quota_buckets = []
    for name, quota in STRATA_QUOTAS:
        bucket = [row for row in rows if row.get(name)]
        rng.shuffle(bucket)
        quota_buckets.append((bucket, quota))
    pool = [row for row in rows if _in_strata(row)]
    rng.shuffle(pool)
    chosen = []
    seen = set()
    for bucket, quota in quota_buckets:
        _take(bucket, quota, chosen, seen, "stratified")
    _take(pool, STRATIFIED_TARGET - len(chosen), chosen, seen, "stratified")
    shuffled_rows = list(rows)
    rng.shuffle(shuffled_rows)
    # Fallback top-up: keep the stratified target when the flag/overwrite pool is too small.
    # Rows added here are explicitly labeled as fallback filler, not as stratified picks.
    _take(shuffled_rows, STRATIFIED_TARGET - len(chosen), chosen, seen, "fallback")
    random_picked = 0
    for row in shuffled_rows:
        if random_picked >= SIMPLE_RANDOM_TARGET: break
        key = (row["page"], row["rev_index"])
        if key not in seen:
            seen.add(key); chosen.append({**row, "subset": "random"}); random_picked += 1
    random.Random(SEED + 1).shuffle(chosen)
    return chosen


def _event_id(row):
    return f"{row['page']}:{row['rev_index']}"


def annotator_events(chosen):
    """Projects sampled rows to the blind annotator view; no extractor or stratum fields."""
    return [{"id": _event_id(row), "page": row["page"], "rev_index": row["rev_index"],
             "seq": row["seq"], "before": row["before"], "after": row["after"]} for row in chosen]


def strata_manifest(chosen):
    """Answer key for per-stratum reporting; never handed to annotators."""
    return [{"id": _event_id(row), "page": row["page"], "rev_index": row["rev_index"],
             "strata": [name for name, _ in STRATA_QUOTAS if row.get(name)],
             "subset": row["subset"]} for row in chosen]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--sample", type=Path, default=Path("signature_sample.json"))
    parser.add_argument("--strata", type=Path, default=Path("signature_sample.strata.json"))
    parser.add_argument("--compare", type=Path)
    args = parser.parse_args()
    if args.compare:
        labels = json.loads(args.compare.read_text(encoding="utf-8"))
        if not isinstance(labels, list) or not all(isinstance(row, dict) for row in labels):
            sys.exit("--compare expects a JSON list of annotation objects with human_artifacts/detected_artifacts")
        if not labels:
            sys.exit("--compare got an empty annotation list")
        tp = fp = fn = false_events = 0
        for row in labels:
            for field in ("human_artifacts", "detected_artifacts"):
                value = row.get(field, [])
                if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                    sys.exit(f"--compare: {field} must be a list of strings")
            expected = set(row["human_artifacts"]) if "human_artifacts" in row else set()
            detected = set(row["detected_artifacts"]) if "detected_artifacts" in row else set()
            tp += len(expected & detected); fp += len(detected - expected); fn += len(expected - detected)
            false_events += bool(detected - expected)
        denominator = len(labels)
        print(f"precision=TP/(TP+FP)={tp/(tp+fp):.4f}" if tp + fp else "precision=undefined (no detections)")
        print(f"recall=TP/(TP+FN)={tp/(tp+fn):.4f}" if tp + fn else "recall=undefined (no human artifacts)")
        print(f"event_false_detection_rate={false_events}/{denominator} (sampled events with at least one false artifact / labeled events)")
        return
    rows = events(args.root)
    chosen = draw_sample(rows)
    for path in (args.sample, args.strata):
        path.parent.mkdir(parents=True, exist_ok=True)
    protocol = "Blind BEFORE/AFTER labeling; raw payload texts included; no extractor or stratum output"
    args.sample.write_text(json.dumps({"protocol": protocol, "events": annotator_events(chosen)}, indent=2) + "\n", encoding="utf-8")
    args.strata.write_text(json.dumps({"seed": SEED, "stratified_target": STRATIFIED_TARGET, "simple_random_target": SIMPLE_RANDOM_TARGET, "strata_quotas": {name: quota for name, quota in STRATA_QUOTAS}, "events": strata_manifest(chosen)}, indent=2) + "\n", encoding="utf-8")
    if len(chosen) < STRATIFIED_TARGET + SIMPLE_RANDOM_TARGET:
        print(f"WARNING: corpus yielded only {len(chosen)} events (target {STRATIFIED_TARGET + SIMPLE_RANDOM_TARGET})", file=sys.stderr)

if __name__ == "__main__": main()
