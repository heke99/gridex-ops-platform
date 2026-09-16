#!/usr/bin/env python3
"""Run after auth-email fixture in the same isolated PG17 CI service."""
from pathlib import Path
import argparse
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text()


def table(body, name):
    start = body.index('create table if not exists public.' + name + ' (')
    return body[start:body.index('\n);', start) + 4]


def sql():
    aux = read('supabase/bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql')
    body = '''select test_assert(current_setting('server_version_num')::int / 10000=17,'PG17');
create table companies(id uuid primary key);
create table customers(id uuid primary key);
'''
    body += table(read('supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql'), 'powers_of_attorney')
    body += table(aux, 'customer_info_requests') + table(aux, 'authorization_scopes')
    start = aux.rfind('do $$', 0, aux.index("if to_regclass('public.powers_of_attorney')"))
    body += aux[start:aux.index('end $$;', start) + len('end $$;')]
    body += read('supabase/bootstrap/20260526_customer_blockers_foundation.sql')
    body += read('supabase/migrations/20260521_final_customer_info_request_status_check.sql')
    body += '''insert into companies values ('20000000-0000-0000-0000-000000000001');
insert into customers values ('30000000-0000-0000-0000-000000000001');
insert into customer_info_requests(company_id,customer_id,status,notes) values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','waiting_for_z02','preserve');
insert into powers_of_attorney(company_id,customer_id,status,evidence_note) values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','signed','preserve');
insert into authorization_scopes(company_id,customer_id) values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
insert into customer_blockers(company_id,customer_id,blocker_type,title) values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','synthetic','preserve');
create temporary view fixture_rows as
 select 'request' kind,to_jsonb(t)-array['requested_period_start','requested_period_end'] row from customer_info_requests t
 union all select 'poa',to_jsonb(t) from powers_of_attorney t
 union all select 'scope',to_jsonb(t) from authorization_scopes t
 union all select 'blocker',to_jsonb(t) from customer_blockers t;
create temporary table rows_before as select * from fixture_rows;
create temporary table policies_before as select * from pg_policies where schemaname='public';
create temporary table keys_before as select conrelid,conname,pg_get_constraintdef(oid) definition from pg_constraint where contype in ('p','f','u');
'''
    source = read('supabase/migrations/20260526_batch_3c_3d_fullmakt_data_requests.sql')
    checks = '''select test_assert(not exists((select * from fixture_rows except select * from rows_before) union all (select * from rows_before except select * from fixture_rows)),'all existing rows preserved');
select test_assert(not exists((select * from pg_policies where schemaname='public' except select * from policies_before) union all (select * from policies_before except select * from pg_policies where schemaname='public')),'policies preserved');
select test_assert(not exists((select conrelid,conname,pg_get_constraintdef(oid) from pg_constraint where contype in ('p','f','u') except select * from keys_before) union all (select * from keys_before except select conrelid,conname,pg_get_constraintdef(oid) from pg_constraint where contype in ('p','f','u'))),'PK/FK/unique constraints preserved');
select test_assert((select count(*)=2 from information_schema.columns where table_schema='public' and table_name='customer_info_requests' and column_name in ('requested_period_start','requested_period_end') and data_type='date' and is_nullable='YES'),'nullable request period dates');
select test_assert((select count(*)=5 from pg_indexes where schemaname='public' and indexname in ('customer_info_requests_company_customer_target_idx','powers_of_attorney_company_customer_status_created_idx','powers_of_attorney_company_customer_signed_idx','authorization_scopes_company_customer_active_idx','customer_blockers_company_customer_open_idx')),'five source indexes');
select test_assert((select count(*)=3 from pg_index x join pg_class i on i.oid=x.indexrelid where i.relname in ('powers_of_attorney_company_customer_signed_idx','authorization_scopes_company_customer_active_idx','customer_blockers_company_customer_open_idx') and x.indpred is not null and x.indisvalid),'three valid partial indexes');
do $$ declare expected record; actual text; begin
 for expected in select * from (values
 ('customer_info_requests_company_customer_target_idx','customer_info_requests','company_id, customer_id, target_party_type, status, created_at DESC',''),
 ('powers_of_attorney_company_customer_status_created_idx','powers_of_attorney','company_id, customer_id, status, created_at DESC',''),
 ('powers_of_attorney_company_customer_signed_idx','powers_of_attorney','company_id, customer_id, signed_at DESC', ' WHERE (status = ''signed''::text)'),
 ('authorization_scopes_company_customer_active_idx','authorization_scopes','company_id, customer_id, created_at DESC', ' WHERE ((status = ''active''::text) AND (revoked_at IS NULL))'),
 ('customer_blockers_company_customer_open_idx','customer_blockers','company_id, customer_id, blocker_type, created_at DESC', ' WHERE (status = ANY (ARRAY[''open''::text, ''pending_review''::text]))')
 ) as definitions(name,relation,columns,predicate) loop
 select indexdef into actual from pg_indexes where schemaname='public' and indexname=expected.name;
 perform test_assert(actual = format('CREATE INDEX %s ON public.%s USING btree (%s)%s',expected.name,expected.relation,expected.columns,expected.predicate),'exact index definition: '||expected.name);
 end loop;
end $$;
select test_assert((select convalidated from pg_constraint where conrelid='customer_info_requests'::regclass and conname='customer_info_requests_status_check'),'status constraint validated');
select test_assert((select relrowsecurity from pg_class where oid='customer_blockers'::regclass),'existing blocker RLS retained');
'''
    body += source + checks + source + checks
    body += '''begin;
do $$ declare value text; begin
 foreach value in array array['draft','ready_to_send','sent','waiting_response','received','partially_received','rejected','failed','cancelled','missing_authorization','z01_prepared','route_missing','sent_to_grid_owner','waiting_for_contrl','waiting_for_aperak','waiting_for_z02','z02_received','negative_aperak','manual_review_required','missing_binding_info','missing_termination_info','ready_for_switch','completed','blocked'] loop
 update customer_info_requests set status=value;
 end loop;
 begin update customer_info_requests set status='unknown_state'; raise exception 'FAIL: invalid status accepted'; exception when check_violation then null; end;
end $$;
rollback;
'''
    return body


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emit', action='store_true')
    parser.add_argument('--selection-only', action='store_true')
    args = parser.parse_args()
    if args.selection_only:
        result = subprocess.run(['python3', str(ROOT / 'scripts/gridex-replay-input-accounting.py')], capture_output=True, text=True, check=False)
        report = json.loads(result.stdout)
        assert not report['errors'], report['errors']
        source = 'migrations/20260526_batch_3c_3d_fullmakt_data_requests.sql'
        row = next(row for row in report['migrations'] if row['path'] == source)
        assert row['classification'] == 'FULL_FILE_SELECTED', row['classification']
        assert row['execution'][0]['stage'] == 'foundation'
        order = json.loads(read('scripts/gridex-aud-003-foundation-order.json'))['foundation']
        predecessor = 'bootstrap/20260526_customer_blockers_foundation.sql'
        assert order.index(source) == order.index(predecessor) + 1
        for prerequisite in ['migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql', 'bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql', 'migrations/20260521_final_customer_info_request_status_check.sql']:
            assert order.index(prerequisite) < order.index(source)
        print('PASS: complete POA/request source selected after all four table prerequisites and status predecessor')
        raise SystemExit(0)
    if args.emit:
        print(sql())
    else:
        subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', 'postgresql://postgres:postgres@127.0.0.1:55440/gridex_auth_test'], input=sql(), text=True, check=True)
        print('PASS: complete POA/request source twice; rows, policies, keys, RLS, periods, indexes and 24 states verified')
