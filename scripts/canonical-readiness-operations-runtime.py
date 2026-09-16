"""Owned immutable M/E/Z continuation from the linked actual71 commit."""
from dataclasses import dataclass, replace
import importlib.util
import json
from pathlib import Path
import sys
import uuid
import weakref

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('readiness_runtime_loader',ROOT/'scripts/canonical-auth-provisioning-replay.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
replay=loader.controller();batch=replay.load_readiness();prior=replay.load_operations_runtime()
alignment=prior.alignment;dedupe=prior.dedupe;legacy=prior.legacy;fixed=prior.fixed
DATABASE=prior.DATABASE;ORACLE=prior.ORACLE;encoded=prior.encoded;check=batch.check
_REFERENCES=weakref.WeakKeyDictionary();_RUNS=weakref.WeakKeyDictionary();_RELEASES=weakref.WeakKeyDictionary()


def reviewed_paths():return batch.reviewed_paths()


@dataclass(frozen=True,repr=False)
class Reference:
    name:str
    directory:str
    prior:object
    inputs:object
    sources:tuple


@dataclass(frozen=True,repr=False)
class Release:
    reference:object
    prior_completion:object
    staging:object
    before:bytes
    after:bytes
    token:str
    program:bytes=b''


def base_owned(target):
    ref=prior.owned(target)
    check(ref.alignment.fixed.dedupe.scope in ('readiness74','intake77','full'),'READINESS_SCOPE_REQUIRED')
    return ref


def owned(target,state=None):
    predecessor=base_owned(target);ref=_REFERENCES.get(target)
    check(type(ref) is Reference and ref.prior is predecessor and ref.inputs is predecessor.inputs
          and ref.name==target.name and ref.directory==target.directory.name,'READINESS_REFERENCE_REQUIRED')
    if state is not None:check(dedupe._STATES.get(target)==state,'READINESS_STATE_REQUIRED')
    return ref


def snapshot(target,database=DATABASE):return prior.snapshot(target,database)


def prepare_reference(target):
    predecessor=base_owned(target);frame=sys._getframe(1)
    check(frame.f_code is dedupe.prepare_reference.__code__ and frame.f_locals.get('target') is target
          and target not in dedupe._STATES and target not in _REFERENCES,'READINESS_PREPARATION_REQUIRED')
    sources=batch.validate_sources(reviewed_paths())
    _REFERENCES[target]=Reference(target.name,target.directory.name,predecessor,predecessor.inputs,sources)


def whole_program(sources,before,expected,rows,token):
    sql="SET TIME ZONE 'UTC'; SET DateStyle='ISO, MDY';\n"+prior.admission(before,token)
    for source in sources:sql+='\n'+source.data.decode()+"\nSELECT 'READINESS_SOURCE_"+source.key+"';\n"
    return sql+batch.assertions(before,expected,rows,sources)


def check_program(target,sql):
    ref=owned(target,'READINESS_NATIVE');run=_RUNS.get(target)
    check(type(run) is Release and target not in _RELEASES and run.reference is ref
          and run.staging is ref.inputs.staging and run.program==sql.encode() and bool(run.program)
          and run.prior_completion is prior.completion(target),'READINESS_PROGRAM_BINDING_REQUIRED')
    check(batch.validate_sources(reviewed_paths(),run.staging)==ref.sources,'READINESS_STAGED_SOURCE_CHANGED')


def run_program(target,sql):
    check_program(target,sql)
    result=alignment.run_private(target,DATABASE,sql)
    check_program(target,sql)
    return result


def check_receipt(output):
    markers=[line for line in output.splitlines() if line.startswith('READINESS_')]
    check(markers==['READINESS_SOURCE_M','READINESS_SOURCE_E','READINESS_SOURCE_Z','READINESS_COMPLETE'],
          'READINESS_COMPLETION_RECEIPT_REQUIRED')


def execute(target,database,paths,staging):
    ref=owned(target,'READINESS_NATIVE');frame=sys._getframe(1)
    check(frame.f_code is dedupe.continue_readiness.__code__ and frame.f_locals.get('target') is target,'READINESS_CONTROLLER_CALL_REQUIRED')
    check(database==DATABASE and type(staging) is legacy.StagedSources and ref.inputs.staging is staging
          and target not in _RUNS,'READINESS_ONCE_STAGED_REQUIRED')
    sources=batch.validate_sources(paths,staging)
    check(sources==ref.sources,'READINESS_FROZEN_SOURCES_REQUIRED')
    predecessor=prior.assert_final(target);before=snapshot(target)
    check(encoded(before)==predecessor.after,'READINESS_ACCEPTED_BASELINE_REQUIRED')
    rows=batch.expected_rows(before[1])
    run=Release(ref,predecessor,staging,encoded(before),b'',uuid.uuid4().hex);_RUNS[target]=run
    def expected_catalog():
        check(encoded(snapshot(target,ORACLE))==run.before,'READINESS_ORACLE_BASELINE_REQUIRED')
        alignment.run_private(target,ORACLE,"SET TIME ZONE 'UTC'; SET DateStyle='ISO, MDY';\n"+batch.oracle_sql(sources,before))
        return snapshot(target,ORACLE)[0]
    # Shared clone constructor first proves the whole predecessor projection;
    # the callback additionally requires the exact operations extensions/rows.
    origin=({k:v for k,v in before[0].items() if not k.startswith('operations_')},before[1])
    expected=prior.clone(target,DATABASE,origin,expected_catalog)
    check(encoded(snapshot(target))==run.before,'READINESS_PREIMAGE_CHANGED')
    sql=whole_program(sources,before,expected,rows,run.token)
    run=replace(run,program=sql.encode());_RUNS[target]=run
    check_receipt(run_program(target,sql))
    after=snapshot(target)
    check(batch.alignment.catalog.final_equal(before[0],after[0],expected,batch.new_index_keys(sources,before[0],before[1]))
          and alignment.rows_equal(after[1],rows),'READINESS_POST_COMMIT_MISMATCH')
    check(batch.validate_sources(paths,staging)==sources,'READINESS_STAGED_SOURCE_CHANGED')
    _RELEASES[target]=replace(run,after=encoded(after))
    return {'sources':3}


def completion(target):
    ref=owned(target);run=_RUNS.get(target);release=_RELEASES.get(target)
    check(type(run) is Release and type(release) is Release and run.reference is ref and release.reference is ref
          and run.prior_completion is release.prior_completion is prior.completion(target)
          and run.staging is release.staging is ref.inputs.staging and run.token==release.token
          and run.before==release.before and run.program==release.program and bool(release.after),
          'READINESS_COMPLETION_LINK_REQUIRED')
    return release


def assert_final(target):
    release=completion(target);alignment.identity(target,DATABASE)
    check(encoded(snapshot(target))==release.after,'READINESS_FINAL_STATE_CHANGED')
    return release


def release_checks(target,full=False):
    ref=owned(target,'READINESS_COMPLETE');frame=sys._getframe(2)
    check(frame.f_code is replay._serve_child.__code__ and frame.f_locals.get('h') is target
          and type(frame.f_locals.get('loop')) is replay.FoundationLoop and frame.f_locals['loop'].target is target
          and frame.f_locals.get('status')==0 and frame.f_locals['child'].poll()==0
          and frame.f_locals['server'].fileno()==-1 and not (Path(ref.directory)/'replay.sock').exists(),
          'SUCCESSFUL_ORIGINAL_CHILD_REQUIRED')
    check(type(full) is bool and full==(ref.prior.alignment.fixed.dedupe.scope=='full'),'READINESS_RELEASE_SCOPE_REQUIRED')
    release=completion(target) if full else assert_final(target)
    check(replay.originals_snapshot()==ref.prior.alignment.fixed.originals,'READINESS_ORIGINALS_RESTORATION_REQUIRED')
    fixed.privacy(target)
    return release
