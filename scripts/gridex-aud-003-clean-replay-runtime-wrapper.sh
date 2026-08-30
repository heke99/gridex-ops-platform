#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$ROOT/scripts/migration-history-manifest.additions.json"
RUNTIME="$ROOT/scripts/migration-history-manifest.runtime.additions.json"
BACKUP="$(mktemp)"

cp "$BASE" "$BACKUP"
python3 - "$BASE" "$RUNTIME" <<'PY'
import json,pathlib,sys
base_path=pathlib.Path(sys.argv[1])
runtime_path=pathlib.Path(sys.argv[2])
base=json.loads(base_path.read_text()) if base_path.exists() else {'files':{}}
runtime=json.loads(runtime_path.read_text()) if runtime_path.exists() else {'files':{}}
base_files=base.setdefault('files',{})
for name,checksum in (runtime.get('files') or {}).items():
    previous=base_files.get(name)
    if previous is not None and previous != checksum:
        raise SystemExit(f'runtime migration checksum conflicts with canonical additions: {name}')
    base_files[name]=checksum
base_path.write_text(json.dumps(base,indent=2,ensure_ascii=False)+'\n')
PY

# Source the canonical replay so its local Supabase lifecycle remains available
# to the rest of the current CI shell step. The composed ledger is needed only
# during provenance preflight and is restored immediately afterwards.
source "$ROOT/scripts/gridex-aud-003-clean-replay.sh"
cp "$BACKUP" "$BASE"
rm -f "$BACKUP"
