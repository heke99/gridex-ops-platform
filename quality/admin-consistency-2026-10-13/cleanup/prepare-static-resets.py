"""Render static, explicit DELETE reset statements; never executes database SQL."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROUPS = {
    'c': ['customer_domain_outbox', 'customer_canonical_outbox', 'customer_domain_events', 'customer_canonical_events', 'customer_energy_events'],
    'b': ['customer_onboarding_operations', 'website_contract_quotes', 'customer_site_resolution', 'customer_portfolio_forecast_snapshots', 'bidding_zone_monthly_metrics', 'company_monthly_metrics', 'forecast_runs'],
}
EMPTY_CHILDREN = {
    'domain_events': ['webhook_deliveries'],
    'customer_onboarding_operations': ['customer_match_review_cases', 'customer_onboarding_applications', 'customer_onboarding_legal_snapshots'],
    'customer_site_resolution': ['grid_owner_information_requests', 'metering_points', 'website_contract_quotes'],
    'forecast_runs': ['forecast_run_items', 'forecast_adjustments'],
}
KEEP_CHILDREN = {
    'domain_events': ['event_outbox'], 'canonical_domain_events': ['canonical_event_outbox'],
    'website_contract_quotes': ['canonical_energy_flow_events'], 'customer_site_resolution': ['canonical_energy_flow_events'],
}
HASH = "md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))"
ROOTS = 'public.customers,public.customer_sites,public.metering_points,public.website_customer_applications'
SOURCE_CHECK = "exists(select 1 from public.customers) or exists(select 1 from public.customer_sites) or exists(select 1 from public.metering_points) or exists(select 1 from public.website_customer_applications)"


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def guard_schema(table, catalog):
    children = sorted({r['child_table'] for r in catalog if r['parent_table'] == table})
    extra = '' if not children else ' and conrelid<>all(array[' + ','.join(quote('public.' + t) + '::regclass' for t in children) + '])'
    return f"if exists(select 1 from pg_constraint where contype='f' and confrelid='public.{table}'::regclass{extra}) or exists(select 1 from pg_trigger where tgrelid='public.{table}'::regclass and not tgisinternal and (tgtype&8)=8) then raise exception 'static_reset_schema_changed:{table}';end if;"


def render_single(scope, row, catalog, group, index):
    table, pred = scope['table'], scope['predicate']
    count, fingerprint = row['exact_count'], row['row_fingerprint']
    keep_children = KEEP_CHILDREN.get(table, [])
    declarations = 'ids uuid[];n bigint;h text;k text;' + ''.join(f'k{i} text;' for i in range(len(keep_children)))
    checks = []
    for child in EMPTY_CHILDREN.get(table, []):
        checks.append(f"if exists(select 1 from public.{child}) then raise exception 'static_reset_child_not_empty:{child}';end if;")
    if table == 'domain_events':
        checks.append("if exists(select 1 from public.event_outbox where domain_event_id=any(ids)) then raise exception 'static_reset_customer_outbox_remains';end if;")
    if table == 'canonical_domain_events':
        checks.append("if exists(select 1 from public.canonical_event_outbox where domain_event_id=any(ids)) then raise exception 'static_reset_customer_canonical_outbox_remains';end if;")
    child_before = [f'select {HASH} into k{i} from public.{child} t;' for i, child in enumerate(keep_children)]
    child_after = [f"select {HASH} into h from public.{child} t;if h<>k{i} then raise exception 'static_reset_changed_child:{child}';end if;" for i, child in enumerate(keep_children)]
    mode = 'row exclusive' if group == 'c' else 'share row exclusive'
    lines = [
        f'-- Reviewed {group.upper()}{index}: {scope["scope"]}. Root only; retain reviewed fingerprint.',
        "begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';",
        'do $reset$ declare ' + declarations + 'begin',
        f'lock table {ROOTS} in share row exclusive mode;lock table public.{table} in {mode} mode;',
        f"if {SOURCE_CHECK} then raise exception 'static_reset_source_not_empty';end if;",
        guard_schema(table, catalog),
        f'select array_agg(t.id order by t.id),count(*),{HASH} into ids,n,h from(select t.* from public.{table} t where {pred} for update of t)t;',
        f"if n<>{count} or h<>{quote(fingerprint)} then raise exception 'static_reset_stale:{scope['scope']}';end if;",
        *checks,
        f"select {HASH} into k from public.{table} t where t.id<>all(coalesce(ids,'{{}}'::uuid[]));",
        *child_before,
        f'delete from public.{table} where id=any(ids);get diagnostics n=row_count;',
        f"if n<>{count} or exists(select 1 from public.{table} where id=any(ids)) then raise exception 'static_reset_delete_mismatch:{scope['scope']}';end if;",
        f"select {HASH} into h from public.{table} t where t.id<>all(coalesce(ids,'{{}}'::uuid[]));if h<>k then raise exception 'static_reset_changed_preserved:{table}';end if;",
        *child_after,
        'end $reset$;commit;',
        f"select {quote('static_customer_reset_'+group+str(index)+'_committed')} as result;",
    ]
    return '\n'.join(lines) + '\n'


def render_inbound(scopes, rows, catalog):
    s1, s2 = scopes['manual_inbound_messages'], scopes['inbound_operation_events']
    lines = [
        '-- Reviewed D: exact classified unmatched manual/email pair. Root refreshes only its classified count-1 hash if needed.',
        "begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';",
        'do $reset$ declare i1 uuid[];i2 uuid[];n bigint;h text;k1 text;k2 text;begin',
        f'lock table {ROOTS},public.manual_inbound_messages,public.inbound_operation_events in share row exclusive mode;',
        f"if {SOURCE_CHECK} then raise exception 'static_reset_source_not_empty';end if;",
        guard_schema(s1['table'], catalog), guard_schema(s2['table'], catalog),
    ]
    for i, s in enumerate([s1, s2], 1):
        r = rows[s['scope']]
        lines += [f"select array_agg(t.id order by t.id),count(*),{HASH} into i{i},n,h from(select t.* from public.{s['table']} t where {s['predicate']} for update of t)t;",
                  f"if n<>{r['exact_count']} or h<>{quote(r['row_fingerprint'])} then raise exception 'static_reset_stale:{s['scope']}';end if;",
                  f"select {HASH} into k{i} from public.{s['table']} t where t.id<>all(coalesce(i{i},'{{}}'::uuid[]));"]
    for i, s in enumerate([s1, s2], 1):
        lines += [f"delete from public.{s['table']} where id=any(i{i});get diagnostics n=row_count;if n<>{rows[s['scope']]['exact_count']} then raise exception 'static_reset_delete_mismatch:{s['scope']}';end if;",
                  f"select {HASH} into h from public.{s['table']} t where t.id<>all(coalesce(i{i},'{{}}'::uuid[]));if h<>k{i} then raise exception 'static_reset_changed_preserved:{s['table']}';end if;"]
    lines += ["if exists(select 1 from public.manual_inbound_messages where id=any(i1)) or exists(select 1 from public.inbound_operation_events where id=any(i2)) then raise exception 'static_reset_inbound_residual';end if;",
              'end $reset$;commit;', "select 'static_customer_reset_d_committed' as result;"]
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    policy = json.loads((HERE/'reset-approved-scopes.json').read_text())
    scopes = {s['scope']: s for s in policy['scopes']}
    rows = {r['scope_name']: r for r in json.loads((HERE/'reset-approved-baseline.json').read_text())}
    catalog = json.loads((HERE/'static-reset-live-fk-catalog.json').read_text())
    for group, names in GROUPS.items():
        for index, name in enumerate(names, 1):
            (HERE/f'reset-static-{group}{index}-{name}.sql').write_text(render_single(scopes[name], rows[name], catalog, group, index))
    (HERE/'reset-static-d-inbound-pair.sql').write_text(render_inbound(scopes, rows, catalog))
    print('Prepared five C, seven B and one paired D static files. No database connection; A/app already completed by root.')
