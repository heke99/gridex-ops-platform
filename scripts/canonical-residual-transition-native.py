#!/usr/bin/env python3
"""Seven residual source dispositions plus actual continuation on an owned PG17 target.

This candidate lane cannot certify normal replay, source-effect accounting,
ledger provenance or generated types. It uses the real first77 and the complete
selected continuation, not a fabricated minimal schema or a managed database.
"""
import importlib.util
import json
from pathlib import Path
import shutil
import signal
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CLONE = 'gridex_auth_legacy_atomic'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def clone(target, database):
    target.docker(['exec', target.name, 'dropdb', '-U', 'postgres', '--if-exists', '--force', CLONE])
    target.docker(['exec', target.name, 'createdb', '-U', 'postgres', '-T', database, CLONE])


def drop_clone(target):
    target.docker(['exec', target.name, 'dropdb', '-U', 'postgres', '--if-exists', '--force', CLONE])


def run():
    if len(sys.argv) != 1:
        raise ValueError('NO_TARGET_ARGUMENTS_ACCEPTED')
    frontier = load('residual_frontier', 'canonical-foundation-frontier-diagnostic.py')
    transitions = load('residual_transitions', 'canonical-residual-transitions.py')
    restored = load('residual_restored', 'canonical-residual-source-restoration.py')
    controller = frontier.load_controller()
    order, report = frontier.verify_selection(controller)
    timestamp = frontier.load_timestamp()
    selected, prerequisites = timestamp.load_inputs(ROOT, report, order)
    extra = load('residual_readiness_native', 'canonical-residual-readiness-native.py')
    prepared = extra.prepare(ROOT)
    db2 = load('db2_native', 'canonical-db2-reconstruction-native.py')
    db2_prepared = db2.prepare(ROOT)
    legacy = controller.load_batch()
    source_before = controller.originals_snapshot()
    original_bytes = {p: transitions.read(ROOT, p) for p in transitions.ORDER}
    authority = transitions.read(ROOT, transitions.AUTHORITY)
    candidates = {p: transitions.reconstruct(p, b, authority) for p, b in original_bytes.items()}
    progress = {'foundationApplied': 0, 'residualApplied': [], 'timestampApplied': 0}
    phase = 'OWNED_TARGET'
    result = None

    def interrupted(*_):
        raise RuntimeError('OWNED_TRANSITION_INTERRUPTED')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    with legacy.OwnedPostgres(postgis=True) as target:
        try:
            timestamp.verify_spatial_runtime(target)
            with controller.load_private().AcceptedInputs(target):
                controller.load_dedupe().prepare_reference(target, 'intake77')
                controller.load_dedupe().fresh_target(target)
                hold = Path(target.directory.name)/'residual-hold'
                hold.mkdir(mode=0o700)
                for source in (ROOT/'supabase/migrations').iterdir():
                    if source.is_symlink():
                        raise ValueError('SYMLINK_SOURCE_REJECTED')
                    if source.is_file() and source.suffix == '.sql':
                        shutil.copy2(source, hold/source.name)
                paths = [str(hold/Path(p).name if p.startswith('migrations/') else ROOT/'supabase'/p) for p in order]
                loop = controller.FoundationLoop(legacy, target, 'intake77')
                _, retained = loop.validate(str(hold), paths)
                target.sql(controller.DATABASE, (ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text(), 'residual_bootstrap', transaction=False)
                phase = 'ACTUAL_PREFIX77'
                loop.run(str(hold), paths)
                progress['foundationApplied'] = 77
                for relative in transitions.ORDER:
                    phase = relative
                    if relative in (transitions.INTAKE, transitions.ALIGNMENT):
                        clone(target, controller.DATABASE)
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
                    target.sql(controller.DATABASE, candidates[relative], 'residual_apply_' + str(len(progress['residualApplied'])+1))
                    progress['residualApplied'].append(relative)
                    if relative == transitions.DB1:
                        load('index_effects','canonical-residual-index-effects.py').verify(
                            target,controller.DATABASE,relative,original_bytes[relative])
                    if relative == transitions.INTAKE:
                        target.sql(controller.DATABASE, """DO $$ DECLARE t text; BEGIN
                          FOREACH t IN ARRAY ARRAY['customers','customer_contacts','customer_addresses','customer_sites','metering_points','customer_contracts','customer_contract_events','powers_of_attorney','customer_info_requests','customer_cases','customer_import_batches','customer_import_rows'] LOOP
                            IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_policy p ON p.polrelid=c.oid
                              WHERE c.oid=to_regclass('public.'||t) AND c.relrowsecurity
                              AND p.polname='tenant_members_read_'||t AND p.polcmd='r'
                              AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
                              AND pg_get_expr(p.polqual,p.polrelid) LIKE '%ro.key%'
                              AND pg_get_expr(p.polqual,p.polrelid) NOT LIKE '%ro.role_key%')
                            THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='RESIDUAL_INTAKE_POLICY_MISSING'; END IF;
                          END LOOP; END $$;""", 'residual_intake_policy_bindings')
                phase = 'INTAKE_TWO_TENANT_PREDICATES'
                clone(target, controller.DATABASE)
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
                phase = 'ACTUAL_FOUNDATION_CONTINUATION' 
                restored.validate_selection(order, tuple(retained))
                rulebook = retained[restored.FOUNDATION_SOURCES[restored.RULEBOOK_COMPLETION][1]-1]
                for ordinal, raw in enumerate(retained[77:], 78):
                    phase = 'foundation_' + str(ordinal)
                    extra.before(target, controller.DATABASE, order[ordinal-1], prepared, progress)
                    target.sql(controller.DATABASE, raw.decode(), 'residual_continue_' + str(ordinal), transaction=False)
                    progress['foundationApplied'] = ordinal
                    relative = order[ordinal-1]
                    extra.after(target, controller.DATABASE, relative, prepared, progress)
                    if relative in restored.SOURCES:
                        restored.verify(target, controller.DATABASE, relative, ordinal, rulebook_bytes=rulebook)
                    if relative == 'migrations/20260529_batch_2_rulebook_hardening_sql_fix_v4.sql':
                        restored.verify_rulebook_conversion(target, controller.DATABASE, relative, ordinal, rulebook_bytes=rulebook)
                phase = 'DB2_GENERIC_SCHEMA_SEPARATION'
                db2.apply(target, controller.DATABASE, db2_prepared, progress)
                phase = 'ACTUAL_TIMESTAMP_CONTINUATION'
                timestamp.execute_tail(ROOT, target, controller.DATABASE, selected, prerequisites, progress)
                if len(progress['residualApplied']) != 7:
                    raise ValueError('RESIDUAL_CANDIDATE_NOT_EXECUTED')
                result = {'outcome': 'CANDIDATE_CONTINUATION_PASSED', **progress}
        except Exception as error:
            last = Path(target.directory.name)/'client-last.out'
            details = frontier.safe_error_identifiers(last.read_bytes()) if last.is_file() else {}
            result = {'outcome': 'BLOCKED', 'phase': phase, 'errorType': type(error).__name__, **details, **progress}
        if controller.originals_snapshot() != source_before:
            raise ValueError('RESIDUAL_SOURCE_PRESERVATION_FAILED')
    if target.active:
        raise ValueError('OWNED_CLEANUP_REQUIRED')
    print(json.dumps({'scope':'RESIDUAL_TRANSITION_CANDIDATE', 'completeReplayVerified':False,
                     'generatedTypesVerified':False, 'productionModified':False, 'cleanup':'PASS', **result}, sort_keys=True))
    return 0 if result['outcome'] == 'CANDIDATE_CONTINUATION_PASSED' else 1


if __name__ == '__main__':
    raise SystemExit(run())
