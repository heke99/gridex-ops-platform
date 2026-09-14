#!/usr/bin/env python3
"""Compare an independently restored public snapshot with the entire source replay.

Only a fresh, network-disabled, controller-owned PostgreSQL instance is allowed.
The reference is the committed dump, never the replay's observed fingerprint.
Raw definitions, SQL/default values and database rows are not exported. Differences
are reported by catalog identity, field names and hashes. No baseline is changed.
A matching public projection alone does not certify native Supabase or its ledger.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
REFERENCE_DB = 'gridex_auth_legacy_native'
PINS = {
    'supabase/schema.sql': 'b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30',
}
# Keys are catalog identifiers, never expressions/defaults/function definitions.
KEYS = {
    'relations': ('nspname', 'relname'),
    'columns': ('nspname', 'relname', 'attname'),
    'enums': ('nspname', 'typname', 'enumlabel'),
    'constraints': ('nspname', 'relname', 'conname'),
    'indexes': ('nspname', 'relname', 'indexname'),
    'functions': ('nspname', 'proname', 'identity_arguments'),
    'triggers': ('nspname', 'relname', 'tgname'),
    'policies': ('nspname', 'relname', 'polname'),
    'relation_grants': ('nspname', 'relname', 'grantee', 'privilege_type'),
    'function_grants': ('nspname', 'proname', 'identity_arguments', 'grantee', 'privilege_type'),
    'schema_grants': ('nspname', 'grantee', 'privilege_type'),
    'extensions': ('extname',),
}


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else
                          json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def load(filename):
    path = ROOT/'scripts'/filename
    spec = importlib.util.spec_from_file_location('full_schema_'+filename.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pinned():
    result = {}
    for name, expected in PINS.items():
        path = ROOT/name
        if path.is_symlink() or not path.is_file() or path.resolve() != path:
            raise ValueError('REFERENCE_INPUT_REQUIRED')
        data = path.read_bytes()
        if sha(data) != expected:
            raise ValueError('REFERENCE_INPUT_HASH_MISMATCH')
        result[name] = data
    return result


def validate(document):
    # Use the same complete-document validation as the release parity engine.
    command = ['node', '-e', "const fs=require('node:fs');const m=require('./scripts/gridex-schema-document.cjs');m.validateSchemaDocument(JSON.parse(fs.readFileSync(0,'utf8')),['public']);"]
    result = subprocess.run(command, cwd=ROOT, input=json.dumps(document).encode(),
                            capture_output=True, timeout=30)
    if result.returncode or set(document) != {'schemas', *KEYS}:
        raise ValueError('COMPLETE_SCHEMA_DOCUMENT_REQUIRED')
    return document


def key(row, fields):
    result = tuple(row[field] for field in fields)
    if any(not isinstance(item, str) or len(item) > 1024 or
           any(ord(char) < 32 or ord(char) == 127 for char in item) for item in result):
        raise ValueError('CATALOG_IDENTITY_REQUIRED')
    return result


def index(rows, fields):
    result = {}
    for row in rows:
        identity = key(row, fields)
        if identity in result:
            raise ValueError('DUPLICATE_CATALOG_IDENTITY')
        result[identity] = row
    return result


def compare(reference, actual):
    validate(reference); validate(actual)
    sections = {}
    for section, fields in KEYS.items():
        before = index(reference[section], fields)
        after = index(actual[section], fields)
        added = sorted(set(after)-set(before))
        removed = sorted(set(before)-set(after))
        changed = sorted(k for k in set(before)&set(after) if before[k] != after[k])
        sections[section] = {
            'referenceCount': len(before), 'replayCount': len(after),
            'referenceSha256': sha(reference[section]), 'replaySha256': sha(actual[section]),
            'added': [{'identity': k, 'sha256': sha(after[k])} for k in added],
            'removed': [{'identity': k, 'sha256': sha(before[k])} for k in removed],
            'changed': [{'identity': k, 'fields': sorted(f for f in set(before[k])|set(after[k])
                                                       if before[k].get(f) != after[k].get(f)),
                         'referenceSha256': sha(before[k]), 'replaySha256': sha(after[k])}
                        for k in changed],
        }
    return {
        'scope': 'FULL_PUBLIC_SNAPSHOT_PROJECTION_NOT_RELEASE_ACCEPTANCE',
        'publicSnapshotEqual': reference == actual,
        'referenceSha256': sha(reference), 'replaySha256': sha(actual),
        'sections': sections,
        'coverage': ['all public relations', 'all live columns including physical ordinals',
                     'enums', 'constraint definitions and validation', 'index definitions',
                     'function identity/body hash/security mode', 'non-internal triggers',
                     'RLS flags and policy predicates/roles', 'relation/function/schema grants',
                     'extension inventory'],
        'notCertified': ['native Supabase lifecycle', 'official migration ledger',
                         'generated types', 'live-versus-replay equality',
                         'ownership (snapshot was emitted with --no-owner)',
                         'sequence values and business data', 'default privileges and event triggers'],
        'schemaAccepted': False, 'ledgerProvenanceVerified': False,
        'generatedTypesVerified': False, 'productionModified': False,
    }


def capture(target, database):
    path = ROOT/'scripts/sql/gridex-db-parity-introspect.sql'
    query = path.read_text()
    if query.count(":'schemas'") != 1:
        raise ValueError('SCHEMA_PARAMETER_CONTRACT_CHANGED')
    query = query.replace(":'schemas'", "'{public}'")
    return validate(json.loads(target.sql(database, query, 'full_public_catalog')))


def restore_reference(target, raw):
    return load('canonical-reference-restore.py').restore_reference(target, raw)


def run():
    if len(sys.argv) != 1:
        raise ValueError('NO_TARGET_OR_ACCEPTANCE_OVERRIDES')
    raw = pinned()['supabase/schema.sql']
    frontier = load('canonical-foundation-frontier-diagnostic.py')
    controller = frontier.load_controller()
    order, source_report = frontier.verify_selection(controller)
    accounting = load('gridex-replay-complete-accounting.py').account(ROOT)
    if not accounting['canonicalSourceDispositionsComplete']:
        raise ValueError('SOURCE_ACCOUNTING_REQUIRED')
    timestamp = frontier.load_timestamp()
    selected, prerequisites = timestamp.load_inputs(ROOT, source_report, order)
    retained = timestamp.retain_sources(ROOT, selected, prerequisites)
    staging = load('canonical-residual-staging-native.py')
    legacy = controller.load_batch()
    before = controller.originals_snapshot()
    phase = 'OWNED_TARGET'
    result = {'scope': 'FULL_PUBLIC_SNAPSHOT_PROJECTION_NOT_RELEASE_ACCEPTANCE',
              'schemaAccepted': False, 'productionModified': False}
    def interrupted(*_):
        raise ValueError('SCHEMA_REFERENCE_INTERRUPTED')
    signal.signal(signal.SIGINT, interrupted); signal.signal(signal.SIGTERM, interrupted)
    with legacy.OwnedPostgres(postgis=True) as target:
        try:
            timestamp.verify_spatial_runtime(target)
            phase = 'INDEPENDENT_REFERENCE_RESTORE'
            reference = restore_reference(target, raw)
            phase = 'COMPLETE_SELECTED_REPLAY'
            with controller.load_private().AcceptedInputs(target):
                controller.load_dedupe().prepare_reference(target, 'full')
                controller.load_dedupe().fresh_target(target)
                hold = Path(target.directory.name)/'full-schema-hold'; hold.mkdir(mode=0o700)
                for source in (ROOT/'supabase/migrations').iterdir():
                    if source.is_symlink():
                        raise ValueError('SYMLINK_SOURCE_REJECTED')
                    if source.is_file() and source.suffix == '.sql':
                        shutil.copy2(source, hold/source.name)
                paths = [str(hold/Path(p).name if p.startswith('migrations/') else ROOT/'supabase'/p) for p in order]
                loop = controller.FoundationLoop(legacy, target, 'full')
                with staging.originals_absent(hold):
                    loop.validate(str(hold), paths)
                    target.sql(controller.DATABASE, (ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text(),
                               'full_schema_bootstrap', transaction=False)
                    loop.run(str(hold), paths)
                    progress = {'foundationApplied': len(order), 'timestampApplied': 0}
                    timestamp.execute_tail(ROOT, target, controller.DATABASE, selected, prerequisites, progress, retained=retained)
                    if progress['timestampApplied'] != len(selected):
                        raise ValueError('FULL_SOURCE_EXECUTION_REQUIRED')
                    phase = 'FULL_PUBLIC_COMPARISON'
                    actual = capture(target, controller.DATABASE)
                result = compare(reference, actual)
                result.update(foundationApplied=len(order), timestampApplied=len(selected), snapshotSourceSha256=sha(raw))
            if controller.originals_snapshot() != before:
                raise ValueError('SOURCE_RESTORATION_REQUIRED')
            phase = 'PRIVATE_TERMINAL_VERIFICATION'
            controller.load_fixed().privacy(target)
            result['privacyVerified'] = True
        except Exception as error:
            result.update(outcome='BLOCKED', phase=phase, errorType=type(error).__name__)
            if target in controller.load_dedupe()._REFERENCES:
                controller.load_dedupe().fail(target)
        if controller.originals_snapshot() != before:
            raise ValueError('SOURCE_RESTORATION_REQUIRED')
    result.update(cleanupVerified=not target.active, originalsRestored=True)
    if target.active:
        raise ValueError('OWNED_CLEANUP_REQUIRED')
    output = ROOT/'artifacts'; output.mkdir(exist_ok=True)
    (output/'full-schema-reference-diff.json').write_text(json.dumps(result, sort_keys=True, indent=2)+'\n')
    summary = {k:v for k,v in result.items() if k != 'sections'}
    summary['counts'] = {s:{k:v for k,v in entry.items() if k.endswith('Count')} |
                         {kind:len(entry[kind]) for kind in ('added','removed','changed')}
                         for s,entry in result.get('sections',{}).items()}
    print(json.dumps(summary, sort_keys=True), flush=True)
    return 0 if result.get('publicSnapshotEqual') and result.get('privacyVerified') else 1


if __name__ == '__main__':
    try:
        raise SystemExit(run())
    except Exception:
        print('FAIL full schema reference; no acceptance override or raw diagnostic disclosure', file=sys.stderr)
        raise SystemExit(1) from None
