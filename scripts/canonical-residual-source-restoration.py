#!/usr/bin/env python3
"""Bounded native evidence for three whole, immutable historical sources.

These checks run after their real foundation or chronological executions, including in the
supported owned replay. They never waive full replay, ledger, schema or types.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOUNDATION_SOURCES = {'migrations/20260528_batch_7a1_inbound_hardening.sql': ('4653d576effa13161ef8bdd713cb928ba9f57e8f2a16084d0f5dff2bc3d83959', 141), 'migrations/20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql': ('7f71410f8b9f498286226dae76a2bc8ab1073cb43e07442ed8b5e0eb5de869be', 143)}
TIMESTAMP_SOURCES = {'migrations/20260615_multitenant_integrity_and_claim_locks.sql': ('046c7ec8c885eca46d8dde306bc1b289aa7bccea3f9d4ebdd5f8580c07ca9a37', 69)}
SOURCES = {**FOUNDATION_SOURCES, **TIMESTAMP_SOURCES}
CLONE = 'gridex_auth_legacy_atomic'
RULEBOOK_TABLES = (
    'ediel_rulebooks', 'ediel_rule_versions', 'ediel_field_rules', 'ediel_code_rules',
    'ediel_ack_rules', 'ediel_message_build_rules', 'ediel_test_cases',
    'ediel_test_run_steps', 'ediel_test_artifacts', 'ediel_rule_change_logs',
    'ediel_test_data_sets', 'ediel_test_customers', 'ediel_test_facilities',
    'ediel_test_metering_points', 'ediel_test_expected_values',
    'ediel_test_expected_acks', 'ediel_test_field_values', 'ediel_permission_cases',
    'ediel_permission_events', 'ediel_ai_list_runs', 'ediel_ai_list_discrepancies',
)
GUARDS = (
    'customer_sites', 'metering_points', 'customer_contracts',
    'contract_price_snapshots', 'customer_legal_acceptances',
    'powers_of_attorney', 'billing_underlays',
)


def reviewed_paths():
    return tuple(ROOT / "supabase" / p for p in SOURCES)


def validate_selection(order):
    for relative, (pin, ordinal) in FOUNDATION_SOURCES.items():
        path = ROOT / 'supabase' / relative
        if (path.is_symlink() or not path.is_file()
                or hashlib.sha256(path.read_bytes()).hexdigest() != pin
                or [i for i, p in enumerate(order, 1) if p == relative] != [ordinal]):
            raise ValueError('RESIDUAL_WHOLE_SOURCE_OR_ORDER_MISMATCH')


def validate_timestamp(selected):
    for relative, (pin, ordinal) in TIMESTAMP_SOURCES.items():
        path = ROOT / 'supabase' / relative
        if ([(i, digest) for i, (name, digest) in enumerate(selected, 1) if name == relative] != [(ordinal, pin)]
                or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != pin):
            raise ValueError('RESIDUAL_WHOLE_SOURCE_OR_ORDER_MISMATCH')


def assertion(expression):
    return ("DO $whole_source$ BEGIN IF (" + expression + ") IS DISTINCT FROM true THEN "
            "RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='RESIDUAL_WHOLE_SOURCE_EFFECT_MISSING'; "
            "END IF; END $whole_source$;\n")


def index(name, columns, unique=False):
    """Compare ordered key attributes, not only the existence of an index name."""
    names = ','.join("'" + c + "'" for c in columns)
    return ("EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public." + name +
            "') AND i.indisvalid AND i.indisready AND i.indisunique=" + str(unique).lower() +
            " AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM "
            "unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ord) "
            "JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum "
            "WHERE k.ord<=i.indnkeyatts)=ARRAY[" + names + "]::text[])")


def column(table, name, kind):
    return ("EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public." + table +
            "') AND attname='" + name + "' AND NOT attisdropped AND atttypid='" + kind + "'::regtype)")


def enabled_rls(table):
    return "EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public." + table + "') AND relrowsecurity)"


def checks(relative):
    if relative not in SOURCES:
        raise ValueError('UNREVIEWED_RESIDUAL_SOURCE')
    if '7a1_inbound' in relative:
        return [
            column('ediel_messages', 'syntax_status', 'text'),
            column('ediel_messages', 'application_status', 'text'),
            column('inbound_processing_jobs', 'max_attempts', 'integer'),
            index('ux_inbound_processing_jobs_one_open_per_email', ('inbound_email_message_id',), True),
            index('idx_inbound_processing_jobs_lock_status', ('status','locked_at','attempts_count','created_at')),
            index('idx_customer_operation_tasks_batch7a_source', ('company_id','task_type','status')),
            index('idx_outbound_requests_batch7a_overdue', ('company_id','status','message_code','sent_at','acknowledged_at')),
            index('idx_metering_values_batch7a_canonical', ('company_id','canonical_dedupe_key')),
            "EXISTS(SELECT 1 FROM storage.buckets WHERE id='grid-owner-agreements' AND NOT public AND file_size_limit=52428800 AND allowed_mime_types=ARRAY['application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[])",
            "EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='grid_owner_agreements_platform_read' AND polcmd='r' AND polqual IS NOT NULL)",
            "EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='grid_owner_agreements_platform_write' AND polcmd='a' AND polwithcheck IS NOT NULL)",
        ]
    if 'rulebook_hardening_and_systemtest' in relative:
        return [
            *[enabled_rls(t) for t in RULEBOOK_TABLES],
            column('ediel_ack_rules', 'negative_aperak_on_error', 'boolean'),
            "EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.ediel_ack_rules'::regclass AND a.attname='negative_aperak_on_error' AND a.attnotnull AND pg_get_expr(d.adbin,d.adrelid)='true')",
            index('ediel_rule_versions_runtime_idx', ('message_family','message_code','status','valid_from')),
            index('ediel_test_cases_suite_idx', ('suite_code','is_active')),
            index('ediel_test_run_steps_run_idx', ('test_run_id','step_no')),
            index('ediel_test_artifacts_run_idx', ('test_run_id','artifact_type')),
            index('ediel_test_field_values_dataset_idx', ('data_set_id','test_case_code')),
            "NOT EXISTS(SELECT 1 FROM public.ediel_rule_versions WHERE message_family='PRODAT' AND previous_version_code='16B')",
            "NOT EXISTS(SELECT 1 FROM public.ediel_ack_rules WHERE message_family='PRODAT' AND message_code='Z01' AND (requires_aperak IS DISTINCT FROM false OR negative_aperak_on_error IS DISTINCT FROM true))",
        ]
    return [
        *["EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public." + table + "'::regclass AND tgname='gridex_" + table + "_company_guard_tg' AND tgenabled='O' AND tgtype=23 AND tgfoid=to_regprocedure('public.gridex_" + table + "_company_guard()'))" for table in GUARDS],
        index('idx_inbound_email_mailbox_message_id_uidx', ('mailbox_id','internet_message_id'), True),
        index('idx_inbound_email_mailbox_raw_hash_uidx', ('mailbox_id','raw_message_sha256'), True),
        index('idx_inbound_email_company_interchange_uidx', ('environment','company_id','sender_ediel_id','interchange_reference'), True),
        index('idx_inbound_email_company_transaction_external_uidx', ('environment','company_id','sender_ediel_id','transaction_reference','external_reference'), True),
        index('idx_inbound_processing_jobs_claim', ('status','locked_at','created_at')),
        index('idx_ediel_outbox_claim', ('environment','company_id','status','locked_at','priority','created_at')),
        index('idx_document_parse_jobs_company_status', ('company_id','status','created_at')),
        column('inbound_email_messages', 'raw_message_sha256', 'text'),
        column('document_ai_extractions', 'normalized_rows', 'jsonb'),
        column('document_parse_jobs', 'company_id', 'uuid'),
        "to_regprocedure('public.claim_inbound_processing_jobs(text,integer,text,interval)') IS NOT NULL",
        "to_regprocedure('public.claim_ediel_outbox_items(text,uuid,integer,text,interval)') IS NOT NULL",
    ]


def negative_sql(relative):
    if '7a1_inbound' in relative:
        return 'DROP INDEX public.ux_inbound_processing_jobs_one_open_per_email;'
    if 'rulebook_hardening_and_systemtest' in relative:
        return 'ALTER TABLE public.ediel_test_customers DISABLE ROW LEVEL SECURITY;'
    if relative in SOURCES:
        return 'ALTER TABLE public.customer_contracts DISABLE TRIGGER gridex_customer_contracts_company_guard_tg;'
    raise ValueError('UNREVIEWED_RESIDUAL_SOURCE')


def verify(target, database, relative, ordinal):
    if (database != 'gridex_auth_legacy_replay' or not getattr(target, 'active', False)
            or getattr(target, 'name', None) != getattr(target, '_created_name', None) or relative not in SOURCES
            or SOURCES[relative][1] != ordinal):
        raise ValueError('RESIDUAL_OWNED_SOURCE_REQUIRED')
    target.command(database)
    expressions = checks(relative)
    sql = ''.join(assertion(e) for e in expressions)
    stage = 'residual_whole_' + str(ordinal)
    target.sql(database, sql, stage, transaction=True)
    target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',CLONE])
    target.docker(['exec',target.name,'createdb','-U','postgres','-T',database,CLONE])
    try:
        target.sql(CLONE, negative_sql(relative), stage + '_negative_setup')
        target.sql(CLONE, sql, stage + '_negative', expect='23514', transaction=True)
    finally:
        target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',CLONE])
    target.sql(database, sql, stage + '_parent_preserved', transaction=True)
    print(json.dumps({'scope':'RESIDUAL_WHOLE_SOURCE_BOUNDARY', 'source':relative,
                      'sourceSha256':SOURCES[relative][0], 'ordinal':ordinal, 'executionStage':'foundation' if relative in FOUNDATION_SOURCES else 'timestamp',
                      'wholeOriginalExecuted':True, 'boundedPostconditions':len(expressions),
                      'negativeControlVerified':True, 'fullDatabaseAcceptance':False}, sort_keys=True), flush=True)
