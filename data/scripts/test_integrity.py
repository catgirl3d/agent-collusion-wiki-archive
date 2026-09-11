import hashlib
import gzip
import shutil
import subprocess
from pathlib import Path

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
VERIFY_SCRIPT = REPOSITORY_ROOT / "data" / "scripts" / "verify.sh"


@pytest.fixture
def synthetic_verify_tree(tmp_path):
    """Place the unchanged verifier in the layout it resolves at runtime."""
    scripts = tmp_path / "data" / "scripts"
    raw = tmp_path / "data" / "raw"
    scripts.mkdir(parents=True)
    raw.mkdir()
    shutil.copy2(VERIFY_SCRIPT, scripts / "verify.sh")
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("verify.sh tests require bash")
    return bash, raw, scripts / "verify.sh"


def _run_verify(bash, script):
    return subprocess.run(
        [bash, str(script)],
        cwd=script.parents[2],
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )


def _sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_text(path, content):
    with path.open("w", encoding="ascii", newline="\n") as stream:
        stream.write(content)


def _write_archive_manifest(raw, archive, digest=None):
    digest = digest or _sha256(raw / archive)
    # The repository's SHA256SUMS.gz is plaintext despite its historical suffix.
    _write_text(raw / "SHA256SUMS.gz", f"{digest}  {archive}\n")


def test_verify_fails_when_archive_manifest_is_missing(synthetic_verify_tree):
    bash, raw, script = synthetic_verify_tree

    result = _run_verify(bash, script)

    assert result.returncode != 0
    assert "SHA256SUMS.gz" in result.stderr
    assert not (raw / "SHA256SUMS.gz").exists()


def test_verify_passes_for_matching_checksum_of_gzip_archive(synthetic_verify_tree):
    bash, raw, script = synthetic_verify_tree
    archive = "pages.jsonl.gz"
    (raw / archive).write_bytes(gzip.compress(b"synthetic gzip archive contents\n"))
    _write_archive_manifest(raw, archive)

    result = _run_verify(bash, script)

    assert result.returncode == 0, result.stderr
    assert "OK" in result.stdout


@pytest.mark.parametrize(
    "manifest, archive_bytes",
    [
        ("not a checksum manifest\n", b"synthetic archive\n"),
        (None, b"changed archive contents\n"),
    ],
)
def test_verify_fails_for_malformed_or_mismatched_archive_integrity_input(
    synthetic_verify_tree, manifest, archive_bytes
):
    bash, raw, script = synthetic_verify_tree
    archive = "pages.jsonl.gz"
    (raw / archive).write_bytes(gzip.compress(b"original archive contents\n"))
    if manifest is None:
        _write_archive_manifest(raw, archive, digest="0" * 64)
        (raw / archive).write_bytes(archive_bytes)
    else:
        _write_text(raw / "SHA256SUMS.gz", manifest)

    result = _run_verify(bash, script)

    assert result.returncode != 0
