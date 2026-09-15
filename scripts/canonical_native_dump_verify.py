"""Owned PostgreSQL dump comparison using the unchanged production normalizer.

Dump bytes remain in process memory. Only hashes/counts are published; mismatches
remain a separate release blocker regardless of accepted catalog projections.
"""
import hashlib
import os
from pathlib import Path
import subprocess
from canonical_native_final_sql import admit_forward
from canonical_native_probe_cleanup import admit_completed
from canonical_native_timestamp_runtime import native_snapshot

ROOT=Path(__file__).resolve().parents[1]
NORMALIZER='scripts/gridex-schema-dump.cjs'
NORMALIZER_SHA='627d2803cf0ec7aaff806782b946e4049bb1bd8e4b5f9364123b471e4d918b92'
REFERENCE='supabase/schema.sql'
REFERENCE_SHA='b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30'

def sha(raw):return hashlib.sha256(raw).hexdigest()

def sources():
    result={}
    for name,digest in ((NORMALIZER,NORMALIZER_SHA),(REFERENCE,REFERENCE_SHA)):
        path=ROOT/name
        if path.is_symlink() or path.resolve()!=path or sha(path.read_bytes())!=digest:
            raise ValueError('NATIVE_DUMP_SOURCE_REQUIRED')
        result[name]=path.read_bytes()
    return result

def normalize(raw):
    if type(raw) is not bytes or not raw or len(raw)>50_000_000:
        raise ValueError('NATIVE_DUMP_OUTPUT_REQUIRED')
    try:raw.decode('utf-8')
    except UnicodeError:raise ValueError('NATIVE_DUMP_OUTPUT_REQUIRED') from None
    sources()
    script="const fs=require('fs');const {normalizeDump}=require(process.argv[1]);process.stdout.write(normalizeDump(fs.readFileSync(0,'utf8')));"
    result=subprocess.run(['node','-e',script,str(ROOT/NORMALIZER)],input=raw,capture_output=True,timeout=60,
                          env={'PATH':os.environ.get('PATH','')})
    if result.returncode or not result.stdout:
        raise ValueError('NATIVE_DUMP_NORMALIZATION_REQUIRED')
    return result.stdout

def capture(target):
    from canonical_native_timestamp_proof import NativeTimestampTarget
    if (type(target) is not NativeTimestampTarget
            or getattr(target.assert_native_owned,'__func__',None) is not NativeTimestampTarget.assert_native_owned):
        raise ValueError('NATIVE_DUMP_OWNED_TARGET_REQUIRED')
    target.assert_native_owned()
    # Same production pg_dump flags, using a socket in the admitted PG17 owner.
    # This memory-only subprocess does not persist a derived SQL dump privately.
    result=subprocess.run(['docker','exec',target.name,'pg_dump','-U','postgres','-d','postgres',
        '--schema-only','--no-owner','--no-tablespaces','--schema','public'],capture_output=True,
        timeout=120,env={'PATH':os.environ.get('PATH','')})
    target.assert_native_owned()
    if result.returncode or not result.stdout:
        raise ValueError('NATIVE_DUMP_CAPTURE_REQUIRED')
    return result.stdout

def execute(runner,retained_forward,parent):
    if 'nativeNormalizedDumpComparison' in parent:raise ValueError('NATIVE_DUMP_ONCE_REQUIRED')
    admit_forward(runner,retained_forward,parent);admit_completed(runner,parent)
    retained=sources();before=native_snapshot(runner.target)
    try:
        actual=normalize(capture(runner.target));repeat=normalize(capture(runner.target))
        if actual!=repeat:raise ValueError('NATIVE_DUMP_REPEAT_REQUIRED')
        reference=normalize(retained[REFERENCE])
    finally:
        admit_forward(runner,retained_forward,parent);admit_completed(runner,parent)
        runner.unchanged()
        if native_snapshot(runner.target)!=before or sources()!=retained:
            raise ValueError('NATIVE_DUMP_STATE_PRESERVATION_REQUIRED')
    receipt=dict(scope='PRODUCTION_NORMALIZED_PUBLIC_DUMP_COMPARISON',verified=True,
        sourceReferenceSha256=REFERENCE_SHA,normalizerSha256=NORMALIZER_SHA,
        actualSha256=sha(actual),referenceSha256=sha(reference),actualBytes=len(actual),referenceBytes=len(reference),
        actualLines=actual.count(b'\n'),referenceLines=reference.count(b'\n'),repeatEqual=True,
        dumpEqual=actual==reference,catalogRowsAndLedgerPreserved=True,rawDumpExported=False,
        schemaAccepted=False,generatedTypesVerified=False)
    parent['nativeNormalizedDumpComparison']=receipt
    return receipt

def validate(receipt):
    reference=normalize(sources()[REFERENCE])
    expected=dict(scope='PRODUCTION_NORMALIZED_PUBLIC_DUMP_COMPARISON',verified=True,
        sourceReferenceSha256=REFERENCE_SHA,normalizerSha256=NORMALIZER_SHA,
        actualSha256=sha(reference),referenceSha256=sha(reference),actualBytes=len(reference),referenceBytes=len(reference),
        actualLines=reference.count(b'\n'),referenceLines=reference.count(b'\n'),repeatEqual=True,
        dumpEqual=True,catalogRowsAndLedgerPreserved=True,rawDumpExported=False,
        schemaAccepted=False,generatedTypesVerified=False)
    import json
    if receipt!=expected or json.dumps(receipt,sort_keys=True)!=json.dumps(expected,sort_keys=True):
        raise ValueError('NATIVE_DUMP_EXACT_COMPARISON_REQUIRED')
    return receipt
