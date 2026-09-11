"""Owned whole L/E/U continuation from the linked actual68 commit.

Source-only preparation supplies added catalog projections. The original child
alone can release actual71 after an exact single-transaction completion.
"""
from dataclasses import dataclass, replace
import importlib.util
import json
from pathlib import Path
import sys
import uuid
import weakref

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('operations_runtime_loader',ROOT/'scripts/canonical-auth-provisioning-replay.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
replay=loader.controller();batch=replay.load_operations();alignment=replay.load_alignment_runtime()
dedupe=alignment.dedupe;legacy=alignment.legacy;fixed=alignment.fixed
DATABASE=alignment.DATABASE;ORACLE=alignment.ORACLE
encoded=alignment.encoded;check=batch.check
_REFERENCES=weakref.WeakKeyDictionary();_RUNS=weakref.WeakKeyDictionary();_RELEASES=weakref.WeakKeyDictionary()


def reviewed_paths():return batch.reviewed_paths()


@dataclass(frozen=True,repr=False)
class Reference:
    name:str
    directory:str
    alignment:object
    inputs:object
    sources:tuple
    extra_catalog:bytes


@dataclass(frozen=True,repr=False)
class Release:
    reference:object
    alignment_completion:object
    staging:object
    before:bytes
    after:bytes
    token:str
    program:bytes=b''


def base_owned(target):
    ref=alignment.owned(target)
    check(ref.fixed.dedupe.scope in ('operations71','full'),'OPERATIONS_SCOPE_REQUIRED')
    return ref


def owned(target,state=None):
    predecessor=base_owned(target);ref=_REFERENCES.get(target)
    check(type(ref) is Reference and ref.alignment is predecessor and ref.inputs is predecessor.inputs
          and ref.name==target.name and ref.directory==target.directory.name,'OPERATIONS_REFERENCE_REQUIRED')
    if state is not None:check(dedupe._STATES.get(target)==state,'OPERATIONS_STATE_REQUIRED')
    return ref


def extra(shape):return {k:v for k,v in shape.items() if k.startswith('operations_')}


def snapshot(target,database=DATABASE):
    sql="SELECT 'OPERATIONS_CATALOG';\n"+batch.catalog_sql()
    sql+="\nSELECT 'OPERATIONS_ROWS';\n"+batch.alignment.rows_sql()
    sql+="\nSELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM alignment_rows; DROP TABLE alignment_rows;"
    lines=alignment.run_private(target,database,sql).splitlines()
    check(lines.count('OPERATIONS_CATALOG')==lines.count('OPERATIONS_ROWS')==1,'OPERATIONS_SNAPSHOT_REQUIRED')
    return json.loads(lines[lines.index('OPERATIONS_CATALOG')+1]),json.loads(lines[lines.index('OPERATIONS_ROWS')+1])


def clone(target,source,expected,operation):
    base_owned(target)
    check(source in (DATABASE,alignment.HELPER),'OPERATIONS_ORACLE_SOURCE_REQUIRED')
    check(alignment.run_private(target,source,'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='+batch.alignment.literal(ORACLE)+');').strip()=='f','OPERATIONS_FRESH_ORACLE_REQUIRED')
    created=False
    try:
        target.docker(['exec',target.name,'createdb','-U','postgres','-T',source,ORACLE]);created=True
        alignment.identity(target,ORACLE)
        check(encoded(alignment.snapshot(target,ORACLE))==encoded(expected),'OPERATIONS_ORACLE_ORIGIN_REQUIRED')
        return operation()
    finally:
        if created:
            base_owned(target)
            target.docker(['exec',target.name,'dropdb','-U','postgres','--force',ORACLE])


def prepare_reference(target):
    predecessor=base_owned(target);frame=sys._getframe(1)
    check(frame.f_code is dedupe.prepare_reference.__code__ and frame.f_locals.get('target') is target
          and target not in dedupe._STATES and target not in _REFERENCES,'OPERATIONS_INDEPENDENT_PREPARATION_REQUIRED')
    sources=batch.validate_sources(reviewed_paths())
    baseline=json.loads(predecessor.baseline)
    def expected_extra():
        alignment.run_private(target,ORACLE,batch.alignment.expected_ddl(predecessor.sources,baseline[0]))
        return extra(snapshot(target,ORACLE)[0])
    additions=clone(target,alignment.HELPER,baseline,expected_extra)
    _REFERENCES[target]=Reference(target.name,target.directory.name,predecessor,predecessor.inputs,sources,encoded(additions))


def admission(before,token):
    literal=batch.alignment.json_sql
    return '''SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s';
SET LOCAL search_path=public,extensions,pg_temp;
SELECT pg_advisory_xact_lock(20260910,140053);
CREATE TEMP TABLE operations_admission(base jsonb,before_rows jsonb,token text) ON COMMIT DROP;
INSERT INTO operations_admission VALUES ('''+literal(before[0])+','+literal(before[1])+','+batch.alignment.literal(token)+''');
DO $$ DECLARE r record; BEGIN
 IF current_user<>'postgres' OR current_database()<>'''+batch.alignment.literal(DATABASE)+''' THEN
 RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='OPERATIONS_OWNER_REQUIRED'; END IF;
 FOR r IN SELECT key,value FROM jsonb_each((SELECT base FROM operations_admission))
 WHERE key LIKE 'relation/%' AND value->>'kind' IN ('r','p') ORDER BY key LOOP
 EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',substr(r.key,10)::regclass);
 END LOOP;
 LOCK TABLE pg_catalog.pg_proc,pg_catalog.pg_rewrite,pg_catalog.pg_depend,pg_catalog.pg_auth_members,
 pg_catalog.pg_description,pg_catalog.pg_constraint IN SHARE ROW EXCLUSIVE MODE;
END $$;
CREATE TEMP TABLE operations_admitted(value) ON COMMIT DROP AS '''+batch.catalog_sql()+'''
DO $$ BEGIN IF (SELECT value FROM operations_admitted) IS DISTINCT FROM (SELECT base FROM operations_admission) THEN
 RAISE EXCEPTION USING ERRCODE='42804',MESSAGE='OPERATIONS_BASE_CHANGED'; END IF; END $$;
CREATE TEMP TABLE alignment_reference(before_rows jsonb) ON COMMIT DROP AS SELECT before_rows FROM operations_admission;
'''+batch.alignment.assert_rows('before_rows')+'\nDROP TABLE alignment_reference;\n'


def check_program(target,sql):
    ref=owned(target,'OPERATIONS_NATIVE');run=_RUNS.get(target)
    check(type(run) is Release and target not in _RELEASES and run.reference is ref
          and run.staging is ref.inputs.staging and run.program==sql.encode() and bool(run.program)
          and run.alignment_completion is alignment.completion(target),'OPERATIONS_PROGRAM_BINDING_REQUIRED')
    check(batch.validate_sources(reviewed_paths(),run.staging)==ref.sources,'OPERATIONS_STAGED_SOURCE_CHANGED')


def run_program(target,sql):
    check_program(target,sql)
    result=alignment.run_private(target,DATABASE,sql)
    check_program(target,sql)
    return result


def check_receipt(output):
    markers=[line for line in output.splitlines() if line.startswith('OPERATIONS_')]
    check(markers==['OPERATIONS_SOURCE_L','OPERATIONS_SOURCE_E','OPERATIONS_SOURCE_U','OPERATIONS_COMPLETE'],'OPERATIONS_COMPLETION_RECEIPT_REQUIRED')


def whole_program(sources,before,expected,expected_rows,token):
    sql=admission(before,token)
    for source in sources:
        sql+='\n'+source.data.decode()+"\nSELECT 'OPERATIONS_SOURCE_"+source.key+"';\n"
    return sql+batch.assertions(before,expected,expected_rows,sources)


def execute(target,database,paths,staging):
    ref=owned(target,'OPERATIONS_NATIVE');frame=sys._getframe(1)
    check(frame.f_code is dedupe.continue_operations.__code__ and frame.f_locals.get('target') is target,'OPERATIONS_CONTROLLER_CALL_REQUIRED')
    check(database==DATABASE and type(staging) is legacy.StagedSources and ref.inputs.staging is staging
          and target not in _RUNS,'OPERATIONS_ONCE_STAGED_REQUIRED')
    sources=batch.validate_sources(paths,staging)
    check(sources==ref.sources,'OPERATIONS_FROZEN_SOURCES_REQUIRED')
    predecessor=alignment.assert_final(target)
    before=snapshot(target);accepted=json.loads(predecessor.after)
    check(encoded(({k:v for k,v in before[0].items() if not k.startswith('operations_')},before[1]))==encoded(accepted)
          and encoded(extra(before[0]))==ref.extra_catalog,'OPERATIONS_INDEPENDENT_BASELINE_REQUIRED')
    expected_rows=batch.expected_rows(before[1])
    run=Release(ref,predecessor,staging,encoded(before),b'',uuid.uuid4().hex)
    _RUNS[target]=run
    def expected_catalog():
        check(encoded(snapshot(target,ORACLE))==run.before,'OPERATIONS_ORACLE_BASELINE_REQUIRED')
        alignment.run_private(target,ORACLE,batch.ddl(sources,before[0]))
        return snapshot(target,ORACLE)[0]
    expected=clone(target,DATABASE,accepted,expected_catalog)
    check(encoded(snapshot(target))==run.before,'OPERATIONS_PREIMAGE_CHANGED')
    sql=whole_program(sources,before,expected,expected_rows,run.token)
    run=replace(run,program=sql.encode());_RUNS[target]=run
    check_receipt(run_program(target,sql))
    after=snapshot(target)
    check(batch.alignment.catalog.final_equal(before[0],after[0],expected,batch.new_index_keys(sources,before[0]))
          and alignment.rows_equal(after[1],expected_rows),'OPERATIONS_POST_COMMIT_MISMATCH')
    check(batch.validate_sources(paths,staging)==sources,'OPERATIONS_STAGED_SOURCE_CHANGED')
    _RELEASES[target]=replace(run,after=encoded(after))
    return {'sources':3}


def completion(target):
    ref=owned(target);run=_RUNS.get(target);release=_RELEASES.get(target)
    check(type(run) is Release and type(release) is Release and run.reference is ref and release.reference is ref
          and run.alignment_completion is release.alignment_completion is alignment.completion(target)
          and run.staging is release.staging is ref.inputs.staging and run.token==release.token
          and run.before==release.before and run.program==release.program and bool(release.after),
          'OPERATIONS_COMPLETION_LINK_REQUIRED')
    return release


def assert_final(target):
    release=completion(target);alignment.identity(target,DATABASE)
    check(encoded(snapshot(target))==release.after,'OPERATIONS_FINAL_STATE_CHANGED')
    return release


def release_checks(target,full=False):
    ref=owned(target,'OPERATIONS_COMPLETE');frame=sys._getframe(2)
    check(frame.f_code is replay._serve_child.__code__ and frame.f_locals.get('h') is target
          and type(frame.f_locals.get('loop')) is replay.FoundationLoop and frame.f_locals['loop'].target is target
          and frame.f_locals.get('status')==0 and frame.f_locals['child'].poll()==0
          and frame.f_locals['server'].fileno()==-1 and not (Path(ref.directory)/'replay.sock').exists(),
          'SUCCESSFUL_ORIGINAL_CHILD_REQUIRED')
    check(type(full) is bool and full==(ref.alignment.fixed.dedupe.scope=='full'),'OPERATIONS_RELEASE_SCOPE_REQUIRED')
    release=completion(target) if full else assert_final(target)
    check(replay.originals_snapshot()==ref.alignment.fixed.originals,'OPERATIONS_ORIGINALS_RESTORATION_REQUIRED')
    fixed.privacy(target)
    return release
