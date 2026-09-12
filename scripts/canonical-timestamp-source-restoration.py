#!/usr/bin/env python3
"""Four whole-source restorations, with bounded native postconditions.

The ordinary selector, not this module, admits the sources at their original
chronological positions. No SQL replacement, arbitrary target, ledger, generated
schema or full-effects acceptance is provided here.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'migrations/20260531111600_system_readiness_foundation.sql':
        ('e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2', 8),
    'migrations/20260609162000_batch_7_website_integration_foundation.sql':
        ('1809f5c8926ec6bda991eb861cc3ba7a24738e8655b47e94f4ab086d5f2afb0b', 38),
    'migrations/20260801143000_canonical_multitenant_platform_hardening.sql':
        ('4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0', 242),
    'migrations/20260802232000_migration_truth_readiness.sql':
        ('dc977bb14a66bc4f12939437428198d3daf7bd174ada16ff42133b44405ef1e2', 256),
}
INDEXES = (
    'integration_api_clients_scopes_idx',
    'billing_disputes_customer_number_idx',
    'company_capabilities_company_enabled_idx',
    None,
)
CLONE = 'gridex_auth_legacy_atomic'


def validate_selection(root, selected):
    if Path(root).resolve() != ROOT:
        raise ValueError('RESTORATION_SOURCE_ROOT_MISMATCH')
    for path, (expected, ordinal) in SOURCES.items():
        matches = [(i, sha) for i, (name, sha) in enumerate(selected, 1) if name == path]
        source = ROOT / 'supabase' / path
        if (matches != [(ordinal, expected)] or source.is_symlink()
                or hashlib.sha256(source.read_bytes()).hexdigest() != expected):
            raise ValueError('RESTORATION_SOURCE_OR_ORDER_MISMATCH')


def assert_sql(expression):
    return ("DO $source_effect$ BEGIN IF (" + expression + ") IS DISTINCT FROM true THEN "
            "RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='RESTORED_SOURCE_POSTCONDITION_FAILED'; "
            "END IF; END $source_effect$;\n")


def rls(tables):
    return " AND ".join("EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public." + t +
                        "') AND relrowsecurity)" for t in tables)


def index(name, unique=False):
    return ("EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public." + name +
            "') AND indisvalid AND indisready AND indisunique=" + ('true' if unique else 'false') + ")")


def view_invoker(name):
    return "EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public." + name + "') AND reloptions @> ARRAY['security_invoker=true'])"


def service_only(signature):
    return ("has_function_privilege('service_role','" + signature + "','EXECUTE') AND NOT "
            "has_function_privilege('anon','" + signature + "','EXECUTE') AND NOT "
            "has_function_privilege('authenticated','" + signature + "','EXECUTE')")


def checks(path):
    if path not in SOURCES:
        raise ValueError('RESTORATION_SOURCE_NOT_ADMITTED')
    which = list(SOURCES).index(path)
    if which == 0:
        return [
            rls(('domain_events','event_outbox','integration_api_clients','integration_api_requests',
                 'webhook_subscriptions','webhook_deliveries','tenant_email_domains',
                 'tenant_email_sender_profiles','status_transition_rules','data_quality_findings','page_performance_budgets')),
            index(INDEXES[0]), index('event_outbox_unique_named_destination_idx', True),
            view_invoker('customer_data_quality_open_issues'), view_invoker('customer_timeline_events'),
            "EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.gridex_emit_domain_event(uuid,text,text,text,uuid,uuid,text,jsonb,text)') AND NOT prosecdef)",
            "EXISTS(SELECT 1 FROM public.status_transition_rules WHERE entity_type='supplier_switch' AND from_status='queued' AND to_status='failed' AND is_allowed AND requires_reason)",
            "EXISTS(SELECT 1 FROM public.page_performance_budgets WHERE route_key='api.v1.events' AND requires_database_filtering AND max_page_size=100)",
        ]
    if which == 1:
        return [
            rls(('company_customer_number_sequences','website_customer_applications','billing_partner_customers','billing_disputes')),
            index(INDEXES[1]), index('website_customer_applications_company_idempotency_uidx', True),
            index('billing_partner_customers_company_provider_customer_uidx', True),
            "EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.gridex_next_customer_number(uuid)') AND prosecdef)",
            "EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.communication_logs'::regclass AND attname='customer_number' AND NOT attisdropped)",
            "NOT EXISTS(SELECT 1 FROM public.customers WHERE company_id IS NOT NULL AND customer_number IS NULL)",
            "NOT EXISTS(SELECT 1 FROM public.companies c CROSS JOIN (VALUES ('contract.application_received','contract_confirmation'),('contract.confirmation_sent','contract_confirmation'),('contract.cooling_off_sent','cancellation_right'),('invoice.created','missing_information'),('invoice.disputed','missing_information')) v(event_key,template_key) WHERE NOT EXISTS(SELECT 1 FROM public.email_event_rules e WHERE e.company_id=c.id AND e.event_key=v.event_key AND e.template_key=v.template_key))",
        ]
    if which == 2:
        return [
            rls(('company_capabilities',)), index(INDEXES[2]),
            index('mt_customers_company_id_id_uidx', True),
            view_invoker('canonical_tenant_effective_legal_sources_v'),
            "EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.canonical_company_capability_enabled(uuid,text)') AND NOT prosecdef AND provolatile='s')",
            "EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.company_capabilities'::regclass AND conname='company_capabilities_ready_when_enabled_check' AND contype='c')",
            "EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.customer_sites'::regclass AND conname='mt_customer_sites_customer_id_tenant_fk' AND contype='f' AND cardinality(conkey)=2)",
            *[service_only(s) for s in ('public.canonical_onboard_customer_graph(jsonb)',
                'public.canonical_next_customer_number(uuid)', 'public.canonical_next_contract_number(uuid,text)',
                'public.canonical_next_application_number(uuid)')],
        ]
    return [
        view_invoker('canonical_migration_readiness_v'),
        service_only('public.gridex_refresh_platform_schema_state_v2(text,text)'),
        "has_table_privilege('service_role','public.canonical_migration_readiness_v','SELECT') AND NOT has_table_privilege('anon','public.canonical_migration_readiness_v','SELECT') AND NOT has_table_privilege('authenticated','public.canonical_migration_readiness_v','SELECT')",
        "NOT EXISTS(SELECT 1 FROM public.canonical_migration_readiness_v WHERE manifest_file_count=0 AND (is_ready OR NOT blockers @> ARRAY['CANONICAL_MIGRATION_MANIFEST_EMPTY']))",
        "NOT EXISTS(SELECT 1 FROM public.platform_schema_state WHERE is_ready AND NOT (SELECT is_ready FROM public.canonical_migration_readiness_v))",
    ]


def verify(target, database, source, ordinal, progress):
    if (database != 'gridex_auth_legacy_replay' or not target.active
            or target.name != target._created_name or source[0] not in SOURCES
            or SOURCES[source[0]] != (source[1], ordinal)):
        raise ValueError('RESTORATION_OWNED_SOURCE_REQUIRED')
    target.command(database)  # Existing allowlist and active ownership contract.
    expressions = checks(source[0])
    sql = ''.join(assert_sql(e) for e in expressions)
    stage = 'restored_source_' + str(list(SOURCES).index(source[0]) + 1)
    target.sql(database, sql, stage, transaction=True)
    # Native negative control: missing required metadata must really fail.
    # The source with no index uses a changed view security option instead.
    missing_index = INDEXES[list(SOURCES).index(source[0])]
    target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',CLONE])
    target.docker(['exec',target.name,'createdb','-U','postgres','-T',database,CLONE])
    try:
        mutation = ('DROP INDEX public.' + missing_index + ';' if missing_index else
                    'ALTER VIEW public.canonical_migration_readiness_v SET (security_invoker=false);')
        target.sql(CLONE, mutation, stage + '_negative_setup')
        target.sql(CLONE, sql, stage + '_negative', expect='23514', transaction=True)
    finally:
        target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',CLONE])
    # Ensure the negative clone did not alter the original target.
    target.sql(database, sql, stage + '_parent_preserved', transaction=True)
    entry = {'source': source[0], 'sourceSha256': source[1], 'timestampOrdinal': ordinal,
             'wholeOriginalExecuted': True, 'boundedPostconditions': len(expressions),
             'negativeControlVerified': True, 'fullDatabaseAcceptance': False}
    progress.setdefault('restoredWholeSources', []).append(entry)
    print(json.dumps({'scope': 'RESTORED_WHOLE_SOURCE', **entry}, sort_keys=True), flush=True)
