#!/usr/bin/env python3
"""Complete owned portable clone qualification; no forward promotion or schema acceptance."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
import canonical_forward_sources as forward_sources
import canonical_forward_portable as forward_portable
import canonical_native_final_sql as final_sql
import canonical_changed_function_witness as functions
import canonical_permission_full_seed as full_seed
import canonical_storage_bootstrap as storage_bootstrap
import canonical_storage_policy_scope as storage_policy_scope
from canonical_native_timestamp_snapshot import queries

def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),ROOT/'scripts'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    return module
portable=load('canonical-portable-invariants-diagnostic')
frontier=portable.frontier
execute_final=portable.execute_final
fixture=load('canonical-permission-native-fixture')
CANDIDATE='scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql'
CANDIDATE_SHA='73eb8a8d89b8468783d69f2829658daeb71d7deda667b5f54a9c5650cd6c47ad'
ATOMIC='gridex_auth_legacy_atomic'
PARENT='gridex_auth_legacy_replay'
NAMES=('gridex_private.effective_company_permissions','gridex_private.platform_permissions',
 'public.gridex_get_user_permissions_in_company','public.gridex_get_user_permissions',
 'public.canonical_authenticated_tenant_context_v1_scoped','gridex_private.customer_document_path_allows',
 'public.canonical_manage_platform_user_access','public.canonical_get_platform_user_permission_diagnostic')


def receipt(outcome,phase,progress):
    return dict(scope='FULL_PORTABLE_PERMISSION_CLONE_QUALIFICATION_NOT_PROMOTION',outcome=outcome,
        phase=phase,details=progress,completeReplayVerified=False,schemaAccepted=False,
        ledgerProvenanceVerified=False,generatedTypesVerified=False,productionModified=False)


INPUT_PINS={'scripts/canonical_storage_bootstrap.py': '312e287ed12353fa7b39073d6af6f69cb9e80fbeaeb8239d1f46a6128626325b', 'scripts/canonical_permission_full_seed.py': 'd58f46ad1596cfb73a0bb6cd5769a94b6ffce2020269297015ea80445f0873ee', 'scripts/canonical_changed_function_witness.py': 'a1eff86d0efecc058af45dc54411bb9056bc4cd96e7fa5b057374ee8cdefcce3', 'scripts/canonical-permission-native-fixture.py': '47425b626551df891f6b13c86390ac9b23239cbe26a3651558572778eceab3a8', 'scripts/canonical-portable-invariants-diagnostic.py': '2737b29ea13cd8d666e16e501f81f5c11d270e5c89aac4a9a88291e6bed21cb9', 'scripts/canonical_native_timestamp_snapshot.py': 'e36911fc25dae81d5d8187ddf7de472af602bbad3e6ec68dc4c657dc6fe23757', 'scripts/sql/canonical-user-rbac-repair-catalog.sql': '1d6315ea6d4d542a01e4b697f1cc2b4528a227f2be7e7052f47c8a04166103c7'}


def retained_inputs():
    result=[]
    for name,digest in INPUT_PINS.items():
        path=ROOT/name;raw=path.read_bytes()
        if path.resolve()!=path or hashlib.sha256(raw).hexdigest()!=digest:
            raise ValueError("PERMISSION_QUALIFICATION_SOURCE_REQUIRED")
        result.append((name,raw))
    scope_source=ROOT/'scripts/canonical_storage_policy_scope.py'
    if scope_source.resolve()!=scope_source or hashlib.sha256(scope_source.read_bytes()).hexdigest()!='3ee6247c931b564542ed61b969b7d2e8f1f0d87f2806862b7d10e0ac367530ec':
        raise ValueError('PERMISSION_QUALIFICATION_SOURCE_REQUIRED')
    storage_policy_scope.candidate()
    return tuple(result)


def candidate():
    path=ROOT/CANDIDATE
    raw=path.read_bytes()
    if path.resolve()!=path or hashlib.sha256(raw).hexdigest()!=CANDIDATE_SHA:
        raise ValueError('PERMISSION_CANDIDATE_SOURCE_REQUIRED')
    return raw


def matrix_sql_diagnostic(stderr,stage,state):
    """Project one known error header into fixed labels, never SQL or row values.

    Unqualified PostgreSQL object names stay unqualified: ``table:objects``
    does not prove a schema or authorize any ACL change. This is diagnostic
    metadata only; the caller must still raise the original failure.
    """
    if (stage!='matrix_case' or state not in ('P0001','42501')
            or type(stderr) is not bytes or len(stderr)>65536 or b'\x00' in stderr):
        return {}
    try:
        text=stderr.decode('utf-8')
    except UnicodeDecodeError:
        return {}
    # Reject multiple/ambiguous errors, including errors from a different
    # file. DETAIL, HINT, CONTEXT and SQL lines are never copied into receipts.
    headers=[line.rstrip('\r') for line in text.split('\n')
        if re.match(r'^(?:psql:[^\r\n]+:[0-9]+: )?(?:ERROR|FATAL|PANIC):',line)]
    if len(headers)!=1:
        return {}
    error=re.fullmatch(r'(?:psql:<stdin>:[0-9]+: )?ERROR: +([A-Z0-9]{5}): (.{1,160})',headers[0])
    if error is None or error[1]!=state:
        return {}
    if state=='P0001':
        labels={'actor_identity','actor_role_flags','access_select_own','access_select_foreign',
            'full_access_select_roster','full_access_no_global_row','access_no_table_write',
            'access_no_column_write','storage_visible_rows','expected_sqlstate_mismatch',
            'affected_rows','unchanged_multisets'}
        return {'assertion':error[2]} if error[2] in labels else {}
    denials={
        'permission denied for schema storage':'schema:storage',
        'permission denied for table objects':'table:objects',
        'permission denied for schema gridex_private':'schema:gridex_private',
        'permission denied for function customer_document_path_allows':'function:customer_document_path_allows',
    }
    label=denials.get(error[2])
    return {'deniedObject':label} if label is not None else {}


def private_sql(target,legacy,database,sql,stage,transaction=True):
    stages={'snapshot_catalog','snapshot_rows','snapshot_ledger','changed_function24',
        'eight_function_metadata','effective_acl','candidate_first','candidate_repeat',
        'matrix_identities','matrix_case','local_acl_poison','candidate_acl_recovery'}
    if (stage not in stages or database not in (PARENT,ATOMIC) or type(target) is not legacy.OwnedPostgres
            or getattr(target.command,'__func__',None) is not legacy.OwnedPostgres.command
            or getattr(target.verify_logging,'__func__',None) is not legacy.OwnedPostgres.verify_logging):
        raise ValueError('PERMISSION_OWNED_TARGET_REQUIRED')
    target.verify_logging()
    result=subprocess.run(target.command(database,transaction=transaction)+['-f','-'],
        input=sql.encode() if type(sql) is str else sql,capture_output=True,timeout=420,
        env=legacy.clean_environment())
    target.verify_logging()
    safe=legacy.safe_receipt(result.stderr.decode(errors='replace'),result.returncode,'permission_clone')
    if safe['sqlstate']!='00000' or result.returncode:
        state=safe.get('sqlstate')
        if type(state) is not str or re.fullmatch('[A-Z0-9]{5}',state) is None:state='XXXXX'
        diagnostic=dict(stage='permission_clone_sql_failure',phase=stage,sqlstate=state)
        diagnostic.update(matrix_sql_diagnostic(result.stderr,stage,state))
        print(json.dumps(diagnostic),flush=True)
        raise ValueError('PERMISSION_CLONE_SQL_REQUIRED')
    return result.stdout.decode()


def capture(target,legacy,database):
    catalog,rows=queries()
    return dict(catalog=json.loads(private_sql(target,legacy,database,catalog,'snapshot_catalog')),
        rows=json.loads(private_sql(target,legacy,database,rows,'snapshot_rows')),
        ledger=json.loads(private_sql(target,legacy,database,functions.added.p.LEDGER_SQL,'snapshot_ledger')))


def function_specs(raw):
    matches=re.findall(r'create or replace function ([a-z_0-9.]+)\((.*?)\)\s*returns ([a-z\[\]]+)\s*language (sql|plpgsql)\s*(.*?)as \$function\$(.*?)\$function\$;',raw.decode(),re.S)
    if tuple(x[0] for x in matches)!=NAMES:raise ValueError('PERMISSION_EIGHT_FUNCTIONS_REQUIRED')
    specs=[]
    for name,args,result,lang,settings,body in matches:
        config=re.search(r'set search_path = ([^\n]+)',settings)
        specs.append(dict(name=name,arguments=' '.join(args.split()).replace('timestamptz','timestamp with time zone').replace(' default null',''),defaults='NULL::uuid' if 'default null' in args else None,result=result,language=lang,
            volatility='s' if 'stable' in settings else 'v',definer='security definer' in settings,
            config=['search_path='+config[1]],body=body))
    return specs


def verify_delta(before,after,specs):
    if before['rows']!=after['rows'] or before['ledger']!=after['ledger']:
        raise ValueError('PERMISSION_ROWS_LEDGER_CHANGED')
    changed={k for k in set(before['catalog'])|set(after['catalog']) if before['catalog'].get(k)!=after['catalog'].get(k)}
    function_keys=[]
    for name in NAMES:
        matches=[k for k in after['catalog'] if k.startswith('function/'+name+'(')]
        if len(matches)!=1:raise ValueError('PERMISSION_FUNCTION_IDENTITY_REQUIRED')
        function_keys.extend(matches)
    allowed=set(function_keys)|{'schema/gridex_private'}
    # pg_describe_object uses visibility-aware function names: public functions
    # on the admitted search_path omit public. Build only exact source signature
    # edges, never a prefix exemption for arbitrary dependencies.
    for spec in specs:
        argtypes=[arg.strip().split(' ',1)[1] for arg in spec['arguments'].split(',')]
        names=[spec['name']]
        if spec['name'].startswith('public.'):names.append(spec['name'][7:])
        destinations={'schema '+spec['name'].split('.')[0], 'language '+spec['language']}
        destinations.update('type '+t for t in argtypes+[spec['result']])
        for name in names:
            for destination in destinations:
                key='dependency/function '+name+'('+','.join(argtypes)+')/'+destination+'/n'
                if key not in before['catalog'] and after['catalog'].get(key)=='n':
                    allowed.add(key)
    if changed-allowed:
        print(json.dumps(dict(stage='permission_clone_catalog_rejected',
            unexpectedKeySha256=sorted(hashlib.sha256(k.encode()).hexdigest() for k in changed-allowed))),flush=True)
        raise ValueError('PERMISSION_UNEXPECTED_CATALOG_DELTA')
    if not set(function_keys)<=changed:raise ValueError('PERMISSION_EIGHT_FUNCTION_DELTAS_REQUIRED')
    if 'schema/gridex_private' in before['catalog']:
        a=dict(before['catalog']['schema/gridex_private']);b=dict(after['catalog']['schema/gridex_private'])
        a.pop('acl');b.pop('acl')
        if a!=b:raise ValueError('PERMISSION_SCHEMA_NON_ACL_CHANGED')
    return sorted(changed)


def behavior(target,legacy,database,expected):
    result=json.loads(private_sql(target,legacy,database,functions.render(),'changed_function24',False))
    if result!=dict(caseCount=24,verified=not expected,failedCases=expected):
        known=set(re.findall(r"INSERT INTO changed_function_cases VALUES \('([^']+)'",functions.render()))
        labels=result.get('failedCases') if type(result) is dict else None
        safe=labels if type(labels) is list and all(type(x) is str and x in known for x in labels) else []
        print(json.dumps(dict(stage='permission_clone_behavior_rejected',failedCases=safe)),flush=True)
        raise ValueError('PERMISSION_CLONE_BEHAVIOR_REQUIRED')


def verify_functions(target,legacy,specs):
    names=','.join("'"+n+"'" for n in NAMES)
    sql="""select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,
      'arguments',pg_get_function_identity_arguments(p.oid),'defaults',pg_get_expr(p.proargdefaults,0),'result',pg_get_function_result(p.oid),
      'language',l.lanname,'volatility',p.provolatile,'definer',p.prosecdef,
      'config',p.proconfig,'body',p.prosrc,'owner',pg_get_userbyid(p.proowner)))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
      where n.nspname||'.'||p.proname in ("""+names+");"
    actual=json.loads(private_sql(target,legacy,ATOMIC,sql,'eight_function_metadata'))
    expected=[dict(s,owner='postgres') for s in specs]
    if sorted(actual,key=lambda r:r['name'])!=sorted(expected,key=lambda r:r['name']):
        differences=[]
        for ordinal,want in enumerate(expected,1):
            found=[r for r in actual if r.get('name')==want['name']]
            fields=sorted(k for k in want if len(found)!=1 or found[0].get(k)!=want[k])
            if fields:differences.append(dict(ordinal=ordinal,fields=fields))
        print(json.dumps(dict(stage='permission_clone_function_metadata_rejected',differences=differences)),flush=True)
        raise ValueError('PERMISSION_EXACT_FUNCTION_SOURCE_REQUIRED')


def acl_check(target,legacy):
    helper="""BEGIN; CREATE SCHEMA fixture;
CREATE FUNCTION fixture.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='PC001',MESSAGE='permission_acl_required'; END IF; END $$;
"""
    private_sql(target,legacy,ATOMIC,helper+fixture.acl_assertions()+'ROLLBACK;','effective_acl',False)


def local_acl_poison():
    sql='GRANT USAGE ON SCHEMA gridex_private TO anon;\n'
    for signature in fixture.PRIVATE_SIGNATURES:
        sql+='GRANT EXECUTE ON FUNCTION '+signature+' TO authenticated, service_role;\n'
    for signature in ('public.canonical_manage_platform_user_access(jsonb)',fixture.DIAGNOSTIC_SIGNATURE):
        sql+='GRANT EXECUTE ON FUNCTION '+signature+' TO anon, authenticated;\n'
    sql+='GRANT EXECUTE ON FUNCTION gridex_private.customer_document_path_allows(text,text) TO anon;\n'
    return sql


def matrix(target,legacy,retained,first):
    identities=json.loads(private_sql(target,legacy,ATOMIC,full_seed.identity_query(),'matrix_identities'))
    cases=full_seed.build_cases(retained,identities)
    if len(cases)!=129 or set(cases)!=set(fixture.build_cases()):
        raise ValueError('PERMISSION_FULL_MATRIX_REQUIRED')
    for label,sql in cases.items():
        try:
            output=private_sql(target,legacy,ATOMIC,sql,'matrix_case',False)
            lines=[line for line in output.splitlines() if line.strip()]
            if not lines or lines[-1]!='PERMISSION_CASE_COMPLETE' or lines.count('PERMISSION_CASE_COMPLETE')!=1:
                raise ValueError('PERMISSION_FULL_MATRIX_REQUIRED')
            if capture(target,legacy,ATOMIC)!=first:
                raise ValueError('PERMISSION_MATRIX_ROLLBACK_REQUIRED')
        except Exception:
            print(json.dumps(dict(stage='permission_clone_matrix_failure',case=label)),flush=True)
            raise
    return len(cases)


def qualify(target,legacy,progress):
    functions.actors._complete(progress,False)
    retained=retained_inputs()
    seed_retained=full_seed.retain(ROOT)
    raw=candidate();specs=function_specs(raw)
    parent=capture(target,legacy,PARENT)
    behavior(target,legacy,PARENT,['can_override_allow','can_override_deny'])
    if capture(target,legacy,PARENT)!=parent:raise ValueError('PERMISSION_PARENT_BASELINE_DRIFT')
    target.reset(ATOMIC)
    target.docker(['exec',target.name,'dropdb','-U','postgres',ATOMIC])
    target.docker(['exec',target.name,'createdb','-U','postgres','-T',PARENT,ATOMIC])
    before=capture(target,legacy,ATOMIC)
    if before!=parent:raise ValueError('PERMISSION_CLONE_REQUIRED')
    identities=json.loads(private_sql(target,legacy,ATOMIC,full_seed.identity_query(),'matrix_identities'))
    s21=full_seed.build_cases(seed_retained,identities)['S21']
    progress['storagePolicyScopeQualification']=storage_policy_scope.qualify(
        target,legacy,ATOMIC,lambda: capture(target,legacy,ATOMIC),s21)
    before=capture(target,legacy,ATOMIC)
    private_sql(target,legacy,ATOMIC,raw,'candidate_first',False)
    first=capture(target,legacy,ATOMIC)
    deltas=verify_delta(before,first,specs)
    verify_functions(target,legacy,specs)
    acl_check(target,legacy)
    behavior(target,legacy,ATOMIC,[])
    if capture(target,legacy,ATOMIC)!=first:raise ValueError('PERMISSION_ORACLE_ROLLBACK_REQUIRED')
    private_sql(target,legacy,ATOMIC,raw,'candidate_repeat',False)
    if capture(target,legacy,ATOMIC)!=first:raise ValueError('PERMISSION_REPEAT_REQUIRED')
    private_sql(target,legacy,ATOMIC,local_acl_poison(),'local_acl_poison')
    if capture(target,legacy,ATOMIC)==first:raise ValueError('PERMISSION_ACL_POISON_CONTROL_REQUIRED')
    private_sql(target,legacy,ATOMIC,raw,'candidate_acl_recovery',False)
    if capture(target,legacy,ATOMIC)!=first:raise ValueError('PERMISSION_ACL_RECOVERY_REQUIRED')
    acl_check(target,legacy)
    matrix_count=matrix(target,legacy,seed_retained,first)
    if full_seed.retain(ROOT)!=seed_retained:raise ValueError('PERMISSION_QUALIFICATION_SOURCE_REQUIRED')
    if capture(target,legacy,PARENT)!=parent or candidate()!=raw or retained_inputs()!=retained:
        raise ValueError('PERMISSION_PARENT_SOURCE_PRESERVATION_REQUIRED')
    return dict(candidateSha256=CANDIDATE_SHA,baselineFailedCases=['can_override_allow','can_override_deny'],
        repairedCases=24,exactFunctions=8,catalogDeltaSha256=hashlib.sha256(json.dumps(deltas).encode()).hexdigest(),
        repeatVerified=True,rowsPreserved=True,ledgerPreserved=True,parentPreserved=True,
        effectiveAclVerified=True,fullCloneAclPoisonRecoveryVerified=True,customRoleInheritedRecoveryVerified=False,
        matrix129Verified=matrix_count==129,matrixCases=matrix_count,promoted=False)


def run():
    if len(sys.argv) != 1:
        raise ValueError('NO_TARGET_OR_SCOPE_ARGUMENTS_ACCEPTED')
    retained_inputs();candidate();full_seed.retain(ROOT)
    controller = frontier.load_controller()
    order, report = frontier.verify_selection(controller)
    timestamp = frontier.load_timestamp()
    selected, prerequisites = timestamp.load_inputs(ROOT, report, order)
    legacy = controller.load_batch()
    retained = timestamp.retain_sources(ROOT, selected, prerequisites)
    forwards = forward_sources.retain(ROOT)
    final = final_sql.retain(ROOT)

    def interrupted(_signum, _frame):
        raise legacy.BoundaryError('INTERRUPTED')

    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    before = controller.originals_snapshot()
    result = None
    phase = 'OWNED_TARGET'
    progress = {'foundationApplied': 0, 'timestampApplied': 0}
    with legacy.OwnedPostgres(postgis=True, storage_dml=True) as target:
        private_directory = Path(target.directory.name)
        try:
            phase = 'SPATIAL_RUNTIME_ADMISSION'
            progress['runtime'] = timestamp.verify_spatial_runtime(target)
            phase = 'PRIVATE_INPUT_ADMISSION'
            with controller.load_private().AcceptedInputs(target):
                phase = 'INDEPENDENT_REFERENCES'
                controller.load_dedupe().prepare_reference(target, 'full')
                phase = 'FRESH_TARGET'
                controller.load_dedupe().fresh_target(target)
                phase = 'SOURCE_STAGING'
                hold = Path(target.directory.name) / 'frontier-hold'
                hold.mkdir(mode=0o700)
                for source in (ROOT / 'supabase/migrations').iterdir():
                    if source.is_symlink():
                        raise legacy.BoundaryError('SYMLINK_SOURCE_REJECTED')
                    if source.is_file() and source.suffix == '.sql':
                        shutil.copy2(source, hold / source.name)
                paths = [str(hold / Path(rel).name if rel.startswith('migrations/')
                             else ROOT / 'supabase' / rel) for rel in order]
                phase = 'FOUNDATION_ADMISSION'
                loop = controller.FoundationLoop(legacy, target, 'full')
                loop.validate(str(hold), paths)
                phase = 'PLATFORM_BOOTSTRAP'
                target.sql(controller.DATABASE,
                           target.bootstrap_sql(),
                           'frontier_bootstrap', transaction=False)
                storage_bootstrap.validate(json.loads(target.sql(controller.DATABASE, storage_bootstrap.CAPTURE,
                    'storage_bootstrap_dml_profile')), allowed=True)
                progress['storageBootstrapDmlChecks'] = 24
                phase = 'SELECTED_FOUNDATION_EXECUTION'
                loop.run(str(hold), paths)
                progress['foundationApplied'] = 144
                phase = 'SELECTED_TIMESTAMP_EXECUTION'
                timestamp.execute_tail(ROOT, target, controller.DATABASE, selected, prerequisites, progress, retained=retained)
                phase = 'FORWARD_EXECUTION'
                forward_portable.execute(target, forwards, progress)
                phase = 'PINNED_FINAL_SQL'
                execute_final(target, legacy, final, progress)
                phase = 'FULL_PERMISSION_CLONE_QUALIFICATION'
                progress['permissionQualification'] = qualify(target, legacy, progress)
                result = receipt('PORTABLE_PERMISSION_CLONE_PASSED_NOT_CERTIFIED', phase, progress)
        except Exception as error:
            allowed={'PERMISSION_CANDIDATE_SOURCE_REQUIRED','PERMISSION_EIGHT_FUNCTIONS_REQUIRED',
                'PERMISSION_OWNED_TARGET_REQUIRED','PERMISSION_CLONE_SQL_REQUIRED','PERMISSION_ROWS_LEDGER_CHANGED',
                'PERMISSION_FUNCTION_IDENTITY_REQUIRED','PERMISSION_UNEXPECTED_CATALOG_DELTA',
                'PERMISSION_EIGHT_FUNCTION_DELTAS_REQUIRED','PERMISSION_SCHEMA_NON_ACL_CHANGED',
                'PERMISSION_CLONE_BEHAVIOR_REQUIRED','PERMISSION_EXACT_FUNCTION_SOURCE_REQUIRED',
                'PERMISSION_PARENT_BASELINE_DRIFT','PERMISSION_CLONE_REQUIRED','PERMISSION_ORACLE_ROLLBACK_REQUIRED',
                'PERMISSION_REPEAT_REQUIRED','PERMISSION_PARENT_SOURCE_PRESERVATION_REQUIRED',
                'PERMISSION_FULL_MATRIX_REQUIRED','PERMISSION_MATRIX_ROLLBACK_REQUIRED',
                'PERMISSION_ACL_POISON_CONTROL_REQUIRED','PERMISSION_ACL_RECOVERY_REQUIRED',
                'PERMISSION_QUALIFICATION_SOURCE_REQUIRED'}
            allowed.update(storage_policy_scope.FAILURE_CODES)
            code=error.args[0] if type(error) is ValueError and len(error.args)==1 and type(error.args[0]) is str and error.args[0] in allowed else 'UNCLASSIFIED'
            progress['failureCode']=code
            result = receipt('BLOCKED', phase, progress)
        # Preserve the exact original source tree: there is no checkout staging,
        # restoration, source/manifest rewrite or schema baseline publication.
        if controller.originals_snapshot() != before:
            raise legacy.BoundaryError('SOURCE_PRESERVATION_FAILED')
    if target.active:
        raise legacy.BoundaryError('OWNED_CLEANUP_REQUIRED')
    result.update(ownedCleanupVerified=True, privateWorkspaceRemoved=target.directory is None and not private_directory.exists(), sourcePreserved=True)
    if result['privateWorkspaceRemoved'] is not True:
        raise ValueError('PRIVATE_DISPOSAL_REQUIRED')
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0 if result['outcome'] == 'PORTABLE_PERMISSION_CLONE_PASSED_NOT_CERTIFIED' else 1


if __name__=='__main__':
    try:raise SystemExit(run())
    except Exception:
        print(json.dumps(receipt('HARNESS_ERROR','DISPOSAL_OR_ADMISSION',{})),flush=True)
        raise SystemExit(2) from None
