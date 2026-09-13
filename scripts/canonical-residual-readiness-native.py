#!/usr/bin/env python3
"""Native view/lock controls at exact prerequisite boundaries, no remote target."""
import hashlib
import importlib.util
from pathlib import Path

CLONE = 'gridex_auth_legacy_atomic'
OPS = 'migrations/20260602090000_ediel_operations_platform_core.sql'
OPS_SHA = '949bad4ed31e526954e59676c308b5953f128363b21d94821725c0dc3f4681b3'


def prepare(root):
    path = Path(root)/'scripts/canonical-residual-readiness-transitions.py'
    spec = importlib.util.spec_from_file_location('readiness_transitions', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    raw = {p:m.read(root,p) for p in m.PINS}
    db1 = (Path(root)/'supabase/migrations/20260522_db1_schema_repair_backfill_foundation.sql').read_bytes()
    candidate = m.reconstruct(raw[m.READINESS], db1)
    ops = (Path(root)/'supabase'/OPS).read_bytes()
    if hashlib.sha256(ops).hexdigest() != OPS_SHA:
        raise ValueError('READINESS_LOCK_SUCCESSOR_MISMATCH')
    return m, raw, candidate, ops


def clone(target, database):
    drop(target)
    target.docker(['exec',target.name,'createdb','-U','postgres','-T',database,CLONE])


def drop(target):
    target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',CLONE])


def before(target, database, relative, prepared, progress):
    m, raw, _, ops = prepared
    if relative != m.BEFORE_LOCKS:
        return
    if m.LOCKS in progress['residualApplied']:
        raise ValueError('RESIDUAL_LOCK_DOUBLE_EXECUTION')
    sql = m.verified(m.LOCKS, raw[m.LOCKS])
    clone(target,database)
    try:
        target.sql(CLONE,"""INSERT INTO public.companies(id,name,slug) VALUES
          ('20000000-0000-4000-8000-000000000001','Lock A','lock-a'),
          ('20000000-0000-4000-8000-000000000002','Lock B','lock-b');""",'locks_two_company_fixture')
        target.sql(CLONE,sql,'locks_original_first',transaction=False)
        target.sql(CLONE,"""DO $$ BEGIN
          IF (SELECT count(*) FROM public.ediel_send_locks WHERE environment='production' AND locked
            AND company_id IN ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'))<>2
            OR EXISTS(SELECT 1 FROM public.companies c WHERE NOT EXISTS(
              SELECT 1 FROM public.ediel_send_locks l WHERE l.company_id=c.id AND l.environment='production' AND l.locked))
          THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='LOCK_SEED_NOT_FAIL_CLOSED'; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ediel_send_locks'::regclass
            AND contype='f' AND confrelid='auth.users'::regclass)
          THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='LOCK_IDENTITY_FK_MISSING'; END IF;
        END $$;
        CREATE TABLE public.gridex_residual_lock_snapshot AS SELECT id,company_id,environment,locked FROM public.ediel_send_locks;
        """,'locks_seed_identity_snapshot')
        target.sql(CLONE,"INSERT INTO public.ediel_send_locks(company_id,environment) VALUES ('20000000-0000-4000-8000-000000000001','production');",'locks_duplicate_rejected',expect='23505')
        target.sql(CLONE,sql,'locks_original_second',transaction=False)
        target.sql(CLONE,ops.decode(),'locks_keyed_successor',transaction=False)
        target.sql(CLONE,"""DO $$ BEGIN
          IF EXISTS((SELECT id,company_id,environment,locked FROM public.ediel_send_locks EXCEPT SELECT * FROM public.gridex_residual_lock_snapshot)
            UNION ALL (SELECT * FROM public.gridex_residual_lock_snapshot EXCEPT SELECT id,company_id,environment,locked FROM public.ediel_send_locks))
          THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='LOCK_IDENTITY_OR_STATE_CHANGED'; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.ediel_send_locks'::regclass AND attname='lock_key' AND NOT attnotnull)
            OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.ediel_send_locks_active_key_uidx'::regclass AND indisunique)
          THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='LOCK_KEY_TRANSITION_MISMATCH'; END IF;
        END $$;""",'locks_keyed_transition_preserves_identity')
        target.sql(CLONE,"UPDATE public.ediel_send_locks SET locked_by='10000000-0000-4000-8000-000000000099' WHERE company_id='20000000-0000-4000-8000-000000000001';",'locks_unknown_user_rejected',expect='23503')
    finally:
        drop(target)
    target.sql(database,sql,'residual_original_locks',transaction=False)
    progress['residualApplied'].append(m.LOCKS)
    progress['lockIdentityAndSeedControls'] = 'PASS'


def after(target, database, relative, prepared, progress):
    m, raw, candidate, _ = prepared
    if relative != m.AFTER_READINESS:
        return
    if m.READINESS in progress['residualApplied']:
        raise ValueError('RESIDUAL_READINESS_DOUBLE_EXECUTION')
    clone(target,database)
    try:
        before = target.catalog(CLONE)
        target.sql(CLONE,raw[m.READINESS].decode(),'readiness_original_view_shape',expect='42P16')
        if target.catalog(CLONE) != before:
            raise ValueError('READINESS_ORIGINAL_ROLLBACK_FAILED')
        target.sql(CLONE,'ALTER VIEW public.ediel_active_actor_settings_v RENAME COLUMN actor_name TO unexpected_actor_name;','readiness_bad_preimage')
        before = target.catalog(CLONE)
        target.sql(CLONE,candidate,'readiness_unknown_preimage_rejected',expect='55000')
        if target.catalog(CLONE) != before:
            raise ValueError('READINESS_GUARD_ROLLBACK_FAILED')
    finally:
        drop(target)
    target.sql(database,candidate,'residual_readiness_projection_transition')
    clone(target,database)
    try:
        target.sql(CLONE,"""INSERT INTO public.companies(id,name,slug) VALUES
          ('20000000-0000-4000-8000-000000000001','Actor A','actor-a'),
          ('20000000-0000-4000-8000-000000000002','Actor B','actor-b');
        INSERT INTO public.ediel_actor_settings(id,company_id,actor_name,actor_ediel_id,environment,actor_role,is_active,updated_at,created_at,metadata)
          VALUES
          ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Old A','98001','test','supplier',true,'2020-01-01','2020-01-01','{}'),
          ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','New A','98002','test','supplier',true,'2021-01-01','2021-01-01','{"preserved":true}'),
          ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','Actor B','98003','test','supplier',true,'2020-01-01','2020-01-01','{}'),
          ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','Other role','98004','test','grid_owner',true,'2020-01-01','2020-01-01','{}'),
          ('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','Inactive','98005','test','supplier',false,'2022-01-01','2022-01-01','{}');
        DO $$ BEGIN
          IF (SELECT array_agg(id ORDER BY id) FROM public.ediel_active_actor_settings_v WHERE company_id IN ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')) IS DISTINCT FROM
            ARRAY['30000000-0000-4000-8000-000000000002'::uuid,'30000000-0000-4000-8000-000000000003'::uuid,'30000000-0000-4000-8000-000000000004'::uuid]
            OR EXISTS(SELECT 1 FROM public.ediel_active_actor_settings_v WHERE runtime_rank<>1)
            OR NOT EXISTS(SELECT 1 FROM public.ediel_active_actor_settings_v WHERE actor_name='New A' AND metadata='{"preserved":true}'::jsonb)
          THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='READINESS_ACTOR_RANKING_MISMATCH'; END IF;
        END $$;""",'readiness_two_tenant_actor_ranking')
    finally:
        drop(target)
    progress['residualApplied'].append(m.READINESS)
    progress['actorProjectionAndRankingControls'] = 'PASS'
