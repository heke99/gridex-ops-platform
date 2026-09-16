#!/usr/bin/env python3
"""Exact source-derived private dependency needed by the public-only reference.

This creates no placeholder and alters no public object. The public dump's
actor_readiness_status view calls this actual aggregate-only internal function.
Its declaration and grants are extracted unchanged from the immutable migration.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATABASE = 'gridex_auth_legacy_native'
SOURCE = '20260809131500_gridex_ops_o008_actor_readiness_conflict_count_visibility.sql'
SOURCE_SHA = '90b4b79784598d1772e82baac23419354618f20342c0bbfdad8d087f3e28d366'
BLOCK_SHA = 'cd2ade2616d40954c4e6595af7ae0e1fdbb8ab2923c6c60ab8b494dcc042beca'


def source_block():
    path = ROOT/'supabase/migrations'/SOURCE
    if path.is_symlink() or not path.is_file() or path.resolve() != path:
        raise ValueError('REFERENCE_DEPENDENCY_SOURCE_REQUIRED')
    raw = path.read_bytes()
    manifest = json.loads((ROOT/'scripts/migration-history-manifest.additions.json').read_text())['files']
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA or manifest.get(SOURCE) != SOURCE_SHA:
        raise ValueError('REFERENCE_DEPENDENCY_SOURCE_HASH_MISMATCH')
    text = raw.decode()
    first = 'create schema if not exists gridex_internal;'
    last = 'do $migration$'
    if text.count(first) != 1 or text.count(last) != 1:
        raise ValueError('REFERENCE_DEPENDENCY_BOUNDARY_CHANGED')
    block = text[text.index(first):text.index(last)]
    if hashlib.sha256(block.encode()).hexdigest() != BLOCK_SHA:
        raise ValueError('REFERENCE_DEPENDENCY_BLOCK_CHANGED')
    return block


def prepare(target):
    # The empty public schema is deliberately restored afterwards. Disabling
    # SQL-body validation here is the same restore-order technique pg_dump uses;
    # the actual body, types and grants are retained and exercised after restore.
    target.sql(DATABASE, 'SET LOCAL check_function_bodies = off;\n'+source_block(),
               'reference_private_dependency', transaction=True)


def verify(target):
    sql = """DO $verify$ BEGIN
IF (SELECT count(*) FROM gridex_internal.actor_open_blocking_conflict_counts()) <> 0
   OR has_schema_privilege('anon','gridex_internal','USAGE')
   OR has_function_privilege('anon','gridex_internal.actor_open_blocking_conflict_counts()','EXECUTE')
   OR NOT has_schema_privilege('authenticated','gridex_internal','USAGE')
   OR NOT has_function_privilege('authenticated','gridex_internal.actor_open_blocking_conflict_counts()','EXECUTE')
   OR NOT has_function_privilege('service_role','gridex_internal.actor_open_blocking_conflict_counts()','EXECUTE')
   OR NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='gridex_internal' AND p.proname='actor_open_blocking_conflict_counts'
                   AND p.prosecdef AND p.provolatile='s') THEN
  RAISE EXCEPTION 'REFERENCE_PRIVATE_DEPENDENCY_CONTRACT_FAILED';
END IF;
END $verify$;"""
    target.sql(DATABASE, sql, 'reference_private_dependency_verified', transaction=True)
    return {'source': SOURCE, 'sourceSha256': SOURCE_SHA, 'blockSha256': BLOCK_SHA,
            'placeholderUsed': False, 'bodyAndPrivilegesVerified': True}
