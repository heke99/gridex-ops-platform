#!/usr/bin/env python3
"""One-table PG17 privilege boundary with real predicates and synthetic actors.

Never a full canonical RPC/application graph or actual Auth-helper qualification.
Only the fixed disposable service and nonce-owned database are admitted.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('send_lock_fixture_owner', ROOT / 'scripts/canonical-composite-customer-fk-selftest.py')
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
TABLES = ('ediel_send_locks',)
PRIVILEGES = ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
CANDIDATE = ROOT / 'scripts/sql/forward-candidates/restrict-ediel-send-lock-client-writes.sql'
CANDIDATE_SHA = '411df92fc01f8b84dd9a83600464594e76a4841d48928d52dfadfd97b3177705'
SOURCE_PINS = {'supabase/schema.sql': 'b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30', 'supabase/migrations/20260601070000_ediel_production_readiness_hardening.sql': '7a73e59f559ebb5291d3e7df74545e6918011ec9764e5c512df19fbaa5bdbc12', 'supabase/migrations/20260602093200_ediel_operations_rls_completion.sql': 'e921919e6effc234a247d17164afa695815271898146c306626c9e0ecf166e75', 'supabase/migrations/20260802011000_canonical_ediel_production_state.sql': '7f50878b2c23889c967bceab5aa85ed0361af7aad9b3a3784b688e6cbd2bb502', 'supabase/migrations/20260815114530_restore_pre_engine_live_ediel_approval.sql': '6850a14fc8154dc538192a525031409e04c7f0da740a4414a9add9f1b268ed29', 'supabase/migrations/20260902094600_fix_canonical_transition_request_hash_rewrite.sql': '4b167c6509b8f3a9076adbe98f24ae5e74981de05501828648045b3d6db3c0ca', 'supabase/migrations/20260903160000_ediel_send_lock_state_convergence.sql': '1f368f4a36e9ac93d09289c4538d142f7489746793aff110d9f593eaa0c7bafd', 'supabase/migrations/20260903161000_ediel_send_lock_release_requeues_outbox.sql': 'ed0affa427b7356064a474a4e390dc70cf8297fa39c0b5e7c4e1edc1255c48c1', 'supabase/migrations/20260815210353_restrict_recent_security_definer_rpcs.sql': '5e2a5542b30bb560911645015382cf87029004f3adba03575f270f9377b93d69', 'supabase/migrations/20260815114814_restore_pre_engine_live_ediel_approval_uuid_aggregate_hotfix.sql': '4bb48b081c68fa11e5ca0fb8106aa2448ad62b50f266ff2be241fddd7882c650'}
ACTUAL_ROWS = [{'nspname': 'public', 'relname': 'ediel_send_locks', 'polname': 'gridex_mp_4fc7c88588b93b1e8b6f', 'command': 'a', 'permissive': True, 'roles': ['authenticated'], 'using_expression': '', 'check_expression': '( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR company_id IS NOT NULL AND gridex_can_write_company(company_id) OR ( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin)'}, {'nspname': 'public', 'relname': 'ediel_send_locks', 'polname': 'gridex_mp_d31ac6d667cda6f43cf7', 'command': 'w', 'permissive': True, 'roles': ['authenticated'], 'using_expression': '( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR company_id IS NOT NULL AND gridex_can_read_company(company_id) OR ( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin)', 'check_expression': '( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR company_id IS NOT NULL AND gridex_can_write_company(company_id) OR ( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin)'}, {'nspname': 'public', 'relname': 'ediel_send_locks', 'polname': 'gridex_perf_authenticated_select_v1', 'command': 'r', 'permissive': True, 'roles': ['authenticated'], 'using_expression': 'true', 'check_expression': ''}]
ACTUAL_HASHES = ['ab884aab91bd11ae84ca1b86f96c9b02a7d7396dc9756043d3a528587aced529', '7d0dbea7e2bf08fd09e865691864f44f988a760a910ddddcaa4633e45f9ec9f2', '3828b4087163470d43f1e4feca9d1650e3235040315bb0cd222fb01682a72480']


def read_candidate(path=CANDIDATE):
    path = Path(path).absolute()
    if path.resolve() != path or not path.is_file():
        raise ValueError('EXACT_CANDIDATE_REQUIRED')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != CANDIDATE_SHA:
        raise ValueError('EXACT_CANDIDATE_REQUIRED')
    return data.decode('utf-8')


def selection():
    candidate = read_candidate()
    files = {name: fixture.read_pinned(ROOT / name, digest) for name,digest in SOURCE_PINS.items()}
    for row,digest in zip(ACTUAL_ROWS,ACTUAL_HASHES):
        if fixture.sha(row) != digest:
            raise ValueError('EXACT_ACTUAL_POLICY_REQUIRED')
    reference = files['supabase/schema.sql']
    policies = re.findall(r'^CREATE POLICY [^\n]+ ON public\.ediel_send_locks [^\n]+;',reference,re.M)
    if len(policies) != 7:
        raise ValueError('EXACT_REFERENCE_POLICIES_REQUIRED')
    convergence = files['supabase/migrations/20260903160000_ediel_send_lock_state_convergence.sql']
    function = fixture.exactly_one(r'(create or replace function private\.ediel_send_lock_state_convergence_trigger\(\).*?\$\$;)',convergence)
    trigger = fixture.exactly_one(r'(create trigger ediel_send_lock_state_convergence\s+.*?;)',convergence)
    restore = files['supabase/migrations/20260815114530_restore_pre_engine_live_ediel_approval.sql']
    for fragment in ('security definer', 'if not public.canonical_actor_is_platform_admin(p_actor_user_id)',
                     'update public.ediel_send_locks', 'to authenticated, service_role;'):
        if fragment not in restore:
            raise ValueError('REAL_RESTORE_RPC_CONTRACT_REQUIRED')
    final_acl = files['supabase/migrations/20260815210353_restrict_recent_security_definer_rpcs.sql']
    if ('from public, anon, authenticated;' not in final_acl or 'to service_role;' not in final_acl):
        raise ValueError('REAL_RESTORE_FINAL_SERVICE_ACL_REQUIRED')
    return candidate, policies, function + '\n' + trigger


def verify_delta(before, after):
    expected = copy.deepcopy(before)
    expected['acl'] = [row for row in expected['acl'] if not (
        row[0]=='public' and row[1]=='ediel_send_locks' and row[3]=='authenticated' and row[4] in PRIVILEGES)]
    if after != expected:
        raise ValueError('EXACT_CLIENT_WRITE_DELTA_REQUIRED')


def state():
    catalog = json.loads(fixture.sql("""select jsonb_build_object(
      'relations',(select jsonb_agg(jsonb_build_array(c.oid,n.nspname,c.relname,c.relkind,c.relowner,
        c.relrowsecurity,c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','control','private')),
      'columns',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid
        where c.relnamespace in ('public'::regnamespace,'control'::regnamespace,'private'::regnamespace) and a.attnum>0),
      'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
      'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c
        where c.connamespace in ('public'::regnamespace,'control'::regnamespace,'private'::regnamespace)),
      'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where c.relnamespace in ('public'::regnamespace,'control'::regnamespace,'private'::regnamespace)),
      'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
        where p.pronamespace in ('public'::regnamespace,'control'::regnamespace,'private'::regnamespace)),
      'schemas',(select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n where n.nspname in ('public','control','private')),
      'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d),
      'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
      'memberships',(select jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor) from pg_auth_members m));"""))
    acl = json.loads(fixture.sql("""select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,
      pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type,a.is_grantable) order by n.nspname,c.relname,a.grantor,a.grantee,a.privilege_type),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where n.nspname in ('public','control','private') and c.relkind in ('r','v');"""))
    relations = json.loads(fixture.sql("""select jsonb_agg(jsonb_build_array(n.nspname,c.relname) order by n.nspname,c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','control','private') and c.relkind in ('r','v');"""))
    rows = {}
    for schema, table in relations:
        if not re.fullmatch('[a-z_]+', schema) or not re.fullmatch('[a-z_]+', table):
            raise ValueError('FIXTURE_IDENTIFIER_REQUIRED')
        rows[schema + '.' + table] = json.loads(fixture.sql(
            f"select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from {schema}.{table} t;"))
    return dict(catalog=catalog, acl=acl, rows=rows)


def actor(kind='operations'):
    if kind not in ('operations','platform','member'):
        raise ValueError('FIXED_ACTOR_REQUIRED')
    return f"begin; set local role authenticated; set local fixture.actor='{kind}'; "


def setup(policies, convergence):
    fixture.sql("""create schema control; create schema private;
      grant usage on schema public,control to authenticated,service_role,anon;
      create function public.gridex_user_is_platform_admin() returns boolean language sql stable
        as $$select current_setting('fixture.actor',true)='platform'$$;
      create function public.gridex_is_current_session_allowed() returns boolean language sql stable
        as $$select true$$;
      create function public.gridex_user_company_ids() returns setof uuid language sql stable
        as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
      create function public.gridex_can_read_company(uuid) returns boolean language sql stable
        as $$select public.gridex_user_is_platform_admin() or $1 in (select public.gridex_user_company_ids())$$;
      create function public.gridex_can_write_company(uuid) returns boolean language sql stable
        as $$select public.gridex_user_is_platform_admin() or
          (current_setting('fixture.actor',true)='operations' and public.gridex_can_read_company($1))$$;
      create table public.ediel_send_locks(id integer primary key,company_id uuid not null,
        locked boolean not null,status text not null,marker text);
      insert into public.ediel_send_locks values
        (1,'00000000-0000-0000-0000-000000000001',true,'active','retained_a'),
        (2,'00000000-0000-0000-0000-000000000002',true,'active','retained_b');
      alter table public.ediel_send_locks enable row level security;
      grant all on public.ediel_send_locks to authenticated,service_role;
      grant select(marker) on public.ediel_send_locks to authenticated;
      create policy synthetic_service_all on public.ediel_send_locks to service_role using(true) with check(true);
      create function public.synthetic_platform_restore() returns void language plpgsql security definer
        set search_path=pg_catalog,public as $$begin
          if not public.gridex_user_is_platform_admin() then
            raise exception using errcode='42501',message='SYNTHETIC_PLATFORM_REQUIRED';
          end if;
          update public.ediel_send_locks set locked=false where id=1;
        end$$;
      revoke all on function public.synthetic_platform_restore() from public;
      grant execute on function public.synthetic_platform_restore() to authenticated,service_role;
      comment on function public.synthetic_platform_restore() is
        'Synthetic definer privilege boundary, not the real canonical restore business graph';""")
    fixture.sql('\n'.join(policies) + '\n' + convergence)
    for schema, table in [('public','outside_targets'),('control','ediel_send_locks')]:
        fixture.sql(f"""create table {schema}.{table}(id integer primary key,marker text);
          insert into {schema}.{table} values(1,'outside_retained');
          grant all on {schema}.{table} to authenticated,service_role;
          grant select(marker) on {schema}.{table} to authenticated;""")


def install_actual_auth_policies():
    statements = ['drop policy ediel_send_locks_tenant_'+action+' on public.ediel_send_locks;'
                  for action in ('insert','update','select')]
    for row in ACTUAL_ROWS:
        statement = 'create policy '+row['polname']+' on public.ediel_send_locks for '+{
            'a':'insert','w':'update','r':'select'}[row['command']]+' to authenticated'
        if row['using_expression']:
            statement += ' using ('+row['using_expression']+')'
        if row['check_expression']:
            statement += ' with check ('+row['check_expression']+')'
        statements.append(statement+';')
    fixture.sql('\n'.join(statements))


def verify_reads():
    for kind,count in [('operations',1),('member',1),('platform',2)]:
        if fixture.sql(actor(kind)+f'select count(*)={count} from public.ediel_send_locks; rollback;')!='t':
            raise ValueError('RETAINED_READ_BOUNDARY_REQUIRED')


def verify_original():
    before=state()
    verify_reads()
    for kind in ('operations','platform'):
        result=fixture.sql(actor(kind)+"""
          insert into public.ediel_send_locks values
            (3,'00000000-0000-0000-0000-000000000001',true,'released','insert_probe');
          select locked and status='active' from public.ediel_send_locks where id=3;
          update public.ediel_send_locks set locked=false where id=1;
          select not locked and status='released' from public.ediel_send_locks where id=1;
          delete from public.ediel_send_locks where id=1;
          select count(*)=1 from public.ediel_send_locks where id=1;
          truncate only public.ediel_send_locks;
          reset role; select count(*)=0 from public.ediel_send_locks; rollback;""")
        if result != 't\nt\nt\nt' or state()!=before:
            raise ValueError('ORIGINAL_WRITE_ADMISSION_AND_TRUNCATE_REQUIRED')
    # Restrictive write guard rejects the non-operations member's INSERT.
    fixture.sql(actor('member')+"insert into public.ediel_send_locks values "
                "(3,'00000000-0000-0000-0000-000000000001',true,'active','denied'); rollback;",expected='42501')
    if state()!=before:
        raise ValueError('ORIGINAL_CONTROLS_MUST_ROLL_BACK')


def verify_service_and_definer():
    before=state()
    result=fixture.sql("""begin; set local role service_role;
      select count(*)=2 from public.ediel_send_locks;
      insert into public.ediel_send_locks values(3,'00000000-0000-0000-0000-000000000002',true,'released','service');
      update public.ediel_send_locks set locked=false where id=3;
      select not locked and status='released' from public.ediel_send_locks where id=3;
      delete from public.ediel_send_locks where id=3;
      truncate only public.ediel_send_locks; select count(*)=0 from public.ediel_send_locks; rollback;""")
    if result!='t\nt\nt':
        raise ValueError('SERVICE_OPERATIONS_REQUIRED')
    result=fixture.sql(actor('platform')+"select public.synthetic_platform_restore(); "
                       "select not locked and status='released' from public.ediel_send_locks where id=1; rollback;")
    if result!='t':
        raise ValueError('SYNTHETIC_DEFINER_BOUNDARY_REQUIRED')
    fixture.sql(actor('operations')+'select public.synthetic_platform_restore(); rollback;',expected='42501')
    if state()!=before:
        raise ValueError('PRESERVED_WRITERS_MUST_ROLL_BACK')


def rejected_shape(candidate,before_sql,after_sql):
    fixture.sql(before_sql)
    before=state()
    fixture.sql(candidate,expected='55000')
    if state()!=before:
        raise ValueError('FAILED_CANDIDATE_MUST_BE_ATOMIC')
    fixture.sql(after_sql)


def run():
    if sys.argv[1:] not in ([],['--selection-only']):
        raise ValueError('NO_EXTERNAL_TARGET_OR_ACCEPTANCE_OPTIONS')
    candidate,policies,convergence=selection()
    if sys.argv[1:]:
        print(json.dumps(dict(scope='SELECTION_ONLY_NOT_SQL',candidateSha256=CANDIDATE_SHA,tables=1)))
        return
    if fixture.sql("select current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999",admin=True)!='t':
        raise ValueError('FIXED_PG17_REQUIRED')
    if fixture.sql(f"select count(*) from pg_database where datname='{fixture.DATABASE}'",admin=True)!='0':
        raise ValueError('PREEXISTING_DATABASE_REFUSED')
    if fixture.sql("select count(*)=3 and bool_and(not rolsuper and not rolbypassrls and not rolcanlogin) "
                   "from pg_roles where rolname in ('authenticated','service_role','anon')",admin=True)!='t':
        raise ValueError('FIXED_NONBYPASS_ROLES_REQUIRED')
    if fixture.sql("select not exists(select 1 from pg_auth_members "
                   "where roleid='service_role'::regrole and member='authenticated'::regrole)",admin=True)!='t':
        raise ValueError('PREEXISTING_FIXTURE_ROLE_MEMBERSHIP_REFUSED')
    with fixture.owned_database():
        setup(policies,convergence)
        verify_original()
        install_actual_auth_policies()
        verify_original()
        verify_service_and_definer()
        rejected_shape(candidate,'alter table public.ediel_send_locks rename to missing_target;',
                       'alter table public.missing_target rename to ediel_send_locks;')
        rejected_shape(candidate,'alter table public.ediel_send_locks rename to original_target; '
                       'create view public.ediel_send_locks as select * from public.original_target;',
                       'drop view public.ediel_send_locks; alter table public.original_target rename to ediel_send_locks;')
        rejected_shape(candidate,'alter table public.ediel_send_locks disable row level security;',
                       'alter table public.ediel_send_locks enable row level security;')
        rejected_shape(candidate,'alter table public.ediel_send_locks force row level security;',
                       'alter table public.ediel_send_locks no force row level security;')
        rejected_shape(candidate,'alter table public.ediel_send_locks owner to authenticated;',
                       'alter table public.ediel_send_locks owner to postgres; grant all on public.ediel_send_locks to authenticated;')
        for grant,revoke in [('update','update'),('truncate','truncate')]:
            rejected_shape(candidate,f'grant {grant} on public.ediel_send_locks to public;',
                           f'revoke {revoke} on public.ediel_send_locks from public;')
        for privilege in ('insert','update','references'):
            rejected_shape(candidate,f'grant {privilege}(marker) on public.ediel_send_locks to authenticated;',
                           f'revoke {privilege}(marker) on public.ediel_send_locks from authenticated;')
        # Both immediately inherited and SET-only role authority are refused.
        for inherit in ('true','false'):
            fixture.sql(f'grant service_role to authenticated with inherit {inherit};',admin=True)
            try:
                before=state()
                fixture.sql(candidate,expected='55000')
                if state()!=before:
                    raise ValueError('INHERITED_AUTHORITY_MUST_ROLL_BACK')
            finally:
                fixture.sql('revoke service_role from authenticated;',admin=True)
        before=state()
        fixture.sql(candidate)
        after=state()
        verify_delta(before,after)
        verify_reads()
        verify_service_and_definer()
        for kind in ('operations','platform','member'):
            for statement in (
                "insert into public.ediel_send_locks values(3,'00000000-0000-0000-0000-000000000001',false,'released','denied');",
                'update public.ediel_send_locks set locked=false where id=1;',
                'delete from public.ediel_send_locks where id=1;',
                'truncate only public.ediel_send_locks;',
            ):
                fixture.sql(actor(kind)+statement+' rollback;',expected='42501')
                if state()!=after:
                    raise ValueError('DENIED_WRITE_MUST_PRESERVE_STATE')
        fixture.sql(candidate)
        if state()!=after:
            raise ValueError('REPEAT_MUST_PRESERVE_STATE')
    print(json.dumps(dict(scope='LIMITED_PG17_SEND_LOCK_CLIENT_WRITE_FIXTURE',candidateSha256=CANDIDATE_SHA,
        tables=1,revokedPrivileges=list(PRIVILEGES),fixedSqlstate='42501',
        originalReferenceInsertUpdateVerified=True,actualPredicateInsertUpdateVerified=True,
        originalDeleteInertVerified=True,originalTruncateBypassesRls=True,
        readBoundaryPreserved=True,serviceOperationsVerified=True,syntheticDefinerBoundaryVerified=True,
        exactAclDeltaVerified=True,rowsAndCatalogPreserved=True,shapeRejectionsVerified=True,
        atomicityVerified=True,repeatVerified=True,cleanupVerified=True,
        realRestoreRpcSourcePinned=True,actualAuthHelpersVerified=False,realRestoreRpcExecuted=False,
        applicationGraphVerified=False,schemaAccepted=False,productionModified=False)))


if __name__=='__main__':
    try:
        run()
    except Exception:
        print('FAIL bounded send-lock client-write qualification; no raw SQL or data published',file=sys.stderr)
        raise SystemExit(1) from None
