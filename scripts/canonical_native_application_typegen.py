"""Generate unaccepted application type candidates on the complete owned native DB.

No reference, committed type file or manifest is changed. Raw bytes remain in
memory until the owner verifies successful resource and private-workspace disposal.
"""
import hashlib
from pathlib import Path
import re
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
OVERRIDE=ROOT/'scripts/apply-supabase-types-nullability-overrides.cjs'
OVERRIDE_SHA='c9ce102f76fa02634b7e725136da85e05daa1ce4e532d7bd9f3e507d65f8ceaa'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def snapshot(target):
    from canonical_native_timestamp_runtime import native_snapshot
    return native_snapshot(target)


def admit(runner, retained_forward, parent):
    from canonical_native_final_sql import admit_forward, PINS
    from canonical_native_probe_cleanup import admit_completed
    from canonical_forward_sources import FORWARD_SOURCES
    admit_forward(runner,retained_forward,parent)
    admit_completed(runner,parent)
    final=parent.get('nativeFinalSql',{})
    comparison=parent.get('_nativeSchemaComparison',{})
    if (parent.get('cliVersion')!='2.101.0'
            or parent.get('foundationInputsExecuted')!=144
            or parent.get('timestampInputsExecuted')!=514
            or parent.get('forwardSources',{}).get('inputsExecuted')!=len(FORWARD_SOURCES)
            or final.get('verified') is not True
            or [(r.get('source'),r.get('sourceSha256')) for r in final.get('checks',[])]!=list(PINS.items())
            or any(any(r.get(k) is not True for k in ('verified','catalogAndRowsPreserved','ledgerUnchanged')) for r in final.get('checks',[]))
            or comparison.get('scope')!='FULL_NATIVE_PUBLIC_PROJECTION_NOT_SCHEMA_ACCEPTANCE'
            or comparison.get('syntheticLifecycleProbeStillPresent') is not False
            or comparison.get('actualLedgerRows')!=len(runner.entries)
            or any(comparison.get(k) is not True for k in ('referenceRestored','referenceDisposed','nativeSchemaRowsAndLedgerPreserved'))):
        raise ValueError('NATIVE_APPLICATION_TYPEGEN_PREREQUISITES_REQUIRED')
    import canonical_policy_actor_qualification as actors
    import canonical_removed_policy_qualification as removed
    import canonical_added_view_witness as views
    for module,key in ((actors,'policyActorQualification'),(removed,'removedPolicyQualification'),(views,'addedViewSourceWitness')):
        receipt=module.validate_execution_receipt(parent.get(key),native=True)
        if comparison.get(key)!=receipt:
            raise ValueError('NATIVE_APPLICATION_TYPEGEN_WITNESS_REQUIRED')


def validate_raw(raw):
    if (type(raw) is not bytes or not 100<len(raw)<20_000_000
            or not raw.startswith(b'export type Json =')
            or b'export type Database = {' not in raw
            or re.search(rb'\bcompanies:\s*\{\s*Row:',raw) is None
            or b'resolve_ediel_timeseries_product_511:' not in raw
            or any(value in raw for value in (b'gridex_native_lifecycle_probe:',b'never_committed:',b'-----BEGIN ',b'postgresql://',b'postgres://'))):
        raise ValueError('NATIVE_APPLICATION_TYPEGEN_OUTPUT_REQUIRED')
    try:
        raw.decode('utf-8')
    except UnicodeError:
        raise ValueError('NATIVE_APPLICATION_TYPEGEN_ENCODING_REQUIRED') from None


def apply_override(raw):
    validate_raw(raw)
    if OVERRIDE.is_symlink() or sha(OVERRIDE.read_bytes())!=OVERRIDE_SHA:
        raise ValueError('NATIVE_APPLICATION_TYPEGEN_OVERRIDE_SOURCE_REQUIRED')
    with tempfile.TemporaryDirectory(prefix='gridex-native-type-candidate-') as directory:
        path=Path(directory)/'candidate.ts'
        path.touch(mode=0o600)
        path.write_bytes(raw)
        result=subprocess.run(['node',str(OVERRIDE),str(path)],capture_output=True,timeout=30)
        if result.returncode!=0:
            raise ValueError('NATIVE_APPLICATION_TYPEGEN_OVERRIDE_REQUIRED')
        candidate=path.read_bytes()
    validate_raw(candidate)
    return candidate


def execute(runner, retained_forward, parent, project):
    if 'nativeApplicationTypeCandidate' in parent or '_nativeApplicationTypeCandidate' in parent:
        raise ValueError('NATIVE_APPLICATION_TYPEGEN_ONCE_REQUIRED')
    admit(runner,retained_forward,parent)
    before=snapshot(runner.target)
    outputs=[]
    for _ in range(2):
        admit(runner,retained_forward,parent)
        result=runner.native('--network-id',project+'-network','gen','types',
                             '--local','--lang','typescript','--schema','public',
                             timeout=600,allow_failure=True)
        if result.returncode!=0:
            raise ValueError('NATIVE_APPLICATION_TYPEGEN_COMMAND_REQUIRED')
        validate_raw(result.stdout)
        runner.unchanged()
        if snapshot(runner.target)!=before:
            raise ValueError('NATIVE_APPLICATION_TYPEGEN_STATE_PRESERVATION_REQUIRED')
        outputs.append(result.stdout)
    if outputs[0]!=outputs[1]:
        raise ValueError('NATIVE_APPLICATION_TYPEGEN_REPEAT_REQUIRED')
    candidate=apply_override(outputs[0])
    admit(runner,retained_forward,parent)
    parent['nativeApplicationTypeCandidate']=dict(
        scope='NATIVE_APPLICATION_TYPE_CANDIDATE_NOT_ACCEPTED_TYPES_OR_SCHEMA',
        cliVersion='2.101.0',genuineCliTypegenExecuted=True,repeatEqual=True,
        schemaRowsProviderEventsAndLedgerPreserved=True,rawBytes=len(outputs[0]),
        rawSha256=sha(outputs[0]),candidateBytes=len(candidate),candidateSha256=sha(candidate),
        nullabilityOverrideSha256=OVERRIDE_SHA,exported=False,
        generatedTypesVerified=False,schemaAccepted=False,manifestUpdated=False)
    parent['_nativeApplicationTypeCandidate']=candidate


def publish(parent, output, *, success):
    candidate=parent.pop('_nativeApplicationTypeCandidate',None)
    if candidate is None:
        return
    if (success is not True or parent.get('cleanupVerified') is not True
            or parent.get('privateWorkspaceRemoved') is not True):
        return
    receipt=parent.get('nativeApplicationTypeCandidate',{})
    validate_raw(candidate)
    if receipt.get('candidateSha256')!=sha(candidate) or receipt.get('candidateBytes')!=len(candidate):
        raise ValueError('NATIVE_APPLICATION_TYPEGEN_EXPORT_BINDING_REQUIRED')
    path=output/'native-application-database.types.candidate.ts'
    with path.open('xb') as stream:
        stream.write(candidate)
    receipt['exported']=True
