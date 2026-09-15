"""Rollback-only real behavior witnesses for two source-defined changed RPCs.

No helper substitution, role grant, reference rewrite or acceptance shortcut.
The parent owns complete native ledger admission and subsequent disposal.
Intended permission override decisions deliberately fail on the unrepaired
shared evaluator; delegation alone cannot certify the missing deny semantics.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess

import canonical_policy_actor_qualification as actors
import canonical_added_view_witness as added

ROOT = Path(__file__).resolve().parents[1]
# Prior explicit controller decision, independently supported by the authored
# override reader (inclusive windows), UI (allow/deny beyond role), and F-18
# any-active-membership contract. No proposed repair is used as an oracle.
OVERRIDE_SPEC = 'quality/audits/PERMISSION_ALGEBRA_DECISIONS_2026-09-12.md'
PINS = {
    'supabase/migrations/20260523_db3_tenant_isolation_rbac_enforcement.sql':
        'ac4d51086e0d6865de6012cc5e84ca524a59c094daccf987261afa2580a9f450',
    'supabase/migrations/20260801143000_canonical_multitenant_platform_hardening.sql':
        '4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0',
    'supabase/migrations/20260611190000_launch_linter_hardening_security_definer_rls.sql':
        'b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1',
    OVERRIDE_SPEC: '2a0689a5804647f00c278636105f1adbfc26a5c7be8bf99759c675ccda8ab20c',
    'supabase/migrations/20260526_debug_step1_2c_full_schema_code_alignment.sql':
        '5a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472',
    'supabase/migrations/20260902100000_rpc_surface_and_permission_scope_corrections.sql':
        '9753cd0f10a120a32826286a0eeb08d6f7e2b51704014decf60243e5eaa1a919',
    'app/admin/users/[id]/page.tsx':
        '43189fa3a474b1978d7b200b7f9dd44db20c6a7f05cdf6b438bf6f2f0450aed9',
}
CAPABILITY_MD5 = 'eb2202c2400cb886e4c07485125ff1fa'
CAN_MD5 = '4492e24fb6777ba8c4ef045f78135218'
A = 'cb310000-0000-4000-8000-000000000001'
B = 'cb310000-0000-4000-8000-000000000002'
USER = 'cb310100-0000-4000-8000-000000000001'
ADMIN = 'cb310100-0000-4000-8000-000000000002'
ROLE = 'cb310200-0000-4000-8000-000000000001'
PERMISSION = 'cb310300-0000-4000-8000-000000000001'
EXTRA = 'cb310300-0000-4000-8000-000000000002'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def contract(retained):
    if (type(retained) is not tuple or len(retained) != len(PINS)
            or any(type(row) is not tuple or len(row) != 2 for row in retained)
            or tuple(name for name, _ in retained) != tuple(PINS)
            or any(type(raw) is not bytes or sha(raw) != PINS[name] for name, raw in retained)):
        raise ValueError('CHANGED_FUNCTION_SOURCE_REQUIRED')
    return retained


def retain(root):
    try:
        rows = []
        for name in PINS:
            path = Path(root) / name
            if path.resolve() != path or not path.is_file():
                raise ValueError('CHANGED_FUNCTION_SOURCE_REQUIRED')
            rows.append((name, path.read_bytes()))
        return contract(tuple(rows))
    except OSError:
        raise ValueError('CHANGED_FUNCTION_SOURCE_REQUIRED') from None


def case(label, expression, expected, *, actor=USER, role='authenticated'):
    """Internal fixed renderer; neither SQL nor actor is an execution argument."""
    claims = json.dumps({'sub': actor, 'role': role}) if actor else json.dumps({'role': role})
    return f"""
DO $case$ DECLARE actual boolean; BEGIN
  PERFORM set_config('request.jwt.claim.sub','{actor or ''}',true);
  PERFORM set_config('request.jwt.claim.role','{role}',true);
  PERFORM set_config('request.jwt.claims','{claims}',true);
  SET LOCAL ROLE {role};
  SELECT ({expression}) INTO actual;
  RESET ROLE;
  INSERT INTO changed_function_cases VALUES ('{label}',actual IS NOT DISTINCT FROM {str(expected).lower()});
END $case$;
"""


def render():
    sql = f"""BEGIN;
SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog,public;
DO $admit$ BEGIN
 IF current_user<>'postgres' OR current_setting('server_version_num')::int/10000<>17
  OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('public.canonical_company_capability_enabled(uuid,text)')
    AND NOT prosecdef AND provolatile='s' AND prorettype='boolean'::regtype
    AND md5(pg_get_functiondef(oid))='{CAPABILITY_MD5}')
  OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('public.gridex_can(text)')
    AND NOT prosecdef AND provolatile='s' AND prorettype='boolean'::regtype
    AND md5(pg_get_functiondef(oid))='{CAN_MD5}')
  OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated' AND NOT rolsuper AND NOT rolbypassrls)
  OR NOT EXISTS(SELECT FROM pg_class WHERE oid='public.company_capabilities'::regclass AND relrowsecurity)
 THEN RAISE EXCEPTION 'CHANGED_FUNCTION_DEFINITIONS_REQUIRED' USING ERRCODE='CF001'; END IF;
END $admit$;
CREATE TEMP TABLE changed_function_cases(label text PRIMARY KEY,passed boolean NOT NULL) ON COMMIT DROP;
INSERT INTO public.companies(id,name,slug,status,lifecycle_status) VALUES
 ('{A}','Changed function A','changed-function-fixture-a','active','active'),
 ('{B}','Changed function B','changed-function-fixture-b','active','active');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES
 ('{USER}','authenticated','authenticated','changed-function-user@example.invalid',now(),'{{}}','{{}}'),
 ('{ADMIN}','authenticated','authenticated','changed-function-admin@example.invalid',now(),'{{}}','{{}}');
INSERT INTO public.user_profiles(id,email,user_status,auth_email_confirmed_at) VALUES
 ('{USER}','changed-function-user@example.invalid','active',now()),
 ('{ADMIN}','changed-function-admin@example.invalid','active',now())
 ON CONFLICT(id) DO UPDATE SET user_status='active',auth_email_confirmed_at=excluded.auth_email_confirmed_at;
INSERT INTO public.roles(id,key,name,scope,is_active) VALUES
 ('{ROLE}','changed_function_operator','changed_function_operator','company',true);
INSERT INTO public.company_memberships(company_id,user_id,membership_role,role_key,role_id,status,is_active)
 VALUES ('{A}','{USER}','operations','operations','{ROLE}','active',true);
INSERT INTO public.user_roles(user_id,company_id,role_id,status,is_active)
 VALUES ('{USER}','{A}','{ROLE}','active',true);
INSERT INTO public.admin_users(user_id,role,is_active) VALUES ('{ADMIN}','super_admin',true);
INSERT INTO public.permissions(id,key,name) VALUES
 ('{PERMISSION}','changed_function.read','changed_function.read'),
 ('{EXTRA}','changed_function.extra','changed_function.extra');
INSERT INTO public.role_permissions(role_id,permission_id,effect) VALUES ('{ROLE}','{PERMISSION}','allow');
INSERT INTO public.company_capabilities(company_id,capability_code,enabled,readiness_status) VALUES
 ('{A}','changed_function_ready',true,'ready'),
 ('{A}','changed_function_disabled',false,'ready'),
 ('{A}','changed_function_blocked',false,'blocked'),
 ('{B}','changed_function_ready',true,'ready');
"""
    for label, company, code, expected, role in (
        ('cap_own_ready', A, 'changed_function_ready', True, 'authenticated'),
        ('cap_other_denied', B, 'changed_function_ready', False, 'authenticated'),
        ('cap_disabled', A, 'changed_function_disabled', False, 'authenticated'),
        ('cap_blocked', A, 'changed_function_blocked', False, 'authenticated'),
        ('cap_missing', A, 'changed_function_missing', False, 'authenticated'),
        ('cap_service', B, 'changed_function_ready', True, 'service_role')):
        sql += case(label, f"public.canonical_company_capability_enabled('{company}','{code}')", expected,
                    role=role, actor=None if role == 'service_role' else USER)
    sql += case('cap_null_company', "public.canonical_company_capability_enabled(NULL,'changed_function_ready')", False)
    sql += case('cap_null_code', f"public.canonical_company_capability_enabled('{A}',NULL)", False)
    sql += case('can_role_allow', "public.gridex_can('changed_function.read')", True)
    sql += case('can_unknown', "public.gridex_can('changed_function.missing')", False)
    sql += case('can_null_permission', 'public.gridex_can(NULL)', False)
    sql += case('can_no_identity', "public.gridex_can('changed_function.read')", False, actor=None)
    sql += case('can_service_no_identity', "public.gridex_can('changed_function.read')", False, actor=None, role='service_role')
    sql += case('can_platform', "public.gridex_can('changed_function.missing')", True, actor=ADMIN)
    sql += case('can_delegates', "public.gridex_can('changed_function.read')=public.gridex_has_permission(auth.uid(),'changed_function.read')", True)
    sql += f"UPDATE public.roles SET is_active=false WHERE id='{ROLE}';\n"
    sql += case('can_inactive_role', "public.gridex_can('changed_function.read')", False)
    sql += f"UPDATE public.roles SET is_active=true WHERE id='{ROLE}';\n"
    sql += f"UPDATE public.company_memberships SET status='disabled',is_active=false WHERE user_id='{USER}' AND company_id='{A}';\n"
    sql += case('can_inactive_membership', "public.gridex_can('changed_function.read')", False)
    sql += f"UPDATE public.company_memberships SET status='active',is_active=true WHERE user_id='{USER}' AND company_id='{A}';\n"
    # These are intended decisions, not a mirror of the current omission.
    sql += f"INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect) VALUES ('{USER}','{A}','changed_function.extra','allow');\n"
    sql += case('can_override_allow', "public.gridex_can('changed_function.extra')", True)
    sql += case('can_override_delegates', "public.gridex_can('changed_function.extra')=public.gridex_has_permission(auth.uid(),'changed_function.extra')", True)
    sql += f"UPDATE public.user_permission_overrides SET is_active=false WHERE user_id='{USER}';\n"
    sql += case('can_override_inactive', "public.gridex_can('changed_function.extra')", False)
    sql += f"UPDATE public.user_permission_overrides SET is_active=true,valid_to=now()-interval '1 day' WHERE user_id='{USER}';\n"
    sql += case('can_override_expired', "public.gridex_can('changed_function.extra')", False)
    sql += f"UPDATE public.user_permission_overrides SET valid_to=NULL,valid_from=now()+interval '1 day' WHERE user_id='{USER}';\n"
    sql += case('can_override_future', "public.gridex_can('changed_function.extra')", False)
    sql += f"UPDATE public.user_permission_overrides SET valid_from=NULL,company_id='{B}' WHERE user_id='{USER}';\n"
    sql += case('can_override_other_company', "public.gridex_can('changed_function.extra')", False)
    sql += f"INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect) VALUES ('{USER}','{A}','changed_function.read','deny');\n"
    sql += case('can_override_deny', "public.gridex_can('changed_function.read')", False)
    sql += """
SELECT jsonb_build_object('caseCount',count(*),'verified',bool_and(passed),
 'failedCases',coalesce(jsonb_agg(label ORDER BY label) FILTER(WHERE NOT passed),'[]'::jsonb))
 FROM changed_function_cases;
ROLLBACK;
"""
    return sql


def verify_result(result, progress):
    known = set(re.findall(r"INSERT INTO changed_function_cases VALUES \('([^']+)'", render()))
    if (type(result) is not dict or set(result) != {'caseCount','verified','failedCases'}
            or type(result.get('caseCount')) is not int or result['caseCount'] != 24
            or type(result.get('verified')) is not bool or type(result.get('failedCases')) is not list
            or any(type(label) is not str or label not in known for label in result['failedCases'])
            or result['failedCases'] != sorted(set(result['failedCases']))
            or result['verified'] is not (not result['failedCases'])):
        raise ValueError('CHANGED_FUNCTION_RESULT_REQUIRED')
    if result['failedCases']:
        # Only finite authored labels leave the owned fixture; no SQL/row data.
        progress['changedFunctionBehaviorWitness']['failedCases'] = result['failedCases']
        raise ValueError('CHANGED_FUNCTION_BEHAVIOR_REQUIRED')


def expected_receipt(*, native):
    return dict(scope='TWO_CHANGED_FUNCTION_BEHAVIORS_NOT_FULL_SCHEMA_ACCEPTANCE', verified=True,
                caseCount=24, nativeTarget=native, sourcePins=PINS,
                sqlSha256=sha(render().encode()), catalogAndRowsPreserved=True,
                ledgerUnchanged=True, fixturesRolledBack=True, permissionOverridesVerified=True,
                permissionSpecificationSource=OVERRIDE_SPEC, permissionSpecificationExecuted=False,
                schemaAccepted=False, generatedTypesVerified=False, ledgerProvenanceAccepted=False)


def validate_execution_receipt(receipt, *, native):
    if (type(native) is not bool or type(receipt) is not dict
            or json.dumps(receipt, sort_keys=True) != json.dumps(expected_receipt(native=native), sort_keys=True)):
        raise ValueError('CHANGED_FUNCTION_RESULT_REQUIRED')
    return receipt


def sources_preserved(retained, native):
    contract(retained)
    if native:
        return retain(ROOT) == retained
    directory = ROOT/'supabase/migrations'
    return directory.is_dir() and not list(directory.glob('*.sql')) and all(
        not (ROOT/name).exists() if name.startswith('supabase/migrations/')
        else (ROOT/name).read_bytes() == raw for name, raw in retained)


def execute_query(target, database, native):
    sql=render()
    if native:
        return target.sql(database,sql,'changed_function_behavior_witness',transaction=False)
    # Keep fixed fixture SQL in memory, as with the view witness transport.
    # The existing owner still checks its immutable source and privacy boundary.
    legacy=actors._controller().load_batch()
    if (type(target) is not legacy.OwnedPostgres
            or getattr(target.command,'__func__',None) is not legacy.OwnedPostgres.command
            or getattr(target.verify_logging,'__func__',None) is not legacy.OwnedPostgres.verify_logging):
        raise ValueError('CHANGED_FUNCTION_OWNED_TARGET_REQUIRED')
    target.verify_logging()
    result=subprocess.run(target.command(database,(),transaction=False)+['-f','-'],
                          input=sql.encode(),capture_output=True,timeout=150,env=legacy.clean_environment())
    actors._admit(target)
    target.verify_logging()
    receipt=legacy.safe_receipt(result.stderr.decode(errors='replace'),result.returncode,'changed_function_behavior_witness')
    if receipt['sqlstate']!='00000' or result.returncode!=0:
        state = receipt.get('sqlstate')
        if type(state) is not str or re.fullmatch(r'[A-Z0-9]{5}', state) is None:
            state = 'XXXXX'
        print(json.dumps({'stage': 'changed_function_portable_sql_failure',
                          'category': 'SQL_EXECUTION_FAILED', 'sqlstate': state}, sort_keys=True), flush=True)
        raise ValueError('CHANGED_FUNCTION_BEHAVIOR_REQUIRED')
    return result.stdout.decode()


def execute(target, retained, progress):
    contract(retained)
    database, native = actors._admit(target)
    actors._complete(progress, native)
    if 'changedFunctionBehaviorWitness' in progress:
        raise ValueError('CHANGED_FUNCTION_ONCE_REQUIRED')
    progress['changedFunctionBehaviorWitness'] = dict(verified=False, schemaAccepted=False, generatedTypesVerified=False)
    before = actors._snapshot(target, database, native)
    prior = added.ledger(target, database)
    try:
        result = json.loads(execute_query(target, database, native))
        verify_result(result, progress)
    except Exception:
        raise ValueError('CHANGED_FUNCTION_BEHAVIOR_REQUIRED') from None
    finally:
        if (actors._admit(target) != (database, native)
                or actors._snapshot(target, database, native) != before
                or added.ledger(target, database) != prior or not sources_preserved(retained, native)):
            raise ValueError('CHANGED_FUNCTION_PRESERVATION_REQUIRED')
    receipt = validate_execution_receipt(expected_receipt(native=native), native=native)
    progress['changedFunctionBehaviorWitness'] = receipt
    return receipt
