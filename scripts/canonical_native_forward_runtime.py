"""Apply exactly nine reviewed forward sources after the complete retained prefix.

Uses the already admitted, live CLI Runner. No connection override, historical
ledger alias, source rewrite, schema acceptance or typegen shortcut is provided.
"""
import json
import re
from types import SimpleNamespace

import canonical_forward_sources as sources
import canonical_native_historical_prefix as p
import canonical_native_timestamp_runtime as timestamp
import canonical_native_timestamp_sources as compiler

POST = b"\nDO $native_forward_fault$ BEGIN RAISE EXCEPTION 'NATIVE_FORWARD_POST_BODY' USING ERRCODE='PF001'; END $native_forward_fault$;\n"
DROP = """BEGIN;
DROP TRIGGER gridex_native_forward_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_forward_probe.reject_ledger();
DROP SCHEMA gridex_native_forward_probe;
SELECT to_json(true); COMMIT;
"""


def programs(retained):
    result = []
    for ordinal, source in enumerate(sources.validate_retained(retained), 1):
        body, transferred = compiler.transfer_outer(source.sql)
        if not transferred:
            raise ValueError('FORWARD_ATOMIC_SOURCE_REQUIRED')
        result.append(SimpleNamespace(name=f'gridex_native_forward_{ordinal:02d}_{p.sha(body)[:12]}',
                                      sql=body, source=source.source, source_sha256=source.source_sha256))
    return tuple(result)


def admit(runner, plan, parent):
    if type(runner) is not timestamp.Runner or type(plan) is not compiler.Plan:
        raise ValueError('FORWARD_LIVE_TIMESTAMP_RUNNER_REQUIRED')
    if compiler.compile_retained(plan.selected, plan.prerequisites, plan.retained) != plan:
        raise ValueError('FORWARD_RETAINED_HISTORICAL_PLAN_REQUIRED')
    progress = parent.get('historicalTimestampTail', {})
    if (parent.get('foundationInputsExecuted') != 144 or parent.get('timestampInputsExecuted') != 514
            or progress.get('executed') is not True or progress.get('noOpRepeatVerified') is not True
            or progress.get('timestampInputsExecuted') != 514
            or progress.get('phase') != 'ALL_SELECTED_TIMESTAMP_INPUTS_EXECUTED'
            or type(progress.get('whiteLabelShimCreated')) is not bool
            or progress.get('actualLedgerRows') != len(runner.entries)
            or len(progress.get('executionUnits', [])) != len(plan.units)):
        raise ValueError('FORWARD_COMPLETE_HISTORICAL_PREFIX_REQUIRED')
    require_qualifications(plan, progress)
    runner.target.assert_native_owned()
    runner.unchanged()
    executed = []
    for unit, receipt in zip(plan.units, progress['executionUnits']):
        if any(receipt.get(key) != value for key, value in unit.receipt().items() if key != 'nativeVerified'):
            raise ValueError('FORWARD_SOURCE_RECEIPT_REQUIRED')
        skipped = unit.condition == 'white_label_shim_created' and not progress['whiteLabelShimCreated']
        if skipped:
            if receipt.get('executed') is not False or receipt.get('skippedByVerifiedCondition') is not True or 'cliFile' in receipt:
                raise ValueError('FORWARD_SOURCE_RECEIPT_REQUIRED')
            continue
        if (receipt.get('executed') is not True or receipt.get('nativeVerified') is not True
                or receipt.get('stage') != 'EXECUTED_AND_LEDGER_VERIFIED'
                or receipt.get('unchangedEarlierLedger') is not True):
            raise ValueError('FORWARD_SOURCE_RECEIPT_REQUIRED')
        executed.append((unit, receipt))
    if len(runner.entries) != 65 + len(executed) or len(runner.retained) != len(runner.entries):
        raise ValueError('FORWARD_LEDGER_COUNT_REQUIRED')
    for (unit, receipt), entry, retained in zip(executed, runner.entries[65:], runner.retained[65:]):
        path, raw, physical = retained
        if (raw != unit.sql or path.name != receipt.get('cliFile')
                or receipt.get('ledgerStatementsSha256') != p.sha(json.dumps(entry['statements'], separators=(',', ':')).encode())):
            raise ValueError('FORWARD_LEDGER_SOURCE_REQUIRED')
        p.verify_private(path, raw, physical)
        p.verify_entry(entry, path.name, unit)


def require_qualifications(plan, progress):
    from canonical_native_timestamp_snapshot import CONTROLS
    expected_snapshot = dict(nonSystemSchemasCovered=True, ledgerVerifiedSeparately=True,
                            cases=[dict(case=item[0], changedObjectDetected=True) for item in CONTROLS],
                            parentUnchanged=True)
    capability = progress.get('nativeSpatialCapability', {})
    if (progress.get('snapshotQualification') != expected_snapshot
            or not re.fullmatch(r'17[0-9]{4}', capability.get('version', ''))
            or not isinstance(capability.get('postgis'), str) or not capability['postgis']
            or progress.get('prerequisitesExecuted') != (5 if progress['whiteLabelShimCreated'] else 4)):
        raise ValueError('FORWARD_TIMESTAMP_QUALIFICATIONS_REQUIRED')
    driver = compiler.load_tail()
    restoration, residual = driver.load_restoration(), driver.load_residual_restoration()
    expected_restored = []
    for unit, receipt in zip(plan.units, progress['executionUnits']):
        special = any(label in unit.qualifications for label in ('COMMITTED_PHASES', 'LOCK_LIFETIME', 'LIVE_SYNC'))
        if 'LEDGER_DEPENDENT_READINESS' in unit.qualifications and receipt.get('ledgerReadinessVerified') is not True:
            raise ValueError('FORWARD_LEDGER_READINESS_QUALIFICATION_REQUIRED')
        if special:
            expected = [dict(expectedSqlstate='PT001', programSha256=p.sha(unit.sql+timestamp.POST),
                             catalogAndRowsRestored=True, ledgerUnchanged=True),
                        dict(expectedSqlstate='PT002', programSha256=p.sha(unit.sql),
                             catalogAndRowsRestored=True, ledgerUnchanged=True)]
            cases = receipt.get('cases', [])
            if (cases != expected or any(c.get('catalogAndRowsRestored') is not True or c.get('ledgerUnchanged') is not True for c in cases)
                    or receipt.get('noOpRepeatVerified') is not True
                    or ('LIVE_SYNC' not in unit.qualifications and receipt.get('originalDerivedCatalogAndRowsEqual') is not True)):
                raise ValueError('FORWARD_TIMESTAMP_QUALIFICATIONS_REQUIRED')
        if 'LIVE_SYNC' in unit.qualifications:
            fix = driver.load_live_sync_proof().fix
            _, expected = fix.reconstruct(compiler.ROOT, unit.source_sql.decode(), retained=plan.retained)
            actual = progress.get('sessionReconstruction', {})
            if (any(actual.get(key) != value for key, value in expected.items())
                    or actual.get('nativeBoundaryVerified') is not True or actual.get('lastPhase') != 'replay_application'):
                raise ValueError('FORWARD_TIMESTAMP_QUALIFICATIONS_REQUIRED')
        if unit.kind == 'timestamp' and unit.phase == unit.phase_count:
            if unit.source in restoration.SOURCES or unit.source in residual.TIMESTAMP_SOURCES:
                expected_restored.append(dict(source=unit.source, sourceSha256=unit.source_sha256,
                    ordinal=unit.ordinal, positiveAndNegativeVerified=True, fullSourceEffectsAccepted=False))
    if progress.get('restoredSourceControls') != expected_restored:
        raise ValueError('FORWARD_TIMESTAMP_QUALIFICATIONS_REQUIRED')


def assertion(ordinal):
    if ordinal == 1:
        return """(SELECT count(*)=2 AND bool_and(c.contype='f' AND c.convalidated
          AND NOT c.condeferrable AND NOT c.condeferred AND c.confmatchtype='s'
          AND c.confupdtype='a' AND c.confdeltype='n' AND c.confdelsetcols IS NULL
          AND c.conkey=ARRAY[a.attnum]::smallint[] AND c.confkey=ARRAY[b.attnum]::smallint[]
          AND c.confrelid=to_regclass('public.'||v.parent_table))
          FROM (VALUES ('customer_documents','contract_id','customer_contracts','customer_documents_contract_id_fkey'),
          ('ediel_route_profiles','actor_setting_id','ediel_actor_settings','ediel_route_profiles_actor_setting_id_fkey'))
          v(child_table,child_key,parent_table,constraint_name)
          JOIN pg_constraint c ON c.conrelid=to_regclass('public.'||v.child_table) AND c.conname=v.constraint_name
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname=v.child_key AND NOT a.attisdropped
          JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attname='id' AND NOT b.attisdropped)"""
    if ordinal == 2:
        return """(SELECT bool_and(NOT has_table_privilege('authenticated','public.'||t.name,p.name))
          FROM unnest(ARRAY['batch4c_security_checks','customer_duplicate_resolution_events',
          'customer_lifecycle_decisions','customer_merge_events','customer_readiness_snapshots','document_ai_extractions']) t(name)
          CROSS JOIN unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(name))"""
    if ordinal == 3:
        return """(SELECT bool_and(NOT has_table_privilege('authenticated','public.'||t.name,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          AND NOT has_any_column_privilege('authenticated','public.'||t.name,'SELECT,INSERT,UPDATE,REFERENCES'))
          FROM unnest(ARRAY['inbound_ediel_match_attempts','inbound_ediel_parse_results',
          'inbound_email_attachments']) t(name))"""
    if ordinal == 4:
        return """(SELECT bool_and(NOT has_table_privilege('authenticated','public.'||t.name,'TRUNCATE'))
          FROM unnest(ARRAY['billing_disputes','billing_partner_customers','company_go_live_reviews',
          'customer_import_batches','customer_import_rows','grid_owner_access_agreements',
          'production_route_wizard_runs']) t(name))"""
    if ordinal == 5:
        return """(SELECT count(*)=22 AND bool_and(c.relkind='r' AND c.relrowsecurity
          AND NOT c.relforcerowsecurity AND NOT has_table_privilege('authenticated',c.oid,'TRUNCATE')
          AND NOT pg_has_role('authenticated',c.relowner,'MEMBER'))
          FROM unnest(ARRAY['customer_case_events','customer_lifecycle_events','customer_sync_events',
          'data_quality_findings','ediel_agt_readiness','ediel_test_customers','ediel_test_expected_acks',
          'ediel_test_expected_values','ediel_test_facilities','ediel_test_field_values',
          'ediel_test_metering_points','ediel_test_run_locks','ediel_unlinked_test_messages',
          'gridex_archived_customer_registry_rows','page_performance_budgets','platform_session_revocations',
          'status_transition_rules','tenant_email_domains','tenant_email_sender_profiles',
          'tenant_governance_events','white_label_platform_memberships','white_label_platforms']) t(name)
          JOIN pg_class c ON c.oid=to_regclass('public.'||t.name))"""
    if ordinal == 6:
        return """(SELECT count(*)=1 AND bool_and(c.relkind='r' AND c.relrowsecurity
          AND NOT c.relforcerowsecurity AND NOT pg_has_role('authenticated',c.relowner,'MEMBER')
          AND has_table_privilege('authenticated',c.oid,'SELECT')
          AND NOT has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          AND NOT has_any_column_privilege('authenticated',c.oid,'INSERT,UPDATE,REFERENCES'))
          FROM pg_class c WHERE c.oid=to_regclass('public.ediel_send_locks'))"""
    if ordinal == 7:
        return """(SELECT count(*)=5 AND bool_and(c.contype='f' AND c.convalidated
          AND NOT c.condeferrable AND NOT c.condeferred AND c.confmatchtype='s'
          AND c.confupdtype='c' AND c.confdeltype='n'
          AND c.conparentid=0 AND c.coninhcount=0 AND c.conislocal
          AND c.conkey=ARRAY[a.attnum,b.attnum]::smallint[]
          AND c.confkey=ARRAY[pa.attnum,pb.attnum]::smallint[]
          AND c.confdelsetcols=ARRAY[a.attnum]::smallint[]
          AND child.relkind='r' AND parent.relkind='r'
          AND NOT EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid IN (child.oid,parent.oid)
                         OR inhparent IN (child.oid,parent.oid))
          AND NOT a.attnotnull AND b.attnotnull=(v.name NOT IN ('customer_sync_events','data_quality_findings'))
          AND pa.attnotnull AND NOT pb.attnotnull)
          FROM unnest(ARRAY['billing_disputes','customer_import_rows','customer_sync_events',
                           'data_quality_findings','document_parse_jobs']) v(name)
          JOIN pg_class child ON child.oid=to_regclass('public.'||v.name)
          JOIN pg_class parent ON parent.oid=to_regclass('public.customers')
          JOIN pg_constraint c ON c.conrelid=child.oid AND c.confrelid=parent.oid
            AND c.conname=v.name||'_customer_company_fk'
          JOIN pg_attribute a ON a.attrelid=child.oid AND a.attname='customer_id'
            AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
          JOIN pg_attribute b ON b.attrelid=child.oid AND b.attname='company_id'
            AND b.attnum>0 AND NOT b.attisdropped AND b.atttypid='uuid'::regtype
          JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attname='id'
            AND pa.attnum>0 AND NOT pa.attisdropped AND pa.atttypid='uuid'::regtype
          JOIN pg_attribute pb ON pb.attrelid=parent.oid AND pb.attname='company_id'
            AND pb.attnum>0 AND NOT pb.attisdropped AND pb.atttypid='uuid'::regtype)"""
    if ordinal == 8:
        return """(SELECT count(*)=1 AND bool_and(t.relkind='r' AND t.relrowsecurity
          AND NOT t.relforcerowsecurity AND NOT EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=t.oid OR inhparent=t.oid)
          AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='text'::regtype AND a.atttypmod=-1
          AND a.attnotnull AND a.attidentity='' AND a.attgenerated=''
          AND a.attcollation=(SELECT typcollation FROM pg_type WHERE oid='text'::regtype)
          AND NOT EXISTS(SELECT 1 FROM pg_attrdef WHERE adrelid=t.oid AND adnum=a.attnum)
          AND c.contype='c' AND c.convalidated AND c.conislocal AND c.coninhcount=0 AND NOT c.connoinherit
          AND c.conkey=ARRAY[a.attnum]::smallint[] AND obj_description(c.oid,'pg_constraint') IS NULL
          AND (SELECT count(*) FROM pg_constraint WHERE conrelid=t.oid AND contype='c' AND a.attnum=ANY(conkey))=1
          AND pg_get_constraintdef(c.oid,true)=$expected$CHECK (action = ANY (ARRAY['invite_sent'::text, 'password_reset_sent'::text, 'confirmation_sent'::text, 'email_confirmed'::text, 'password_updated'::text, 'auth_callback_completed'::text, 'auth_callback_failed'::text, 'email_action_verified'::text, 'company_invitation_accepted'::text, 'direct_user_created'::text, 'direct_user_linked'::text]))$expected$)
          FROM pg_class t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname='action'
          JOIN pg_constraint c ON c.conrelid=t.oid AND c.conname='auth_email_events_action_check'
          WHERE t.oid=to_regclass('public.auth_email_events'))"""
    if ordinal == 9:
        return """(SELECT count(*)=2 AND bool_and(c.relkind='r' AND c.relrowsecurity
          AND NOT c.relforcerowsecurity AND NOT pg_has_role('authenticated',c.relowner,'MEMBER')
          AND has_table_privilege('authenticated',c.oid,'SELECT')
          AND NOT EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role('authenticated',r.oid,'MEMBER')
            AND (r.rolsuper OR r.rolbypassrls
              OR has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
              OR has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES'))))
          FROM unnest(ARRAY['company_invitations','user_roles']) t(name)
          JOIN pg_class c ON c.oid=to_regclass('public.'||t.name))"""
    raise ValueError('FORWARD_SOURCE_ORDINAL_REQUIRED')


def negative(runner, program, ordinal, *, ledger):
    body = program.sql if ledger else program.sql + POST
    probe = SimpleNamespace(name=program.name[:-12]+p.sha(body)[:12], sql=body)
    before = timestamp.native_snapshot(runner.target)
    files = {path.name for path in runner.directory.iterdir()}
    path, physical = runner.create(probe)
    installed = False
    try:
        if ledger:
            guard = ("BEGIN; CREATE SCHEMA gridex_native_forward_probe; "
              "REVOKE ALL ON SCHEMA gridex_native_forward_probe FROM PUBLIC,anon,authenticated,service_role; "
              "CREATE FUNCTION gridex_native_forward_probe.reject_ledger() RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN "
              "IF NEW.name IS DISTINCT FROM '"+probe.name+"' OR ("+assertion(ordinal)+") IS DISTINCT FROM true THEN "
              "RAISE EXCEPTION 'NATIVE_FORWARD_BOUNDARY' USING ERRCODE='PF009'; END IF; "
              "RAISE EXCEPTION 'NATIVE_FORWARD_LEDGER_FAULT' USING ERRCODE='PF002'; END $guard$; "
              "REVOKE ALL ON FUNCTION gridex_native_forward_probe.reject_ledger() FROM PUBLIC,anon,authenticated,service_role; "
              "CREATE TRIGGER gridex_native_forward_guard BEFORE INSERT ON supabase_migrations.schema_migrations "
              "FOR EACH ROW EXECUTE FUNCTION gridex_native_forward_probe.reject_ledger(); SELECT to_json(true); COMMIT;")
            if runner.sql(guard) is not True:
                raise ValueError('FORWARD_LEDGER_GUARD_REQUIRED')
            installed = True
        result = runner.native('migration', 'up', '--local', timeout=420, allow_failure=True)
        p.verify_private(path, body, physical)
        expected = b'ERROR: NATIVE_FORWARD_LEDGER_FAULT (SQLSTATE PF002)' if ledger else b'ERROR: NATIVE_FORWARD_POST_BODY (SQLSTATE PF001)'
        errors = [line.rstrip(b' ') for line in result.stderr.splitlines() if line.startswith(b'ERROR:')]
        if result.returncode == 0 or errors != [expected]:
            raise ValueError('FORWARD_FAILURE_CONTROL_REQUIRED')
        runner.unchanged()
    finally:
        if installed and runner.sql(DROP) is not True:
            raise ValueError('FORWARD_GUARD_CLEANUP_REQUIRED')
        p.verify_private(path, body, physical)
        path.unlink()
    if timestamp.native_snapshot(runner.target) != before or {path.name for path in runner.directory.iterdir()} != files:
        raise ValueError('FORWARD_ROLLBACK_REQUIRED')
    return dict(expectedSqlstate='PF002' if ledger else 'PF001', programSha256=p.sha(body),
                catalogAndRowsRestored=True, ledgerUnchanged=True)


def execute(runner, historical_plan, retained, parent):
    compiled = programs(retained)
    admit(runner, historical_plan, parent)
    if 'forwardSources' in parent:
        raise ValueError('FORWARD_ONCE_ONLY_REQUIRED')
    report = dict(scope='FORWARD_SOURCE_EXECUTION_NOT_FULL_SCHEMA_ACCEPTANCE', executed=False,
                  inputsExecuted=0, sources=[], schemaAccepted=False, generatedTypesVerified=False,
                  originalHistoricalVersionsMarkedApplied=False)
    parent['forwardSources'] = report
    for ordinal, program in enumerate(compiled, 1):
        receipt = dict(source=program.source, sourceSha256=program.source_sha256,
                       programSha256=p.sha(program.sql), outerTransactionTransferredToCli=True,
                       executed=False, stage='FAILURE_CONTROLS')
        report['sources'].append(receipt)
        receipt['cases'] = [negative(runner, program, ordinal, ledger=False), negative(runner, program, ordinal, ledger=True)]
        before_rows = runner.target.snapshot()[1]
        receipt['stage'] = 'CLI_EXECUTION'
        receipt.update(runner.apply(program))
        if runner.sql('SELECT to_json(('+assertion(ordinal)+'));') is not True or runner.target.snapshot()[1] != before_rows:
            raise ValueError('FORWARD_POSTCONDITION_REQUIRED')
        runner.repeat()
        receipt.update(executed=True, noOpRepeatVerified=True, rowsPreserved=True, stage='VERIFIED')
        report['inputsExecuted'] = ordinal
        parent['forwardInputsExecuted'] = ordinal
    report.update(executed=True, actualLedgerRows=len(runner.entries))
    return report
