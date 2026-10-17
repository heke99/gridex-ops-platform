"""Offline render of reviewed focused resets; live execution belongs to root."""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROUPS = {
    "a-quality": ["dashboard_alerts", "data_quality_issues"],
    "b-read-models": ["customer_onboarding_operations", "website_contract_quotes", "customer_site_resolution", "customer_portfolio_forecast_snapshots", "bidding_zone_monthly_metrics", "company_monthly_metrics", "forecast_runs"],
    "c-events": ["customer_domain_outbox", "customer_canonical_outbox", "customer_domain_events", "customer_canonical_events", "customer_energy_events"],
    "d-inbound": ["manual_inbound_messages", "inbound_operation_events"],
}
MIXED = ["domain_events", "event_outbox", "canonical_domain_events", "canonical_event_outbox", "canonical_energy_flow_events", "manual_inbound_messages", "inbound_operation_events"]


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def render_group(policy, baseline, names, group):
    scopes = {s["scope"]: s for s in policy["scopes"]}
    rows = {s["scope_name"]: s for s in baseline}
    selected = sorted((scopes[name] for name in names), key=lambda s: s["delete_order"])
    values = []
    for s in selected:
        r = rows[s["scope"]]
        if r["table_name"] != s["table"] or not re.fullmatch(r"[a-z_][a-z_0-9]*", s["table"]):
            raise ValueError("Invalid/mismatched reviewed scope")
        if not isinstance(r["exact_count"], int) or r["exact_count"] < 0:
            raise ValueError("Invalid reviewed count")
        if s["expected_count"] is not None and s["expected_count"] != r["exact_count"]:
            raise ValueError("Unreviewed count change: " + s["scope"])
        if not re.fullmatch(r"[a-f0-9]{32}", r["row_fingerprint"]):
            raise ValueError("Invalid fingerprint")
        values.append("(" + ",".join([quote(s["scope"]), quote(s["table"]), quote(s["predicate"]), str(r["exact_count"]), quote(r["row_fingerprint"]), str(s["delete_order"])]) + ")")
    own_tables = {s["table"] for s in selected}
    roots = ["customers", "website_customer_applications", "metering_points", "customer_sites"]
    # Shared event tables receive selected-row locks only; technical appends continue.
    lock_tables = sorted(set(roots + ([s["table"] for s in selected] if group != "c-events" else [])))
    protect = sorted(set(policy["preserve_tables"] + policy["review_held_tables"] + MIXED) - own_tables)
    values_sql = ",\n  ".join(values)
    sql = f"""-- Authorized customer-flow reset {group}; root-only execution. Run C, B, A, D.
-- Original reviewed counts/hashes remain fixed; no blanket FK/trigger bypass.
begin isolation level repeatable read;
set local lock_timeout='10s'; set local statement_timeout='90s';
do $focused$
declare r record;n bigint;h text;v_ids uuid[];pinned jsonb:='{{}}';kept jsonb:='[]';
begin
 lock table {','.join('public.'+t for t in lock_tables)} in share row exclusive mode;
 if exists(select 1 from public.customers) or exists(select 1 from public.website_customer_applications)
  or exists(select 1 from public.metering_points) or exists(select 1 from public.customer_sites) then raise exception 'focused_reset_source_not_empty';end if;
 if exists(select 1 from pg_constraint where contype='f' and connamespace='public'::regnamespace and not convalidated) then raise exception 'focused_reset_unvalidated_fk';end if;
 for r in select * from(values
  {values_sql}
 ) s(scope_name,table_name,predicate,expected_count,expected_hash,delete_order) order by delete_order loop
  execute format('select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from(select t.* from public.%I t where %s for update of t)t',r.table_name,r.predicate) into v_ids,n,h;
  if n<>r.expected_count or h<>r.expected_hash then raise exception 'focused_reset_stale:%',r.scope_name;end if;
  pinned:=jsonb_set(pinned,array[r.table_name],jsonb_build_object('ids',to_jsonb(coalesce(v_ids,'{{}}'::uuid[])),'predicate',r.predicate));
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where not coalesce((%s),false)',r.table_name,r.predicate) into n,h;
  kept:=kept||jsonb_build_array(jsonb_build_object('t',r.table_name,'p','not coalesce(('||r.predicate||'),false)','n',n,'h',h));
 end loop;
 for r in select unnest(array[{','.join(quote(t) for t in protect)}]) as table_name loop
  if to_regclass('public.'||r.table_name) is null then raise exception 'focused_reset_missing_preserved_table:%',r.table_name;end if;
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.table_name) into n,h;
  kept:=kept||jsonb_build_array(jsonb_build_object('t',r.table_name,'p','true','n',n,'h',h));
 end loop;
 for r in select * from(values
  {values_sql}
 ) s(scope_name,table_name,predicate,expected_count,expected_hash,delete_order) order by delete_order loop
  select coalesce(array_agg(value::uuid),'{{}}'::uuid[]) into v_ids from jsonb_array_elements_text(pinned->r.table_name->'ids');
  execute format('delete from public.%I where id=any($1)',r.table_name) using v_ids;
  get diagnostics n=row_count;if n<>r.expected_count then raise exception 'focused_reset_deleted_count:%',r.scope_name;end if;
 end loop;
 for r in select value->>'t' as t,value->>'p' as p,(value->>'n')::bigint as n,value->>'h' as h from jsonb_array_elements(kept) loop
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where %s',r.t,r.p) into n,h;
  if n<>r.n or h<>r.h then raise exception 'focused_reset_changed_preserved:%',r.t;end if;
 end loop;
 for r in select key as t,value->'ids' as ids,value->>'predicate' as predicate from jsonb_each(pinned) loop
  select coalesce(array_agg(value::uuid),'{{}}'::uuid[]) into v_ids from jsonb_array_elements_text(r.ids);
  execute format('select count(*) from public.%I where id=any($1)',r.t) into n using v_ids;
  if n<>0 then raise exception 'focused_reset_pinned_residual:%',r.t;end if;
  execute format('select count(*) from public.%I t where %s',r.t,r.predicate) into n;
  if n<>0 then raise exception 'focused_reset_scope_residual:%',r.t;end if;
 end loop;
 if exists(select 1 from public.customers) or exists(select 1 from public.website_customer_applications)
  or exists(select 1 from public.metering_points) or exists(select 1 from public.customer_sites) then raise exception 'focused_reset_new_source';end if;
end $focused$;
commit;
select 'focused_customer_reset_{group}_committed' as result;
"""
    return sql


if __name__ == "__main__":
    policy = json.loads((HERE / "reset-approved-scopes.json").read_text())
    baseline = json.loads((HERE / "reset-approved-baseline.json").read_text())
    for name, names in GROUPS.items():
        target = HERE / ("reset-focused-" + name + ".sql")
        target.write_text(render_group(policy, baseline, names, name))
        print(f"Prepared {target.name}; no database connection")
