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
CANDIDATE = 'scripts/sql/forward-candidates/drop-inert-inbound-client-policies.sql'
CANDIDATE_SHA = 'b04ce7766f0d3e4655778cdd6aa6fcde1bb3a0661867e381aa0939f015c9e2c1'
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
    return sql


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
        redCount=24,greenCount=0,exactPolicyOnlyDelta=True,repeatVerified=True,negativeShapeCases=len(cases),
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
