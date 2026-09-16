#!/usr/bin/env python3
"""Finite Task 11a source intake, not a PostgreSQL runner or replay approval.

Only exact repository-relative manifest inputs are read. No SQL is executed,
no database/environment target is accepted, and unresolved composition gates
prevent callers from treating an admitted body inventory as a runnable fixture.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'scripts/sql/canonical-permission-native-sources.json'
SOURCE_ROOTS = ('supabase/migrations/', 'supabase/bootstrap/', 'scripts/sql/')
SHA256 = re.compile(r'[0-9a-f]{64}')
IDENTIFIER = re.compile(r'[a-z][a-z0-9_]*')
FUNCTION_HEAD = re.compile(
    r'create\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(',
    re.IGNORECASE,
)


class AdmissionError(ValueError):
    """Finite, non-SQL error labels suitable for public construction receipts."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_path(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative.startswith(SOURCE_ROOTS):
        raise AdmissionError('SOURCE_PATH_NOT_ADMITTED')
    path = Path(relative)
    if path.is_absolute() or path.as_posix() != relative or any(part in ('..', '.') for part in path.parts):
        raise AdmissionError('SOURCE_PATH_NOT_ADMITTED')
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise AdmissionError('SOURCE_PATH_NOT_ADMITTED')
    return resolved


def check_function(body: str, entry: dict) -> None:
    """Check the exact complete source definition, not a rewritten stub/header.

    Pinned source hashes make this deliberately a finite extractor, not a generic
    SQL parser. The first AS dollar delimiter must terminate at the slice end;
    semicolons inside the original body cannot truncate a definition.
    """
    head = FUNCTION_HEAD.match(body)
    if head is None or head.group(1).lower() != entry['function_name']:
        raise AdmissionError('FUNCTION_SIGNATURE_MISMATCH')
    delimiter = re.search(r'\bas\s+(\$[a-zA-Z_0-9]*\$)', body, re.IGNORECASE)
    if delimiter is None:
        raise AdmissionError('FUNCTION_DELIMITER_MISSING')
    tag = delimiter.group(1)
    finish = body.find(tag, delimiter.end())
    if finish < 0 or body[finish + len(tag):].strip() != ';':
        raise AdmissionError('FUNCTION_BODY_NOT_COMPLETE')
    if body[:delimiter.start()].strip() != entry['declaration']:
        raise AdmissionError('FUNCTION_DECLARATION_MISMATCH')


def admit(root: Path = ROOT, manifest: dict | None = None) -> dict[str, str]:
    if manifest is None:
        manifest = json.loads(MANIFEST.read_text())
    if manifest.get('version') != 1 or manifest.get('scope') != 'task11a_source_intake':
        raise AdmissionError('MANIFEST_SCOPE_MISMATCH')
    sources = manifest.get('sources')
    entries = manifest.get('slices')
    if not isinstance(sources, dict) or not isinstance(entries, list) or not entries:
        raise AdmissionError('MANIFEST_SHAPE_MISMATCH')
    loaded = {}
    for relative, expected in sources.items():
        if not isinstance(expected, str) or not SHA256.fullmatch(expected):
            raise AdmissionError('SOURCE_HASH_INVALID')
        try:
            data = source_path(root, relative).read_bytes()
        except OSError:
            raise AdmissionError('SOURCE_UNAVAILABLE') from None
        if digest(data) != expected:
            raise AdmissionError('SOURCE_HASH_MISMATCH')
        loaded[relative] = data
    admitted = {}
    used = set()
    for entry in entries:
        key = entry.get('id')
        if not isinstance(key, str) or not IDENTIFIER.fullmatch(key) or key in admitted:
            raise AdmissionError('SLICE_ID_INVALID_OR_DUPLICATE')
        relative = entry.get('source')
        if relative not in loaded:
            raise AdmissionError('SLICE_SOURCE_NOT_ADMITTED')
        start, end = entry.get('start'), entry.get('end')
        data = loaded[relative]
        if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(data):
            raise AdmissionError('SLICE_RANGE_INVALID')
        raw = data[start:end]
        if digest(raw) != entry.get('sha256'):
            raise AdmissionError('SLICE_HASH_MISMATCH')
        try:
            body = raw.decode('utf-8')
        except UnicodeDecodeError:
            raise AdmissionError('SLICE_ENCODING_INVALID') from None
        if entry.get('kind') == 'function':
            check_function(body, entry)
            definitions = [match for match in FUNCTION_HEAD.finditer(data.decode('utf-8'))
                           if match.group(1).lower() == entry['function_name']]
            if len(definitions) != 1:
                raise AdmissionError('SOURCE_FUNCTION_NOT_UNIQUE')
        elif entry.get('kind') not in ('table', 'statement', 'block', 'bootstrap'):
            raise AdmissionError('SLICE_KIND_INVALID')
        if not body.startswith(entry.get('starts_with', '\x00')) or not body.endswith(entry.get('ends_with', '\x00')):
            raise AdmissionError('SLICE_BOUNDARY_MISMATCH')
        admitted[key] = body
        used.add(relative)
    if used != set(loaded):
        raise AdmissionError('UNUSED_SOURCE_ADMISSION')
    for gate in manifest.get('composition_gates', []):
        if not isinstance(gate.get('id'), str) or gate.get('status') not in ('OPEN', 'CLOSED'):
            raise AdmissionError('COMPOSITION_GATE_INVALID')
    return admitted


def compose(root: Path = ROOT, manifest: dict | None = None) -> str:
    """Compose only explicitly selected source slices; witnesses never execute."""
    if manifest is None:
        manifest = json.loads(MANIFEST.read_text())
    admitted = admit(root, manifest)
    gates = manifest.get('composition_gates')
    order = manifest.get('composition_order')
    executable = {entry['id'] for entry in manifest['slices']
                  if not entry.get('read_only_witness')}
    if not gates or any(gate['status'] != 'CLOSED' for gate in gates) or not order:
        raise AdmissionError('SOURCE_COMPOSITION_NOT_ADMITTED')
    if len(order) != len(set(order)) or set(order) != executable:
        raise AdmissionError('SOURCE_COMPOSITION_ORDER_INVALID')
    return '\n\n'.join(admitted[key] for key in order) + '\n'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', required=True)
    parser.parse_args()
    try:
        manifest = json.loads(MANIFEST.read_text())
        admitted = admit(manifest=manifest)
    except (OSError, json.JSONDecodeError):
        print('PERMISSION_SOURCE_MANIFEST_UNAVAILABLE')
        return 1
    except AdmissionError as error:
        print(str(error))
        return 1
    print(json.dumps({
        'scope': manifest['scope'],
        'source_files': len(manifest['sources']),
        'slices': len(admitted),
        'functions': sum(entry['kind'] == 'function' for entry in manifest['slices']),
        'source_intake': 'PASS',
        'composition': 'CONSTRUCTED' if compose(manifest=manifest) else 'OPEN',
        'native': 'NOT_RUN',
    }, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
