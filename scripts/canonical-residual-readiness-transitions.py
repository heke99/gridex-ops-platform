#!/usr/bin/env python3
"""Exact May21 view projection transition and original June1 lock ordering.

No historical source is overwritten. View rank/filter semantics are retained
from May21; the existing published columns, OID, ACL and security options remain.
The June1 source is executed whole before June2 first creates the keyed table.
"""
import hashlib
from pathlib import Path
import re

READINESS = 'migrations/20260521_batch_1_2_live_readiness_and_automation_hardening.sql'
LOCKS = 'migrations/20260601070000_ediel_production_readiness_hardening.sql'
PINS = {
    READINESS: '9f741fb9afc07661713e8448cb394f9ec950e25eaf56ee4422b0983886f81c34',
    LOCKS: '7a73e59f559ebb5291d3e7df74545e6918011ec9764e5c512df19fbaa5bdbc12',
}
BEFORE_LOCKS = 'bootstrap/20260601_ediel_production_readiness_foundation.sql'
AFTER_READINESS = 'migrations/20260521_actor_testing_go_live_module.sql'
COLUMNS = ('id','company_id','actor_name','actor_ediel_id','actor_role','environment',
           'is_active','sender_name','sender_sub_address','default_application_reference',
           'default_timezone','default_charset','default_test_flag','smtp_from_email',
           'smtp_reply_to_email','mailbox','brp_name','brp_ediel_id','brp_status','esett_status',
           'valid_from','valid_to','notes','metadata','created_at','updated_at','created_by','updated_by')
VIEW = 'public.ediel_active_actor_settings_v'
PROJECTION = r'(create or replace view public\.ediel_active_actor_settings_v as\n      select\n)(.*?)(\n      from \()'


def verified(relative, raw):
    if relative not in PINS or type(raw) is not bytes or hashlib.sha256(raw).hexdigest() != PINS[relative]:
        raise ValueError('READINESS_SOURCE_MISMATCH')
    return raw.decode('utf-8')


def read(root, relative):
    base = Path(root)/'supabase'
    path = base/relative
    if relative not in PINS or base.is_symlink() or path.parent.is_symlink() or path.is_symlink() or not path.is_file():
        raise ValueError('READINESS_SOURCE_REQUIRED')
    raw = path.read_bytes()
    verified(relative, raw)
    return raw


def projection(sql):
    matches = list(re.finditer(PROJECTION, sql, re.S))
    if len(matches) != 1:
        raise ValueError('READINESS_PROJECTION_MISMATCH')
    return matches[0]


def reconstruct(raw, db1_authority):
    sql = verified(READINESS, raw)
    if type(db1_authority) is not bytes or hashlib.sha256(db1_authority).hexdigest() != 'aff5a3e4fb3aae6ebe682081cbce4876c5731be1c124650b19d8151abf6efc73':
        raise ValueError('READINESS_DB1_AUTHORITY_MISMATCH')
    old = re.search(r'create or replace view public\.ediel_active_actor_settings_v as\n(select \*\n.*?);', db1_authority.decode(), re.S)
    if old is None:
        raise ValueError('READINESS_DB1_VIEW_MISSING')
    # SELECT * was expanded at the actual DB1 boundary, before later additive
    # actor columns. Bind to those original 28 columns rather than a new star.
    previous = old[1].replace('select *\n', 'select '+','.join(COLUMNS)+'\n', 1)
    selected = projection(sql)
    body = sql[:selected.start(2)] + ',\n'.join('        ranked.'+c for c in (*COLUMNS,'runtime_rank')) + sql[selected.end(2):]
    prefix = f"""CREATE TEMP VIEW gridex_residual_actor_expected AS {previous};
DO $actor_preimage$
BEGIN
  IF current_setting('check_function_bodies') <> 'on'
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('{VIEW}') AND relkind='v')
     OR pg_get_viewdef(to_regclass('{VIEW}'),true) IS DISTINCT FROM pg_get_viewdef('pg_temp.gridex_residual_actor_expected'::regclass,true)
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='RESIDUAL_ACTOR_VIEW_PREIMAGE_MISMATCH'; END IF;
END $actor_preimage$;
CREATE TEMP TABLE gridex_residual_actor_identity ON COMMIT DROP AS
  SELECT oid,relowner,relacl,reloptions FROM pg_class WHERE oid=to_regclass('{VIEW}');
DROP VIEW pg_temp.gridex_residual_actor_expected;
"""
    suffix = f"""
DO $actor_identity$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.gridex_residual_actor_identity b JOIN pg_class c ON c.oid=b.oid
    WHERE c.oid=to_regclass('{VIEW}') AND c.relowner=b.relowner
      AND c.relacl IS NOT DISTINCT FROM b.relacl AND c.reloptions IS NOT DISTINCT FROM b.reloptions)
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='RESIDUAL_ACTOR_VIEW_IDENTITY_CHANGED'; END IF;
END $actor_identity$;
DROP TABLE pg_temp.gridex_residual_actor_identity;
"""
    return prefix + body + suffix
