from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import export_anna_fyi_snapshot as exporter  # noqa: E402
from export_anna_fyi_snapshot import _load_selection, _private_universe_digest, export_snapshot  # noqa: E402


PRIVATE_ROOT = Path("E:/git/agent-collusion-wiki-archive/data/external/anna-fyi-full-private")
FROZEN_RUN = PRIVATE_ROOT / "runs/provisional-20260912T230949Z-004252d8"
PRIVATE_LISTING = PRIVATE_ROOT / "listing.jsonl"
PUBLIC_SELECTION = PRIVATE_ROOT / "pins/public-selection.json"
PUBLIC_TIMES = PRIVATE_ROOT / "times/published-times.json"
IMPORT_LOCK = PRIVATE_ROOT / "pins/provisional-20260912T230949Z-004252d8.import-lock.json"
PRIVATE_INPUTS_AVAILABLE = FROZEN_RUN.is_dir() and PRIVATE_LISTING.is_file() and PUBLIC_SELECTION.is_file() and IMPORT_LOCK.is_file()


PUBLIC_ID = "aaaaaaaa"
PRIVATE_ID = "bbbbbbbb"
PHP_BANNER = b"""
<div style="border:1px solid #990000;padding-left:20px;margin:0 0 10px 0;">
<h4>A PHP Error was encountered</h4>
<p>Severity: 8192</p>
<p>Message:  Function create_function() is deprecated</p>
<p>Filename: geshi/geshi.php</p>
<p>Line Number: 4698</p>
</div>"""


class ExportSnapshotTests(unittest.TestCase):
    def validate_fixture(self, run: Path, root: Path):
        lock = json.loads((root / "import-lock.json").read_text(encoding="utf-8"))
        lock["run_json_sha256"] = hashlib.sha256((run / "run.json").read_bytes()).hexdigest()
        lock["exchanges_jsonl_sha256"] = hashlib.sha256((run / "exchanges.jsonl").read_bytes()).hexdigest()
        lock["checksums_sha256"] = hashlib.sha256((run / "checksums.sha256").read_bytes()).hexdigest()
        lock["private_listing_sha256"] = hashlib.sha256((root / "listing.jsonl").read_bytes()).hexdigest()
        ids = sorted(json.loads(line)["hash"] for line in (root / "listing.jsonl").read_text(encoding="utf-8").splitlines())
        lock["private_universe_id_sha256"] = hashlib.sha256("".join(f"{paste_id}\n" for paste_id in ids).encode()).hexdigest()
        (root / "import-lock.json").write_text(json.dumps(lock, sort_keys=True), encoding="utf-8", newline="\n")
        with patch.object(exporter, "TRUSTED_IMPORT_LOCK", lock), patch.object(exporter, "PINNED_RUN_ID", lock["run_id"]), patch.object(exporter, "PINNED_PRIVATE_UNIVERSE_COUNT", 2), patch.object(exporter, "EXPECTED_ROLE_COUNTS", {"list": 1, "raw": 2, "view": 2}), patch.object(exporter, "EXPECTED_TOTAL_EXCHANGES", 5), patch.object(exporter, "EXPECTED_LIST_OFFSETS", (0,)):
            return exporter.import_provisional_run(run, root / "listing.jsonl", root / "import-lock.json")

    def test_importer_has_no_caller_overridable_counts_or_lock_object(self):
        parameters = __import__("inspect").signature(exporter.import_provisional_run).parameters
        self.assertEqual(tuple(parameters), ("run_dir", "private_listing_path", "import_lock_path"))

    def test_imported_run_does_not_expose_mutable_mappings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, _ = self.make_fixture(root)
            imported = self.validate_fixture(run, root)
            with self.assertRaises(TypeError):
                imported.run["status"] = "FAILED"
            with self.assertRaises(TypeError):
                imported.exchanges[0]["status"] = 500

    def test_importer_rejects_forged_lock_even_when_file_hashes_are_rewritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, _ = self.make_fixture(root)
            lock_path = root / "import-lock.json"
            trusted = json.loads(lock_path.read_text(encoding="utf-8"))
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            lock["run_id"] = "forged"
            lock_path.write_text(json.dumps(lock), encoding="utf-8", newline="\n")
            with patch.object(exporter, "TRUSTED_IMPORT_LOCK", trusted):
                with self.assertRaisesRegex(ValueError, "import lock constant mismatch"):
                    exporter.import_provisional_run(run, root / "listing.jsonl", lock_path)

    def test_provisional_rows_reject_all_non_schema_mutations(self):
        mutations = {
            "status": lambda row: row.update(status=True),
            "error": lambda row: row.update(error="failed"),
            "attempt": lambda row: row.update(attempt=True),
            "timestamp": lambda row: row.update(started_at="not-a-timestamp"),
            "headers": lambda row: row.update(request_headers=["bad"]),
            "list_offset": lambda row: row.update(list_offset=None),
            "method": lambda row: row.update(method="POST"),
            "body_path": lambda row: row.update(body_path="source/nested/ex-000002.body"),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, _ = self.make_fixture(root)
            rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
            for name, mutate in mutations.items():
                with self.subTest(name=name):
                    index = 0 if name == "list_offset" else 1
                    candidate = dict(rows[index])
                    mutate(candidate)
                    with self.assertRaises(ValueError):
                        exporter._validate_provisional_row(candidate, index + 1)

    def test_importer_rejects_raw_and_view_ids_outside_private_universe(self):
        for role, row_index, url in (("raw", 1, "https://anna.fyi/view/raw/cccccccc"), ("view", 3, "https://anna.fyi/view/cccccccc")):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run, _ = self.make_fixture(root)
                rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
                rows[row_index]["paste_id"] = "cccccccc"
                rows[row_index]["url"] = rows[row_index]["final_url"] = url
                (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
                with self.assertRaisesRegex(ValueError, "closure"):
                    self.validate_fixture(run, root)

    def test_importer_rejects_exchange_order_and_raw_view_list_offsets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, _ = self.make_fixture(root)
            rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
            rows[1]["list_offset"] = 0
            (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
            with self.assertRaises(ValueError):
                self.validate_fixture(run, root)
            rows[1]["list_offset"] = None
            rows[1], rows[2] = rows[2], rows[1]
            (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
            with self.assertRaisesRegex(ValueError, "line order"):
                self.validate_fixture(run, root)

    def test_importer_rejects_view_exchange_with_non_null_list_offset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, _ = self.make_fixture(root)
            rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
            rows[3]["list_offset"] = 0
            (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
            with self.assertRaisesRegex(ValueError, "invalid raw/view paste ID"):
                self.validate_fixture(run, root)

    def test_importer_rejects_body_byte_count_types_and_malformed_response_headers(self):
        for value in (True, "12"):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run, _ = self.make_fixture(root)
                rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
                rows[1]["body_bytes"] = value
                (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
                with self.assertRaises(ValueError):
                    self.validate_fixture(run, root)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, _ = self.make_fixture(root)
            rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
            rows[1]["response_headers"] = ["bad"]
            (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
            with self.assertRaises(ValueError):
                self.validate_fixture(run, root)

    def test_importer_boundary_rejects_exchange_field_mutations(self):
        mutations = {
            "status": lambda row: row.update(status=True),
            "error": lambda row: row.update(error="failed"),
            "attempt": lambda row: row.update(attempt=True),
            "timestamp": lambda row: row.update(started_at="not-a-timestamp"),
            "request_headers": lambda row: row.update(request_headers=["bad"]),
            "response_headers": lambda row: row.update(response_headers=["bad"]),
            "method": lambda row: row.update(method="POST"),
            "body_path": lambda row: row.update(body_path="source/nested/ex-000002.body"),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run, _ = self.make_fixture(root)
                rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
                mutate(rows[1])
                (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
                with self.assertRaisesRegex(ValueError, "(unsuccessful|attempt|timestamp|headers|method|body path)"):
                    self.validate_fixture(run, root)

    def test_importer_boundary_rejects_boolean_list_offset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, _ = self.make_fixture(root)
            rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
            rows[0]["list_offset"] = False
            (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
            with self.assertRaisesRegex(ValueError, "list exchange"):
                self.validate_fixture(run, root)

    def test_importer_rejects_non_pinned_run_counters_and_unordered_timestamps(self):
        for mutation in ("stable_inventory_seed", "target_records", "reversed", "equal"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run, _ = self.make_fixture(root)
                manifest = json.loads((run / "run.json").read_text(encoding="utf-8"))
                if mutation in ("stable_inventory_seed", "target_records"):
                    manifest[mutation] = 1
                else:
                    manifest["started_at"] = "2026-09-12T23:01:00.000Z"
                    if mutation == "equal":
                        manifest["ended_at"] = manifest["started_at"]
                (run / "run.json").write_text(json.dumps(manifest), encoding="utf-8", newline="\n")
                with self.assertRaises(ValueError):
                    self.validate_fixture(run, root)

    def test_importer_rejects_checksum_manifest_missing_extra_and_duplicate_rows(self):
        for mode in ("missing", "extra", "duplicate"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run, _ = self.make_fixture(root)
                lines = (run / "checksums.sha256").read_text(encoding="ascii").splitlines()
                if mode == "missing":
                    lines.pop()
                elif mode == "extra":
                    lines.append("0" * 64 + "  source/orphan.body")
                else:
                    lines.append(lines[0])
                (run / "checksums.sha256").write_text("\n".join(lines) + "\n", encoding="ascii", newline="\n")
                with self.assertRaises(ValueError):
                    self.validate_fixture(run, root)

    def test_provisional_validator_rejects_unknown_actual_role(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, _ = self.make_fixture(root)
            rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
            rows[0]["role"] = "other"
            (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
            with self.assertRaisesRegex(ValueError, "unknown exchange role"):
                self.validate_fixture(run, root)

    def test_provisional_validator_rejects_role_url_and_id_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, _ = self.make_fixture(root)
            rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
            rows[1]["url"] = f"https://anna.fyi/view/raw/{PRIVATE_ID}"
            rows[1]["final_url"] = rows[1]["url"]
            (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
            with self.assertRaisesRegex(ValueError, "canonical raw URL mismatch"):
                self.validate_fixture(run, root)

    def test_provisional_validator_rejects_source_file_closure_errors(self):
        for mode in ("missing", "extra"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run, _ = self.make_fixture(root)
                if mode == "missing":
                    (run / "source/ex-000005.body").unlink()
                else:
                    (run / "source/orphan.body").write_bytes(b"orphan")
                with self.assertRaisesRegex(ValueError, "(source body|source body closure)"):
                    self.validate_fixture(run, root)

    def test_provisional_validator_rejects_duplicate_exchange_or_body_identity(self):
        for mode in ("exchange", "body"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run, _ = self.make_fixture(root)
                rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
                rows[1]["exchange_id"] = rows[0]["exchange_id"] if mode == "exchange" else rows[1]["exchange_id"]
                if mode == "body":
                    rows[1]["body_path"] = rows[0]["body_path"]
                (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
                with self.assertRaisesRegex(ValueError, "(duplicate or|line order|body path)"):
                    self.validate_fixture(run, root)

    def test_provisional_validator_rejects_summary_count_and_list_offset_mismatch(self):
        for mode in ("count", "offset"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run, _ = self.make_fixture(root)
                if mode == "count":
                    manifest = json.loads((run / "run.json").read_text(encoding="utf-8"))
                    manifest["successes"]["raw"] = 1
                    (run / "run.json").write_text(json.dumps(manifest), encoding="utf-8", newline="\n")
                else:
                    rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
                    rows[0]["list_offset"] = 15
                    rows[0]["url"] = rows[0]["final_url"] = "https://anna.fyi/lists/15"
                    (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
                with self.assertRaisesRegex(ValueError, "(disagree|offset|invalid list exchange)"):
                    self.validate_fixture(run, root)

    def test_provisional_validator_rejects_body_metadata_or_checksum_disagreement(self):
        for mode in ("metadata", "checksum"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run, _ = self.make_fixture(root)
                body_path = run / "source/ex-000002.body"
                body_path.write_bytes(body_path.read_bytes() + b"changed")
                if mode == "checksum":
                    rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
                    row = rows[1]
                    row["body_bytes"] = len(body_path.read_bytes())
                    row["body_sha256"] = hashlib.sha256(body_path.read_bytes()).hexdigest()
                    (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
                with self.assertRaisesRegex(ValueError, "body"):
                    self.validate_fixture(run, root)

    def test_export_requires_all_locked_input_paths(self):
        with self.assertRaises(TypeError):
            export_snapshot(Path("run"), Path("listing"), Path("selection"))

    def export_fixture(self, run: Path, selection: Path, output: Path, **options: object) -> dict[str, int | str]:
        lock = json.loads((run.parent / "import-lock.json").read_text(encoding="utf-8"))
        with patch.object(exporter, "TRUSTED_IMPORT_LOCK", lock), patch.object(exporter, "PINNED_PRIVATE_UNIVERSE_COUNT", 2), patch.object(exporter, "PINNED_RUN_ID", lock["run_id"]), patch.object(exporter, "EXPECTED_ROLE_COUNTS", {"list": 1, "raw": 2, "view": 2}), patch.object(exporter, "EXPECTED_TOTAL_EXCHANGES", 5), patch.object(exporter, "EXPECTED_LIST_OFFSETS", (0,)), patch.object(exporter, "EXPECTED_PUBLIC_SELECTION_COUNT", 1):
            return export_snapshot(run, run.parent / "listing.jsonl", selection, run.parent / "import-lock.json", run.parent / "times.json", output)

    def refresh_lock_hash(self, run: Path, selection: Path) -> None:
        lock_path = run.parent / "import-lock.json"
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock["run_json_sha256"] = hashlib.sha256((run / "run.json").read_bytes()).hexdigest()
        lock["exchanges_jsonl_sha256"] = hashlib.sha256((run / "exchanges.jsonl").read_bytes()).hexdigest()
        lock["checksums_sha256"] = hashlib.sha256((run / "checksums.sha256").read_bytes()).hexdigest()
        lock_path.write_text(json.dumps(lock, sort_keys=True), encoding="utf-8", newline="\n")

    def copy_frozen_inputs(self, root: Path) -> tuple[Path, Path]:
        run = root / "run"
        shutil.copytree(FROZEN_RUN, run)
        listing = root / "listing.jsonl"
        shutil.copy2(PRIVATE_LISTING, listing)
        return run, listing

    @unittest.skipUnless(PRIVATE_INPUTS_AVAILABLE, "private frozen inputs are not available")
    def test_rejects_private_universe_substitution_before_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, listing = self.copy_frozen_inputs(root)
            listing.write_text(
                listing.read_text(encoding="utf-8").replace("02a9f97a", "deadbeef"),
                encoding="utf-8",
                newline="\n",
            )
            output = root / "output"

            with self.assertRaisesRegex(ValueError, "private universe digest"):
                export_snapshot(run, listing, PUBLIC_SELECTION, IMPORT_LOCK, PUBLIC_TIMES, output)

            self.assertFalse(output.exists())

    @unittest.skipUnless(PRIVATE_INPUTS_AVAILABLE, "private frozen inputs are not available")
    def test_rejects_locked_exchanges_manifest_mutation_before_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, listing = self.copy_frozen_inputs(root)
            manifest = run / "exchanges.jsonl"
            manifest.write_text(manifest.read_text(encoding="utf-8") + "\n", encoding="utf-8", newline="\n")
            output = root / "output"

            with self.assertRaisesRegex(ValueError, "locked exchanges.jsonl hash"):
                export_snapshot(run, listing, PUBLIC_SELECTION, IMPORT_LOCK, PUBLIC_TIMES, output)

            self.assertFalse(output.exists())

    @unittest.skipUnless(PRIVATE_INPUTS_AVAILABLE, "private frozen inputs are not available")
    def test_rejects_coordinated_replacement_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, listing = self.copy_frozen_inputs(root)
            selection = root / "selection.json"
            shutil.copy2(PUBLIC_SELECTION, selection)
            selection_data = json.loads(selection.read_text(encoding="utf-8"))
            original_private_ids = {
                json.loads(line)["hash"]
                for line in listing.read_text(encoding="utf-8").splitlines()
            }
            original_selected_ids = {row["paste_id"] for row in selection_data["records"]}
            old_id = selection_data["records"][0]["paste_id"]
            new_id = "deadbeef"
            self.assertIn(old_id, original_selected_ids)
            self.assertIn(old_id, original_private_ids)
            self.assertNotIn(new_id, original_private_ids)
            self.assertNotIn(new_id, original_selected_ids)
            for body_path in (run / "source").glob("*.body"):
                body_path.write_bytes(body_path.read_bytes().replace(old_id.encode(), new_id.encode()))
            exchanges_path = run / "exchanges.jsonl"
            exchanges = [json.loads(line.replace(old_id, new_id)) for line in exchanges_path.read_text(encoding="utf-8").splitlines()]
            for exchange in exchanges:
                body = (run / exchange["body_path"]).read_bytes()
                exchange["body_bytes"] = len(body)
                exchange["body_sha256"] = hashlib.sha256(body).hexdigest()
            exchanges_path.write_text("".join(json.dumps(row) + "\n" for row in exchanges), encoding="utf-8", newline="\n")
            listing.write_text(listing.read_text(encoding="utf-8").replace(old_id, new_id), encoding="utf-8", newline="\n")
            for record in selection_data["records"]:
                if record["paste_id"] == old_id:
                    record["paste_id"] = new_id
                    raw_exchange = next(row for row in exchanges if row["role"] == "raw" and row["paste_id"] == new_id)
                    record["approved_raw_sha256"] = raw_exchange["body_sha256"]
            selection_data["records"].sort(key=lambda record: record["paste_id"])
            selection.write_text(json.dumps(selection_data, sort_keys=True), encoding="utf-8", newline="\n")
            run_manifest = json.loads((run / "run.json").read_text(encoding="utf-8"))
            run_manifest["run_id"] = "replacement-run"
            (run / "run.json").write_text(json.dumps(run_manifest), encoding="utf-8", newline="\n")
            checksums = []
            for line in (run / "checksums.sha256").read_text(encoding="ascii").splitlines():
                _, relative = line.split("  ", 1)
                checksums.append(f"{hashlib.sha256((run / relative).read_bytes()).hexdigest()}  {relative}\n")
            (run / "checksums.sha256").write_text("".join(checksums), encoding="ascii", newline="\n")
            lock = json.loads(IMPORT_LOCK.read_text(encoding="utf-8"))
            lock.update({
                "run_id": "replacement-run",
                "run_json_sha256": hashlib.sha256((run / "run.json").read_bytes()).hexdigest(),
                "exchanges_jsonl_sha256": hashlib.sha256(exchanges_path.read_bytes()).hexdigest(),
                "checksums_sha256": hashlib.sha256((run / "checksums.sha256").read_bytes()).hexdigest(),
                "private_listing_sha256": hashlib.sha256(listing.read_bytes()).hexdigest(),
                "private_universe_id_sha256": hashlib.sha256("".join(f"{row['hash']}\n" for row in sorted((json.loads(line) for line in listing.read_text(encoding='utf-8').splitlines()), key=lambda row: row['hash'])).encode()).hexdigest(),
                "public_selection_sha256": hashlib.sha256(selection.read_bytes()).hexdigest(),
            })
            private_ids = [json.loads(line)["hash"] for line in listing.read_text(encoding="utf-8").splitlines()]
            selected_ids = [row["paste_id"] for row in selection_data["records"]]
            parsed_selection, approved_hashes = _load_selection(selection, expected_count=len(selection_data["records"]))
            self.assertEqual(parsed_selection["records"], selection_data["records"])
            self.assertEqual(len(private_ids), 146)
            self.assertEqual(len(set(private_ids)), 146)
            self.assertEqual(len(selected_ids), len(original_selected_ids))
            self.assertEqual(len(set(selected_ids)), len(original_selected_ids))
            self.assertEqual(len(set(private_ids) - set(selected_ids)), len(original_private_ids - original_selected_ids))
            self.assertTrue(set(selected_ids).issubset(set(private_ids)))
            self.assertNotIn(old_id, private_ids)
            self.assertIn(new_id, private_ids)
            self.assertNotIn(old_id, selected_ids)
            self.assertIn(new_id, selected_ids)
            self.assertEqual(lock["private_universe_id_sha256"], _private_universe_digest(listing))
            self.assertEqual(approved_hashes, {row["paste_id"]: row["approved_raw_sha256"] for row in selection_data["records"]})
            for field, path in (
                ("private_listing_sha256", listing),
                ("public_selection_sha256", selection),
                ("exchanges_jsonl_sha256", exchanges_path),
                ("run_json_sha256", run / "run.json"),
                ("checksums_sha256", run / "checksums.sha256"),
            ):
                self.assertEqual(lock[field], hashlib.sha256(path.read_bytes()).hexdigest())
            replacement_lock = root / "replacement-lock.json"
            replacement_lock.write_text(json.dumps(lock), encoding="utf-8", newline="\n")

            with self.assertRaisesRegex(ValueError, "import lock constant mismatch"):
                export_snapshot(run, listing, selection, replacement_lock, PUBLIC_TIMES, root / "output")
            self.assertFalse((root / "output").exists())

    @unittest.skipUnless(PRIVATE_INPUTS_AVAILABLE, "private frozen inputs are not available")
    def test_rejects_duplicate_private_listing_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, listing = self.copy_frozen_inputs(root)
            rows = listing.read_text(encoding="utf-8").splitlines()
            rows[-1] = rows[0]
            listing.write_text("\n".join(rows) + "\n", encoding="utf-8", newline="\n")

            with self.assertRaisesRegex(ValueError, "private listing contains duplicate IDs"):
                export_snapshot(run, listing, PUBLIC_SELECTION, IMPORT_LOCK, PUBLIC_TIMES, root / "output")

    def make_fixture(self, root: Path, *, approved_hash: str | None = None) -> tuple[Path, Path]:
        run = root / "run"
        source = run / "source"
        source.mkdir(parents=True)

        listing = f"""
<table class="recent"><tbody>
<tr><td class="first"><a href="https://anna.fyi/view/{PUBLIC_ID}">Public title</a></td>
<td>Agent</td><td>Plain Text</td><td>3 Months ago.</td></tr>
<tr><td class="first"><a href="https://anna.fyi/view/{PRIVATE_ID}">Private title</a></td>
<td>Private</td><td>Plain Text</td><td>1 Year ago.</td></tr>
</tbody></table>
""".encode()
        public_raw = PHP_BANNER + b"PUBLIC PAYLOAD\n"
        private_raw = b"PRIVATE SECRET " + PRIVATE_ID.encode()
        public_view = f"""
<h1 class="pagetitle right">Public title</h1>
<span class="detail by">From Agent, 3 Months ago, written in Plain Text, viewed 12 times.</span>
<span class="detail by">This paste is a reply to <a href="https://anna.fyi/view/{PRIVATE_ID}">Private title</a> from Private
- <a href="https://anna.fyi/view/{PUBLIC_ID}/diff">view diff</a></span>
<h1>Replies <a href="https://anna.fyi/view/rss/{PUBLIC_ID}">RSS</a></h1>
""".encode()
        private_view = b"<h1 class=\"pagetitle right\">Private title</h1>"

        bodies = [listing, public_raw, private_raw, public_view, private_view]
        for number, body in enumerate(bodies, 1):
            (source / f"ex-{number:06d}.body").write_bytes(body)

        def exchange(number: int, role: str, paste_id: str | None, body: bytes, url: str, list_offset: int | None = None) -> dict[str, object]:
            return {
                "attempt": 1,
                "body_bytes": len(body),
                "body_path": f"source/ex-{number:06d}.body",
                "body_sha256": hashlib.sha256(body).hexdigest(),
                "duration_ms": 10,
                "ended_at": "2026-09-12T23:00:00.010Z",
                "error": None,
                "exchange_id": f"ex-{number:06d}",
                "final_url": url,
                "list_offset": list_offset,
                "method": "GET",
                "paste_id": paste_id,
                "request_headers": [["Accept-Encoding", "identity"]],
                "response_headers": [["Content-Type", "text/plain"]],
                "role": role,
                "started_at": "2026-09-12T23:00:00.000Z",
                "status": 200,
                "url": url,
            }

        exchanges = [
            exchange(1, "list", None, listing, "https://anna.fyi/lists/0", 0),
            exchange(2, "raw", PUBLIC_ID, public_raw, f"https://anna.fyi/view/raw/{PUBLIC_ID}"),
            exchange(3, "raw", PRIVATE_ID, private_raw, f"https://anna.fyi/view/raw/{PRIVATE_ID}"),
            exchange(4, "view", PUBLIC_ID, public_view, f"https://anna.fyi/view/{PUBLIC_ID}"),
            exchange(5, "view", PRIVATE_ID, private_view, f"https://anna.fyi/view/{PRIVATE_ID}"),
        ]
        (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in exchanges), encoding="utf-8", newline="\n")
        (run / "run.json").write_text(json.dumps({
            "run_id": "provisional-test",
            "source": "https://anna.fyi",
            "status": "COMPLETE",
            "started_at": "2026-09-12T23:00:00.000Z",
            "ended_at": "2026-09-12T23:01:00.000Z",
            "discovered_listing_ids": 2,
            "exchange_count": 5,
            "failures": 0,
            "successes": {"list": 1, "raw": 2, "view": 2},
            "semantics": "urllib response entity body; automatic redirects; no content/text decoding or transforms",
            "stable_inventory_seed": 2,
            "target_records": 2,
        }), encoding="utf-8", newline="\n")

        selection = root / "selection.json"
        selection.write_text(json.dumps({
            "schema_version": 1,
            "selection_version": 1,
            "source_commit": "e694240",
            "source_commit_oid": "e694240b04821ed6b83a82baa0183b26269318e7",
            "count": 1,
            "records": [{
                "paste_id": PUBLIC_ID,
                "approved_raw_sha256": approved_hash or hashlib.sha256(public_raw).hexdigest(),
            }],
        }), encoding="utf-8", newline="\n")
        times = root / "times.json"
        times.write_text(json.dumps({
            "schema_version": 1,
            "source": "https://anna.fyi/api/paste/<id> (created field)",
            "fetched_at": "2026-09-13T00:00:00Z",
            "count": 1,
            "times": {PUBLIC_ID: int(datetime(2026, 6, 5, 10, 0, tzinfo=timezone.utc).timestamp())},
        }), encoding="utf-8", newline="\n")
        private_listing = root / "listing.jsonl"
        private_listing.write_text("".join(json.dumps({"hash": paste_id}) + "\n" for paste_id in (PUBLIC_ID, PRIVATE_ID)), encoding="utf-8", newline="\n")
        checksum_lines = []
        for body_path in sorted(source.glob("*.body")):
            checksum_lines.append(f"{hashlib.sha256(body_path.read_bytes()).hexdigest()}  {body_path.relative_to(run).as_posix()}\n")
        (run / "checksums.sha256").write_text("".join(checksum_lines), encoding="ascii", newline="\n")
        lock = {
            "canonical_capture_v2": False,
            "checksums_sha256": hashlib.sha256((run / "checksums.sha256").read_bytes()).hexdigest(),
            "exchanges_jsonl_sha256": hashlib.sha256((run / "exchanges.jsonl").read_bytes()).hexdigest(),
            "historical_source_oid": "e694240b04821ed6b83a82baa0183b26269318e7",
            "network_recapture": False,
            "private_id_serialization": "sorted-lowercase-utf8-one-per-line-final-lf",
            "private_listing_sha256": hashlib.sha256(private_listing.read_bytes()).hexdigest(),
            "private_universe_id_sha256": hashlib.sha256("".join(f"{paste_id}\n" for paste_id in sorted((PUBLIC_ID, PRIVATE_ID))).encode()).hexdigest(),
            "public_selection_sha256": hashlib.sha256(selection.read_bytes()).hexdigest(),
            "run_id": "provisional-test",
            "run_json_sha256": hashlib.sha256((run / "run.json").read_bytes()).hexdigest(),
            "schema_version": 1,
            "source_format": "provisional-v1-import",
        }
        (root / "import-lock.json").write_text(json.dumps(lock, sort_keys=True), encoding="utf-8", newline="\n")
        return run, selection

    def rewrite_exchange_body(self, run: Path, exchange_number: int, body: bytes) -> None:
        source = run / "source" / f"ex-{exchange_number:06d}.body"
        source.write_bytes(body)
        rows = [json.loads(line) for line in (run / "exchanges.jsonl").read_text(encoding="utf-8").splitlines()]
        row = next(row for row in rows if row["exchange_id"] == f"ex-{exchange_number:06d}")
        row["body_bytes"] = len(body)
        row["body_sha256"] = hashlib.sha256(body).hexdigest()
        (run / "exchanges.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8", newline="\n")
        checksums = (run / "checksums.sha256").read_text(encoding="ascii").splitlines()
        relative = f"source/ex-{exchange_number:06d}.body"
        (run / "checksums.sha256").write_text(
            "".join((f"{row['body_sha256']}  {relative}" if line.endswith(f"  {relative}") else line) + "\n" for line in checksums),
            encoding="ascii",
            newline="\n",
        )

    def test_exports_exact_raw_and_public_metadata_without_private_relation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, selection = self.make_fixture(root)
            output = root / "output"

            self.export_fixture(run, selection, output, expected_discovered=2, expected_public_count=1, expected_list_exchanges=1)

            self.assertEqual((output / f"raw/{PUBLIC_ID}.txt").read_bytes(), PHP_BANNER + b"PUBLIC PAYLOAD\n")
            records = [json.loads(line) for line in (output / "records.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(records[0]["views"], 12)
            self.assertIsNone(records[0]["parent"])
            self.assertTrue(records[0]["raw_has_diagnostic_banner"])
            self.assertEqual(records[0]["published_utc"], "2026-06-05T10:00:00Z")
            exchanges = [json.loads(line) for line in (output / "exchanges.public.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual([row["role"] for row in exchanges], ["raw", "view"])
            for row in [*records, *exchanges]:
                self.assertNotIn("list_offset", row)
            published = {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()}
            self.assertEqual(
                published,
                {
                    "README.md",
                    ".gitattributes",
                    "capture.json",
                    "SHA256SUMS",
                    "records.jsonl",
                    "exchanges.public.jsonl",
                    f"raw/{PUBLIC_ID}.txt",
                },
            )
            for line in (output / "SHA256SUMS").read_text(encoding="ascii").splitlines():
                digest, relative = line.split("  ", 1)
                self.assertEqual(hashlib.sha256((output / relative).read_bytes()).hexdigest(), digest)
            public_bytes = b"".join(path.read_bytes() for path in output.rglob("*") if path.is_file())
            self.assertNotIn(PRIVATE_ID.encode(), public_bytes)
            self.assertNotIn(b"PRIVATE SECRET", public_bytes)

    def test_rejects_times_manifest_not_covering_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, selection = self.make_fixture(root)
            times_path = root / "times.json"
            data = json.loads(times_path.read_text(encoding="utf-8"))
            data["count"] = 0
            data["times"] = {}
            times_path.write_text(json.dumps(data), encoding="utf-8", newline="\n")
            with self.assertRaisesRegex(ValueError, "do not cover"):
                self.export_fixture(run, selection, root / "output")

    def test_rejects_extra_published_time_id(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, selection = self.make_fixture(root)
            times_path = root / "times.json"
            data = json.loads(times_path.read_text(encoding="utf-8"))
            data["count"] = 2
            data["times"][PRIVATE_ID] = data["times"][PUBLIC_ID]
            times_path.write_text(json.dumps(data), encoding="utf-8", newline="\n")
            with self.assertRaisesRegex(ValueError, "do not cover"):
                self.export_fixture(run, selection, root / "output")

    def test_rejects_published_time_inconsistent_with_displayed_when(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, selection = self.make_fixture(root)
            times_path = root / "times.json"
            data = json.loads(times_path.read_text(encoding="utf-8"))
            data["times"][PUBLIC_ID] = int(datetime(2026, 9, 12, 20, 0, tzinfo=timezone.utc).timestamp())
            times_path.write_text(json.dumps(data), encoding="utf-8", newline="\n")
            with self.assertRaisesRegex(ValueError, "inconsistent"):
                self.export_fixture(run, selection, root / "output")

    def test_withheld_metadata_canaries_skip_short_and_overlapping_names(self):
        listing_rows = [
            {"hash": PUBLIC_ID, "title": "Shared relay title", "author": "OpenAI"},
            {"hash": PRIVATE_ID, "title": "Shared relay title", "author": "Agent Zero"},
            {"hash": "cccccccc", "title": "short", "author": "tiny"},
        ]
        titles, authors = exporter._withheld_metadata_canaries(listing_rows, {PUBLIC_ID})
        self.assertEqual(titles, [])
        self.assertEqual(authors, ["agent zero"])

    def test_public_privacy_scan_rejects_leaked_withheld_title(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "raw").mkdir()
            (root / "raw" / "aaaaaaaa.txt").write_bytes(b"This mentions Agent Zero activity\n")
            with self.assertRaisesRegex(ValueError, "withheld title metadata"):
                exporter._scan_public_privacy(root, {"bbbbbbbb"}, ["agent zero"], [])

    def test_public_privacy_scan_rejects_leaked_withheld_id(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "raw").mkdir()
            (root / "raw" / "aaaaaaaa.txt").write_bytes(b"see bbbbbbbb for details\n")
            with self.assertRaisesRegex(ValueError, "withheld paste ID"):
                exporter._scan_public_privacy(root, {"bbbbbbbb"}, [], [])

    def test_repeated_export_from_same_run_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, selection = self.make_fixture(root)
            first, second = root / "first", root / "second"

            self.export_fixture(run, selection, first, expected_discovered=2, expected_public_count=1, expected_list_exchanges=1)
            self.export_fixture(run, selection, second, expected_discovered=2, expected_public_count=1, expected_list_exchanges=1)

            first_files = {path.relative_to(first): path.read_bytes() for path in first.rglob("*") if path.is_file()}
            second_files = {path.relative_to(second): path.read_bytes() for path in second.rglob("*") if path.is_file()}
            self.assertEqual(first_files, second_files)

    def test_changed_raw_body_is_rejected_before_output_is_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, selection = self.make_fixture(root, approved_hash="0" * 64)
            output = root / "output"

            with self.assertRaisesRegex(ValueError, "approved raw hash"):
                self.export_fixture(run, selection, output, expected_discovered=2, expected_public_count=1, expected_list_exchanges=1)

            self.assertFalse(output.exists())

    def test_incomplete_frozen_run_is_rejected_before_output_is_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, selection = self.make_fixture(root)
            run_manifest = json.loads((run / "run.json").read_text(encoding="utf-8"))
            run_manifest["failures"] = 1
            (run / "run.json").write_text(json.dumps(run_manifest), encoding="utf-8", newline="\n")
            self.refresh_lock_hash(run, selection)

            with self.assertRaisesRegex(ValueError, "run has failures"):
                self.export_fixture(run, selection, root / "output", expected_discovered=2, expected_public_count=1, expected_list_exchanges=1)

    def test_malformed_parent_relation_is_rejected_instead_of_silently_hidden(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, selection = self.make_fixture(root)
            malformed = (run / "source" / "ex-000004.body").read_bytes().replace(
                b'This paste is a reply to <a href="https://anna.fyi/view/bbbbbbbb">Private title</a>',
                b"This paste is a reply to malformed private reference",
            )
            self.rewrite_exchange_body(run, 4, malformed)
            self.refresh_lock_hash(run, selection)

            with self.assertRaisesRegex(ValueError, "malformed parent relation"):
                self.export_fixture(run, selection, root / "output", expected_discovered=2, expected_public_count=1, expected_list_exchanges=1)

    def test_existing_stale_output_is_replaced_only_after_privacy_checked_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run, selection = self.make_fixture(root)
            output = root / "output"
            (output / "stale").mkdir(parents=True)
            (output / "stale" / "private.txt").write_text(PRIVATE_ID, encoding="ascii")

            self.export_fixture(run, selection, output, expected_discovered=2, expected_public_count=1, expected_list_exchanges=1)

            self.assertFalse((output / "stale").exists())
            self.assertTrue((output / f"raw/{PUBLIC_ID}.txt").exists())


if __name__ == "__main__":
    unittest.main()
