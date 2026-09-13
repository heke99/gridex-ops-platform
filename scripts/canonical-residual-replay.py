#!/usr/bin/env python3
"""Seven source-pinned residuals in the shared, source-retaining foundation loop.

The constructors and native negative controls are the same as the prior candidate
lane. This module adds no remote target, acceptance flag or ledger assertion.
All SQL/authority bytes are admitted from the caller's private stage before use;
missing originals never trigger a fallback to the repository migration directory.
"""
from __future__ import annotations
import hashlib
import importlib.util
from pathlib import Path
from types import MappingProxyType

ROOT = Path(__file__).resolve().parents[1]
DATABASE = 'gridex_auth_legacy_replay'
CLONE = 'gridex_auth_legacy_atomic'
FOUNDATION_SHA256 = '11af5df0de43b4e135a2c8172a1ffc937079241826a60e5fefda9cb588363595'


def load(filename):
    path = ROOT/'scripts'/filename
    spec = importlib.util.spec_from_file_location('residual_' + path.stem.replace('-','_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def reviewed_paths():
    return tuple(ROOT/'supabase'/p for p in source_pins())


def source_pins():
    transitions = load('canonical-residual-transitions.py')
    readiness = load('canonical-residual-readiness-transitions.py')
    db2 = load('canonical-db2-reconstruction.py')
    extra = load('canonical-residual-readiness-native.py')
    return {**transitions.PINS, **readiness.PINS, **db2.PINS, extra.OPS: extra.OPS_SHA}


def prepare(root, read_source):
    """Read each of the nine exact sources once using the approved staged reader."""
    if Path(root).resolve() != ROOT or not callable(read_source):
        raise ValueError('RESIDUAL_SOURCE_READER_REQUIRED')
    pins = source_pins()
    raw = {}
    for relative, digest in pins.items():
        value = read_source(relative)
        if type(value) is not bytes or hashlib.sha256(value).hexdigest() != digest:
            raise ValueError('RESIDUAL_RETAINED_SOURCE_MISMATCH')
        raw[relative] = value
    # Values are immutable bytes. Do not retain the reader or allow later I/O.
    return MappingProxyType(raw)


def clone(target, database):
    drop_clone(target)
    target.docker(['exec',target.name,'createdb','-U','postgres','-T',database,CLONE])


def drop_clone(target):
    target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',CLONE])


def apply_prefix(target, retained, progress):
    transitions = load('canonical-residual-transitions.py')
    original_bytes = {p: retained[p] for p in transitions.ORDER}
    authority = retained[transitions.AUTHORITY]
    candidates = {p: transitions.reconstruct(p,b,authority) for p,b in original_bytes.items()}
    for relative in transitions.ORDER:
        if relative in (transitions.INTAKE, transitions.ALIGNMENT):
            clone(target, DATABASE)
            try:
                before = target.catalog(CLONE)
                expected = '42703' if relative == transitions.INTAKE else '42P13'
                target.sql(CLONE, original_bytes[relative].decode(), 'residual_original_rejection', expect=expected)
                if target.catalog(CLONE) != before:
                    raise ValueError('RESIDUAL_ORIGINAL_ROLLBACK_FAILED')
                if relative == transitions.ALIGNMENT:
                    target.sql(CLONE, 'ALTER FUNCTION public.gridex_get_user_roles(uuid) VOLATILE;', 'residual_corrupt_preimage')
                    before = target.catalog(CLONE)
                    target.sql(CLONE, candidates[relative], 'residual_unknown_preimage', expect='55000')
                    if target.catalog(CLONE) != before:
                        raise ValueError('RESIDUAL_GUARD_ROLLBACK_FAILED')
            finally:
                drop_clone(target)
        target.sql(DATABASE, candidates[relative], 'residual_apply_' + str(len(progress['residualApplied'])+1))
        progress['residualApplied'].append(relative)
        if relative == transitions.INTAKE:
            target.sql(DATABASE, """DO $$ DECLARE t text; BEGIN
                          FOREACH t IN ARRAY ARRAY['customers','customer_contacts','customer_addresses','customer_sites','metering_points','customer_contracts','customer_contract_events','powers_of_attorney','customer_info_requests','customer_cases','customer_import_batches','customer_import_rows'] LOOP
                            IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_policy p ON p.polrelid=c.oid
                              WHERE c.oid=to_regclass('public.'||t) AND c.relrowsecurity
                              AND p.polname='tenant_members_read_'||t AND p.polcmd='r'
                              AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
                              AND pg_get_expr(p.polqual,p.polrelid) LIKE '%ro.key%'
                              AND pg_get_expr(p.polqual,p.polrelid) NOT LIKE '%ro.role_key%')
                            THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='RESIDUAL_INTAKE_POLICY_MISSING'; END IF;
                          END LOOP; END $$;""", 'residual_intake_policy_bindings')
    clone(target, DATABASE)
    try:
        target.sql(CLONE, """INSERT INTO public.companies(id,name,slug) VALUES
                      ('20000000-0000-4000-8000-000000000001','Residual A','residual-a'),
                      ('20000000-0000-4000-8000-000000000002','Residual B','residual-b');
                    INSERT INTO auth.users(id,email)
                      SELECT ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
                        'residual-'||i||'@example.invalid' FROM generate_series(1,7) i;
                    INSERT INTO public.company_memberships(company_id,user_id,status) VALUES
                      ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','active'),
                      ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','active'),
                      ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','revoked');
                    INSERT INTO public.roles(key,name)
                      SELECT k,k FROM unnest(ARRAY['super_admin','superadmin','platform_admin']) k
                      WHERE NOT EXISTS(SELECT 1 FROM public.roles r WHERE r.key=k);
                    INSERT INTO public.user_roles(user_id,role_id)
                      SELECT ('10000000-0000-4000-8000-'||lpad((i+4)::text,12,'0'))::uuid,r.id
                      FROM unnest(ARRAY['super_admin','superadmin','platform_admin']) WITH ORDINALITY k(key,i)
                      JOIN public.roles r ON r.key=k.key;
                    INSERT INTO public.customer_import_batches(company_id)
                      VALUES ('20000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
                    DO $policy_truth$ DECLARE i int; found_ids uuid[]; expected_ids uuid[]; expression text;
                    BEGIN
                      SELECT pg_get_expr(polqual,polrelid) INTO STRICT expression FROM pg_policy
                        WHERE polrelid='public.customer_import_batches'::regclass
                        AND polname='tenant_members_read_customer_import_batches';
                      FOR i IN 1..7 LOOP
                        PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-'||lpad(i::text,12,'0'),true);
                        EXECUTE 'SELECT coalesce(array_agg(company_id ORDER BY company_id),ARRAY[]::uuid[]) FROM public.customer_import_batches WHERE ('||expression||')' INTO found_ids;
                        expected_ids := CASE WHEN i=1 THEN ARRAY['20000000-0000-4000-8000-000000000001'::uuid]
                          WHEN i=2 THEN ARRAY['20000000-0000-4000-8000-000000000002'::uuid]
                          WHEN i IN (3,4) THEN ARRAY[]::uuid[]
                          ELSE ARRAY['20000000-0000-4000-8000-000000000001'::uuid,'20000000-0000-4000-8000-000000000002'::uuid] END;
                        IF found_ids IS DISTINCT FROM expected_ids THEN
                          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='RESIDUAL_POLICY_PREDICATE_MISMATCH';
                        END IF;
                      END LOOP;
                    END $policy_truth$;""", 'residual_two_tenant_seven_predicate_cases')
        progress['intakeNativePredicateCases'] = 7
    finally:
        drop_clone(target)


class ResidualReplay:
    """One-shot boundary state machine on the controller's live owned target."""
    def __init__(self, target, retained, order):
        import json
        if (type(order) is not list or len(order) != 144 or
                hashlib.sha256(json.dumps(order,separators=(',',':')).encode()).hexdigest() != FOUNDATION_SHA256):
            raise ValueError('RESIDUAL_FOUNDATION_ORDER_MISMATCH')
        pins = source_pins()
        if (not isinstance(retained, MappingProxyType) or set(retained) != set(pins) or
                any(type(retained[p]) is not bytes or hashlib.sha256(retained[p]).hexdigest() != pin
                    for p,pin in pins.items())):
            raise ValueError('RESIDUAL_RETAINED_SOURCE_MISMATCH')
        self.target = target
        self.name = getattr(target, 'name', None)
        self.retained = retained
        self.order = tuple(order)
        self.state = 'READY'
        self.ordinal = 77
        self.progress = {'residualApplied':[]}
        self.extra = load('canonical-residual-readiness-native.py')
        self.db2 = load('canonical-db2-reconstruction-native.py')
        self.prepared = self.extra.prepare(ROOT, read_source=retained.__getitem__)
        self.db2_prepared = self.db2.prepare(ROOT, read_source=retained.__getitem__)
        self.require_target()

    def require_target(self):
        if (not getattr(self.target,'active',False) or self.name is None or
                self.name != getattr(self.target,'name',None) or
                self.name != getattr(self.target,'_created_name',None)):
            self.state = 'FAILED'
            raise ValueError('RESIDUAL_OWNED_TARGET_REQUIRED')
        self.target.command(DATABASE)

    def step(self, expected, work, next_state):
        self.require_target()
        if self.state != expected:
            self.state = 'FAILED'
            raise ValueError('RESIDUAL_BOUNDARY_SEQUENCE_MISMATCH')
        self.state = 'RUNNING'
        try:
            result = work()
            self.state = next_state
            return result
        except BaseException:
            self.state = 'FAILED'
            raise

    def after_prefix(self):
        self.step('READY', lambda: apply_prefix(self.target,self.retained,self.progress), 'AFTER')

    def boundary(self, ordinal, relative, before):
        if (type(ordinal) is not int or ordinal != self.ordinal + int(before) or
                ordinal < 78 or ordinal > 144 or relative != self.order[ordinal-1]):
            self.state = 'FAILED'
            raise ValueError('RESIDUAL_BOUNDARY_SEQUENCE_MISMATCH')
        if before:
            self.step('AFTER',lambda: self.extra.before(self.target,DATABASE,relative,self.prepared,self.progress),'BEFORE')
            self.ordinal = ordinal
        else:
            self.step('BEFORE',lambda: self.extra.after(self.target,DATABASE,relative,self.prepared,self.progress),'AFTER')

    def before_source(self, ordinal, relative):
        self.boundary(ordinal,relative,True)

    def after_source(self, ordinal, relative):
        self.boundary(ordinal,relative,False)

    def finish(self):
        if self.ordinal != 144:
            self.state = 'FAILED'
            raise ValueError('RESIDUAL_FOUNDATION_INCOMPLETE')
        self.step('AFTER',lambda: self.db2.apply(self.target,DATABASE,self.db2_prepared,self.progress),'DONE')
        m = load('canonical-residual-transitions.py')
        readiness = self.prepared[0]
        db2 = self.db2_prepared[0]
        expected = [*m.ORDER,readiness.LOCKS,readiness.READINESS,db2.PREFLIGHT,db2.FINISH]
        if self.progress['residualApplied'] != expected:
            self.state = 'FAILED'
            raise ValueError('RESIDUAL_SOURCE_COMPLETION_MISMATCH')
        return {**self.progress, 'scope':'SHARED_FOUNDATION_RESIDUALS',
                'completeReplayVerified':False, 'generatedTypesVerified':False,
                'ledgerProvenanceVerified':False, 'historicalSourcesModified':False}
