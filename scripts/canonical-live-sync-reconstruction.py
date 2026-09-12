#!/usr/bin/env python3
"""Source-bound reconstruction of the one invalid live-sync session block.

Historical files and their manifests stay immutable. Only the invalid 33-line
block is replaced, using the complete function already in the forward repair.
This is an explicit reconstruction, not execution of unchanged historical SQL.
No external target, validation waiver, ledger or full-effects acceptance exists.
"""
from __future__ import annotations
import hashlib
import re
from pathlib import Path

SOURCE = 'migrations/20260728170000_live_schema_code_canonical_sync.sql'
SOURCE_SHA256 = '4b1af824f75423faa393d60b845d3b39a3998bcfc7d7ea1cec2a54aa8d3bd400'
ORIGINAL = 'migrations/20260519_batch_6d2_runtime_governance_completion.sql'
ORIGINAL_SHA256 = 'b7d9d48b9cd3093b5546b04225f9c6151b0f674d2ae73441d8086f51922de9ab'
FORWARD = 'migrations/20260730130000_historical_sync_forward_repair.sql'
FORWARD_SHA256 = '3e204b00fa33badbfdc7a11c0304df3bc5385b16e0854e40af2df1c06b32b50b'
SIGNATURE = 'public.gridex_is_current_session_allowed()'
START = "do $repair$\nbegin\n  if to_regprocedure('" + SIGNATURE + "') is not null then\n"
END = '\nend\n$repair$;'
FUNCTION = r'create or replace function public\.gridex_is_current_session_allowed\(\).*?\bas \$\$(.*?)\$\$;'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def quoted(value):
    return "'" + value.replace("'", "''") + "'"


def read_pinned(root, relative, expected):
    base = Path(root) / 'supabase'
    path = base / relative
    if (base.is_symlink() or path.parent.is_symlink() or path.is_symlink()
            or not path.is_file() or not path.resolve().is_relative_to(base.resolve())):
        raise ValueError('LIVE_SYNC_SOURCE_REQUIRED')
    data = path.read_bytes()
    if digest(data) != expected:
        raise ValueError('LIVE_SYNC_SOURCE_HASH_MISMATCH')
    return data.decode('utf-8')


def function_parts(sql):
    found = list(re.finditer(FUNCTION, sql, re.S))
    if len(found) != 1:
        raise ValueError('LIVE_SYNC_FUNCTION_AUTHORITY_MISMATCH')
    return found[0].group(0), found[0].group(1)


def split_source(sql):
    if digest(sql.encode()) != SOURCE_SHA256 or sql.count(START) != 1:
        raise ValueError('LIVE_SYNC_SOURCE_HASH_MISMATCH')
    prefix, rest = sql.split(START, 1)
    middle, suffix = rest.split(END, 1)
    block = START + middle + END
    if block.count('perform public.gridex__repair_replace_function_text(') != 4:
        raise ValueError('LIVE_SYNC_BLOCK_MISMATCH')
    return prefix, block, suffix


def reconstruct(root, source):
    """Retain every byte outside the defective block and original BEGIN/COMMIT."""
    original_sql = read_pinned(root, ORIGINAL, ORIGINAL_SHA256)
    forward_sql = read_pinned(root, FORWARD, FORWARD_SHA256)
    _, original_body = function_parts(original_sql)
    forward_definition, forward_body = function_parts(forward_sql)
    prefix, block, suffix = split_source(source)
    # Admission and assertions live INSIDE the original transaction. Replacing
    # the function preserves its OID, owner and ACL; verify, do not assume that.
    before = f"""-- Explicit source-bound session reconstruction; all other source bytes retained.
DO $session_admission$
BEGIN
  IF current_setting('check_function_bodies') <> 'on' OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure('{SIGNATURE}')
      AND p.prosrc={quoted(original_body)} AND p.pronargs=0
      AND p.prorettype='boolean'::regtype AND p.prokind='f'
      AND p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict
      AND l.lanname='plpgsql'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='LIVE_SYNC_GUARD_PREIMAGE_MISMATCH';
  END IF;
END
$session_admission$;
CREATE TEMP TABLE gridex_live_sync_guard_before ON COMMIT DROP AS
  SELECT oid,proowner,proacl FROM pg_proc WHERE oid=to_regprocedure('{SIGNATURE}');
"""
    after = f"""
DO $session_assertion$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_temp.gridex_live_sync_guard_before b ON p.oid=b.oid
    WHERE p.proowner=b.proowner AND p.proacl IS NOT DISTINCT FROM b.proacl
      AND p.prosrc={quoted(forward_body)} AND p.pronargs=0
      AND p.prorettype='boolean'::regtype AND p.prokind='f'
      AND p.prosecdef AND p.provolatile='s' AND NOT p.proisstrict
      AND p.proconfig=ARRAY['search_path=public, auth, pg_catalog, pg_temp']::text[]
  ) OR current_setting('check_function_bodies') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='LIVE_SYNC_GUARD_POSTIMAGE_MISMATCH';
  END IF;
END
$session_assertion$;
DROP TABLE pg_temp.gridex_live_sync_guard_before;"""
    rendered = prefix + before + forward_definition + after + suffix
    evidence = {
        'source': SOURCE, 'sourceSha256': SOURCE_SHA256,
        'replacementAuthority': FORWARD, 'replacementAuthoritySha256': FORWARD_SHA256,
        'reconstructedSha256': digest(rendered.encode()),
        'preservedPrefixSha256': digest(prefix.encode()),
        'preservedSuffixSha256': digest(suffix.encode()),
        'replacedBlockSha256': digest(block.encode()),
        'historicalBytesModified': False,
        'completeSourceEffectsAccepted': False,
    }
    return rendered, evidence
