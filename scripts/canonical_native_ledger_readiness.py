"""Native readiness behavior on disposable clones, never deployment approval.

The governance positive fixture maps temporary manifest rows to the REAL cloned
CLI ledger. Its checksum is of ledger statement serialization, not historical
source-effect evidence. No ledger row or historical alias is written. T351's
authored explicit historical version is characterized separately from the real
function's default latest-CLI-version behavior. Source SQL is never translated.
"""
import json

import canonical_native_historical_prefix as p
import canonical_native_timestamp_sources as compiler

CLONE = 'gridex_native_timestamp_phase'
PINS = {
    257: ('migrations/20260802232000_migration_truth_readiness.sql',
          'dc977bb14a66bc4f12939437428198d3daf7bd174ada16ff42133b44405ef1e2'),
    262: ('migrations/20260803093200_gridex_migration_governance_v3.sql',
          '104554751e3418b051647150170f80884fb537747a4c399737f83852bcd16089'),
    275: ('migrations/20260803212754_canonical_migration_readiness_reconciliation_v4.sql',
          '08b8722e962ee019c9d190dcb3c4f3efe4cd956cdf88a0d432a0989f70635117'),
    351: ('migrations/20260813230000_runtime_readiness_dependency_resilience_v1.sql',
          '63b6099df1e28139d0a3e82011f582fa11c9e46d20db1aa3a2d43932050e8a0e'),
}


def assertion(expression):
    return "DO $readiness$ BEGIN IF (" + expression + ") IS DISTINCT FROM true THEN " \
        "RAISE EXCEPTION 'NATIVE_LEDGER_READINESS_ASSERTION' USING ERRCODE='PR001'; " \
        "END IF; END $readiness$;\n"


def program(unit):
    if (type(unit) is not compiler.Unit or unit.kind != 'timestamp'
            or unit.phase != 1 or unit.phase_count != 1
            or PINS.get(unit.ordinal) != (unit.source, unit.source_sha256)
            or p.sha(unit.source_sql) != unit.source_sha256
            or 'LEDGER_DEPENDENT_READINESS' not in unit.qualifications
            or compiler.transfer_outer(unit.source_sql)[0] != unit.sql):
        raise ValueError('NATIVE_LEDGER_READINESS_SOURCE_REQUIRED')
    parts, cases = ['BEGIN;\n'], []

    def case(name, setup, expression):
        cases.append(name)
        parts.extend(['SAVEPOINT readiness_case;\n', setup, '\n', assertion(expression),
                      'ROLLBACK TO SAVEPOINT readiness_case;\n'])

    if unit.ordinal != 351:
        mapped = unit.ordinal != 257
        columns = ',applied_ledger_version,applied_ledger_name,verification_kind,effect_verified' if mapped else ''
        values = ",version::text,name,'ledger',true" if mapped else ''
        parts.append("""DELETE FROM public.canonical_migration_manifest;
INSERT INTO public.canonical_migration_manifest
(version,filename,checksum,applied_environment,verified_at,verification_source,release_identifier,schema_fingerprint""" + columns + ")\n" +
            "SELECT version::text,version::text||'_'||name||'.sql',"
            "encode(sha256(convert_to(statements::text,'UTF8')),'hex'),'native_behavior_fixture',now(),"
            "'temporary_real_cli_ledger_fixture','native_readiness_fixture',repeat('a',64)" + values +
            " FROM supabase_migrations.schema_migrations;\n")
        view = 'public.gridex_migration_governance_v3' if unit.ordinal == 262 else 'public.canonical_migration_readiness_v'
        ready = '(SELECT is_ready AND cardinality(blockers)=0 FROM ' + view + ')'
        case('real_cli_mapping_ready_fixture', '', ready)
        for name, mutation, blocker in (
            ('unverified', 'verified_at=NULL', 'MIGRATIONS_NOT_FULLY_VERIFIED'),
            ('invalid_checksum', "checksum='invalid'", 'MIGRATION_CHECKSUM_INVALID'),
        ):
            case(name, 'UPDATE public.canonical_migration_manifest SET '+mutation+';',
                 "(SELECT NOT is_ready AND '"+blocker+"'=ANY(blockers) FROM "+view+')')
        case('empty_manifest', 'DELETE FROM public.canonical_migration_manifest;',
             "(SELECT NOT is_ready AND 'CANONICAL_MIGRATION_MANIFEST_EMPTY'=ANY(blockers) FROM "+view+')')
        if mapped:
            case('missing_real_name_mapping',
                 "UPDATE public.canonical_migration_manifest SET applied_ledger_name='native_missing_mapping';",
                 "(SELECT NOT is_ready AND 'MIGRATION_LEDGER_MISSING_MAPPING'=ANY(blockers) "
                 "AND 'MIGRATION_LEDGER_UNMAPPED_VERSION'=ANY(blockers) FROM "+view+')')
            case('effects_unverified', 'UPDATE public.canonical_migration_manifest SET effect_verified=false;',
                 "(SELECT NOT is_ready AND 'MIGRATION_EFFECTS_NOT_FULLY_VERIFIED'=ANY(blockers) FROM "+view+')')
            case('age_does_not_expire_governance',
                 "UPDATE public.canonical_migration_manifest SET verified_at=now()-interval '48 hours';", ready)
        else:
            case('missing_real_version_mapping',
                 "UPDATE public.canonical_migration_manifest SET version=version||'missing';",
                 "(SELECT NOT is_ready AND 'MIGRATION_LEDGER_MISSING_VERSION'=ANY(blockers) FROM "+view+')')
            case('stale_verification', "UPDATE public.canonical_migration_manifest SET verified_at=now()-interval '48 hours';",
                 "(SELECT NOT is_ready AND 'MIGRATION_VERIFICATION_STALE'=ANY(blockers) FROM "+view+')')
            case('refresh_matching_fingerprint', '',
                 "(SELECT is_ready FROM public.gridex_refresh_platform_schema_state_v2('native_readiness_fixture',repeat('a',64)))")
            case('refresh_wrong_fingerprint', '',
                 "(SELECT NOT is_ready AND blocking_issues ? 'SCHEMA_FINGERPRINT_MISMATCH' "
                 "FROM public.gridex_refresh_platform_schema_state_v2('native_readiness_fixture',repeat('b',64)))")
    else:
        call = "public.gridex_refresh_platform_runtime_readiness_v1(' native_readiness_fixture ',' native_deployment ',NULL)"
        case('authored_explicit_historical_version_not_cli_alias', '',
             "(SELECT migration_version='20260813230000' FROM public.platform_runtime_readiness WHERE id) "
             "AND NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20260813230000')")
        compare = """(SELECT r.migration_version=(SELECT max(version::text) FROM supabase_migrations.schema_migrations)
          AND r.schema_version='native_readiness_fixture' AND r.deployment_id='native_deployment'
          AND r.schema_fingerprint=v.schema_fingerprint
          AND r.is_ready IS NOT DISTINCT FROM (v.is_ready AND coalesce(cardinality(v.blocking_issues),0)=0)
          AND r.blocking_issues=to_jsonb(coalesce(v.blocking_issues,'{}'::text[]))
          AND r.capabilities=coalesce(v.capabilities,'{}'::jsonb)
          FROM """+call+" r CROSS JOIN public.gridex_runtime_schema_capabilities_v3 v)"
        case('default_refresh_reads_real_latest_cli_version', '', compare)
        for name, args in (('blank_schema_rejected', "'',NULL,NULL"),
                           ('invalid_migration_rejected', "'native_readiness_fixture',NULL,'invalid'")):
            cases.append(name)
            parts.append("DO $invalid$ BEGIN BEGIN PERFORM public.gridex_refresh_platform_runtime_readiness_v1("+
                         args+"); RAISE EXCEPTION 'NATIVE_LEDGER_READINESS_ASSERTION' USING ERRCODE='PR001'; "
                         "EXCEPTION WHEN invalid_parameter_value THEN NULL; END; END $invalid$;\n")
        case('missing_capability_persists_blocked_runtime',
             'ALTER TABLE public.integration_api_clients RENAME COLUMN key_prefix TO native_readiness_missing_key_prefix;',
             "(SELECT NOT is_ready AND jsonb_array_length(blocking_issues)>0 FROM "+call+')')
    parts.extend(['SELECT to_json(true);\n', 'ROLLBACK;\n'])
    return ''.join(parts), tuple(cases)


def qualify(runner, unit):
    sql, cases = program(unit)
    runner.target.assert_native_owned()
    runner.unchanged()
    entry = runner.entries[-1]
    p.verify_entry(entry, entry['version']+'_'+entry['name']+'.sql', unit)
    ledger = json.loads(json.dumps(runner.entries))
    target = runner.target
    before = target.snapshot()
    # Deployment governance remains blocked on the actual unmodified manifest.
    observed = target.sql('postgres', 'SELECT to_json(is_ready) FROM public.canonical_migration_readiness_v;',
                          'ledger_readiness_observe').strip()
    if observed != 'false':
        raise ValueError('NATIVE_LEDGER_READINESS_DEPLOYMENT_NOT_QUALIFIED')
    try:
        target.clone('postgres', CLONE)
        clone_before = target.snapshot(CLONE)
        if json.loads(target.sql(CLONE, p.LEDGER_SQL, 'ledger_readiness_cloned_ledger')) != ledger:
            raise ValueError('NATIVE_LEDGER_READINESS_CLONE_LEDGER_REQUIRED')
        if target.sql(CLONE, sql, 'ledger_readiness_behavior', transaction=False).strip() != 'true':
            raise ValueError('NATIVE_LEDGER_READINESS_EXECUTION_REQUIRED')
        if (target.snapshot(CLONE) != clone_before
                or json.loads(target.sql(CLONE, p.LEDGER_SQL, 'ledger_readiness_preserved_ledger')) != ledger):
            raise ValueError('NATIVE_LEDGER_READINESS_ROLLBACK_REQUIRED')
    finally:
        target.drop_clone(CLONE)
    if target._oid(CLONE) is not None or target.snapshot() != before:
        raise ValueError('NATIVE_LEDGER_READINESS_PARENT_OR_CLEANUP_REQUIRED')
    runner.unchanged()
    return dict(ledgerReadinessVerified=True, ledgerReadiness=dict(
        scope='NATIVE_BEHAVIOR_QUALIFICATION_NOT_DEPLOYMENT_READINESS',
        source=unit.source, sourceSha256=unit.source_sha256, programSha256=p.sha(sql.encode()),
        cliVersion=entry['version'], cliName=entry['name'],
        ledgerSha256=p.sha(json.dumps(ledger, sort_keys=True, separators=(',', ':')).encode()),
        cases=list(cases), deploymentReady=False, historicalLedgerAliasesCreated=False,
        sourceEnvironmentTranslated=False, fixtureRolledBack=True, cloneDisposed=True, parentUnchanged=True))
