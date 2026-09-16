#!/usr/bin/env python3
"""Qualify only the exact24 inert-policy candidate on an owned PostgreSQL17.

Fixture helpers supply the source expression signatures, not application auth
behavior. Actual client denial is exercised at unchanged table/column ACLs.
"""
import copy
import hashlib
import importlib.util
import json
import re
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DATABASE = 'gridex_auth_legacy_replay'
OLD_CANDIDATE = 'scripts/sql/forward-candidates/drop-inert-inbound-client-policies.sql'
OLD_CANDIDATE_SHA = 'b04ce7766f0d3e4655778cdd6aa6fcde1bb3a0661867e381aa0939f015c9e2c1'
CANDIDATE = 'scripts/sql/forward-candidates/drop-inert-inbound-client-policies-preserve-platform.sql'
CANDIDATE_SHA = '5cd56392d5647196fe4f64e7d5a76fe5fa0a3a9a454efcfd34a6d8f754ac86a7'
PLATFORM_SOURCE = 'supabase/migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql'
PLATFORM_SOURCE_SHA = 'a5ca82d1c68f44c8542820e5d209fd5d31356a16e7eb1ccc827843a61e0ba690'
PLATFORM_BLOCK_SHA = 'f0b3fe093f519b2564674a89ce5bd6704a76a75bf408904228022dc593216368'
CONVERGENCE = 'supabase/migrations/20260904120000_canonical_tenant_invariant_convergence.sql'
CONVERGENCE_SHA = '3e40f894ec109a45e4dd7842edd819509caadac1e8d5e89a45d244224d0c77e1'
POSTCONDITION = 'scripts/sql/forward-candidates/inert-inbound-preserved-platform-postcondition.sql'
POSTCONDITION_SHA = 'baaa1053792c8e0d850fcde912b85a3561386756d4f7eec8d8b402591ce13c80'
IDENTITIES = 'quality/audits/ediel-masterplan-v2/inert-policy-identities.json'
IDENTITIES_SHA = 'daec1fbbd9c6cab178c9aeaf439dd8e61e2ccdbe84016dd564d4c134b323b42d'
REVOKE = 'supabase/migrations/20260915132224_restrict_inbound_service_table_privileges.sql'
REVOKE_SHA = '0ee026c41d180768b23e20826d522387cc1c65e9c689304472f62cda39b19033'
TABLES = ('inbound_ediel_match_attempts','inbound_ediel_parse_results','inbound_email_attachments')
import canonical_forward_portable as snapshots


def load_legacy():
    spec=importlib.util.spec_from_file_location('inert_owner',ROOT/'scripts/canonical-auth-provisioning-replay.py')
    loaded=importlib.util.module_from_spec(spec);spec.loader.exec_module(loaded)
    return loaded.load_batch()


def pinned(path, digest):
    p=ROOT/path
    if p.resolve()!=p or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:
        raise ValueError('INERT_QUALIFICATION_SOURCE_REQUIRED')
    return p.read_text()


def selection():
    candidate=pinned(CANDIDATE,CANDIDATE_SHA)
    platform_policies()
    pinned(OLD_CANDIDATE,OLD_CANDIDATE_SHA)
    pinned(POSTCONDITION,POSTCONDITION_SHA)
    evidence=json.loads(pinned(IDENTITIES,IDENTITIES_SHA))
    records=evidence['records']
    if evidence['count']!=24 or len(records)!=24:
        raise ValueError('INERT_QUALIFICATION_IDENTITIES_REQUIRED')
    for r in records:
        schema,table,name=r['identity']; row=r['row']
        if schema!='public' or table not in TABLES or row['roles']!=['authenticated']:
            raise ValueError('INERT_QUALIFICATION_SCOPE_REQUIRED')
        for key,value in [('tableSha256',table),('policySha256',name)]:
            if hashlib.sha256(value.encode()).hexdigest()!=r['observedHashes'][key]:
                raise ValueError('INERT_QUALIFICATION_HASH_IDENTITY_REQUIRED')
        if hashlib.sha256(json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()!=r['sourceRowSha256']:
            raise ValueError('INERT_QUALIFICATION_ROW_REQUIRED')
    return candidate,records,pinned(REVOKE,REVOKE_SHA)


def platform_policies():
    """Execute the original bounded May28 block and September4 service drops.

    Only the three target tables exist in this fixture. No hand-authored PUBLIC
    policy replaces the source definition, and no application-helper behavior
    is inferred from the fixture's deliberately false helper signatures.
    """
    source=pinned(PLATFORM_SOURCE,PLATFORM_SOURCE_SHA)
    start=source.index('do $$',source.index('-- 5. RLS policies.'))
    end=source.index('end $$;',start)+len('end $$;')
    block=source[start:end]
    if hashlib.sha256(block.encode()).hexdigest()!=PLATFORM_BLOCK_SHA:
        raise ValueError('INERT_QUALIFICATION_SOURCE_REQUIRED')
    convergence=pinned(CONVERGENCE,CONVERGENCE_SHA)
    drops=[]
    for table in TABLES:
        statement=f'drop policy if exists {table}_service_role_all\n  on public.{table};'
        if convergence.count(statement)!=1:
            raise ValueError('INERT_QUALIFICATION_SOURCE_REQUIRED')
        drops.append(statement)
    return block+'\n'+'\n'.join(drops)


def setup(records):
    sql="""
create role anon nologin; create role authenticated nologin;
create role service_role nologin nobypassrls;
grant usage on schema public to anon,authenticated,service_role;
create function public.gridex_user_is_platform_admin() returns boolean language sql stable as 'select false';
create function public.gridex_is_current_session_allowed() returns boolean language sql stable as 'select false';
create function public.gridex_user_company_ids() returns setof uuid language sql stable as 'select null::uuid where false';
create function public.gridex_can_write_company(uuid) returns boolean language sql stable as 'select false';
"""
    for table in (*TABLES,'outside_inbound'):
        sql+=f"""
create table public.{table}(id integer primary key,company_id uuid,marker text);
insert into public.{table} values(1,'00000000-0000-0000-0000-000000000001','tenant_a'),
 (2,'00000000-0000-0000-0000-000000000002','tenant_b'),(3,null,'unattributed');
alter table public.{table} enable row level security;
grant all on public.{table} to authenticated,service_role;
grant select(marker) on public.{table} to service_role;
create policy retained_service on public.{table} to service_role using(true) with check(true);
"""
    for r in records:
        row=r['row']; action={'r':'select','a':'insert','w':'update','d':'delete'}[row['command']]
        sql+=f"create policy {row['polname']} on public.{row['relname']} as {'permissive' if row['permissive'] else 'restrictive'} for {action} to authenticated"
        if row['using_expression']:sql+=' using ('+row['using_expression']+')'
        if row['check_expression']:sql+=' with check ('+row['check_expression']+')'
        sql+=';\n'
    return sql+platform_policies()+'\n'


F14_COUNT="""select count(*) from pg_policy pol join pg_class c on c.oid=pol.polrelid
 join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
 where pol.polroles <> '{0}'::oid[] and not exists (
 select 1 from unnest(pol.polroles) as role_oid join pg_roles r on r.oid=role_oid
 where has_table_privilege(r.rolname,c.oid,'SELECT, INSERT, UPDATE, DELETE'));"""


def policy_dependencies(target, records):
    pairs=[]
    for record in records:
        table, policy = record['identity'][1:]
        if not all(re.fullmatch(r'[A-Za-z0-9_]+', value) for value in (table, policy)):
            raise ValueError('INERT_DEPENDENCY_IDENTITY_REQUIRED')
        pairs.append("('%s','%s')" % (table, policy))
    query = """select coalesce(jsonb_agg(distinct k order by k),'[]'::jsonb) from (
      select 'dependency/'||pg_describe_object(d.classid,d.objid,d.objsubid)||'/'||
        pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid)||'/'||d.deptype::text as k
      from pg_depend d join pg_policy p on d.classid='pg_policy'::regclass and p.oid=d.objid
      join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and (c.relname,p.polname) in (""" + ','.join(pairs) + ')) selected;'
    return json.loads(target.sql(DATABASE, query, 'inert_policy_dependencies'))


def verify_delta(before, after, records, dependencies=()):
    expected=copy.deepcopy(before)
    for r in records:
        key='policy/public.'+r['identity'][1]+'/'+r['identity'][2]
        if key not in expected[0]:
            raise ValueError('INERT_EXPECTED_POLICY_MISSING')
        del expected[0][key]
    if (type(dependencies) not in (list, tuple) or
            any(type(key) is not str or not key.startswith('dependency/') for key in dependencies)
            or len(set(dependencies)) != len(dependencies)):
        raise ValueError('INERT_DEPENDENCY_SET_REQUIRED')
    for key in dependencies:
        if key not in expected[0]:
            raise ValueError('INERT_DEPENDENCY_SET_REQUIRED')
        del expected[0][key]
    if after!=expected:
        before_keys,after_keys=set(expected[0]),set(after[0])
        print(json.dumps(dict(stage='inert_catalog_delta',
            missing=len(before_keys-after_keys),extra=len(after_keys-before_keys),
            changed=len([key for key in before_keys & after_keys if expected[0][key]!=after[0][key]]),
            rowsPreserved=after[1]==expected[1])),flush=True)
        raise ValueError('INERT_EXACT_POLICY_DELTA_REQUIRED')


def run():
    if sys.argv[1:] not in ([],['--selection-only']):
        raise ValueError('NO_EXTERNAL_TARGET_OR_OPTIONS')
    candidate,records,revoke=selection()
    if sys.argv[1:]:
        print(json.dumps(dict(scope='INERT_SELECTION_ONLY',count=24,candidateSha256=CANDIDATE_SHA)))
        return
    legacy=load_legacy()
    with legacy.OwnedPostgres() as target:
        private_dir=Path(target.directory.name)
        target.reset(DATABASE)
        if target.sql(DATABASE,"select current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999",'pg17')!='t\n':
            raise ValueError('INERT_PG17_REQUIRED')
        target.sql(DATABASE,setup(records),'inert_fixture')
        if target.sql(DATABASE,F14_COUNT,'inert_before_revocation').strip()!='0':
            raise ValueError('INERT_PRE_REVOCATION_REQUIRED')
        target.sql(DATABASE,revoke,'original_whole_revocation',transaction=False)
        if target.sql(DATABASE,F14_COUNT,'inert_red24').strip()!='24':
            raise ValueError('INERT_EXACT24_REPRODUCTION_REQUIRED')
        if target.sql(DATABASE,'select '+pinned(POSTCONDITION,POSTCONDITION_SHA),'inert_candidate_predicate_before').strip()!='f':
            raise ValueError('INERT_NATIVE_PREDICATE_BEFORE_REQUIRED')
        before=snapshots.snapshot(target)
        target.sql(DATABASE,pinned(OLD_CANDIDATE,OLD_CANDIDATE_SHA),
                   'inert_original_rejects_source_platform_policies',expect='55000',transaction=False)
        if snapshots.snapshot(target)!=before:
            raise ValueError('INERT_REJECTION_NOT_ATOMIC')
        # Each rejected shape leaves the complete pre-call catalog and rows intact.
        last=records[-1]['row']; table=last['relname']; name=last['polname']
        cases=[
          (f'grant select on public.{table} to authenticated;', f'revoke select on public.{table} from authenticated;'),
          (f'grant select(marker) on public.{table} to authenticated;', f'revoke select(marker) on public.{table} from authenticated;'),
          (f'grant select on public.{table} to public;', f'revoke select on public.{table} from public;'),
          (f'alter policy {name} on public.{table} to anon;',f'alter policy {name} on public.{table} to authenticated;'),
          (f'alter policy {name} on public.{table} using(false);',f"alter policy {name} on public.{table} using ({last['using_expression']});"),
          (f'alter policy {name} on public.{table} rename to unexpected_inbound;',f'alter policy unexpected_inbound on public.{table} rename to {name};'),
          (f'create policy unexpected_inbound on public.{table} to authenticated using(false);',f'drop policy unexpected_inbound on public.{table};'),
        ]
        cases.append((f'create policy unexpected_public on public.{table} using(false);',
                      f'drop policy unexpected_public on public.{table};'))
        for retained_table in TABLES:
            for suffix in ('select','write'):
                retained_name=retained_table+'_platform_'+suffix
                cases.extend([
                    (f'alter policy {retained_name} on public.{retained_table} using(false);',
                     f'alter policy {retained_name} on public.{retained_table} using(public.gridex_user_is_platform_admin());'),
                    (f'alter policy {retained_name} on public.{retained_table} to authenticated;',
                     f'alter policy {retained_name} on public.{retained_table} to public;'),
                    (f'alter policy {retained_name} on public.{retained_table} rename to unexpected_platform;',
                     f'alter policy unexpected_platform on public.{retained_table} rename to {retained_name};'),
                ])
                if suffix=='write':
                    cases.append((f'alter policy {retained_name} on public.{retained_table} with check(false);',
                                  f'alter policy {retained_name} on public.{retained_table} with check(public.gridex_user_is_platform_admin());'))
        for i,(change,restore) in enumerate(cases):
            target.sql(DATABASE,change,'inert_negative_shape_'+str(i))
            before=snapshots.snapshot(target)
            target.sql(DATABASE,candidate,'inert_reject_'+str(i),expect='55000',transaction=False)
            if snapshots.snapshot(target)!=before:
                raise ValueError('INERT_REJECTION_NOT_ATOMIC')
            target.sql(DATABASE,restore,'inert_restore_'+str(i))
        dependencies=policy_dependencies(target,records)
        before=snapshots.snapshot(target)
        target.sql(DATABASE,candidate,'inert_candidate',transaction=False)
        after=snapshots.snapshot(target)
        verify_delta(before,after,records,dependencies)
        if target.sql(DATABASE,F14_COUNT,'inert_green0').strip()!='0':
            raise ValueError('INERT_ZERO_POSTCONDITION_REQUIRED')
        if target.sql(DATABASE,'select '+pinned(POSTCONDITION,POSTCONDITION_SHA),'inert_candidate_predicate_after').strip()!='t':
            raise ValueError('INERT_NATIVE_PREDICATE_AFTER_REQUIRED')
        # Once the 24 removable policies are absent, independently exercise the
        # candidate postcondition's preserved-policy clauses. Otherwise its
        # earlier false result could be explained solely by the 24 present rows.
        for i,(change,restore) in enumerate(cases[7:]):
            target.sql(DATABASE,change,'inert_postcondition_negative_'+str(i))
            if target.sql(DATABASE,'select '+pinned(POSTCONDITION,POSTCONDITION_SHA),
                          'inert_postcondition_reject_'+str(i)).strip()!='f':
                raise ValueError('INERT_POSTCONDITION_NEGATIVE_REQUIRED')
            target.sql(DATABASE,restore,'inert_postcondition_restore_'+str(i))
            if snapshots.snapshot(target)!=after:
                raise ValueError('INERT_POSTCONDITION_RESTORATION_REQUIRED')
        target.sql(DATABASE,candidate,'inert_repeat',transaction=False)
        if snapshots.snapshot(target)!=after:
            raise ValueError('INERT_REPEAT_STATE_CHANGED')
        for table in TABLES:
            for role in ('anon','authenticated'):
                for statement in (f'select * from public.{table}',f'insert into public.{table}(id) values(4)',
                                  f"update public.{table} set marker='changed'",f'delete from public.{table}'):
                    target.sql(DATABASE,f'begin; set local role {role}; {statement}; rollback;','inert_client_denied',expect='42501')
                    if snapshots.snapshot(target)!=after:raise ValueError('INERT_DENIED_STATE_CHANGED')
            answer=target.sql(DATABASE,f"begin; set local role service_role; select count(*)=3 from public.{table}; insert into public.{table}(id,marker) values(4,'service'); update public.{table} set marker='updated' where id=4; select marker='updated' from public.{table} where id=4; delete from public.{table} where id=4; select count(*)=3 from public.{table}; rollback;",'inert_service_dml')
            if answer.strip()!='t\nt\nt' or snapshots.snapshot(target)!=after:
                raise ValueError('INERT_SERVICE_STATE_CHANGED')
    if target.active or target.directory is not None or private_dir.exists():
        raise ValueError('INERT_CLEANUP_REQUIRED')
    result=dict(scope='OWNED_PG17_INERT_POLICY_QUALIFICATION_ONLY',candidateSha256=CANDIDATE_SHA,
        retainedPlatformPolicyCount=6,retainedPlatformSourceSha256=PLATFORM_SOURCE_SHA,
        originalCandidateRejectedSourcePlatformPolicies=True,
        redCount=24,greenCount=0,candidatePostconditionVerified=True,candidatePostconditionSha256=POSTCONDITION_SHA,
        postconditionNegativeCases=len(cases[7:]),
        exactPolicyOnlyDelta=True,repeatVerified=True,negativeShapeCases=len(cases),
        clientDenialVerified=True,serviceDmlVerified=True,cleanupVerified=True,schemaAccepted=False,
        nativeReplayAccepted=False,generatedTypesVerified=False,applicationHelpersVerified=False,productionModified=False)
    output=ROOT/'artifacts/inert-inbound-policy-candidate'
    output.mkdir(parents=True,exist_ok=True)
    (output/'qualification.json').write_text(json.dumps(result,sort_keys=True)+'\n')
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':
    try:run()
    except Exception as error:
        allowed={'INERT_EXPECTED_POLICY_MISSING','INERT_DEPENDENCY_SET_REQUIRED',
                 'INERT_EXACT_POLICY_DELTA_REQUIRED','INERT_ZERO_POSTCONDITION_REQUIRED',
                 'INERT_REPEAT_STATE_CHANGED','INERT_DENIED_STATE_CHANGED',
                 'INERT_SERVICE_STATE_CHANGED','INERT_CLEANUP_REQUIRED'}
        reason=error.args[0] if type(error) is ValueError and len(error.args)==1 and type(error.args[0]) is str and error.args[0] in allowed else 'UNCLASSIFIED'
        print('FAIL owned inert policy qualification: '+reason,file=sys.stderr)
        raise SystemExit(1) from None
