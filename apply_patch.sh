#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"
if [[ -z "$target" || ! -d "$target" || ! -f "$target/package.json" ]]; then
  echo "Användning: $0 /absolut/sökväg/till/gridex-ops-platform" >&2
  exit 2
fi
if ! grep -Fq '"name": "gridex-ops-platform"' "$target/package.json"; then
  echo "Fel projektmål: package.json är inte gridex-ops-platform." >&2
  exit 2
fi

patch_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_root="$target/.patch-backups/gridex-ops-platform-api-canonical-patch-2026-07-30-$(date -u +%Y%m%dT%H%M%SZ)"
applied=0
skipped=0

digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

manifest_value() {
  awk -F '\t' -v requested="$2" '$2 == requested { print $1; exit }' "$1"
}

while IFS= read -r relative_path || [[ -n "$relative_path" ]]; do
  [[ -z "$relative_path" ]] && continue
  case "$relative_path" in
    /*|../*|*/../*|*/..) echo "Osäker sökväg i PATCH_FILES.txt: $relative_path" >&2; exit 3 ;;
  esac

  source_path="$patch_root/$relative_path"
  target_path="$target/$relative_path"
  expected_base="$(manifest_value "$patch_root/BASELINE_SHA256.txt" "$relative_path")"
  expected_patch="$(manifest_value "$patch_root/PATCH_SHA256.txt" "$relative_path")"
  if [[ ! -f "$source_path" || -z "$expected_base" || -z "$expected_patch" ]]; then
    echo "Ofullständig patchmetadata för $relative_path." >&2
    exit 3
  fi
  if [[ "$(digest "$source_path")" != "$expected_patch" ]]; then
    echo "Patchfilens checksumma är fel: $relative_path." >&2
    exit 3
  fi

  if [[ -f "$target_path" ]]; then
    current="$(digest "$target_path")"
    if [[ "$current" == "$expected_patch" ]]; then
      skipped=$((skipped + 1))
      continue
    fi
    if [[ "$expected_base" == "NEW" || "$current" != "$expected_base" ]]; then
      echo "Lokalt ändrad fil skulle skrivas över: $relative_path. Avbryter utan att skriva den filen." >&2
      exit 4
    fi
    mkdir -p "$backup_root/$(dirname "$relative_path")"
    cp -p "$target_path" "$backup_root/$relative_path"
  fi

  mkdir -p "$(dirname "$target_path")"
  cp -p "$source_path" "$target_path"
  if [[ "$(digest "$target_path")" != "$expected_patch" ]]; then
    echo "Verifiering efter kopiering misslyckades: $relative_path." >&2
    exit 5
  fi
  applied=$((applied + 1))
done < "$patch_root/PATCH_FILES.txt"

echo "Patch applicerad: $applied fil(er), $skipped redan aktuella."
if [[ -d "$backup_root" ]]; then
  echo "Backup av ersatta filer: $backup_root"
fi
