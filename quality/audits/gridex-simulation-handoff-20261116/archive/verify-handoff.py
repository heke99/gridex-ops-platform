#!/usr/bin/env python3
"""Read-only handoff integrity check. Requires Python 3; never runs app code."""
import hashlib
import json
import os
import posixpath
import stat
import sys
from pathlib import Path, PurePosixPath


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message):
    print("FAIL: " + message, file=sys.stderr)
    raise SystemExit(1)


def main():
    root = Path(__file__).resolve().parent.parent
    manifest_path = root / "PACKAGE-MANIFEST.safe.json"
    checksum_path = root / "PACKAGE.sha256"
    if not manifest_path.is_file() or not checksum_path.is_file():
        fail("Run from a complete extracted handoff package; manifest is missing.")
    checksum_fields = checksum_path.read_text(encoding="utf-8").split()
    if len(checksum_fields) != 2 or checksum_fields[1].lstrip("*") != manifest_path.name:
        fail("Unexpected manifest checksum format.")
    if sha256_file(manifest_path) != checksum_fields[0]:
        fail("Manifest checksum mismatch.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    seen = set()
    total_bytes = 0
    for entry in manifest["files"]:
        name = entry["path"]
        relative = PurePosixPath(name)
        if relative.is_absolute() or not relative.parts or any(p in ("..", ".") for p in relative.parts):
            fail("Unsafe manifest path.")
        if name in seen:
            fail("Duplicate manifest path: " + name)
        seen.add(name)
        path = root.joinpath(*relative.parts)
        for parent in path.parents:
            if parent == root:
                break
            if parent.is_symlink():
                fail("Symlinked parent: " + name)
        try:
            mode = path.lstat().st_mode
        except FileNotFoundError:
            fail("Missing file: " + name)
        if entry["type"] == "symlink":
            if not stat.S_ISLNK(mode):
                fail("Expected symlink: " + name)
            target = os.readlink(path)
            normalized = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
            if posixpath.isabs(target) or normalized == ".." or normalized.startswith("../"):
                fail("Symlink escapes package: " + name)
            payload = os.fsencode(target)
            actual_hash = hashlib.sha256(payload).hexdigest()
            actual_bytes = len(payload)
        elif entry["type"] == "file":
            if not stat.S_ISREG(mode):
                fail("Expected regular file: " + name)
            actual_hash = sha256_file(path)
            actual_bytes = path.stat().st_size
        else:
            fail("Unsupported manifest type: " + name)
        if actual_hash != entry["sha256"] or actual_bytes != entry["bytes"]:
            fail("Content mismatch: " + name)
        total_bytes += actual_bytes
    print("PASS: manifest and %d payload files verified (%d bytes)." % (len(seen), total_bytes))
    print("This verifies transfer integrity, not Mac/runtime, database connectivity, scenario PASS or Main adoption.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        fail(type(error).__name__ + ": invalid or unreadable package metadata.")
