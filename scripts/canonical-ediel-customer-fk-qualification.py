#!/usr/bin/env python3
"""Execute the exact forward FK candidate on an owned PG17 and immutable sources.

This is migration qualification, not acceptance of the full schema/ledger/types.
No URL, credentials, production table or external target can be provided.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
FORWARD_NAME = '20260913211625_ediel_intent_customer_company_integrity.sql'
CANDIDATE = ROOT/'supabase/migrations'/FORWARD_NAME
CANDIDATE_SHA = 'da2d3d288d69038b4c9767fe22b2a1ae4293d3196d88b5d129089337594392b9'
CLASSIFICATION = '20260902094000_platform_table_classification_and_invariant_gate.sql'
ORIGINAL = '20260902095000_lock_customer_chain_with_composite_keys.sql'
DATABASE = 'gridex_auth_legacy_atomic'
KEY = 'constraint/public.ediel_message_intents/ediel_message_intents_customer_company_fk'
EXPECTED = {'kind':'f', 'definition':'FOREIGN KEY (customer_id, company_id) REFERENCES customers(id, company_id) ON UPDATE CASCADE ON DELETE SET NULL (customer_id)', 'validated':True, 'deferrable':False, 'deferred':False, 'noinherit':True}


def read_candidate():
    if CANDIDATE.is_symlink() or not CANDIDATE.is_file() or CANDIDATE.resolve() != CANDIDATE:
        raise ValueError('FK_CANDIDATE_REQUIRED')
    raw=CANDIDATE.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=CANDIDATE_SHA:
        raise ValueError('FK_CANDIDATE_HASH_MISMATCH')
    return raw.decode()


def load_legacy():
    path=ROOT/'scripts/canonical-auth-provisioning-replay.py'
    spec=importlib.util.spec_from_file_location('fk_qualification_loader',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.load_batch()


def original(name):
    path=ROOT/'supabase/migrations'/name
    digest=json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files'][name]
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
        raise ValueError('IMMUTABLE_FK_SOURCE_CHANGED')
    return path.read_text()


def equal_catalog(before, after):
    expected={**before,KEY:EXPECTED}
    if after!=expected:
        # Compare all public/auth/storage catalog entries, not only the FK.
        changed=[k for k in sorted(set(expected)|set(after)) if expected.get(k)!=after.get(k)]
        print(json.dumps({'scope':'FK_DIFFERENTIAL','changedKeys':changed[:30],'accepted':False}),flush=True)
        raise ValueError('FK_UNRELATED_CATALOG_CHANGE')


SETUP = """
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE public.companies(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.companies(id),
                             CONSTRAINT customers_id_company_uk UNIQUE(id,company_id));
CREATE TABLE public.ediel_message_intents(id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.companies(id), customer_id uuid, payload jsonb NOT NULL DEFAULT '{}');
ALTER TABLE public.ediel_message_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY intents_service ON public.ediel_message_intents TO service_role USING(true) WITH CHECK(true);
GRANT ALL ON public.ediel_message_intents TO service_role;
INSERT INTO public.companies VALUES('10000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000001');
INSERT INTO public.customers VALUES('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
"""
SAME = "INSERT INTO public.ediel_message_intents VALUES('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','{\"evidence\":\"preserve\"}');"
CROSS = "INSERT INTO public.ediel_message_intents VALUES('20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','{}');"
DELETE = "DELETE FROM public.customers WHERE id='10000000-0000-0000-0000-000000000002';"
DETACHED = """DO $$ BEGIN IF NOT EXISTS(SELECT FROM public.ediel_message_intents WHERE id='10000000-0000-0000-0000-000000000003' AND company_id='10000000-0000-0000-0000-000000000001' AND customer_id IS NULL AND payload='{"evidence":"preserve"}'::jsonb) THEN RAISE EXCEPTION 'FK_DETACH_PRESERVATION_FAILED'; END IF; END $$;"""


def fixtures():
    sql=read_candidate(); classify=original(CLASSIFICATION); historical=original(ORIGINAL)
    legacy=load_legacy(); outcomes=[]
    with legacy.OwnedPostgres() as target:
        for client_grants in (False, True):
            target.reset(DATABASE);target.sql(DATABASE,SETUP,'fk_fixture')
            if client_grants:
                target.sql(DATABASE,'GRANT SELECT ON public.ediel_message_intents TO authenticated;','historical_reachability_fixture')
            target.sql(DATABASE,classify,'actual_classification_source',transaction=False)
            kind=target.sql(DATABASE,"SELECT kind FROM public.platform_table_classification WHERE table_name='ediel_message_intents';",'classification_state').strip()
            if kind!=('tenant' if client_grants else 'system'):raise ValueError('FK_CLASSIFICATION_CAUSE_NOT_REPRODUCED')
            target.sql(DATABASE,historical,'actual_customer_key_source',transaction=False)
            before=target.catalog(DATABASE)
            if (KEY in before)!=client_grants:raise ValueError('FK_GRANT_DEPENDENCE_NOT_REPRODUCED')
            target.sql(DATABASE,SAME,'fk_same_tenant_fixture')
            if client_grants:
                target.sql(DATABASE,DELETE,'fk_historical_delete_red',expect='23502')
            target.sql(DATABASE,sql,'fk_candidate',transaction=False)
            equal_catalog(before,target.catalog(DATABASE))
            target.sql(DATABASE,CROSS,'fk_cross_tenant_rejected',expect='23503')
            target.sql(DATABASE,DELETE+DETACHED,'fk_detach_preserves_tenant')
            repaired=target.catalog(DATABASE)
            target.sql(DATABASE,sql,'fk_idempotent',transaction=False)
            if target.catalog(DATABASE)!=repaired:raise ValueError('FK_IDEMPOTENCY_FAILED')
            outcomes.append('historical_grants' if client_grants else 'no_client_grants')
        # Named but semantically unrelated constraints never get replaced.
        for wrong in ('CHECK (customer_id IS NULL)',
                      'FOREIGN KEY(customer_id,company_id) REFERENCES customers(id,company_id) ON DELETE CASCADE'):
            target.reset(DATABASE);target.sql(DATABASE,SETUP,'fk_wrong_setup')
            target.sql(DATABASE,'ALTER TABLE public.ediel_message_intents ADD CONSTRAINT ediel_message_intents_customer_company_fk '+wrong+';','fk_wrong_predecessor')
            before=target.catalog(DATABASE)
            target.sql(DATABASE,sql,'fk_wrong_rejected',expect='55000',transaction=False)
            if target.catalog(DATABASE)!=before:raise ValueError('FK_REJECTION_NOT_ATOMIC')
        target.reset(DATABASE);target.sql(DATABASE,SETUP+CROSS,'fk_dirty_setup')
        before=target.catalog(DATABASE)
        target.sql(DATABASE,sql,'fk_dirty_rejected',expect='23503',transaction=False)
        if target.catalog(DATABASE)!=before:raise ValueError('FK_DIRTY_ROLLBACK_FAILED')
        if target.sql(DATABASE,'SELECT count(*) FROM public.ediel_message_intents;','fk_dirty_rows_preserved').strip()!='1':raise ValueError('FK_DIRTY_ROWS_LOST')
    print(json.dumps({'scope':'EDIEL_CUSTOMER_FK_QUALIFICATION','candidateSha256':CANDIDATE_SHA,'cases':outcomes,
        'exactHistoricalSourcesExecuted':True,'crossTenantRejected':True,'oldDeleteNotNullFailureReproduced':True,
        'deletePreservesIntentTenantAndPayload':True,'idempotent':True,'unknownPredecessorRejected':True,
        'dirtyDataRejectedWithoutDeletion':True,'unrelatedCatalogIncludingGrantsAndRlsUnchanged':True,
        'cleanupVerified':not target.active,'fullReplayAccepted':False,'productionModified':False}),flush=True)


if __name__=='__main__':
    if len(sys.argv)!=1:raise SystemExit('No target or override arguments accepted')
    try:fixtures()
    except Exception:
        print('FAIL FK qualification; original output retained privately',file=sys.stderr)
        raise SystemExit(1) from None
