"""Final ordinary-CI gate over fresh artifacts from this invocation's owned DB.

This never modifies source, references, types or manifests. Unsupported schema
source decisions remain a hard failure even after a successful native run.
"""
import json
from pathlib import Path
import time
import canonical_schema_source_decisions as decisions
import canonical_native_application_typegen as types
import canonical_native_parity_engine as parity
import canonical_policy_actor_qualification as actors
from canonical_forward_sources import FORWARD_SOURCES, retain as retain_forward
from canonical_native_final_sql import PINS

ROOT=Path(__file__).resolve().parents[1]

def fresh(root,name,started_ns):
    path=root/name
    if (path.is_symlink() or path.resolve()!=path or not path.is_file()
            or path.stat().st_mtime_ns<started_ns):
        raise ValueError('NATIVE_RELEASE_FRESH_ARTIFACT_REQUIRED')
    return path.read_bytes()

def verify(root=ROOT,*,started_ns):
    root=Path(root).resolve()
    if type(started_ns) is not int or started_ns<=0 or started_ns>time.time_ns():
        raise ValueError('NATIVE_RELEASE_INVOCATION_REQUIRED')
    report=json.loads(fresh(root,'artifacts/native-supabase-lifecycle.json',started_ns))
    diff=json.loads(fresh(root,'artifacts/native-full-schema-reference-diff.json',started_ns))
    candidate=fresh(root,'artifacts/native-application-database.types.candidate.ts',started_ns)
    if (report.get('outcome')!='NATIVE_SELECTED_CHAIN_EXECUTED_NOT_FULL_ACCEPTANCE'
            or report.get('cliVersion')!='2.101.0'
            or any(report.get(k) is not True for k in ('cleanupVerified','privateWorkspaceRemoved',
                'historicalPrivateInputsDisposed','nativeLedgerVerified','historicalGridexSourcesExecuted'))):
        raise ValueError('NATIVE_RELEASE_COMPLETE_OWNED_REPLAY_REQUIRED')
    actors._complete(report,True)
    retain_forward(root)
    for name,digest in FORWARD_SOURCES:
        if types.sha((root/'supabase'/name).read_bytes())!=digest:
            raise ValueError('NATIVE_RELEASE_SOURCE_CHANGED')
    final=report.get('nativeFinalSql',{})
    if (final.get('verified') is not True
            or [(r.get('source'),r.get('sourceSha256')) for r in final.get('checks',[])]!=list(PINS.items())
            or any(any(r.get(k) is not True for k in ('verified','catalogAndRowsPreserved','ledgerUnchanged')) for r in final['checks'])):
        raise ValueError('NATIVE_RELEASE_FINAL_SQL_REQUIRED')
    parity.validate_receipt(report.get('nativeParityEngineQualification'))
    summary=report.get('nativeSchemaReferenceComparison',{})
    expected={key:value for key,value in diff.items() if key!='sections'}
    expected['counts']={section:{kind:len(group[kind]) for kind in ('added','removed','changed')} for section,group in diff['sections'].items()}
    if summary!=expected or types.sha(json.dumps(summary,sort_keys=True).encode())!=types.sha(json.dumps(expected,sort_keys=True).encode()):
        raise ValueError('NATIVE_RELEASE_COMPARISON_BINDING_REQUIRED')
    # Full witness validation also runs on mappings actually used by the schema
    # verifier. Bind every collector receipt back to the enclosing native owner.
    for key in ('policyActorQualification','removedPolicyQualification','addedViewSourceWitness',
                'changedViewSourceWitness','changedFunctionBehaviorWitness','changedIndexSourceWitness',
                'intakeJsonbSourceWitness','nativeFinalSql','historicalTimestampTail'):
        if report.get(key)!=diff.get(key) or key not in report:
            raise ValueError('NATIVE_RELEASE_WITNESS_BINDING_REQUIRED')
    import canonical_changed_function_witness as functions
    for key,module in dict(decisions.WITNESSES,changedFunctionBehaviorWitness=functions).items():
        module.validate_execution_receipt(report.get(key),native=True)
    from canonical_native_dump_verify import validate as validate_dump
    validate_dump(report.get('nativeNormalizedDumpComparison'))
    schema=decisions.verify(diff)
    if schema['schemaAccepted'] is not True:
        counts={}
        for row in schema['unsupported']:
            key=row['section']+':'+row['change'];counts[key]=counts.get(key,0)+1
        print(json.dumps(dict(stage='native_release_source_decisions_required',unsupportedCounts=counts),sort_keys=True),flush=True)
        raise ValueError('NATIVE_RELEASE_SOURCE_DECISIONS_REQUIRED')
    receipt=report.get('nativeApplicationTypeCandidate',{})
    types.validate_raw(candidate)
    if (any(receipt.get(k) is not True for k in ('genuineCliTypegenExecuted','repeatEqual',
            'schemaRowsProviderEventsAndLedgerPreserved','exported'))
            or receipt.get('candidateSha256')!=types.sha(candidate)
            or receipt.get('candidateBytes')!=len(candidate)
            or receipt.get('nullabilityOverrideSha256')!=types.OVERRIDE_SHA):
        raise ValueError('NATIVE_RELEASE_TYPEGEN_RECEIPT_REQUIRED')
    manifest=json.loads((root/'scripts/supabase-types-manifest.json').read_bytes())
    latest=max(path.name for path in (root/'supabase/migrations').glob('*.sql') if len(path.name)>15 and path.name[:14].isdigit() and path.name[14]=='_')
    if (manifest.get('generated_types')!='supabase/database.types.ts'
            or manifest.get('latest_migration')!=latest
            or manifest.get('sha256')!=types.sha(candidate)
            or (root/'supabase/database.types.ts').read_bytes()!=candidate):
        raise ValueError('NATIVE_RELEASE_COMMITTED_TYPES_REQUIRED')
    return dict(scope='VERIFIED_NATIVE_SOURCE_REPLAY_AND_COMMITTED_TYPES',completeReplayVerified=True,
        schemaAccepted=True,generatedTypesVerified=True,cleanupVerified=True,
        sourceDecisionSha256=decisions.sha(schema),comparisonSha256=decisions.sha(diff),
        candidateSha256=types.sha(candidate),latestMigration=latest,productionModified=False)
