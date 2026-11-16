"""Read-only integrity check of this Git handoff. Requires Python 3."""
import hashlib
import json
from pathlib import Path, PurePosixPath

root = Path(__file__).resolve().parent
manifest = json.loads((root / "MANIFEST.safe.json").read_text())
for entry in manifest["files"]:
    rel = PurePosixPath(entry["path"])
    if rel.is_absolute() or ".." in rel.parts:
        raise SystemExit("FAIL: unsafe manifest path")
    path = root.joinpath(*rel.parts)
    if path.is_symlink() or not path.is_file() or root not in path.resolve().parents:
        raise SystemExit("FAIL: missing/unsafe file: " + str(rel))
    data = path.read_bytes()
    if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise SystemExit("FAIL: changed file: " + str(rel))
print("PASS: %d handoff files verified. No app or database execution." % len(manifest["files"]))
