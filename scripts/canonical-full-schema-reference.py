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
from pathlib import Path
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



def isolated_reference(legacy, timestamp, raw):
    """Return only catalog metadata after destroying the reference runtime.

    The reconstruction must not adopt a target that already performed reference
    SQL or contains its client files. In particular, AcceptedInputs deliberately
    rejects a pre-existing physical client-last.out. Do not delete that evidence
    or relax the guard; dispose the reference instance and create a fresh target.
    """
    with legacy.OwnedPostgres(postgis=True) as target:
        timestamp.verify_spatial_runtime(target)
        document = restore_reference(target, raw)
    if target.active or target.directory is not None:
        raise ValueError('REFERENCE_DISPOSAL_REQUIRED')
    return validate(document)


def publish_result(result):
    output = ROOT/'artifacts'; output.mkdir(exist_ok=True)
    (output/'full-schema-reference-diff.json').write_text(json.dumps(result, sort_keys=True, indent=2)+'\n')
    summary = {k:v for k,v in result.items() if k != 'sections'}
    summary['counts'] = {s:{k:v for k,v in entry.items() if k.endswith('Count')} |
                         {kind:len(entry[kind]) for kind in ('added','removed','changed')}
                         for s,entry in result.get('sections',{}).items()}
    print(json.dumps(summary, sort_keys=True), flush=True)
    return 0 if all(result.get(field) is True for field in
                    ('publicSnapshotEqual', 'privacyVerified', 'cleanupVerified',
                     'ordinaryReplaySucceeded')) else 1



def terminal_observer(controller, original, reference, before, result):
    """Inspect a finished full shell failure without changing its disposition.

    The shell/controller owns source staging and AcceptedInputs. Do not duplicate
    migration copies in the private target or exempt them from the privacy gate.
    Catalog values stay in memory; only the sanitized comparison may be published
    after the ORIGINAL terminal handler verifies privacy and disposes the target.
    A successful comparison never converts the shell's failure into acceptance.
    """
    targets = {}

    def observed(handle):
        eligible = False
        candidate = None
        try:
            frame = sys._getframe(1)
            tail = frame.f_locals.get('tail')
            loop = frame.f_locals.get('loop')
            child = frame.f_locals.get('child')
            code = getattr(controller._serve_child, '__code__', None)
            eligible = (code is not None and frame.f_code is code
                        and frame.f_locals.get('h') is handle
                        and frame.f_locals.get('scope') == 'full'
                        and getattr(tail, 'state', None) == 'executed'
                        and getattr(loop, 'applied', False) is True
                        and child is not None and child.poll() not in (None, 0)
                        and id(handle) not in targets)
            if eligible:
                targets[id(handle)] = handle
                controller.load_repair().require_owned(handle, reference=True)
                controller.load_dedupe().require_live(handle)
                if controller.originals_snapshot() != before:
                    raise ValueError('SOURCE_RESTORATION_REQUIRED')
                from canonical_forward_sources import FORWARD_SOURCES
                forward = tail.forward_receipt
                if (forward.get('executed') is not True or forward.get('inputsExecuted') != 4
                        or len(forward.get('sources', [])) != 4
                        or any(entry.get('source') != path or entry.get('sourceSha256') != digest
                               or any(entry.get(flag) is not True for flag in ('executed','positiveAndRepeatVerified','rowsPreserved'))
                               for entry, (path, digest) in zip(forward['sources'], FORWARD_SOURCES))):
                    raise ValueError('FULL_SCHEMA_FORWARD_RECEIPT_REQUIRED')
                import canonical_policy_actor_qualification as actors
                actor_receipt = actors.validate_execution_receipt(tail.actor_receipt, native=False)
                candidate = compare(reference, capture(handle, controller.DATABASE))
                candidate.update(foundationApplied=controller.SCOPES['full'],
                                 timestampApplied=len(tail.selected),
                                 forwardApplied=4,
                                 policyActorQualification=actor_receipt,
                                 forwardSources=[dict(source=path, sourceSha256=digest) for path,digest in FORWARD_SOURCES])
        except Exception:
            # Never publish exception strings, SQL, raw catalog values or paths.
            result['collectionOutcome'] = 'EVIDENCE_UNAVAILABLE'
        finally:
            # Propagate the original error unchanged, even if collection failed.
            returned = original(handle)
        if eligible:
            if controller.load_dedupe()._STATES.get(handle) != 'DISPOSED':
                raise ValueError('OBSERVED_TERMINAL_DISPOSAL_REQUIRED')
            if candidate is not None:
                result.update(candidate, collectionOutcome='COLLECTED',
                              privacyVerified=True, databaseDisposed=True,
                              originalsRestored=True)
        return returned
    observed.targets = targets
    return observed


def observe_actual_shell(controller, reference, before, result):
    """Invoke the actual shell once; restore all observer-local process state."""
    dedupe = controller.load_dedupe()
    original, argv = dedupe.fail, sys.argv
    signals = {s:signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM)}
    observer = terminal_observer(controller, original, reference, before, result)
    dedupe.fail = observer
    sys.argv = [str(ROOT/'scripts/canonical-auth-provisioning-replay.py'), '--owned-compatible']
    result['ordinaryReplaySucceeded'] = False
    try:
        controller.main()
        result['ordinaryReplaySucceeded'] = True
    except Exception as error:
        # This remains a failed diagnostic run, not an alternative release gate.
        result.update(outcome='BLOCKED', phase='ACTUAL_OWNED_SHELL',
                      errorType=type(error).__name__)
    finally:
        dedupe.fail, sys.argv = original, argv
        for signum, handler in signals.items():
            signal.signal(signum, handler)
    # fail() verifies removal of the replay database. The controller's context
    # manager closes the owning runtime afterwards; these are different checks.
    if result.get('privacyVerified') is True:
        result['cleanupVerified'] = bool(observer.targets) and all(
            not target.active and target.directory is None
            for target in observer.targets.values())
        if not result['cleanupVerified']:
            result.update(outcome='BLOCKED', phase='OWNED_RUNTIME_CLEANUP')


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
    timestamp.load_inputs(ROOT, source_report, order)
    legacy = controller.load_batch()
    before = controller.originals_snapshot()
    result = {'scope': 'FULL_PUBLIC_SNAPSHOT_PROJECTION_NOT_RELEASE_ACCEPTANCE',
              'schemaAccepted': False, 'productionModified': False,
              'snapshotSourceSha256': sha(raw)}
    try:
        reference = isolated_reference(legacy, timestamp, raw)
    except Exception as error:
        if controller.originals_snapshot() != before:
            raise ValueError('SOURCE_RESTORATION_REQUIRED')
        result.update(outcome='BLOCKED', phase='INDEPENDENT_REFERENCE_RESTORE',
                      errorType=type(error).__name__, originalsRestored=True)
        return publish_result(result)
    result.update(referenceRestored=True, referenceDisposed=True,
                  referenceCounts={name:len(rows) for name,rows in reference.items()},
                  referenceSha256=sha(reference))
    observe_actual_shell(controller, reference, before, result)
    if controller.originals_snapshot() != before:
        raise ValueError('SOURCE_RESTORATION_REQUIRED')
    return publish_result(result)


if __name__ == '__main__':
    try:
        raise SystemExit(run())
    except Exception:
        print('FAIL full schema reference; no acceptance override or raw diagnostic disclosure', file=sys.stderr)
        raise SystemExit(1) from None
