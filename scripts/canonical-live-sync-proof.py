#!/usr/bin/env python3
"""Native boundary proof on clones of the actual 228-input replay prefix.

Runs inside the existing owned/private PG17 handle; no managed database or URL.
The historical failure, injected rollback and green candidate use complete SQL.
Behavior fixtures are explicitly bounded, not a claim of full Auth/RLS parity.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('live_sync_reconstruction', ROOT/'scripts/canonical-live-sync-reconstruction.py')
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)
CLONES = ('gridex_auth_legacy_dirty', 'gridex_auth_legacy_atomic', 'gridex_auth_legacy_native', 'gridex_auth_legacy_helper')
META_SQL = f"""SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,
'body',prosrc,'config',proconfig,'definer',prosecdef,'volatility',provolatile,
'definition',pg_get_functiondef(oid),
'execute',jsonb_build_object('anon',has_function_privilege('anon',oid,'EXECUTE'),
'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),
'service_role',has_function_privilege('service_role',oid,'EXECUTE')))
FROM pg_proc WHERE oid=to_regprocedure('{fix.SIGNATURE}');"""
ROWS_SQL = """
CREATE TEMP TABLE live_sync_row_snapshot(k text PRIMARY KEY,n bigint,h text) ON COMMIT DROP;
DO $row_snapshot$
DECLARE r record; amount bigint; fingerprint text;
BEGIN
  FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p') ORDER BY 1,2
  LOOP
    EXECUTE format('SELECT count(*),md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text),'''')) FROM %I.%I t',r.nspname,r.relname)
      INTO amount,fingerprint;
    INSERT INTO pg_temp.live_sync_row_snapshot VALUES (r.nspname||'.'||r.relname,amount,fingerprint);
  END LOOP;
END
$row_snapshot$;
SELECT coalesce(jsonb_object_agg(k,jsonb_build_array(n,h)),'{}'::jsonb) FROM pg_temp.live_sync_row_snapshot;
"""


def checkpoint(case):
    print(json.dumps({'scope':'LIVE_SYNC_BOUNDARY_PROOF','case':case,'result':'PASS'}),flush=True)


def check(condition, label):
    if not condition:
        raise ValueError(label)


def clone(target, source, destination):
    check(source == 'gridex_auth_legacy_replay' and destination in CLONES, 'LIVE_SYNC_OWNED_CLONE_REQUIRED')
    target.command(source)  # Existing owned target/database admission.
    target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',destination])
    target.docker(['exec',target.name,'createdb','-U','postgres','-T',source,destination])


def snapshot(target, database):
    return target.catalog(database), json.loads(target.sql(database,ROWS_SQL,'live_sync_row_snapshot'))


def metadata(target, database):
    return json.loads(target.sql(database,META_SQL,'live_sync_guard_metadata'))


def assert_sql(expression, label='LIVE_SYNC_BEHAVIOR_FAILED'):
    return "DO $check$ BEGIN IF ("+expression+") IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='"+label+"'; END IF; END $check$;\n"


def behavior(target, accepted):
    database=CLONES[3]
    target.reset(database)
    # Real auth.uid definition, not a permissive stub; a small profile table is
    # the explicitly labelled function fixture, not a replacement for actual RLS.
    bootstrap=(ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text()
    auth_matches=re.findall(r'create or replace function auth\.uid\(\).*?\$\$;',bootstrap,re.S)
    check(len(auth_matches)==1,'LIVE_SYNC_AUTH_UID_SOURCE_REQUIRED')
    sql='CREATE SCHEMA auth;\n'+auth_matches[0]+"\nCREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text,disabled_at timestamptz);\n"
    sql+=accepted['definition']+';\n'
    sql+='REVOKE ALL ON FUNCTION '+fix.SIGNATURE+' FROM public,anon,authenticated,service_role;\n'
    for role,allowed in accepted['execute'].items():
        check(role in ('anon','authenticated','service_role') and type(allowed) is bool,'LIVE_SYNC_ACL_SHAPE_REQUIRED')
        if allowed: sql+='GRANT EXECUTE ON FUNCTION '+fix.SIGNATURE+' TO '+role+';\n'
    sql+="INSERT INTO public.user_profiles VALUES ('11111111-1111-4111-8111-111111111111','active',NULL),('22222222-2222-4222-8222-222222222222','disabled',NULL);\n"
    target.sql(database,sql,'live_sync_behavior_fixture')
    statements=["BEGIN;", "SELECT set_config('request.jwt.claims','{}',true);", "SELECT set_config('request.jwt.claim.sub','',true);",
                assert_sql('NOT '+fix.SIGNATURE)]
    claims="SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);"
    statements+=[claims,assert_sql(fix.SIGNATURE)]
    for status in ('disabled','locked_security','removed_from_company','invitation_revoked'):
        statements += ["UPDATE public.user_profiles SET user_status='"+status+"' WHERE id='11111111-1111-4111-8111-111111111111';",assert_sql('NOT '+fix.SIGNATURE)]
    statements += ["UPDATE public.user_profiles SET user_status='active',disabled_at=now() WHERE id='11111111-1111-4111-8111-111111111111';",assert_sql('NOT '+fix.SIGNATURE),
                   "UPDATE public.user_profiles SET disabled_at=NULL WHERE id='11111111-1111-4111-8111-111111111111';",assert_sql(fix.SIGNATURE),
                   "SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);",assert_sql('NOT '+fix.SIGNATURE),claims,assert_sql(fix.SIGNATURE)]
    if accepted['execute']['authenticated']:
        statements += ['SET LOCAL ROLE authenticated;',assert_sql(fix.SIGNATURE),"SELECT set_config('request.jwt.claim.sub','',true);",assert_sql('NOT '+fix.SIGNATURE),'RESET ROLE;',claims]
    # Both schema variants are explicitly supported by the versioned authority.
    statements += ['ALTER TABLE public.user_profiles DROP COLUMN disabled_at;',assert_sql(fix.SIGNATURE),
                   "UPDATE public.user_profiles SET user_status='disabled' WHERE id='11111111-1111-4111-8111-111111111111';",assert_sql('NOT '+fix.SIGNATURE),
                   "SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);",assert_sql(fix.SIGNATURE),
                   'DROP TABLE public.user_profiles;',assert_sql(fix.SIGNATURE),"SELECT set_config('request.jwt.claim.sub','',true);",assert_sql('NOT '+fix.SIGNATURE),'ROLLBACK;']
    target.sql(database,'\n'.join(statements),'live_sync_behavior_matrix',transaction=False)
    for role,allowed in accepted['execute'].items():
        sql='BEGIN; SET LOCAL ROLE '+role+"; SELECT set_config('request.jwt.claim.sub','',true); SELECT "+fix.SIGNATURE+'; ROLLBACK;'
        target.sql(database,sql,'live_sync_acl_'+role,expect='00000' if allowed else '42501',transaction=False)
    checkpoint('bounded_session_and_caller_matrix')


def execute_boundary(root,target,database,source_sql,progress):
    """Prove on owned clones before applying the reconstruction to the replay."""
    check(Path(root).resolve()==ROOT and database=='gridex_auth_legacy_replay','LIVE_SYNC_OWNED_TARGET_REQUIRED')
    rendered,evidence=fix.reconstruct(ROOT,source_sql)
    progress['sessionReconstruction']=dict(evidence,nativeBoundaryVerified=False)
    current_phase='original_failure'
    try:
        # RED: exact historical migration really fails, and its transaction does
        # not leave catalog/row changes on the clone of the actual full prefix.
        clone(target,database,CLONES[0]); before=snapshot(target,CLONES[0])
        target.sql(CLONES[0],source_sql,'live_sync_original_red',expect='42601',transaction=False)
        check(snapshot(target,CLONES[0])==before,'LIVE_SYNC_ORIGINAL_ROLLBACK_FAILED')
        checkpoint('original_42601_and_catalog_row_rollback')

        current_phase='injected_rollback'
        clone(target,database,CLONES[1]); before=snapshot(target,CLONES[1])
        check(rendered.endswith('commit;\n'),'LIVE_SYNC_TRANSACTION_BOUNDARY_MISMATCH')
        injected=rendered[:-len('commit;\n')]+"DO $failure$ BEGIN RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='LIVE_SYNC_INJECTED_FAILURE'; END $failure$;\ncommit;\n"
        target.sql(CLONES[1],injected,'live_sync_injected_rollback',expect='ZX001',transaction=False)
        check(snapshot(target,CLONES[1])==before,'LIVE_SYNC_CANDIDATE_ROLLBACK_FAILED')
        checkpoint('full_candidate_failure_before_commit_rolls_back')

        current_phase='native_success'
        clone(target,database,CLONES[2]); before_meta=metadata(target,CLONES[2])
        target.sql(CLONES[2],rendered,'live_sync_candidate_green',transaction=False)
        accepted=metadata(target,CLONES[2])
        _,expected=fix.function_parts(fix.read_pinned(ROOT,fix.FORWARD,fix.FORWARD_SHA256))
        check(accepted['body']==expected and all(accepted[k]==before_meta[k] for k in ('oid','owner','acl','execute','definer','volatility')),'LIVE_SYNC_FUNCTION_OR_ACL_CHANGED')
        target.sql(CLONES[2],assert_sql("to_regprocedure('public.gridex__repair_replace_function_text(text,text,text)') IS NULL"),'live_sync_no_repair_helper')
        checkpoint('complete_candidate_exact_function_and_unchanged_acl')

        current_phase='preimage_negative'
        clone(target,database,CLONES[0])
        wrong=before_meta['definition'].replace('return true;','return false;')
        target.sql(CLONES[0],wrong,'live_sync_changed_preimage')
        before=snapshot(target,CLONES[0])
        target.sql(CLONES[0],rendered,'live_sync_preimage_negative',expect='55000',transaction=False)
        check(snapshot(target,CLONES[0])==before,'LIVE_SYNC_PREIMAGE_FAILURE_LEFT_EFFECTS')
        checkpoint('unknown_preimage_denied_without_partial_effects')

        current_phase='behavior'
        behavior(target,accepted)
        current_phase='replay_application'
        target.sql(database,rendered,'live_sync_reconstructed_229',transaction=False)
        after=metadata(target,database)
        check(after['body']==expected and after['acl']==accepted['acl'],'LIVE_SYNC_REPLAY_POSTIMAGE_MISMATCH')
        progress['sessionReconstruction']['nativeBoundaryVerified']=True
        checkpoint('actual_replay_boundary_applied')
    finally:
        progress['sessionReconstruction']['lastPhase']=current_phase
        for name in CLONES:
            target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',name])
