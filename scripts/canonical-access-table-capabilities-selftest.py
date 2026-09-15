#!/usr/bin/env python3
"""Fixed PG17 access-table ACL qualification; synthetic tenant/audit mechanism only."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('access_capability_state',ROOT/'scripts/canonical-ediel-send-lock-client-writes-selftest.py')
shared=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(shared)
fixture=shared.fixture
state=shared.state
TABLES=('company_invitations','user_roles')
PRIVILEGES=('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
CANDIDATE=ROOT/'scripts/sql/forward-candidates/restrict-canonical-access-table-capabilities.sql'
CANDIDATE_SHA='ddee41e3266948eef7f9082b331f873823602266448efe7cabcb03fdb3566683'
SOURCE_PINS={'supabase/schema.sql': 'b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30', 'supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql': 'e2eee5be4e4c795380782248683bfd32b682a66b2e2882a1fd241c9acc7498b2', 'supabase/migrations/20260802014000_canonical_provisioning_access.sql': '4fd103508d86a85ee41c168af90a25fdbbd546d17efea7ebcec91935c3c790fc', 'supabase/migrations/20260802170000_canonical_security_convergence.sql': 'e34618a9cb0c780f3fd75034ab113e48d99a27d8983e5d0fcbfc4a53ee27370a', 'supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql': '96a4402e5b642453a7358f55f9a5c93b2559a707df66b958a770318d10412930', 'lib/auth/companyInvitationFlow.ts': 'f28be56db9240b07dc8890b940bdcd78ed9bbc71cb6e97900be00a2260f9257f', 'lib/auth/companyUserAccess.ts': '9f83ab92080c2fdce9bb267c0f4a96c8a9482f0fa5691f4cd39171f2558da286', 'lib/admin/platformUserAccess.ts': 'a6135b919c61fbc55068afb7bff8fc402327378f0fb46337f5de3d8f6d8f569d'}
def read_candidate(path=CANDIDATE):
    path=Path(path).absolute()
    if path.resolve()!=path or not path.is_file():raise ValueError('EXACT_CANDIDATE_REQUIRED')
    data=path.read_bytes()
    if hashlib.sha256(data).hexdigest()!=CANDIDATE_SHA:raise ValueError('EXACT_CANDIDATE_REQUIRED')
    return data.decode()
def selection():
    candidate=read_candidate()
    sources={p:fixture.read_pinned(ROOT/p,h) for p,h in SOURCE_PINS.items()}
    reference=sources['supabase/schema.sql']
    for table in TABLES:
        if f'GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.{table} TO authenticated;' not in reference:
            raise ValueError('EXACT_REFERENCE_CAPABILITY_GRANT_REQUIRED')
        if f'revoke insert, update, delete on public.{table} from anon, authenticated;' not in sources['supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql']:
            raise ValueError('CANONICAL_ACCESS_WRITE_CONTRACT_REQUIRED')
    for rpc in ('canonical_create_tenant_invitation','canonical_accept_tenant_invitation','canonical_change_tenant_user_access','canonical_manage_platform_user_access'):
        grants=re.findall(r'^GRANT .* ON FUNCTION public\.'+rpc+r'\(p_command jsonb\) TO ([^;]+);',reference,re.M)
        if grants!=['service_role'] or f'REVOKE ALL ON FUNCTION public.{rpc}(p_command jsonb) FROM PUBLIC;' not in reference:
            raise ValueError('FINAL_SERVICE_RPC_ACL_REQUIRED')
    for fragment in ('TENANT_USER_ROLE_CHANGED','insert into public.canonical_audit_events','update public.user_roles set status='):
        if fragment not in sources['supabase/migrations/20260802014000_canonical_provisioning_access.sql']:
            raise ValueError('SOURCE_AUDITED_ACCESS_CHANGE_REQUIRED')
    return candidate

def verify_delta(before,after):
    expected=copy.deepcopy(before)
    expected['acl']=[x for x in expected['acl'] if not(x[0]=='public' and x[1] in TABLES and x[3]=='authenticated' and x[4] in PRIVILEGES)]
    if after!=expected:raise ValueError('EXACT_ACCESS_CAPABILITY_DELTA_REQUIRED')

def setup():
    fixture.sql("""create schema control; create schema private;
      grant usage on schema public,control to authenticated,service_role,anon;
      grant create on schema control to authenticated;
      create table control.audit_events(id integer primary key,marker text);
      create table public.outside_targets(id integer primary key,marker text);
      create table control.user_roles(id integer primary key,marker text);
      grant all on public.outside_targets,control.user_roles to authenticated;
      insert into public.outside_targets values(1,'outside'); insert into control.user_roles values(1,'outside_schema');
      create function control.noop_trigger() returns trigger language plpgsql as $$begin return new; end$$;
    """)
    for table in TABLES:
        fixture.sql(f"""create table public.{table}(id integer primary key,company_id integer not null,marker text);
          alter table public.{table} enable row level security;
          grant select,truncate,references,trigger,maintain on public.{table} to authenticated;
          grant select(marker) on public.{table} to authenticated;
          grant all on public.{table} to service_role;
          create policy synthetic_tenant_read on public.{table} for select to authenticated using(company_id=1);
          create policy synthetic_service on public.{table} for all to service_role using(true) with check(true);
          insert into public.{table} values(1,1,'active'),(2,2,'active');""")
    fixture.sql("""create function public.synthetic_canonical_revoke() returns boolean language plpgsql security definer
      set search_path=pg_catalog,public as $$begin
        update public.user_roles set marker='disabled' where id=1;
        insert into control.audit_events values(1,'TENANT_USER_ROLE_CHANGED');
        return true;
      end$$;
      revoke all on function public.synthetic_canonical_revoke() from public;
      grant execute on function public.synthetic_canonical_revoke() to service_role;""")

def actor(sql):return 'begin; set local role authenticated; '+sql+' rollback;'
def verify_reads_and_iud():
    before=state()
    for table in TABLES:
        if fixture.sql(actor(f'select count(*)=1 from public.{table};'))!='t':raise ValueError('TENANT_READ_PRESERVATION_REQUIRED')
        for statement in (f"insert into public.{table} values(3,1,'denied');",f"update public.{table} set marker='denied';",f'delete from public.{table};'):
            fixture.sql(actor(statement),expected='42501')
    if state()!=before:raise ValueError('IUD_AND_READ_CONTROLS_MUST_ROLL_BACK')

def capability_statement(table,privilege):
    if table not in TABLES or privilege not in PRIVILEGES:raise ValueError('FIXED_CAPABILITY_REQUIRED')
    return {'TRUNCATE':f'truncate only public.{table}; reset role; select count(*)=0 from public.{table}; select count(*)=0 from control.audit_events;',
      'REFERENCES':f'create table control.reference_probe(id integer references public.{table}(id));',
      'TRIGGER':f'create trigger synthetic_client_trigger before update on public.{table} for each row execute function control.noop_trigger();'}[privilege]

def verify_capabilities(admitted):
    before=state()
    for table in TABLES:
        for privilege in PRIVILEGES:
            actual=fixture.sql(f"select has_table_privilege('authenticated','public.{table}','{privilege}');")
            if actual!=('t' if admitted else 'f'):raise ValueError('EFFECTIVE_FOUR_CAPABILITIES_REQUIRED')
            if privilege=='MAINTAIN':continue # ANALYZE can warn/skip; no false fixed-42501 claim.
            result=fixture.sql(actor(capability_statement(table,privilege)),expected=None if admitted else '42501')
            if admitted and privilege=='TRUNCATE' and result!='t\nt':raise ValueError('ORIGINAL_TRUNCATE_BYPASSES_TENANT_AND_AUDIT_REQUIRED')
            if state()!=before:raise ValueError('CAPABILITY_CONTROLS_MUST_ROLL_BACK')

def verify_service_and_definer():
    before=state()
    for table in TABLES:
        result=fixture.sql(f"""begin; set local role service_role;
          select count(*)=2 from public.{table}; insert into public.{table} values(3,2,'service');
          update public.{table} set marker='changed' where id=3; delete from public.{table} where id=3;
          truncate only public.{table}; select count(*)=0 from public.{table}; rollback;""")
        if result!='t\nt':raise ValueError('SERVICE_OPERATIONS_REQUIRED')
    if fixture.sql("begin; set local role service_role; select public.synthetic_canonical_revoke(); reset role; "
       "select marker='disabled' from public.user_roles where id=1; select count(*)=1 from control.audit_events; rollback;")!='t\nt\nt':
        raise ValueError('SYNTHETIC_CANONICAL_AUDIT_REQUIRED')
    fixture.sql(actor('select public.synthetic_canonical_revoke();'),expected='42501')
    if state()!=before:raise ValueError('SERVICE_AND_DEFINER_MUST_ROLL_BACK')

def rejected(candidate,setup_sql,restore_sql):
    fixture.sql(setup_sql);before=state();fixture.sql(candidate,expected='55000')
    if state()!=before:raise ValueError('FAILED_CANDIDATE_MUST_BE_ATOMIC')
    fixture.sql(restore_sql)

def verify_forward_postcondition(expected):
    from canonical_native_forward_runtime import assertion
    if fixture.sql('select ('+assertion(9)+');') != ('t' if expected else 'f'):
        raise ValueError('FORWARD_POSTCONDITION_REQUIRED')

def run():
    if sys.argv[1:] not in ([],['--selection-only']):raise ValueError('NO_EXTERNAL_TARGET_OR_ACCEPTANCE_OPTIONS')
    candidate=selection()
    if sys.argv[1:]:
        print(json.dumps(dict(scope='SELECTION_ONLY_NOT_SQL',candidateSha256=CANDIDATE_SHA,tables=2)));return
    if fixture.sql("select current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999",admin=True)!='t':raise ValueError('FIXED_PG17_REQUIRED')
    if fixture.sql(f"select count(*) from pg_database where datname='{fixture.DATABASE}'",admin=True)!='0':raise ValueError('PREEXISTING_DATABASE_REFUSED')
    if fixture.sql("select count(*)=3 and bool_and(not rolsuper and not rolbypassrls and not rolcanlogin) from pg_roles where rolname in ('authenticated','service_role','anon')",admin=True)!='t':raise ValueError('FIXED_NONBYPASS_ROLES_REQUIRED')
    if fixture.sql("select not exists(select 1 from pg_auth_members where roleid='service_role'::regrole and member='authenticated'::regrole)",admin=True)!='t':raise ValueError('PREEXISTING_FIXTURE_ROLE_MEMBERSHIP_REFUSED')
    with fixture.owned_database():
        setup();verify_forward_postcondition(False);verify_reads_and_iud();verify_capabilities(True);verify_service_and_definer()
        rejected(candidate,'alter table public.user_roles rename to missing_last;','alter table public.missing_last rename to user_roles;')
        rejected(candidate,'alter table public.user_roles rename to original_last; create view public.user_roles as select * from public.original_last;',
          'drop view public.user_roles; alter table public.original_last rename to user_roles;')
        rejected(candidate,'alter table public.user_roles disable row level security;','alter table public.user_roles enable row level security;')
        rejected(candidate,'alter table public.user_roles force row level security;','alter table public.user_roles no force row level security;')
        rejected(candidate,'alter table public.user_roles owner to authenticated;',
          'alter table public.user_roles owner to postgres; revoke all on public.user_roles from authenticated; grant select,truncate,references,trigger,maintain on public.user_roles to authenticated; grant select(marker) on public.user_roles to authenticated;')
        for privilege in ('truncate','references','trigger','maintain'):
            rejected(candidate,f'grant {privilege} on public.user_roles to public;',f'revoke {privilege} on public.user_roles from public;')
        rejected(candidate,'grant references(marker) on public.user_roles to authenticated;','revoke references(marker) on public.user_roles from authenticated;')
        rejected(candidate,'grant insert on public.user_roles to authenticated;','revoke insert on public.user_roles from authenticated;')
        for inherit in ('true','false'):
            fixture.sql(f'grant service_role to authenticated with inherit {inherit};',admin=True)
            try:
                before=state();fixture.sql(candidate,expected='55000')
                if state()!=before:raise ValueError('INHERITED_AUTHORITY_MUST_ROLL_BACK')
            finally:fixture.sql('revoke service_role from authenticated;',admin=True)
        before=state();fixture.sql(candidate);after=state();verify_delta(before,after);verify_forward_postcondition(True)
        verify_reads_and_iud();verify_capabilities(False);verify_service_and_definer()
        fixture.sql(candidate)
        if state()!=after:raise ValueError('REPEAT_MUST_PRESERVE_STATE')
    print(json.dumps(dict(scope='LIMITED_PG17_CANONICAL_ACCESS_CAPABILITY_FIXTURE',candidateSha256=CANDIDATE_SHA,
      tables=2,revokedPrivileges=list(PRIVILEGES),fixedSqlstate='42501',originalTruncateBypassesTenantAndAudit=True,
      referencesAndTriggerSqlQualified=True,effectiveMaintainDenied=True,readAndIudBoundaryPreserved=True,
      serviceOperationsVerified=True,syntheticCanonicalAuditPreserved=True,realCanonicalSourcesPinned=True,
      exactAclDeltaVerified=True,rowsAndCatalogPreserved=True,missingLastTableAtomicityVerified=True,
      shapeAndResidualAuthorityRejected=True,repeatVerified=True,cleanupVerified=True,
      actualAuthHelpersVerified=False,realCanonicalRpcExecuted=False,applicationGraphVerified=False,
      schemaAccepted=False,productionModified=False)))
if __name__=='__main__':
    try:run()
    except Exception:
        print('FAIL bounded canonical-access capability qualification; no raw SQL or data published',file=sys.stderr)
        raise SystemExit(1) from None
