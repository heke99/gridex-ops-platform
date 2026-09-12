#!/usr/bin/env python3
"""Owned private PG17 standalone and actual staged proof for R2/E2/S2/W."""
from pathlib import Path
import importlib.util
import sys

ROOT = Path(__file__).resolve().parents[1]

def load_batch():
    spec=importlib.util.spec_from_file_location('repair_test_loader',ROOT/'scripts/canonical-auth-provisioning-replay.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.load_repair()


def constructor_checks():
    b = load_batch()
    sources = b.validate_sources(b.reviewed_paths())
    assert [s.alias for s in sources] == ['R2', 'E2', 'S2', 'W']
    for paths in ((), b.reviewed_paths()[:-1], b.reviewed_paths()[::-1], b.reviewed_paths()*2):
        try:
            b.validate_sources(paths)
        except b.BoundaryError:
            pass
        else:
            raise AssertionError('invalid complete-source order accepted')
    for target in (None, object(), 'postgresql://localhost/example'):
        try:
            b.envelope_files(target, b.reviewed_paths())
        except b.BoundaryError:
            pass
        else:
            raise AssertionError('unowned target accepted')
    print('PASS repair constructors (no SQL execution)')


import contextlib
import io
import inspect
import json
import os
import re
import signal
import subprocess
import tempfile
import time
from unittest.mock import patch

U='81000000-0000-0000-0000-000000000001'
U2='81000000-0000-0000-0000-000000000002'
C='82000000-0000-0000-0000-000000000001'
C2='82000000-0000-0000-0000-000000000002'
SENTINEL='REPAIR_PRIVATE_SYNTHETIC_SENTINEL'


def check(condition):
    return "DO $$ BEGIN IF ("+condition+") IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF; END $$;"


def assertion_cases():
    # Expectations are explicit SQL three-valued-logic cases, independent of
    # check() rendering. Empty scalar results must fail just like SQL NULL.
    return (
      ('true','true','00000'),
      ('false','false','P0003'),
      ('null','NULL::boolean','P0003'),
      ('empty_scalar','(SELECT true WHERE false)','P0003'),
      ('null_scalar','(SELECT value FROM (VALUES (NULL::boolean)) AS v(value))','P0003'),
    )


def assertion_constructor_controls():
    for label,condition,state in assertion_cases():
        assert state==('00000' if label=='true' else 'P0003')
        sql=check(condition)
        assert sql.startswith('DO $$ BEGIN IF ('+condition+') IS DISTINCT FROM true THEN '), \
            'assertion must reject false and SQL unknown'


def sequence_snapshot_constructor_controls():
    # Sequences have no composite row type, so whole-row to_jsonb(x) cannot be
    # used for them. Preserve all three physical state fields explicitly.
    state_json="jsonb_build_object(''last_value'',last_value,''log_cnt'',log_cnt,''is_called'',is_called)"
    admission=(ROOT/'scripts/sql/canonical-user-rbac-repair-admission.sql').read_text()
    assertions=(ROOT/'scripts/sql/canonical-user-rbac-repair-assertions.sql').read_text()
    snapshot_source=inspect.getsource(snapshot)
    assert state_json in admission, 'admission must capture explicit sequence state'
    assert state_json in assertions, 'assertions must compare explicit sequence state'
    assert "IF r.relkind='S' THEN" in snapshot_source and state_json in snapshot_source, \
        'outer snapshot must capture explicit sequence state'


def plpgsql_alias_constructor_controls():
    # A PL/pgSQL record variable and a SQL whole-row alias cannot share `r`:
    # PostgreSQL must otherwise choose between two valid column references.
    admission=(ROOT/'scripts/sql/canonical-user-rbac-repair-admission.sql').read_text()
    assertions=(ROOT/'scripts/sql/canonical-user-rbac-repair-assertions.sql').read_text()
    boundary=(ROOT/'supabase/migrations'/load_batch().W).read_text()
    collision=re.compile(r'\bto_jsonb\(r\)\s+FROM\s+public\.roles\s+(?:AS\s+)?r\b',re.I)
    assert not any(collision.search(sql) for sql in (admission,assertions,boundary)), \
        'PL/pgSQL record variable collides with whole-row SQL alias'
    assert 'SELECT role_row.id,to_jsonb(role_row) FROM public.roles AS role_row' in admission, \
        'role-row snapshot must use an explicit non-colliding alias'


def seeded_profile_constructor_controls(b):
    # Check the implicated profile DML against declarations in the exact
    # accepted prefix, never against a later migration or a guessed fixture.
    columns=set()
    sources=[(b.SUPPORT/'gridex-supabase-compatible-bootstrap.sql').read_text(),
             *(sql for _,sql in b.legacy.verified_prefix()),
             *(path.read_text() for path in b.legacy.reviewed_paths())]
    for sql in sources:
        for match in re.finditer(r'CREATE TABLE IF NOT EXISTS public\.user_profiles\s*\((.*?)\);',sql,re.I|re.S):
            columns.update(re.findall(r'^\s*(\w+)\s+(?:uuid|text|timestamptz)\b',match[1],re.I|re.M))
        for match in re.finditer(r'ALTER TABLE (?:IF EXISTS )?public\.user_profiles\b[^;]*;',sql,re.I):
            columns.update(re.findall(r'ADD COLUMN IF NOT EXISTS (\w+)',match[0],re.I))
    assert {'id','email','user_status','active_company_id'}<=columns and 'is_active' not in columns
    fixture=inspect.getsource(actual_seeded_repeat)
    for match in re.finditer(r'UPDATE user_profiles SET (.*?) WHERE',fixture,re.I|re.S):
        assigned=set(re.findall(r'(?:^|,)\s*(\w+)\s*=',match[1]))
        assert assigned<=columns, 'seeded profile update uses absent first52 column'
    inserts=re.findall(r'INSERT INTO user_profiles\(([^)]+)\)',fixture,re.I)
    assert inserts, 'seeded profiles must be inserted explicitly; Auth inserts create no profiles'
    for inserted in inserts:
        assert set(inserted.split(','))<=columns, 'seeded profile insert uses absent first52 column'
    assert 'seeded_profiles_present' in fixture, 'profile presence/status must be checked before preservation'


def assertion_semantics(b,h):
    database='gridex_auth_legacy_native'
    h.reset(database)
    for label,condition,state in assertion_cases():
        h.sql(database,check(condition),'assertion_'+label,expect=state)
    # Exercise the exact PostgreSQL 17 object class that failed before any
    # source lane. Both the uncalled and called states must remain observable.
    h.sql(database,"CREATE SEQUENCE public.repair_snapshot_state START WITH 17; SELECT setval('public.repair_snapshot_state',41,false);",'sequence_fixture')
    uncalled=[value for name,value in snapshot(b,h,database)[1]
              if name=='public.repair_snapshot_state']
    assert len(uncalled)==1 and set(uncalled[0])=={'last_value','log_cnt','is_called'}
    assert uncalled[0]['last_value']==41 and uncalled[0]['is_called'] is False
    h.sql(database,"SELECT nextval('public.repair_snapshot_state');",'sequence_call')
    called=[value for name,value in snapshot(b,h,database)[1]
            if name=='public.repair_snapshot_state']
    assert len(called)==1 and called[0]['last_value']==41 and called[0]['is_called'] is True
    assert called[0]!=uncalled[0]
    h.sql(database,'DROP SEQUENCE public.repair_snapshot_state;','sequence_cleanup')


def clone(h,database):
    h.reset(database)
    h.docker(['exec',h.name,'dropdb','-U','postgres',database])
    h.docker(['exec',h.name,'createdb','-U','postgres','-T','gridex_auth_legacy_template',database])


def snapshot(b,h,database):
    sql='''CREATE TEMP TABLE repair_test_rows(name text,row_value jsonb) ON COMMIT DROP;
DO $$ DECLARE r record; BEGIN
FOR r IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','S') LOOP
IF r.relkind='S' THEN
 EXECUTE format('INSERT INTO repair_test_rows SELECT %L,jsonb_build_object(''last_value'',last_value,''log_cnt'',log_cnt,''is_called'',is_called) FROM %I.%I',r.nspname||'.'||r.relname,r.nspname,r.relname);
ELSE
 EXECUTE format('INSERT INTO repair_test_rows SELECT %L,to_jsonb(x) FROM %I.%I x',r.nspname||'.'||r.relname,r.nspname,r.relname);
END IF; END LOOP; END $$;
SELECT coalesce(jsonb_agg(jsonb_build_array(name,row_value) ORDER BY name,row_value),'[]') FROM repair_test_rows;'''
    return b.catalog(h,database),json.loads(h.sql(database,sql,'snapshot'))


def unchanged(b,h,database,before):
    assert snapshot(b,h,database)==before, 'complete rollback rows/catalog mismatch'


def rollback_files(h,files):
    # Also fail closed if an expected native rejection unexpectedly succeeds.
    return [*files,h.private('repair-test-rollback.sql','ROLLBACK;')]


def rejected(b,h,database,state,label,files=None):
    before=snapshot(b,h,database)
    output=h.run_files(database,rollback_files(h,files or b.envelope_files(h,b.reviewed_paths())),label,expect=state)
    if label.startswith(('dirty_','catalog_')):
        assert not re.search(r'^REPAIR_STAGE_',output,re.M), 'source started before rejected admission'
    unchanged(b,h,database,before)


def parents():
    return f'''INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at)
VALUES ('{U}','repair-one@example.invalid','{{"fixture":"synthetic"}}','{{}}','2026-01-01'),
('{U2}','repair-two@example.invalid','{{}}','{{}}','2026-01-01');
INSERT INTO companies(id,name,slug,status) VALUES
('{C}','Repair fixture one','repair-fixture-one','active'),('{C2}','Repair fixture two','repair-fixture-two','active');'''


def actual_seeded_repeat(b,h):
    db='gridex_auth_legacy_prefix';clone(h,db)
    assert b.catalog(h,db)==b.REFERENCES[h].base
    expected_presence=[('relation/public.'+name) in b.REFERENCES[h].base for name in b.TARGETS]
    observed=json.loads(h.sql(db,"SELECT jsonb_agg(to_regclass('public.'||name) IS NOT NULL ORDER BY ordinal) FROM unnest(ARRAY["+
        ','.join(b.literal(name) for name in b.TARGETS)+"]) WITH ORDINALITY t(name,ordinal);",'target_presence'))
    assert observed==expected_presence and len(observed)==17
    b.execute(h,db,b.reviewed_paths())
    state=snapshot(b,h,db);b.execute(h,db,b.reviewed_paths());unchanged(b,h,db,state)
    print('PASS actual-first52 target_presence_mask='+''.join('1' if x else '0' for x in observed))
    db='gridex_auth_legacy_seeded';clone(h,db)
    h.sql(db,parents()+f'''
INSERT INTO user_profiles(id,email,user_status,active_company_id)
VALUES ('{U}','repair-one@example.invalid','disabled','{C}'),
('{U2}','repair-two@example.invalid','active','{C2}');
INSERT INTO company_memberships(company_id,user_id,membership_role,role,status,invited_email)
VALUES ('{C}','{U}','member','member','active','repair-one@example.invalid'),
('{C2}','{U}','member','member','active','repair-one@example.invalid'),
('{C2}','{U2}','member','member','active','repair-two@example.invalid');
INSERT INTO roles(key,name,description,scope,is_active,is_system,is_system_role,created_at,updated_at)
VALUES ('repair_custom','Retained custom role',NULL,'company',false,false,false,'2026-01-01','2026-01-02');
INSERT INTO roles(key,name,is_active,is_system,is_system_role) VALUES (NULL,'',false,false,false);
UPDATE roles SET name='Retained company role',description=NULL,is_active=false,is_system=false,
 is_system_role=false,created_at='2026-01-01',updated_at='2026-01-02' WHERE key='company_admin';
INSERT INTO permissions(key,name,description) VALUES ('repair.custom','Retained permission','synthetic');
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r,permissions p
 WHERE r.key='repair_custom' AND p.key='repair.custom';
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r,permissions p
 WHERE r.key='repair_custom' AND p.key='tenants.write' ON CONFLICT DO NOTHING;
INSERT INTO admin_users(user_id,role,is_active,metadata) VALUES ('{U}','superadmin',false,'{{"fixture":"retained"}}');
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after)
VALUES ('83000000-0000-0000-0000-000000000001','{U}','2026-01-01',NULL,'2026-02-01');
INSERT INTO platform_session_revocations(user_id,revoked_by,reason) VALUES ('{U}','{U2}','retained synthetic revocation');
INSERT INTO tenant_governance_events(company_id,target_user_id,actor_user_id,action)
VALUES ('{C}','{U}','{U2}','retained_fixture');
INSERT INTO customer_sync_events(company_id,source_type,event_type,title)
VALUES ('{C2}','synthetic','retained_fixture','Retained synthetic work');
''','seeded_fixture')
    h.sql(db,check(f"""(SELECT count(*)=2 AND bool_and((
      (id='{U}' AND user_status='disabled' AND active_company_id='{C}') OR
      (id='{U2}' AND user_status='active' AND active_company_id='{C2}')) IS TRUE)
      FROM user_profiles WHERE id IN ('{U}','{U2}'))"""),'seeded_profiles_present')
    h.sql(db,business_canaries(b,h),'business_canaries')
    before=snapshot(b,h,db)
    b.execute(h,db,b.reviewed_paths())
    after=snapshot(b,h,db)
    old=[row for row in before[1] if row[0]!='public.roles']
    assert old==[row for row in after[1] if row[0]!='public.roles']
    old_roles={row[1]['id']:row[1] for row in before[1] if row[0]=='public.roles'}
    assert old_roles=={row[1]['id']:row[1] for row in after[1] if row[0]=='public.roles' and row[1]['id'] in old_roles}
    b.execute(h,db,b.reviewed_paths());unchanged(b,h,db,after)



def business_canaries(b,h):
    # Every actual-prefix S2 target gets two tenant-owned synthetic rows; absent
    # branches remain absent. Shapes below come from complete selected sources.
    sql=""
    for number,(company,user) in enumerate(((C,U),(C2,U2)),1):
        customer=f'84000000-0000-0000-0000-{number:012d}'
        request=f'85000000-0000-0000-0000-{number:012d}'
        sql+=f"INSERT INTO customers(id,company_id,first_name,created_by) VALUES ('{customer}','{company}','Retained synthetic','{user}');"
        for table in b.TARGETS:
            if 'relation/public.'+table not in b.REFERENCES[h].base:continue
            columns=['company_id'];values=[b.literal(company)]
            shape=b.REFERENCES[h].base
            for column,value in (('customer_id',customer),('created_by',user)):
                if 'column/public.'+table+'/'+column in shape:
                    columns.append(column);values.append(b.literal(value))
            if table=='customer_info_requests':columns+=['id'];values+=[b.literal(request)]
            if table=='customer_info_request_events':columns+=['customer_info_request_id'];values+=[b.literal(request)]
            additions={'customer_internal_notes':('body','Retained synthetic note'),
              'customer_cases':('title','Retained synthetic case'),
              'partner_exports':('target_system','synthetic'),
              'customer_info_request_events':('event_type','retained_fixture'),
              'outbound_dispatch_events':('event_type','retained_fixture'),
              'supplier_switch_events':('event_type','retained_fixture')}
            if table in additions:
                column,value=additions[table];columns.append(column);values.append(b.literal(value))
            sql+='INSERT INTO public.'+table+'('+','.join(columns)+') VALUES ('+','.join(values)+');'
        sql+=f"INSERT INTO audit_logs(company_id,actor_user_id,entity_type,entity_id,action,metadata) VALUES ('{company}','{user}','synthetic','{customer}','retained_fixture','{{}}');"
        sql+=f"INSERT INTO user_permissions(user_id,company_id,permission_key,effect) VALUES ('{user}','{company}','repair.custom','allow');"
        sql+=f"INSERT INTO user_permission_overrides(user_id,company_id,permission_key,effect,created_by) VALUES ('{user}','{company}','repair.custom','deny','{user}');"
        sql+=f"INSERT INTO tenant_email_outbox(company_id,customer_id,email_type,to_email,subject,html_body,created_by) VALUES ('{company}','{customer}','synthetic','retained@example.invalid','Retained synthetic work','Retained synthetic body','{user}');"
    return sql


def policy_preimages(b,h):
    # Extra synthetic catalog lane, explicitly separate from actual first52.
    # Expected safe deltas are merged from the independently created oracle;
    # W and post-W data never calculate their own expected policy answer.
    original=b.REFERENCES[h];db='gridex_auth_legacy_seeded';reference='gridex_auth_legacy_native'
    table=next(t for t in b.TARGETS if 'relation/public.'+t in original.base)
    ddl=f"""ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY;
CREATE POLICY gridex_debug2_{table}_tenant_select ON public.{table} AS RESTRICTIVE FOR SELECT TO authenticated USING(company_id='{C}'::uuid);
CREATE POLICY gridex_debug2_{table}_tenant_insert ON public.{table} FOR INSERT TO service_role WITH CHECK(company_id='{C2}'::uuid);
CREATE POLICY gridex_debug2_{table}_tenant_update ON public.{table} FOR UPDATE TO authenticated USING(company_id='{C}'::uuid) WITH CHECK(company_id='{C2}'::uuid);
GRANT SELECT(company_id) ON public.{table} TO authenticated;"""
    # Actual52 absence is checked, so this fixture never assumes an old policy.
    for operation in ('select','insert','update'):
        assert 'policy/public.'+table+'/gridex_debug2_'+table+'_tenant_'+operation not in original.base
    clone(h,reference);h.sql(reference,ddl,'policy_reference')
    base=b.catalog(h,reference)
    final=dict(base)
    for key,value in original.final.items():
        if key not in original.base:final[key]=value
    # No baseline object is modified by independent safe source declarations.
    assert all(original.final.get(key)==value for key,value in original.base.items())
    try:
        b.REFERENCES[h]=b.Reference(h.directory.name,base,final)
        clone(h,db);h.sql(db,ddl,'policy_fixture')
        b.execute(h,db,b.reviewed_paths());state=snapshot(b,h,db)
        b.execute(h,db,b.reviewed_paths());unchanged(b,h,db,state)
    finally:b.REFERENCES[h]=original


def dirty_data(b,h):
    db='gridex_auth_legacy_dirty'
    cases={
      'active':f"INSERT INTO user_roles(user_id,company_id,role_id,role,status,is_active) SELECT '{U}','{C}',id,key,'active',true FROM roles WHERE key='company_admin';",
      'inactive':f"INSERT INTO user_roles(user_id,company_id,role,status,is_active) VALUES ('{U}','{C}','member','disabled',false);",
      'global':f"INSERT INTO user_roles(user_id,company_id,role,status,is_active) VALUES ('{U}',NULL,'member','active',true);",
      'multi_company_role':f"INSERT INTO user_roles(user_id,company_id,role_id,role) SELECT '{U}',c.id,r.id,r.key FROM companies c CROSS JOIN roles r WHERE c.id IN ('{C}','{C2}') AND r.key IN ('company_admin','operations_agent');",
      'null_activity':f"ALTER TABLE user_roles ALTER COLUMN status DROP NOT NULL; ALTER TABLE user_roles ALTER COLUMN is_active DROP NOT NULL; INSERT INTO user_roles(user_id,company_id,role,status,is_active) VALUES ('{U}','{C}',NULL,NULL,NULL);",
      'orphan_role':f"INSERT INTO user_roles(user_id,company_id,role) VALUES ('{U}','{C}','unmatched_synthetic_role');",
      'null_key_name':"INSERT INTO roles(key,name) VALUES(NULL,'Normalizable synthetic name');",
      'alias':"INSERT INTO roles(key,name) VALUES('companyadmin','Synthetic alias');",
      'ambiguous_name':"INSERT INTO roles(key,name) VALUES('repair_ambiguous','company_admin');",
    }
    for status in ('pending','expired','revoked','accepted'):
        cases['invitation_'+status]=f"INSERT INTO company_invitations(company_id,email,invited_email,status,expires_at) VALUES ('{C}','repair-invite@example.invalid','other-alias@example.invalid','{status}','2025-01-01');"
    cases['invitation_null_alias']=f"ALTER TABLE company_invitations ALTER COLUMN email DROP NOT NULL; INSERT INTO company_invitations(company_id,email,invited_email,status) VALUES ('{C}',NULL,NULL,'pending');"
    for label,sql in cases.items():
        clone(h,db);h.sql(db,parents()+sql,'fixture')
        rejected(b,h,db,'55000','dirty_'+label)
    # Reduced shape: duplicates and orphan/null identity rows remain forbidden.
    # These explicit relaxations only construct rejected inputs, never admission.
    for label,values in (
      ('duplicate',f"('{U}','{C}','member'),('{U}','{C}','member')"),
      ('orphan',"('89000000-0000-0000-0000-000000000001','89000000-0000-0000-0000-000000000002','member')"),
      ('null_identity',"(NULL,NULL,NULL)")):
        clone(h,db)
        h.sql(db,'''DO $$ DECLARE r record; BEGIN
FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='public.user_roles'::regclass AND contype IN ('f','u') LOOP
EXECUTE format('ALTER TABLE user_roles DROP CONSTRAINT %I',r.conname); END LOOP;
FOR r IN SELECT i.indexrelid::regclass AS idx FROM pg_index i WHERE i.indrelid='public.user_roles'::regclass AND i.indisunique AND NOT i.indisprimary LOOP
EXECUTE format('DROP INDEX %s',r.idx); END LOOP; END $$;
ALTER TABLE user_roles ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE user_roles ALTER COLUMN company_id DROP NOT NULL;
INSERT INTO user_roles(user_id,company_id,role) VALUES '''+values+';','reduced_dirty_fixture')
        rejected(b,h,db,'55000','dirty_'+label)


def dirty_catalog(b,h):
    db='gridex_auth_legacy_dirty'
    cases={
      'missing_table':('DROP TABLE company_invitations CASCADE;','42P01'),
      'missing_column':('ALTER TABLE company_memberships DROP COLUMN invited_email CASCADE;','42703'),
      'wrong_index':('DROP INDEX user_roles_user_active_idx; CREATE INDEX user_roles_user_active_idx ON user_roles(status,user_id,is_active);','42804'),
      'role_arbiter':('''DO $$ DECLARE r record; BEGIN
FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='public.roles'::regclass AND contype='u' LOOP EXECUTE format('ALTER TABLE roles DROP CONSTRAINT %I',r.conname); END LOOP;
FOR r IN SELECT i.indexrelid::regclass idx FROM pg_index i WHERE i.indrelid='public.roles'::regclass AND i.indisunique AND NOT i.indisprimary LOOP EXECUTE format('DROP INDEX %s',r.idx); END LOOP; END $$;''','42804'),
      'wrong_function_shape':('CREATE FUNCTION public.gridex_get_user_roles(uuid) RETURNS TABLE(role_key text) LANGUAGE sql AS $$ SELECT NULL::text $$;','42804'),
      'trigger':("CREATE FUNCTION public.repair_bad_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER repair_bad BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION public.repair_bad_trigger();",'P0004'),
      'rule':('CREATE RULE repair_bad AS ON UPDATE TO roles DO ALSO SELECT 1;','P0004'),
      'domain':('CREATE DOMAIN public.repair_reason AS text; ALTER TABLE company_memberships ALTER COLUMN status_reason TYPE public.repair_reason;','42804'),
      'generated':("ALTER TABLE roles ADD COLUMN repair_generated text GENERATED ALWAYS AS (upper(key)) STORED;",'42804'),
      'enum':("CREATE TYPE public.repair_reason_enum AS ENUM ('synthetic'); ALTER TABLE company_memberships ALTER COLUMN status_reason TYPE public.repair_reason_enum USING NULL;",'42804'),
      'platform_acl':('GRANT EXECUTE ON FUNCTION gridex_user_is_platform_admin() TO dashboard_user;','42804'),
    }
    for label,(setup,state) in cases.items():
        clone(h,db);h.sql(db,setup,'catalog_fixture');rejected(b,h,db,state,'catalog_'+label)
    # Use an actually absent target for wrong-kind/type constructions so no
    # accepted business relation is replaced or constraint silently disabled.
    absent=next((t for t in b.TARGETS if 'relation/public.'+t not in b.REFERENCES[h].base),None)
    if absent:
        for label,ddl in (('target_kind','CREATE VIEW public.'+absent+' AS SELECT NULL::uuid company_id;'),
                          ('target_type','CREATE TABLE public.'+absent+'(company_id text);')):
            clone(h,db);h.sql(db,ddl,'catalog_fixture');rejected(b,h,db,'42804' if label=='target_type' else 'P0004','catalog_'+label)
    else:
        # Full-target prefixes exercise wrong type on the actual table; DROP
        # dependents is confined to rejected disposable dirty input.
        t=b.TARGETS[0];clone(h,db)
        h.sql(db,'ALTER TABLE public.'+t+' ADD COLUMN repair_wrong_company_id text;','catalog_fixture')
        rejected(b,h,db,'42804','catalog_target_type')
    # Repeat-only catalog/ACL/owner substitutions reject before R2.
    for label,setup,state in (
      ('view_grant','GRANT SELECT ON gridex_debug_batch2_rbac_v TO authenticated;','42804'),
      ('view_column','GRANT SELECT(invited_email) ON gridex_debug_batch2_rbac_v TO anon;','42804'),
      ('view_owner','ALTER VIEW gridex_debug_batch2_rbac_v OWNER TO service_role;','42804'),
      ('view_shape','CREATE OR REPLACE VIEW gridex_debug_batch2_tenant_policy_gaps_v AS SELECT NULL::text table_name,NULL::text rls_status,false missing_select_policy,false missing_insert_policy,false missing_update_policy;','P0004')):
        clone(h,db);b.execute(h,db,b.reviewed_paths());h.sql(db,setup,'catalog_fixture');rejected(b,h,db,state,'catalog_'+label)


def reduced_schema():
    return '''CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE TABLE roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text UNIQUE,name text,description text,
 scope text DEFAULT 'company',is_system boolean NOT NULL DEFAULT false);
CREATE TABLE user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
CREATE TABLE companies(id uuid PRIMARY KEY,name text,status text);
CREATE TABLE company_memberships(company_id uuid,user_id uuid,invited_email text,membership_role text,role text,role_key text,status text,is_active boolean,accepted_at timestamptz);
CREATE TABLE company_invitations(company_id uuid,email text,invited_email text,status text,invited_user_id uuid,created_at timestamptz,accepted_at timestamptz);
CREATE TABLE admin_users(user_id uuid,role text,is_active boolean);
'''


def native_characterization(b,h):
    db='gridex_auth_legacy_native';sources={s.alias:s for s in b.validate_sources(b.reviewed_paths())}
    cases=[
      ('r2_alias_collision','R2',"INSERT INTO roles(key,name) VALUES ('superadmin','Alias one'),('platform_super_admin','Alias two');",None,'23505'),
      ('r2_null_activity','R2',f"INSERT INTO roles(key,name) VALUES ('repair_custom','Custom'); INSERT INTO user_roles(user_id,role_id) SELECT '{U}',id FROM roles WHERE key='repair_custom';",check("(SELECT role='repair_custom' AND status='active' AND is_active=true FROM user_roles)"),'00000'),
      ('r2_return_shape','R2','CREATE FUNCTION gridex_get_user_roles(uuid) RETURNS TABLE(role_key text) LANGUAGE sql AS $$ SELECT NULL::text $$;',None,'42P13'),
      ('e2_alias_fill','E2',f"INSERT INTO company_invitations(company_id,email,invited_email) VALUES ('{C}','left@example.invalid',NULL),('{C}',NULL,'right@example.invalid'),('{C}','a@example.invalid','b@example.invalid'),('{C}',NULL,NULL);",check("(SELECT count(*)=4 AND count(*) FILTER (WHERE email=invited_email)=2 AND count(*) FILTER (WHERE email='a@example.invalid' AND invited_email='b@example.invalid')=1 AND count(*) FILTER (WHERE email IS NULL AND invited_email IS NULL)=1 FROM company_invitations)"),'00000'),
      ('e2_added_email','E2',"ALTER TABLE company_invitations DROP COLUMN email; INSERT INTO company_invitations(invited_email) VALUES ('restored@example.invalid');",check("(SELECT email='restored@example.invalid' AND invited_email=email FROM company_invitations)"),'00000'),
      ('e2_added_invited_email','E2',"ALTER TABLE company_invitations DROP COLUMN invited_email; INSERT INTO company_invitations(email) VALUES ('restored@example.invalid');",check("(SELECT invited_email='restored@example.invalid' AND invited_email=email FROM company_invitations)"),'00000'),
      ('s2_all_absent','S2','',check("(SELECT count(*)=0 FROM gridex_debug_batch2_tenant_policy_gaps_v)"),'00000'),
      ('e2_missing_column','E2','ALTER TABLE company_memberships DROP COLUMN role_key;',None,'42703'),
      ('s2_missing_helper','S2','CREATE TABLE customer_blockers(company_id uuid);',None,'42883'),
      ('s2_wrong_type','S2','CREATE TABLE customer_blockers(company_id text); CREATE FUNCTION gridex_user_is_platform_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$; CREATE FUNCTION gridex_can_read_company(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$; CREATE FUNCTION gridex_can_write_company(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;',None,'42883'),
      ('s2_public_policy','S2',f"CREATE TABLE customer_blockers(company_id uuid); INSERT INTO customer_blockers VALUES ('{C}'),('{C2}'); CREATE FUNCTION gridex_user_is_platform_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$; CREATE FUNCTION gridex_can_read_company(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$; CREATE FUNCTION gridex_can_write_company(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$; GRANT SELECT,INSERT,UPDATE ON customer_blockers TO anon; GRANT USAGE ON SCHEMA public TO anon;",check("(SELECT count(*)=3 AND bool_and(polroles=ARRAY[0::oid] AND polpermissive) FROM pg_policy WHERE polrelid='customer_blockers'::regclass)")+f"SET LOCAL ROLE anon; SELECT count(*) FROM customer_blockers; INSERT INTO customer_blockers VALUES ('{C}'); UPDATE customer_blockers SET company_id='{C2}'; RESET ROLE;"+check('(SELECT count(*)=3 FROM customer_blockers)'), '00000'),
    ]
    for label,alias,setup,assertions,state in cases:
        h.reset(db);h.sql(db,reduced_schema()+setup,'native_fixture');before=snapshot(b,h,db)
        files=[h.private('native-whole-'+alias+'.sql',sources[alias].data)]
        if assertions:files.append(h.private('native-assertions.sql',assertions))
        h.run_files(db,rollback_files(h,files),'native_'+label,expect=state)
        unchanged(b,h,db,before)
    # Actual complete first52 native R2 changes are observed and then rolled back.
    clone(h,db);before=snapshot(b,h,db)
    h.run_files(db,rollback_files(h,[h.private('native-r2.sql',sources['R2'].data),
      h.private('native-r2-check.sql',check("position('admin_users' in pg_get_functiondef('gridex_user_is_platform_admin()'::regprocedure))>0")+
                check("has_function_privilege('authenticated','gridex_get_user_roles(uuid)','EXECUTE')"))]),'native_actual_r2')
    unchanged(b,h,db,before)


def private_query(h,db,sql):
    return h.docker(['exec',h.name,'psql','-X','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1','-c',sql]).decode().strip()


def spawn(b,h,db,files,label):
    path=h.private('repair-process-'+label+'.out',b'')
    with open(path,'wb') as stream:
        command=h.command(db,files)
        command[2:2]=['-e','PGAPPNAME=repair_'+label]
        process=subprocess.Popen(command,stdout=stream,stderr=stream,env=b.legacy.clean_environment())
    h.processes.append(process)
    return process,path


def observed(h,db,condition,seconds=8):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        if private_query(h,db,'SELECT ('+condition+')::int')=='1':return
        time.sleep(0.05)
    raise AssertionError('real concurrency condition not observed')


def result(b,process,path,label,state='00000'):
    process.wait(timeout=90)
    receipt=b.legacy.safe_receipt(path.read_text(),process.returncode,label)
    print(json.dumps(receipt,sort_keys=True),flush=True)
    assert receipt['sqlstate']==state and (state=='00000')==(process.returncode==0)


def wait_sleep(h,db,label):
    observed(h,db,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='repair_"+label+"' AND wait_event='PgSleep')")


def terminate(h,db,label):
    private_query(h,db,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='repair_"+label+"'")


def sentinel_sql():
    return "DO $$ BEGIN RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='"+SENTINEL+"',DETAIL='"+SENTINEL+"',HINT='"+SENTINEL+"'; END $$;"


def atomicity(b,h):
    db='gridex_auth_legacy_atomic'
    for stage in ('R2','E2','S2','W'):
        clone(h,db);files=b.envelope_files(h,b.reviewed_paths())
        needle='repair-whole-W.sql' if stage=='W' else 'repair-stage-'+stage+'.sql'
        index=next(i for i,p in enumerate(files) if p.name==needle)+1
        files.insert(index,h.private('repair-sentinel.sql',sentinel_sql()))
        rejected(b,h,db,'XX000','rollback_after_'+stage,files)
    clone(h,db);files=b.envelope_files(h,b.reviewed_paths())
    index=next(i for i,p in enumerate(files) if p.name=='repair-whole-W.sql')
    w=files[index].read_text();assert w.count('-- REPAIR_TEST_INSIDE_W')==1
    files[index]=h.private('repair-inside-W.sql',w.replace('-- REPAIR_TEST_INSIDE_W',
        "RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='"+SENTINEL+"';"))
    rejected(b,h,db,'XX000','rollback_inside_W',files)
    clone(h,db)
    rejected(b,h,db,'P0002','W_alone',[h.private('repair-standalone-W.sql',b.validate_sources(b.reviewed_paths())[-1].data)])
    for label,sql in (
      ('wrong_stage',"UPDATE repair_context SET stage='E2';"),
      ('stale_tx',"UPDATE repair_context SET txid=txid_current()-1;"),
      ('wrong_backend',"UPDATE repair_context SET backend=pg_backend_pid()+1;"),
      ('wrong_database',"UPDATE repair_context SET database_name='gridex_auth_legacy_native';"),
      ('wrong_hashes',"UPDATE repair_context SET hashes=ARRAY['incorrect'];"),
      ('missing_context','DROP TABLE repair_context;')):
        files=b.envelope_files(h,b.reviewed_paths())
        index=next(i for i,p in enumerate(files) if p.name=='repair-whole-W.sql')
        files.insert(index,h.private('repair-corrupt-context.sql',sql))
        rejected(b,h,db,'P0002',label,files)
    files=[p for p in b.envelope_files(h,b.reviewed_paths()) if p.name!='repair-whole-W.sql']
    rejected(b,h,db,'P0002','missing_W',files)
    # Stage guard rejects reordered complete sources even if caller bypasses
    # the public path/order constructor solely within this private negative test.
    files=b.envelope_files(h,b.reviewed_paths())
    i=next(i for i,p in enumerate(files) if p.name=='repair-stage-R2.sql')
    j=next(i for i,p in enumerate(files) if p.name=='repair-stage-E2.sql')
    files[i],files[j]=files[j],files[i]
    rejected(b,h,db,'P0002','reordered_stage',files)
    clone(h,db);before=snapshot(b,h,db)
    files=b.envelope_files(h,b.reviewed_paths());index=next(i for i,p in enumerate(files) if p.name=='repair-stage-S2.sql')+1
    files.insert(index,h.private('repair-death-wait.sql','SELECT pg_sleep(30);'))
    process,path=spawn(b,h,db,rollback_files(h,files),'backend_death')
    wait_sleep(h,db,'backend_death');terminate(h,db,'backend_death')
    result(b,process,path,'backend_death','57P01');unchanged(b,h,db,before)


def concurrency(b,h):
    db='gridex_auth_legacy_lock';clone(h,db);before=snapshot(b,h,db)
    holder,hpath=spawn(b,h,db,[h.private('repair-target-lock.sql',
        'LOCK TABLE public.company_invitations IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(30);')],'target_holder')
    wait_sleep(h,db,'target_holder')
    contender,cpath=spawn(b,h,db,rollback_files(h,b.envelope_files(h,b.reviewed_paths())),'target_contender')
    observed(h,db,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='repair_target_contender' AND wait_event_type='Lock')")
    result(b,contender,cpath,'target_lock_timeout','55P03')
    terminate(h,db,'target_holder');result(b,holder,hpath,'target_holder','57P01');unchanged(b,h,db,before)
    # Two whole groups: the second has no public/Auth/storage relation lock
    # while waiting for the same accepted (20260910,140053) transaction mutex.
    clone(h,db);files=b.envelope_files(h,b.reviewed_paths())
    files.insert(2,h.private('repair-serialize-wait.sql','SELECT pg_sleep(2);'))
    first,fpath=spawn(b,h,db,files,'first');wait_sleep(h,db,'first')
    second,spath=spawn(b,h,db,b.envelope_files(h,b.reviewed_paths()),'second')
    observed(h,db,"""EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity z
ON a.application_name='repair_first' AND z.application_name='repair_second'
JOIN pg_locks held ON held.pid=a.pid JOIN pg_locks waiting ON waiting.pid=z.pid
WHERE z.wait_event='advisory' AND held.locktype='advisory' AND held.granted
AND waiting.locktype='advisory' AND NOT waiting.granted
AND held.database=(SELECT oid FROM pg_database WHERE datname=current_database())
AND waiting.database=held.database AND held.classid=20260910 AND held.objid=140053 AND held.objsubid=2
AND waiting.classid=held.classid AND waiting.objid=held.objid AND waiting.objsubid=held.objsubid
AND a.pid=ANY(pg_blocking_pids(z.pid))
AND NOT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE l.pid=z.pid AND l.granted AND l.locktype='relation' AND n.nspname IN ('public','auth','storage')))""")
    result(b,first,fpath,'first');result(b,second,spath,'second')
    for path in (fpath,spath):assert re.findall(r'^REPAIR_STAGE_(\w+)$',path.read_text(),re.M)==['R2','E2','S2','COMPLETED']
    state=snapshot(b,h,db);b.execute(h,db,b.reviewed_paths());unchanged(b,h,db,state)
    # A dirty row committed while the contender waits must be visible to its
    # fresh READ COMMITTED admission after the mutex is acquired.
    clone(h,db);h.sql(db,parents(),'fixture')
    holder,hpath=spawn(b,h,db,[h.private('repair-fresh-holder.sql',
      f"SELECT pg_advisory_xact_lock(20260910,140053); INSERT INTO company_invitations(company_id,email,status) VALUES ('{C}','fresh@example.invalid','pending'); SELECT pg_sleep(2);")],'fresh_holder')
    wait_sleep(h,db,'fresh_holder')
    contender,cpath=spawn(b,h,db,rollback_files(h,b.envelope_files(h,b.reviewed_paths())),'fresh_contender')
    observed(h,db,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='repair_fresh_contender' AND wait_event='advisory')")
    result(b,holder,hpath,'fresh_holder');result(b,contender,cpath,'fresh_contender','55000')
    assert 'REPAIR_STAGE_' not in cpath.read_text()
    h.sql(db,check("(SELECT count(*)=1 AND min(email)='fresh@example.invalid' FROM company_invitations)"),'fresh_row_retained')
    # Catalog-trigger DDL has a real target lock; rollback restores trusted shape.
    clone(h,db)
    holder,hpath=spawn(b,h,db,[h.private('repair-catalog-holder.sql',
      "CREATE FUNCTION pg_temp.repair_lock_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER repair_lock BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION pg_temp.repair_lock_trigger(); SELECT pg_sleep(2); ROLLBACK;")],'catalog_holder')
    wait_sleep(h,db,'catalog_holder')
    contender,cpath=spawn(b,h,db,b.envelope_files(h,b.reviewed_paths()),'catalog_contender')
    observed(h,db,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='repair_catalog_contender' AND wait_event_type='Lock')")
    result(b,holder,hpath,'catalog_holder');result(b,contender,cpath,'catalog_contender')


def security(b,h):
    db='gridex_auth_legacy_helper';clone(h,db);b.execute(h,db,b.reviewed_paths())
    for role in ('anon','authenticated','authenticator','service_role'):
        for obj in b.VIEWS:
            h.sql(db,f'SET LOCAL ROLE {role}; SELECT * FROM public.{obj};','deny_'+role,expect='42501')
        for call in ('gridex_get_user_roles(NULL::uuid)','gridex_table_has_company_id(\'companies\')'):
            h.sql(db,f'SET LOCAL ROLE {role}; SELECT public.{call};','deny_'+role,expect='42501')
    # These grants are inserted only after admitted whole originals. W must
    # remove both inherited function/table and column-only privilege paths.
    # The membership is preexisting in the independent reference and target;
    # the hostile new diagnostic grants are not part of the expected result.
    original=b.REFERENCES[h]
    h.sql(db,'CREATE ROLE repair_inherited NOLOGIN; GRANT repair_inherited TO authenticated WITH INHERIT TRUE;','inherited_role')
    try:
        base=dict(original.base);final=dict(original.final)
        current=b.catalog(h,db)
        for key,value in current.items():
            if key.startswith(('database_role/repair_inherited','role_membership/repair_inherited/')):
                base[key]=value;final[key]=value
        b.REFERENCES[h]=b.Reference(h.directory.name,base,final)
        clone(h,db);files=b.envelope_files(h,b.reviewed_paths())
        index=next(i for i,p in enumerate(files) if p.name=='repair-whole-W.sql')
        files.insert(index,h.private('repair-inherited-diagnostic-grants.sql',
          'GRANT EXECUTE ON FUNCTION gridex_get_user_roles(uuid),gridex_table_has_company_id(text) TO repair_inherited; GRANT SELECT ON gridex_debug_batch2_rbac_v TO repair_inherited; GRANT SELECT(table_name) ON gridex_debug_batch2_tenant_policy_gaps_v TO authenticated;'))
        h.run_files(db,files,'inherited_privilege_boundary')
        h.sql(db,'SET LOCAL ROLE authenticated; SELECT * FROM gridex_debug_batch2_rbac_v;','inherited_denial',expect='42501')
    finally:
        # W removed the new grants; membership/role cleanup is explicit and owned.
        h.sql(db,'REVOKE repair_inherited FROM authenticated; DROP ROLE repair_inherited;','inherited_cleanup')
        b.REFERENCES[h]=original
    # Selected41 semantics are independently evaluated before/after the group,
    # using identical synthetic role scenarios after admission, inside rollback.
    # No role assignment is allowed at batch admission itself.
    helper_setup=parents()+"INSERT INTO roles(key,name) VALUES('super_admin','super_admin') ON CONFLICT(key) DO NOTHING;"+f"INSERT INTO user_roles(user_id,company_id,role_id,role,status,is_active) SELECT '{U}',{{company}},id,key,{{status}},{{active}} FROM roles WHERE key='super_admin';"
    reference='gridex_auth_legacy_native';clone(h,reference)
    for company in ('NULL',"'"+C+"'"):
        for status,active in (("'active'",'true'),("'disabled'",'false'),('NULL','NULL')):
            setup=helper_setup.replace('{company}',company).replace('{status}',status).replace('{active}',active)
            setup='ALTER TABLE user_roles ALTER COLUMN status DROP NOT NULL; ALTER TABLE user_roles ALTER COLUMN is_active DROP NOT NULL;'+setup
            sql=setup+f"SET LOCAL request.jwt.claim.sub='{U}'; SELECT gridex_user_is_platform_admin();"
            expected=h.run_files(reference,rollback_files(h,[h.private('repair-helper-case.sql',sql)]),'helper_reference')
            actual=h.run_files(db,rollback_files(h,[h.private('repair-helper-case.sql',sql)]),'helper_after')
            assert actual==expected
    sql=parents()+f"INSERT INTO admin_users(user_id,role,is_active) VALUES ('{U}','superadmin',true); SET LOCAL request.jwt.claim.sub='{U}'; SELECT gridex_user_is_platform_admin();"
    expected=h.run_files(reference,rollback_files(h,[h.private('repair-admin-helper-case.sql',sql)]),'admin_helper_reference')
    actual=h.run_files(db,rollback_files(h,[h.private('repair-admin-helper-case.sql',sql)]),'admin_helper_after')
    assert actual==expected


def private_logs_and_cleanup(b,h):
    db='gridex_auth_legacy_atomic';clone(h,db)
    output=io.StringIO()
    with contextlib.redirect_stdout(output):
        files=b.envelope_files(h,b.reviewed_paths())
        files.insert(-1,h.private('repair-log-sentinel.sql',sentinel_sql()))
        rejected(b,h,db,'XX000','private_statement',files)
        h.sql(db,"CREATE TEMP TABLE repair_parameter(value text UNIQUE); INSERT INTO repair_parameter VALUES ('"+SENTINEL+"'); PREPARE repair_statement(text) AS INSERT INTO repair_parameter VALUES ($1); EXECUTE repair_statement('"+SENTINEL+"');",'private_parameter',expect='23505')
    assert SENTINEL not in output.getvalue()
    for line in output.getvalue().splitlines():
        assert set(json.loads(line))<= {'stage','exit_code','sqlstate','category','milliseconds'}
    print(output.getvalue(),end='')
    collector=h.docker(['exec',h.name,'sh','-c','cat /var/lib/postgresql/data/pg_log_private/*'])
    assert SENTINEL.encode() in collector
    assert SENTINEL.encode() not in h.docker(['logs',h.name])
    assert set(h.docker(['exec',h.name,'sh','-c','stat -c %a /var/lib/postgresql/data/pg_log_private/*']).splitlines())=={b'600'}
    h.verify_logging()
    # LISTEN observes no batch work notification on success or rollback. A
    # committed synthetic control establishes that the listener is actually live.
    listener,lpath=spawn(b,h,db,[h.private('repair-listener.sql',
      'LISTEN repair_work; COMMIT; SELECT pg_sleep(5); SELECT 1;')],'listener')
    wait_sleep(h,db,'listener')
    h.sql(db,"NOTIFY repair_work,'control';",'notification_control')
    b.execute(h,db,b.reviewed_paths())
    files=b.envelope_files(h,b.reviewed_paths());files.insert(-1,h.private('repair-notify-rollback.sql',
      "NOTIFY repair_work,'rolled_back';"+sentinel_sql()))
    rejected(b,h,db,'XX000','notification_rollback',files)
    result(b,listener,lpath,'notification_listener')
    received=lpath.read_text()
    assert 'control' in received and 'rolled_back' not in received
    assert received.count('Asynchronous notification')==1


def extended_constructors(b):
    assertion_constructor_controls()
    sequence_snapshot_constructor_controls()
    plpgsql_alias_constructor_controls()
    seeded_profile_constructor_controls(b)
    sources=b.validate_sources(b.reviewed_paths())
    assert len(b.legacy.verified_prefix())==43
    assert len(b.legacy.validate_sources(b.legacy.reviewed_paths()))==9
    assert len(b.source_oracle(sources)[0])==16
    # Original bytes are immutable. Simulated IO corruption exercises the new
    # public validator without ever rewriting an original on disk.
    original_read=Path.read_bytes
    for source in sources:
        def corrupted(path, _source=source):
            data=original_read(path)
            return data+b'\n' if path==_source.path else data
        with patch.object(Path,'read_bytes',corrupted):
            try:b.validate_sources(b.reviewed_paths())
            except b.BoundaryError as error:assert str(error)=='SOURCE_HASH_MISMATCH'
            else:raise AssertionError('changed whole-source bytes accepted')
    for sql in ('COMMIT;','ROLLBACK;','BEGIN;','\\i unexpected.sql','SET ROLE authenticated;',
                "DO $$ BEGIN EXECUTE 'COMMIT'; END $$;",'ALTER TABLE roles DISABLE TRIGGER ALL;'):
        try:b.legacy.check_support(sql)
        except b.BoundaryError:pass
        else:raise AssertionError('transaction/role escape accepted')
    admission=(b.SUPPORT/'canonical-user-rbac-repair-admission.sql').read_text()
    for mutated in ("SELECT * FROM pg_class;\n"+admission,
                    admission.replace('140053','140054'),
                    admission.replace('pg_advisory_xact_lock','pg_advisory_lock')):
        try:b.legacy.validate_admission(mutated.replace('DO $repair$','DO $legacy$'))
        except b.BoundaryError:pass
        else:raise AssertionError('mutex ordering mutation accepted')
    # Recording-only exact owned-class construction: no connection/SQL occurs.
    # The transport check is explicitly replaced for this static file assembly.
    with tempfile.TemporaryDirectory(prefix='repair-constructor-') as directory:
        target=b.legacy.OwnedPostgres()
        target.directory=type('PrivateDirectory',(),{'name':directory})()
        target.active=True
        with patch.object(target,'verify_logging',lambda:None):
            try:
                try:b.envelope_files(target,b.reviewed_paths())
                except b.BoundaryError as error:assert str(error)=='OWNED_REFERENCE_REQUIRED'
                else:raise AssertionError('missing independent reference accepted')
                for active,name in ((False,target.name),(True,target.name+'-changed')):
                    saved=target.name;target.active=active;target.name=name
                    try:
                        try:b.envelope_files(target,b.reviewed_paths())
                        except b.BoundaryError:pass
                        else:raise AssertionError('wrong active/name ownership accepted')
                    finally:target.active=True;target.name=saved
                for database in ('postgres','production','postgresql://localhost/example'):
                    try:target.command(database)
                    except b.BoundaryError:pass
                    else:raise AssertionError('unowned database name accepted')
                b.REFERENCES[target]=b.Reference(directory,{}, {})
                files=b.envelope_files(target,b.reviewed_paths())
                assert [p.name for p in files]==['repair-context.sql','repair-admission.sql',
                  'repair-whole-R2.sql','repair-stage-R2.sql','repair-whole-E2.sql','repair-stage-E2.sql',
                  'repair-whole-S2.sql','repair-stage-S2.sql','repair-whole-W.sql','repair-assertions.sql']
                assert 'READ COMMITTED' in files[0].read_text()
                command=target.command('gridex_auth_legacy_prefix',files)
                assert command[:3]==['docker','exec','-i'] and command.count('--single-transaction')==1
                assert command.count('-f')==10 and '-h' not in command and '-p' not in command
                assert all(not key.startswith('PG') for key in b.legacy.clean_environment())
                assert all((p.stat().st_mode&0o777)==0o600 for p in files)
                assert all(s.data==files[2+index*2].read_bytes() for index,s in enumerate(sources[:3]))
                assert sources[-1].data==files[-2].read_bytes()
                assert all('ON COMMIT DROP' in files[index].read_text() for index in (0,1))
                assert all(pin in files[0].read_text() for pin in [s.sha256 for s in sources])
                assert 'backend=pg_backend_pid()' in b.stage_sql('R2','E2')
                assert b.REFERENCES[target].base=={} and target.reference is None
                b.REFERENCES[target]=b.Reference(directory+'-wrong',{}, {})
                try:b.envelope_files(target,b.reviewed_paths())
                except b.BoundaryError:pass
                else:raise AssertionError('foreign reference ownership accepted')
            finally:
                b.REFERENCES.pop(target,None);target.active=False;target.directory=None
    # Exact original17 stays fixed; the new job is independent and private.
    spec=importlib.util.spec_from_file_location('repair_workflow_checks',ROOT/'scripts/canonical-auth-provisioning-legacy-selftest.py')
    old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
    workflow=(ROOT/'.github/workflows/ops-hardening.yml').read_text()
    job=old.extract_top_level_job(workflow,'user-rbac-repair-proof')
    assert 'timeout-minutes: 20' in job
    assert 'python3 scripts/canonical-auth-membership-group.py --partition repair18' in job
    assert 'if: always()' in job and '--cleanup-owned' in job
    assert not re.search(r'\b(?:needs|services):|upload-artifact|docker logs|supabase/setup-cli',job)
    old.validate_legacy_job(old.extract_top_level_job(workflow,'auth-provisioning-legacy-proof'))
    command=subprocess.run(['python3','scripts/canonical-auth-membership-group.py','--dry-run'],capture_output=True,text=True)
    assert command.returncode==0
    assert command.stdout.count('canonical-auth-provisioning-legacy-selftest.py')==1
    assert command.stdout.count('canonical-user-rbac-repair-selftest.py')==1
    print('PASS independent repair source/hash/context/ownership/workflow constructors; no SQL execution')


def integration_constructors(b):
    """Fail before SQL on selection, ownership, retained-source or scope drift."""
    import hashlib, shutil, types
    spec=importlib.util.spec_from_file_location('repair_actual_replay',ROOT/'scripts/canonical-auth-provisioning-replay.py')
    replay=importlib.util.module_from_spec(spec);spec.loader.exec_module(replay)
    assert replay.load_batch() is b.legacy, 'trusted consumers must share the exact owned class'
    assert replay.load_repair() is b, 'repair reference registry must survive trusted reuse'
    key='canonical_owned_replay_batch';saved=sys.modules[key]
    try:
        copied=types.ModuleType(key);copied.__dict__.update(saved.__dict__)
        for untrusted in (types.ModuleType(key),copied):
            sys.modules[key]=untrusted
            try:replay.load_batch()
            except RuntimeError:pass
            else:raise AssertionError('arbitrary registered module accepted as trusted origin')
    finally:sys.modules[key]=saved
    order=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
    assert len(order)==118 and order[52:56]==['migrations/'+p.name for p in b.reviewed_paths()]
    account=subprocess.run(['python3','scripts/gridex-replay-input-accounting.py','--require-full-effects'],cwd=ROOT,capture_output=True,text=True)
    data=json.loads(account.stdout)
    assert account.returncode==1 and not data['errors']
    assert data['counts']=={'FULL_FILE_SELECTED':562,'SUBSTITUTED':19,'UNCLASSIFIED':14,'EXPLICITLY_EXCLUDED':5}
    by_path={row['path']:row for row in data['migrations']}
    for ordinal,path in enumerate(order[43:56],44):
        assert by_path[path]['execution']==[{'ordinal':ordinal,'stage':'foundation'}]
    for scope,flags in (('legacy52',['--foundation-prefix-proof']),('repair56',['--repair-prefix-proof']),('full',[])):
        assert replay.scope_flags(scope)==flags
        replay.require_context({'scope':scope},scope)
        for wrong in ({},{'prefix_only':True},{'scope':'56'},{'scope':'full' if scope!='full' else 'legacy52'}):
            try:replay.require_context(wrong,scope)
            except b.BoundaryError:pass
            else:raise AssertionError('wrong/missing scope admitted')
    script=str(ROOT/'scripts/canonical-auth-provisioning-replay.py')
    for flags in (['--foundation-prefix-proof','--repair-prefix-proof'],['--repair-prefix-proof','--cutoff','56'],['--unknown'],['--repair-prefix']):
        result=subprocess.run([sys.executable,script,*flags],capture_output=True)
        assert result.returncode==2
    # Full completeness admission must precede even the constructor/startup.
    class NoStartup:
        def __init__(self):raise AssertionError('incomplete full replay started an owned target')
    with patch.object(b.legacy,'OwnedPostgres',NoStartup),patch.object(sys,'argv',[script,'--owned-compatible']):
        try:replay.main()
        except b.BoundaryError as error:assert str(error)=='FULL_EFFECTS_INCOMPLETE'
        else:raise AssertionError('incomplete full replay admitted')
    with tempfile.TemporaryDirectory(prefix='repair-staged-constructor-') as directory:
        hold=Path(directory)/'hold';hold.mkdir(mode=0o700)
        for path in (ROOT/'supabase/migrations').iterdir():
            if path.is_file():shutil.copyfile(path,hold/path.name)
        h=b.legacy.OwnedPostgres();h.active=True;h.directory=types.SimpleNamespace(name=directory)
        h.reference=({'legacy_base':1},{'legacy_final':1})
        b.REFERENCES[h]=b.Reference(directory,{'repair_base':1},{'repair_final':1})
        h.verify_logging=lambda:None
        original_open=Path.open
        def retained_only(path,*args,**kwargs):
            if path.parent==ROOT/'supabase/migrations':raise AssertionError('ROOT original opened after HOLD mutation')
            return original_open(path,*args,**kwargs)
        paths=[str(hold/Path(p).name if p.startswith('migrations/') else ROOT/'supabase'/p) for p in order]
        try:
            # New native-COMMIT scopes have their own real lifecycle proof in command19.
            # These recorder-only checks retain full118 dispatch construction.
            with contextlib.ExitStack() as constructor_patches:
                dedupe=replay.load_dedupe()
                for name in ('require_live','accepted56','fail'):
                    constructor_patches.enter_context(patch.object(dedupe,name,return_value=None))
                constructor_patches.enter_context(patch.object(dedupe,'execute',side_effect=lambda target,db,paths,staging=None: observed.append((db,'dedupe',False)) or {'sources':1}))
                constructor_patches.enter_context(patch.object(dedupe,'continue_fixed',side_effect=lambda target,db,paths,staging: observed.append((db,'fixed',False)) or {'sources':6}))
                constructor_patches.enter_context(patch.object(dedupe,'continue_alignment',side_effect=lambda target,db,paths,staging,bounds: observed.append((db,'alignment',True)) or {'sources':5}))
                constructor_patches.enter_context(patch.object(dedupe,'continue_operations',side_effect=lambda target,db,paths,staging: observed.append((db,'operations',True)) or {'sources':3}))
                constructor_patches.enter_context(patch.object(dedupe,'continue_readiness',side_effect=lambda target,db,paths,staging: observed.append((db,'readiness',True)) or {'sources':3}))
                constructor_patches.enter_context(patch.object(dedupe,'continue_intake',side_effect=lambda target,db,paths,staging: observed.append((db,'intake',True)) or {'sources':3}))
                _record_scopes=('legacy52','repair56','dedupe57','fixed-target','alignment68','operations71','readiness74','intake77','full')
                for scope in _record_scopes:
                    dedupe._REFERENCES[h]=dedupe._Reference(directory,h.name,h.reference,b.REFERENCES[h],{},{},[],scope in ('fixed-target','alignment68','operations71','readiness74','intake77','full'),scope)
                    loop=replay.FoundationLoop(b.legacy,h,scope)
                    observed=[]
                    h.run_files=lambda db,files,stage,transaction=True:observed.append((db,stage,transaction))
                    def legacy_execute(target,db,logical,staging=None):
                        b.legacy.envelope_files(target,logical,staging)
                        observed.append((db,'legacy',True));return {'sources':9}
                    def repair_execute(target,db,logical,staging=None):
                        b.envelope_files(target,logical,staging)
                        observed.append((db,'repair',True));return {'sources':4}
                    with patch.object(Path,'open',retained_only),patch.object(b.legacy,'execute',legacy_execute),patch.object(b,'execute',repair_execute),contextlib.redirect_stdout(io.StringIO()):
                        loop.run(hold,paths)
                    expected=['replay_foundation_'+str(i) for i in range(1,44)]+['legacy']
                    if scope!='legacy52':expected+=['repair']
                    if scope in ('dedupe57','fixed-target','alignment68','operations71','readiness74','intake77','full'):expected+=['dedupe']
                    if scope in ('fixed-target','alignment68','operations71','readiness74','intake77','full'):expected+=['fixed']
                    if scope in ('alignment68','operations71','readiness74','intake77','full'):expected+=['alignment']
                    if scope in ('operations71','readiness74','intake77','full'):expected+=['operations']
                    if scope in ('readiness74','intake77','full'):expected+=['readiness']
                    if scope in ('intake77','full'):expected+=['intake']
                    if scope=='full':expected+=['replay_foundation_'+str(i) for i in range(78,119)]
                    assert [stage for _,stage,_ in observed]==expected
                    assert all(db==replay.DATABASE for db,_,_ in observed)
                    try:loop.run(hold,paths)
                    except b.BoundaryError:pass
                    else:raise AssertionError('duplicate whole foundation executed')
            loop=replay.FoundationLoop(b.legacy,h,'repair56')
            h.run_files=lambda *a,**k:(_ for _ in ()).throw(AssertionError('invalid stage reached target SQL'))
            for bad in (paths[:-1],paths[::-1],paths+paths[-1:],paths[:52]+paths[53:56]+paths[52:53]+paths[56:]):
                try:loop.run(hold,bad)
                except b.BoundaryError:pass
                else:raise AssertionError('invalid physical order accepted')
            dependencies=[*b.reviewed_paths(),ROOT/'supabase/migrations/20260810193450_canonical_access_provisioning_runtime_v1.sql']
            for logical in dependencies:
                path=hold/logical.name;raw=path.read_bytes()
                for mutation in ('missing','changed','symlink'):
                    path.unlink()
                    if mutation=='changed':path.write_bytes(raw+b'\n')
                    if mutation=='symlink':path.symlink_to(logical)
                    try:loop.run(hold,paths)
                    except b.BoundaryError:pass
                    else:raise AssertionError('bad retained dependency accepted')
                    path.unlink(missing_ok=True);path.write_bytes(raw)
            for scope in ('legacy52','repair56'):
                other=replay.FoundationLoop(b.legacy,h,scope)
                w=hold/b.W;raw=w.read_bytes();w.write_bytes(raw+b'\n')
                try:
                    try:other.run(hold,paths)
                    except b.BoundaryError:pass
                    else:raise AssertionError('whole118 validation omitted repair source in named scope')
                finally:w.write_bytes(raw)
            for fake_stage in (object(),types.SimpleNamespace(read=lambda p:p.read_bytes())):
                try:b.validate_sources(b.reviewed_paths(),fake_stage)
                except b.BoundaryError:pass
                else:raise AssertionError('duck-typed staged reader accepted')
            for scope in ('56',56,True,'repair52'):
                try:replay.FoundationLoop(b.legacy,h,scope)
                except b.BoundaryError:pass
                else:raise AssertionError('arbitrary scope accepted')
            for fake in (object(),types.SimpleNamespace(active=True,reference=h.reference,directory=h.directory)):
                try:replay.FoundationLoop(b.legacy,fake,'repair56')
                except b.BoundaryError:pass
                else:raise AssertionError('unowned target accepted')
            # Reference replacement after construction must fail before SQL.
            for replacement in ('legacy','repair','directory','inactive'):
                bound=replay.FoundationLoop(b.legacy,h,'repair56')
                saved_legacy=h.reference;saved_repair=b.REFERENCES[h];saved_name=h.name
                try:
                    if replacement=='legacy':h.reference=({}, {})
                    if replacement=='repair':b.REFERENCES[h]=b.Reference(directory,{}, {})
                    if replacement=='directory':h.name+='-wrong'
                    if replacement=='inactive':h.active=False
                    try:bound.run(hold,paths)
                    except b.BoundaryError:pass
                    else:raise AssertionError('changed owned reference reached target SQL')
                finally:h.reference=saved_legacy;b.REFERENCES[h]=saved_repair;h.name=saved_name;h.active=True
            saved_ref=b.REFERENCES.pop(h)
            try:
                try:replay.FoundationLoop(b.legacy,h,'repair56')
                except b.BoundaryError:pass
                else:raise AssertionError('legacy reference substituted for repair reference')
            finally:b.REFERENCES[h]=saved_ref
            assert h.reference==({'legacy_base':1},{'legacy_final':1})
            assert b.REFERENCES[h] is saved_ref
        finally:b.REFERENCES.pop(h,None);h.active=False;h.directory=None
    print('PASS repair integration constructors: exact118, shared trusted loader, retained dependencies, nine scopes and once-only same-target dispatch; NO SQL claim')


def replay_originals_snapshot():
    """In-memory exact restoration evidence, never expose original source bytes."""
    migrations=ROOT/'supabase/migrations'
    entries=[]
    for path in sorted(migrations.rglob('*')):
        stat=path.lstat()
        value=os.readlink(path) if path.is_symlink() else (path.read_bytes() if path.is_file() else None)
        entries.append((str(path.relative_to(migrations)),stat.st_mode,stat.st_mtime_ns,value))
    seed=ROOT/'supabase/seed.sql'
    return migrations.stat().st_mode,migrations.stat().st_mtime_ns,entries,seed.read_bytes(),seed.stat().st_mode,seed.stat().st_mtime_ns


def actual_replay_loop(b,h):
    """Real hosted shell/HOLD/planner/transport, both batches in one actual DB."""
    spec=importlib.util.spec_from_file_location('repair_actual_replay_sql',ROOT/'scripts/canonical-auth-provisioning-replay.py')
    replay=importlib.util.module_from_spec(spec);spec.loader.exec_module(replay)
    assert replay.load_batch() is b.legacy and replay.load_repair() is b
    command=['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--repair-prefix-proof']
    originals=replay_originals_snapshot()
    legacy_reference=h.reference;repair_reference=b.REFERENCES[h]
    original_legacy=b.legacy.execute;original_repair=b.execute
    reached=[];preimages=[]
    def legacy_once(target,database,paths,staging=None):
        assert target is h and database==replay.DATABASE and type(staging) is b.legacy.StagedSources
        reached.append('legacy')
        return original_legacy(target,database,paths,staging)
    def repair_once(target,database,paths,staging=None):
        assert target is h and database==replay.DATABASE and type(staging) is b.legacy.StagedSources
        assert h.catalog(database)==legacy_reference[1]
        assert b.catalog(h,database)==repair_reference.base
        reached.append('repair');preimages.append(snapshot(b,h,database))
        return original_repair(target,database,paths,staging)
    try:
        b.legacy.execute=legacy_once;b.execute=repair_once
        h.reset(replay.DATABASE)
        status=replay.serve_child(b.legacy,h,command,'repair56')
        assert status==0 and reached==['legacy','repair'] and len(preimages)==1
        assert not (Path(h.directory.name)/'replay.sock').exists()
        assert replay_originals_snapshot()==originals, 'successful staging did not restore exact originals'
        after=snapshot(b,h,replay.DATABASE)
        assert after[0]==repair_reference.final
        before=preimages[0]
        assert [row for row in before[1] if row[0]!='public.roles']==[row for row in after[1] if row[0]!='public.roles']
        old_roles={row[1]['id']:row[1] for row in before[1] if row[0]=='public.roles'}
        assert old_roles=={row[1]['id']:row[1] for row in after[1] if row[0]=='public.roles' and row[1]['id'] in old_roles}
        old_keys={row['key'] for row in old_roles.values()}
        added=[row[1] for row in after[1] if row[0]=='public.roles' and row[1]['id'] not in old_roles]
        expected=[row for row in b.source_oracle(b.validate_sources(b.reviewed_paths()))[0] if row[0] not in old_keys]
        assert sorted((r['key'],r['name'],r['description'],r['scope']) for r in added)==sorted(expected)
        assert all(r['is_system'] is True for r in added)
        rejected(b,h,replay.DATABASE,'P0002','actual_replay_W_alone',
                 [h.private('actual-replay-outside-W.sql',b.validate_sources(b.reviewed_paths())[-1].data)])
        # Real post-W marker can only be produced by the same backend and tx.
        # Explicit terminal rollback also protects against unexpected success.
        reached.clear();preimages.clear();rollbacks=[]
        def injected(target,database,paths,staging=None):
            assert target is h and database==replay.DATABASE and type(staging) is b.legacy.StagedSources
            assert h.catalog(database)==legacy_reference[1] and b.catalog(h,database)==repair_reference.base
            reached.append('repair');preimages.append(snapshot(b,h,database))
            files=b.envelope_files(h,paths,staging)
            files.insert(-1,h.private('actual-replay-after-W.sql',
                "SELECT 'ACTUAL_REPLAY_W_REACHED' FROM pg_temp.repair_context WHERE stage='W' AND txid=txid_current() AND backend=pg_backend_pid() AND database_name=current_database();"+sentinel_sql()))
            output=h.run_files(database,rollback_files(h,files),'actual_replay_rollback_after_W',expect='XX000')
            assert output.splitlines().count('ACTUAL_REPLAY_W_REACHED')==1
            assert re.findall(r'^REPAIR_STAGE_(\w+)$',output,re.M)==['R2','E2','S2']
            rollbacks.append('after_W_XX000')
            raise b.BoundaryError('SYNTHETIC_REPLAY_FAILURE')
        b.execute=injected
        h.reset(replay.DATABASE)
        status=replay.serve_child(b.legacy,h,command,'repair56')
        assert status!=0 and reached==['legacy','repair'] and len(preimages)==1 and rollbacks==['after_W_XX000']
        assert not (Path(h.directory.name)/'replay.sock').exists()
        unchanged(b,h,replay.DATABASE,preimages[0])
        assert b.catalog(h,replay.DATABASE)==repair_reference.base and h.catalog(replay.DATABASE)==legacy_reference[1]
        assert replay_originals_snapshot()==originals, 'failed staging did not restore exact originals'
        assert h.reference is legacy_reference and b.REFERENCES[h] is repair_reference
    finally:
        b.legacy.execute=original_legacy;b.execute=original_repair
    h.verify_logging()
    h.docker(['logs',h.name])
    assert SENTINEL.encode() not in (Path(h.directory.name)/'docker-private-last.out').read_bytes()
    assert all(path.stat().st_mode & 0o077==0 for path in Path(h.directory.name).iterdir() if path.is_file())
    print('PASS actual clean-shell HOLD/planner/bootstrap/first43/legacy44-52/repair53-56 once in same owned replay DB; independent rows/catalog, W-alone rejection, post-W rollback to intact52 rows/catalog/sequence, exact restoration and private logs; NO ledger provenance; NOT full replay')


def cleanup_proof(b):
    # This bounded failure path uses the same owned lifecycle with a distinct
    # stopped canary. Neither raw startup nor cleanup stderr can reach receipts.
    owner=os.environ.get('GRIDEX_LEGACY_CONTAINER_NAME') or 'gridex-auth-legacy-repair-'+os.urandom(8).hex()
    canary=owner+'-canary'
    created=subprocess.run(['docker','create','--name',canary,'--label','gridex.auth-legacy.canary='+owner,'postgres:17'],capture_output=True)
    assert created.returncode==0
    name=None
    try:
        try:
            with b.legacy.OwnedPostgres() as target:
                name=target.name
                raise b.BoundaryError('SYNTHETIC_CLEANUP_PATH')
        except b.BoundaryError as error:
            assert str(error)=='SYNTHETIC_CLEANUP_PATH'
        gone=subprocess.run(['docker','ps','-aq','--filter','name=^/'+name+'$'],capture_output=True)
        kept=subprocess.run(['docker','ps','-aq','--filter','name=^/'+canary+'$','--filter','label=gridex.auth-legacy.canary='+owner],capture_output=True)
        assert gone.returncode==kept.returncode==0 and not gone.stdout.strip() and kept.stdout.strip()
    finally:
        removed=subprocess.run(['docker','rm','-v',canary],capture_output=True)
        assert removed.returncode==0
    print('PASS repair failure cleanup retains separate owned canary')


def sql_main(b):
    def interrupted(signum,frame):raise b.BoundaryError('INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    started=time.monotonic()
    with b.legacy.OwnedPostgres() as target:
        b.prepare_reference(target)
        clone(target,'gridex_auth_legacy_replay')
        canary=snapshot(b,target,'gridex_auth_legacy_replay')
        for lane in (assertion_semantics,actual_seeded_repeat,policy_preimages,dirty_data,dirty_catalog,native_characterization,atomicity,concurrency,security,private_logs_and_cleanup):
            begin=time.monotonic();lane(b,target)
            print('PASS repair lane='+lane.__name__+' milliseconds='+str(round((time.monotonic()-begin)*1000)),flush=True)
        unchanged(b,target,'gridex_auth_legacy_replay',canary)
        print('PASS complete R2-E2-S2-W standalone SQL lanes before staged integration',flush=True)
        begin=time.monotonic();actual_replay_loop(b,target)
        print('PASS repair lane=actual_replay_loop milliseconds='+str(round((time.monotonic()-begin)*1000)),flush=True)
    cleanup_proof(b)
    print('PASS complete command18 standalone and actual staged repair56 SQL proof milliseconds='+str(round((time.monotonic()-started)*1000)))


if __name__ == '__main__':
    try:
        b=load_batch()
        if '--cleanup-owned' in sys.argv:
            b.legacy.cleanup_workflow_owned()
        else:
            constructor_checks();extended_constructors(b);integration_constructors(b)
            if '--selection-only' not in sys.argv:sql_main(b)
    except BaseException as error:
        if isinstance(error,(KeyboardInterrupt,SystemExit)):raise
        # Exception text, SQL, result rows, stack locals and native logs stay private.
        print('FAIL repair proof category=UNEXPECTED_RESULT type='+type(error).__name__,file=sys.stderr)
        sys.exit(1)
