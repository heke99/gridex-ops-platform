#!/usr/bin/env python3
"""Pinned native H2 boundary and terminal unpublished replay ownership.

Only the parent controller can construct references and a fresh replay target.
Private Python preimages span H2's own COMMIT; no SQL rollback claim spans it.
The historical legacy52/repair56 proof scopes do not use this lifecycle.
"""
from dataclasses import dataclass
import importlib.util
import json
import os
from pathlib import Path
import re
import weakref

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'supabase/migrations/20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql'
SHA256 = '98522e209332c44c804d7acccf831f25fb13b75b048fbe3613c8d69fcb373a9b'
DATABASE = 'gridex_auth_legacy_replay'
INDEX_NAMES = ('user_roles_active_unique_role_text_idx', 'user_roles_active_unique_role_id_idx')


def _load():
    spec = importlib.util.spec_from_file_location('dedupe_trusted_loader', ROOT/'scripts/canonical-auth-provisioning-replay.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.load_batch(), module.load_repair()


legacy, repair = _load()
BoundaryError = legacy.BoundaryError
_REFERENCES = weakref.WeakKeyDictionary()
_STATES = weakref.WeakKeyDictionary()


@dataclass(frozen=True)
class _Reference:
    directory: str
    name: str
    legacy: tuple
    repair: object
    base: dict
    final: dict
    indexes: list


def reviewed_paths():
    return (SOURCE,)


def validate_sources(paths, staging=None):
    if tuple(paths) != reviewed_paths() or SOURCE.is_symlink() or SOURCE.resolve() != SOURCE:
        raise BoundaryError('COMPLETE_SOURCE_REQUIRED')
    data = repair.read_source(SOURCE, staging)
    legacy.verify_bytes(data, SHA256, 96)
    manifest = json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
    if manifest.get(SOURCE.name) != SHA256:
        raise BoundaryError('SOURCE_MANIFEST_MISMATCH')
    return (legacy.Source('H2', SOURCE, SHA256, data),)


def index_declarations(staging=None):
    sql = validate_sources(reviewed_paths(), staging)[0].data.decode()
    pattern = r'create unique index if not exists (user_roles_active_unique_role_\w+_idx)\s+on public\.user_roles\s*\(.*?;'
    if tuple(re.findall(pattern, sql, re.S)) != INDEX_NAMES:
        raise BoundaryError('INDEX_ORACLE_MISMATCH')
    return '\n'.join(match.group() for match in re.finditer(pattern, sql, re.S))


def require_owned(target, reference=True):
    repair.require_owned(target, reference)
    if reference:
        ref = _REFERENCES.get(target)
        if (type(ref) is not _Reference or ref.directory != target.directory.name or
                ref.name != target.name or target.reference is not ref.legacy or
                repair.REFERENCES[target] is not ref.repair):
            raise BoundaryError('OWNED_DEDUPE_REFERENCE_REQUIRED')
    if target in _STATES and _STATES[target] in ('TERMINAL', 'DISPOSED'):
        raise BoundaryError('REPLAY_TERMINAL')


def index_details(target, database):
    require_owned(target, False)
    return json.loads(target.sql(database, '''
SELECT coalesce(jsonb_agg(jsonb_build_object('name', c.relname,'method',a.amname,
 'unique',i.indisunique,'valid',i.indisvalid,'ready',i.indisready,
 'nulls_not_distinct',i.indnullsnotdistinct,'predicate',pg_get_expr(i.indpred,i.indrelid),
 'opclasses',(SELECT jsonb_agg(o.opcname ORDER BY x.ordinal)
 FROM unnest(i.indclass) WITH ORDINALITY x(id,ordinal) JOIN pg_opclass o ON o.oid=x.id))
 ORDER BY c.relname),'[]') FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 JOIN pg_am a ON a.oid=c.relam WHERE c.relnamespace='public'::regnamespace
 AND c.relname IN ('user_roles_active_unique_role_text_idx','user_roles_active_unique_role_id_idx');
''', 'dedupe_indexes'))


def snapshot(target, database=DATABASE):
    """Complete public/Auth/storage rows and explicit sequence state, privately."""
    require_owned(target, False)
    sql = '''CREATE TEMP TABLE dedupe_preimage(name text,row_value jsonb) ON COMMIT DROP;
DO $$ DECLARE r record; BEGIN
FOR r IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','S') LOOP
IF r.relkind='S' THEN
 EXECUTE format('INSERT INTO dedupe_preimage SELECT %L,jsonb_build_object(''last_value'',last_value,''log_cnt'',log_cnt,''is_called'',is_called) FROM %I.%I',r.nspname||'.'||r.relname,r.nspname,r.relname);
ELSE
 EXECUTE format('INSERT INTO dedupe_preimage SELECT %L,to_jsonb(x) FROM %I.%I x',r.nspname||'.'||r.relname,r.nspname,r.relname);
END IF; END LOOP; END $$;
SELECT coalesce(jsonb_agg(jsonb_build_array(name,row_value) ORDER BY name,row_value),'[]') FROM dedupe_preimage;'''
    return repair.catalog(target, database), json.loads(target.sql(database, sql, 'dedupe_preimage'))


def prepare_reference(target):
    require_owned(target, False)
    if target in _STATES or target in _REFERENCES:
        raise BoundaryError('FRESH_OWNED_TARGET_REQUIRED')
    validate_sources(reviewed_paths())
    repair.prepare_reference(target)
    legacy_ref = target.reference; repair_ref = repair.REFERENCES[target]
    database = 'gridex_auth_legacy_helper'
    target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',database])
    target.docker(['exec',target.name,'createdb','-U','postgres','-T','gridex_auth_legacy_reference',database])
    before = snapshot(target, database)
    if before[0] != repair_ref.final or any('index/public.'+name in before[0] for name in INDEX_NAMES):
        raise BoundaryError('DEDUPE_BASE_ORACLE_MISMATCH')
    target.sql(database, index_declarations(), 'dedupe_index_oracle')
    final, rows = snapshot(target, database)
    if (rows != before[1] or set(final)-set(before[0]) != {'index/public.'+name for name in INDEX_NAMES} or
            {k:v for k,v in final.items() if k in before[0]} != before[0]):
        raise BoundaryError('DEDUPE_DELTA_ORACLE_MISMATCH')
    indexes = index_details(target, database)
    if len(indexes) != 2:
        raise BoundaryError('DEDUPE_INDEX_ORACLE_MISMATCH')
    for item in indexes:
        if (item['method'] != 'btree' or not all(item[k] for k in ('unique','valid','ready')) or
                item['nulls_not_distinct'] is not False or not item['predicate'] or
                item['opclasses'] != ['uuid_ops','uuid_ops','text_ops' if 'text' in item['name'] else 'uuid_ops']):
            raise BoundaryError('DEDUPE_INDEX_ORACLE_MISMATCH')
    _REFERENCES[target] = _Reference(target.directory.name,target.name,legacy_ref,repair_ref,before[0],final,indexes)


def fresh_target(target):
    require_owned(target)
    if target in _STATES:
        raise BoundaryError('FRESH_OWNED_TARGET_REQUIRED')
    # Fixed trusted constructor, never a caller-provided reset callback or DB URL.
    _STATES[target] = 'STARTING'
    try:
        legacy.OwnedPostgres.reset(target, DATABASE)
        _STATES[target] = 'FRESH'
    except BaseException:
        fail(target)
        raise


def require_live(target):
    require_owned(target)
    if target not in _STATES or _STATES[target] == 'SUCCEEDED':
        raise BoundaryError('UNPUBLISHED_REPLAY_REQUIRED')


def _dispose(target):
    """Exact database disposal, falling back only to its exact labelled owner."""
    ref = _REFERENCES[target]
    if type(target) is not legacy.OwnedPostgres or target.name != ref.name or target._created_name != ref.name:
        raise BoundaryError('OWNED_DISPOSAL_IDENTITY_MISMATCH')
    label = legacy.OwnedPostgres.docker(target, ['inspect','--format','{{ index .Config.Labels "gridex.auth-legacy.owner" }}',ref.name]).decode().strip()
    if label != ref.name:
        raise BoundaryError('OWNED_DISPOSAL_IDENTITY_MISMATCH')
    try:
        legacy.OwnedPostgres.docker(target, ['exec',ref.name,'dropdb','-U','postgres','--if-exists','--force',DATABASE])
        raw = legacy.OwnedPostgres.docker(target, ['exec',ref.name,'psql','-X','-U','postgres','-d','postgres','-At','-c',
            "SELECT count(*) FROM pg_database WHERE datname='gridex_auth_legacy_replay';"])
        if raw.strip() != b'0':
            raise BoundaryError('OWNED_DATABASE_DISPOSAL_UNVERIFIED')
    except BaseException:
        # close performs the existing exact name AND owner label check.
        legacy.OwnedPostgres.close(target)
        if target.active:
            raise BoundaryError('OWNED_DISPOSAL_FAILED')


def fail(target):
    # Denial is installed before disposal, persists even if disposal itself fails,
    # and cannot be cleared by constructing another loop or resetting the DB.
    if target not in _REFERENCES:
        raise BoundaryError('OWNED_DEDUPE_REFERENCE_REQUIRED')
    if _STATES.get(target) == 'DISPOSED':
        return
    _STATES[target] = 'TERMINAL'
    try:
        _dispose(target)
    except BaseException:
        raise BoundaryError('REPLAY_TERMINAL_DISPOSAL_FAILED') from None
    _STATES[target] = 'DISPOSED'


def accepted56(target):
    require_live(target)
    if _STATES[target] != 'FRESH' or repair.catalog(target,DATABASE) != _REFERENCES[target].base:
        raise BoundaryError('ACTUAL56_REQUIRED')
    _STATES[target] = 'ACCEPTED56'


def assert_final(target):
    require_live(target)
    ref = _REFERENCES[target]
    if repair.catalog(target,DATABASE) != ref.final or index_details(target,DATABASE) != ref.indexes:
        raise BoundaryError('DEDUPE_FINAL_MISMATCH')


def execute(target, database, paths, staging=None):
    require_live(target)
    try:
        if database != DATABASE or _STATES[target] != 'ACCEPTED56':
            raise BoundaryError('ACTUAL56_REQUIRED')
        sources = validate_sources(paths, staging)
        target.verify_logging()
        ref = _REFERENCES[target]
        before = snapshot(target)
        if before[0] not in (ref.base, ref.final):
            raise BoundaryError('CLEAN_CATALOG_REQUIRED')
        if target.sql(DATABASE,'SELECT count(*) FROM public.user_roles;','dedupe_admission').strip() != '0':
            raise BoundaryError('EMPTY_USER_ROLES_REQUIRED')
        _STATES[target] = 'NATIVE'
        # This synchronous call retains complete private preimages across COMMIT.
        target.run_files(DATABASE,[target.private('dedupe-whole-H2.sql',sources[0].data)],'dedupe_native',transaction=False)
        assert_final(target)
        if snapshot(target) != (ref.final,before[1]):
            raise BoundaryError('DEDUPE_PRESERVATION_FAILED')
        _STATES[target] = 'H2_COMPLETE'
        return {'sources':1}
    except BaseException:
        fail(target)
        raise


def finish(target, full=False):
    require_live(target)
    if _STATES[target] != 'H2_COMPLETE':
        raise BoundaryError('DEDUPE_COMPLETION_REQUIRED')
    if not full:
        assert_final(target)
    _STATES[target] = 'SUCCEEDED'
