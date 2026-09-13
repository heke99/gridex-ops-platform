#!/usr/bin/env python3
"""Test DB2 generic schema without executing legacy business reconciliation."""
import importlib.util
from pathlib import Path

CLONE='gridex_auth_legacy_atomic'


def prepare(root, *, read_source=None):
    spec=importlib.util.spec_from_file_location('db2_reconstruction',Path(root)/'scripts/canonical-db2-reconstruction.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    raw={p:(m.read(root,p) if read_source is None else m.verified(p,read_source(p))) for p in m.PINS}
    return m,raw,{p:m.reconstruct(p,b) for p,b in raw.items()}


def drop(target):
    target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',CLONE])


def clone(target,database):
    drop(target)
    target.docker(['exec',target.name,'createdb','-U','postgres','-T',database,CLONE])


def apply(target,database,prepared,progress):
    m,raw,sql=prepared
    clone(target,database)
    try:
        target.sql(CLONE,"""INSERT INTO public.companies(id,name,slug) VALUES
          ('20000000-0000-4000-8000-000000000011','DB2 A','db2-a'),
          ('20000000-0000-4000-8000-000000000012','DB2 B','db2-b');
        INSERT INTO auth.users(id,email) VALUES
          ('10000000-0000-4000-8000-000000000011','db2-a@example.invalid'),
          ('10000000-0000-4000-8000-000000000012','db2-b@example.invalid');
        INSERT INTO public.company_memberships(company_id,user_id,status) VALUES
          ('20000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011','revoked'),
          ('20000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000012','active');
        CREATE TABLE public.gridex_db2_member_snapshot AS
          SELECT id,company_id,user_id,status,role,membership_role,role_key,updated_at FROM public.company_memberships;
        CREATE TABLE public.gridex_db2_count_snapshot AS SELECT
          (SELECT count(*) FROM public.companies) AS companies,
          (SELECT count(*) FROM auth.users) AS users,
          (SELECT count(*) FROM public.gridex_schema_repair_runs) AS runs,
          (SELECT count(*) FROM public.backfill_runs) AS backfills;
        """,'db2_security_preservation_fixture')
        target.sql(CLONE,sql[m.PREFLIGHT],'db2_schema_partition_fixture')
        target.sql(CLONE,sql[m.FINISH],'db2_generic_closeout_fixture')
        target.sql(CLONE,"""DO $$ BEGIN
          IF EXISTS((SELECT id,company_id,user_id,status,role,membership_role,role_key,updated_at FROM public.company_memberships
              EXCEPT SELECT * FROM public.gridex_db2_member_snapshot)
            UNION ALL (SELECT * FROM public.gridex_db2_member_snapshot EXCEPT
              SELECT id,company_id,user_id,status,role,membership_role,role_key,updated_at FROM public.company_memberships))
            OR EXISTS(SELECT 1 FROM public.gridex_db2_count_snapshot s
              WHERE s.companies<>(SELECT count(*) FROM public.companies) OR s.users<>(SELECT count(*) FROM auth.users)
                 OR s.runs<>(SELECT count(*) FROM public.gridex_schema_repair_runs) OR s.backfills<>(SELECT count(*) FROM public.backfill_runs))
          THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DB2_HISTORICAL_DATA_EFFECT_EXECUTED'; END IF;
          IF (SELECT count(*) FROM public.gridex_db2_v4_schema_contract_v WHERE exists_in_db)<>24
            OR to_regclass('public.customer_profiles') IS NOT NULL
            OR to_regprocedure('public.gridex_db2_v4_run_customer_profile_backfill(boolean)') IS NOT NULL
            OR to_regclass('public.gridex_db2_v4_final_readiness_v') IS NOT NULL
          THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DB2_SCHEMA_OR_OPERATOR_BOUNDARY_MISMATCH'; END IF;
          IF (SELECT count(*) FROM pg_index WHERE indexrelid IN
            ('public.company_memberships_company_user_uidx'::regclass,'public.company_memberships_company_status_idx'::regclass,
             'public.company_invitations_company_status_idx'::regclass,'public.company_invitations_email_status_idx'::regclass) AND indisvalid)<>4
          THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DB2_GENERIC_INDEX_MISSING'; END IF;
        END $$;""",'db2_no_reactivation_or_historical_seeding')
        target.sql(CLONE,'ALTER TABLE public.companies RENAME COLUMN technical_contact_email TO db2_probe_missing_contact;','db2_bad_schema_fixture')
        before=target.catalog(CLONE)
        target.sql(CLONE,sql[m.FINISH],'db2_missing_generic_column_rejected',expect='23514')
        if target.catalog(CLONE)!=before:
            raise ValueError('DB2_CLOSEOUT_ROLLBACK_FAILED')
    finally:
        drop(target)
    clone(target,database)
    try:
        # Deliberately incompatible preimage in a disposable negative-control
        # clone only. The canonical target never receives a legacy/fake table.
        target.sql(CLONE,'CREATE TABLE public.customer_profiles(id uuid primary key);','db2_incompatible_legacy_fixture')
        before=target.catalog(CLONE)
        target.sql(CLONE,sql[m.PREFLIGHT],'db2_legacy_operator_scope_rejected',expect='55000')
        if target.catalog(CLONE)!=before:
            raise ValueError('DB2_SCOPE_ROLLBACK_FAILED')
    finally:
        drop(target)
    for path in (m.PREFLIGHT,m.FINISH):
        target.sql(database,sql[path],'residual_db2_'+('preflight' if path==m.PREFLIGHT else 'closeout'))
        progress['residualApplied'].append(path)
    spec=importlib.util.spec_from_file_location('db2_index_effects',Path(__file__).with_name('canonical-residual-index-effects.py'))
    effects=importlib.util.module_from_spec(spec);spec.loader.exec_module(effects)
    effects.verify(target,database,m.PREFLIGHT,raw[m.PREFLIGHT])
    progress['db2SchemaAndHistoricalSeparationControls']='PASS'
    progress['db2HistoricalOperatorProgramExecuted']=False
