"""Source-bound counterfactual omissions on disposable actual63 test clones only.

These removals construct a missing-column fixture, never an admitted migration
input. The source/origin catalog stays exact. Unknown dependencies still block
RESTRICT, and every prepared setup is also applied to the independent oracle.
"""
import hashlib


SOURCE_PINS = (
    (1, '02_db1_operations_ediel_billing_dedupe_and_storage.sql', '0413f4dca84aca387297954b900a163aa63d0f84552570c372c12e8f8abdd693'),
    (2, '03_db1_backfill_functions_rls_reports_and_finish.sql', '877e395df0050a36ec71298d279c72fb0e6cb13d8b90082277450012e196f169'),
    (30, '20260519_batch_6d_superadmin_tenant_governance.sql', 'b54cc17584c7274862fe85711e324fff030ffca770d360c0fb721979f549cb47'),
    (36, '20260519_batch_6d2_runtime_governance_completion.sql', 'b7d9d48b9cd3093b5546b04225f9c6151b0f674d2ae73441d8086f51922de9ab'),
    (38, '20260520_batch_6e_rbac_tenant_stats_whitelabel.sql', '47c24a0340da00d3ab765d87efdfcf17622a12102af3bf29c2327db5f4500c64'))

# Parent views follow their dependents. The aliases stay private in this module.
VIEWS = {
    'readiness': 'gridex_db1_backfill_readiness_v',
    'overdue': 'ediel_overdue_message_acks_v',
    'ack': 'ediel_message_ack_state_v',
    'duplicate_ack': 'ediel_duplicate_ack_candidates_v',
    'tenant': 'gridex_db1_tenant_gap_v',
    'customer': 'gridex_db1_duplicate_customer_candidates_v',
    'site': 'gridex_db1_duplicate_site_candidates_v',
    'point': 'gridex_db1_duplicate_metering_point_candidates_v',
    'platform': 'platform_tenant_governance_overview',
    'meter': 'metering_billing_audit_overview',
    'volume': 'company_billing_volume_overview',
}

# Ordinals are the sorted35 exact B guard pairs followed by eight fixed cases.
# Only the native-proved17 blocked setups have a reviewed removal map.
VARIANTS = {
    0: ('billing_underlays', 'tenant readiness platform meter volume'),
    2: ('customer_authorization_documents', 'volume'),
    4: ('customer_internal_notes', ''),
    6: ('customer_portal_accounts', ''),
    8: ('customer_portal_claims', ''),
    10: ('customer_sites', 'tenant site readiness volume'),
    12: ('customers', 'tenant customer readiness platform volume'),
    13: ('ediel_messages', 'ack overdue duplicate_ack tenant readiness platform volume'),
    15: ('grid_owner_data_requests', ''),
    17: ('metering_points', 'tenant point readiness volume'),
    20: ('metering_values', 'meter volume'),
    23: ('outbound_requests', 'tenant readiness'),
    25: ('partner_exports', 'meter volume'),
    29: ('powers_of_attorney', 'tenant readiness'),
    31: ('supplier_switch_events', ''),
    33: ('supplier_switch_requests', 'tenant readiness'),
    39: ('metering_values', 'meter'),
}
DB1_ONLY = frozenset(('customer_internal_notes', 'customer_portal_accounts', 'customer_portal_claims'))


def target_sql(ordinal):
    if ordinal == 39:
        return 'ALTER TABLE public.metering_values DROP COLUMN IF EXISTS read_at; ALTER TABLE public.metering_values DROP COLUMN created_at;'
    return 'ALTER TABLE public."' + VARIANTS[ordinal][0] + '" DROP COLUMN IF EXISTS "company_id";'


def objects(ordinal):
    table, view_names = VARIANTS[ordinal]
    result = [('view', 'public', name) for alias, name in VIEWS.items() if alias in view_names.split()]
    if ordinal != 39:
        result += [('policy', table, 'gridex_db1_' + table + '_' + command)
                   for command in ('select', 'insert', 'update')]
        if table not in DB1_ONLY:
            result += [('policy', table, table + '_tenant_' + command)
                       for command in ('select', 'insert', 'update')]
            result += [('trigger', table, table + '_tenant_operational_guard_trg')]
    return tuple(result)


def key(kind, table, name):
    return 'relation/public.' + name if kind == 'view' else kind + '/public.' + table + '/' + name


def prepare(c, ordinal, setup, before, origin, prefix):
    check = lambda condition: c.check(condition, 'ALIGNMENT_GUARD_SETUP_SOURCE_DEPENDENCY')
    check(type(ordinal) is int and 0 <= ordinal < 43)
    check(len(prefix) == 43 and all(prefix[i][0] == 'migrations/' + name
          and hashlib.sha256(prefix[i][1].encode()).hexdigest() == digest
          for i, name, digest in SOURCE_PINS))
    check(c.encoded(before) == c.encoded(origin))
    if ordinal not in VARIANTS:
        return setup
    check(setup == target_sql(ordinal))
    statements = []
    for kind, table, name in objects(ordinal):
        identity = key(kind, table, name)
        check(identity in before and before[identity] == origin[identity])
        if kind == 'view':
            check(before[identity].get('kind') == 'v' and before[identity].get('owner') == 'postgres')
            statements.append('DROP VIEW public.' + c.batch.ident(name) + ' RESTRICT;')
        elif kind == 'policy':
            statements.append('DROP POLICY ' + c.batch.ident(name) + ' ON public.' + c.batch.ident(table) + ';')
        else:
            statements.append('DROP TRIGGER ' + c.batch.ident(name) + ' ON public.' + c.batch.ident(table) + ' RESTRICT;')
    return '\n'.join(statements) + '\n' + setup
