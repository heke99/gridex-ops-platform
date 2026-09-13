#!/usr/bin/env python3
"""Explicit, source-pinned residual transitions; no replay acceptance shortcut.

Historical SQL remains immutable. The intake reconstruction changes one column
reference. The alignment reconstruction preserves the already-applied canonical
four-column role function instead of attempting a backwards return-type change.
Every other source byte is retained. All three sources execute atomically.
"""
from __future__ import annotations
import hashlib
import re
from pathlib import Path

DB1 = 'migrations/20260522_db1_schema_repair_backfill_foundation.sql'
INTAKE = 'migrations/20260521_batch_customer_intake_batch2_completion.sql'
ALIGNMENT = 'migrations/20260525_debug_fix_batch_1b_schema_code_alignment.sql'
AUTHORITY = 'migrations/20260526_debug_step1_2c_full_schema_code_alignment.sql'
PINS = {
    DB1: 'aff5a3e4fb3aae6ebe682081cbce4876c5731be1c124650b19d8151abf6efc73',
    INTAKE: '9cf593a45de464b273eb0642645d21d4b831fbc6e2458cb41711dcfdb90fff6a',
    ALIGNMENT: 'c846be376c5f878965ea6a831d23611da959d4721cd0ebfb853fa46b10bccf68',
    AUTHORITY: '5a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472',
}
ORDER = (DB1, INTAKE, ALIGNMENT)
SIGNATURE = 'public.gridex_get_user_roles(uuid)'
FUNCTION = r'create or replace function public\.gridex_get_user_roles\(p_user_id uuid\).*?\bas \$\$(.*?)\$\$;'


def verified(relative, raw):
    if (relative not in PINS or type(raw) is not bytes
            or hashlib.sha256(raw).hexdigest() != PINS[relative]):
        raise ValueError('RESIDUAL_TRANSITION_SOURCE_MISMATCH')
    return raw.decode('utf-8')


def read(root, relative):
    base = Path(root) / 'supabase'
    path = base / relative
    if (relative not in PINS or base.is_symlink() or path.parent.is_symlink()
            or path.is_symlink() or not path.is_file()
            or not path.resolve().is_relative_to(base.resolve())):
        raise ValueError('RESIDUAL_TRANSITION_SOURCE_REQUIRED')
    raw = path.read_bytes()
    verified(relative, raw)
    return raw


def function(sql):
    found = list(re.finditer(FUNCTION, sql, re.S))
    if len(found) != 1:
        raise ValueError('RESIDUAL_ROLE_AUTHORITY_MISMATCH')
    return found[0]


def quote(text):
    return "'" + text.replace("'", "''") + "'"


def role_guard(authority):
    body = function(verified(AUTHORITY, authority)).group(1)
    return f"""DO $residual_role_guard$
BEGIN
  IF current_setting('check_function_bodies') <> 'on' OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure('{SIGNATURE}')
      AND p.prosrc={quote(body)} AND p.pronargs=1 AND p.proretset
      AND p.prorettype='record'::regtype AND p.prokind='f'
      AND p.proargnames=ARRAY['p_user_id','role_key','key','code','name']::text[]
      AND p.proallargtypes=ARRAY['uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid]
      AND p.proargmodes=ARRAY['i','t','t','t','t']::"char"[]
      AND p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict
      AND l.lanname='sql' AND p.proconfig=ARRAY['search_path=public']::text[]
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='RESIDUAL_ROLE_PREIMAGE_MISMATCH';
  END IF;
END
$residual_role_guard$;
"""


def reconstruct(relative, raw, authority=None):
    sql = verified(relative, raw)
    if relative not in ORDER or re.search(r'(?im)^\s*(begin|commit|rollback)\s*;', sql):
        raise ValueError('RESIDUAL_TRANSITION_TRANSACTION_MISMATCH')
    if relative == DB1:
        return sql
    if relative == INTAKE:
        if sql.count('ro.role_key') != 1:
            raise ValueError('RESIDUAL_ROLE_COLUMN_MISMATCH')
        return sql.replace('ro.role_key', 'ro.key')
    guard = role_guard(authority)
    original = function(sql)
    if 'returns text[]' not in original.group(0):
        raise ValueError('RESIDUAL_ROLE_RETURN_MISMATCH')
    # The May26 canonical function is already present, hardened and depended on.
    # Retain it exactly. Do not DROP, re-GRANT, or regress to the May25 array API.
    before = guard + f"CREATE TEMP TABLE gridex_residual_role_before ON COMMIT DROP AS SELECT to_jsonb(p) AS definition FROM pg_proc p WHERE oid=to_regprocedure('{SIGNATURE}');\n"
    after = guard + f"""DO $residual_role_unchanged$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_temp.gridex_residual_role_before b
    WHERE b.definition IS DISTINCT FROM (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid=to_regprocedure('{SIGNATURE}'))
  ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='RESIDUAL_ROLE_IDENTITY_OR_ACL_CHANGED'; END IF;
END
$residual_role_unchanged$;
DROP TABLE pg_temp.gridex_residual_role_before;
"""
    return before + sql[:original.start()] + guard + sql[original.end():] + after
