-- Reality scenario K, FINDINGS K-01 and K-02 (tenant dashboard "Driftöversikt" and the platform summary).
--
--   K-01  "Pågående leverantörsbyten" / "Aktiva switchar" counted the statuses draft, queued, submitted, accepted,
--         cancellation_* and manual_followup_required. The Z03 builder writes 'prepared' when the request has been
--         sent and the grid owner's answer is awaited, so every switch actually waiting at the grid owner was
--         missing; and an 'accepted' switch stayed "pågående" forever, also after its supply had started or ended.
--         A switch is now ongoing while it is open (including 'prepared') or confirmed but its supply has not
--         started yet (Swedish calendar date).
--   K-02  "Mätvärden" counted every stored revision; a corrected value was counted twice. Only current values
--         count now. ("Senaste mottagna mätvärden" stays a count of receptions in the last 7 days.)
--
-- Same wrapper technique as 20261013094648: every other column, guard and query of the installed objects is
-- preserved; only the named columns/keys are replaced.
begin;

create or replace function public.gridex_switch_request_is_ongoing_v1(p_company_id uuid, p_switch_request_id uuid, p_status text)
returns boolean
language sql stable security invoker set search_path = public, pg_temp
as $$
  select case
    when lower(coalesce(p_status, '')) in ('draft', 'queued', 'prepared', 'submitted', 'pending', 'ready', 'in_progress', 'sent',
      'waiting_response', 'awaiting_confirmation', 'cancellation_requested', 'cancellation_sent', 'manual_followup_required') then true
    when lower(coalesce(p_status, '')) in ('accepted', 'confirmed') then not exists (
      select 1 from public.customer_supply_periods sp
      where sp.company_id = p_company_id and sp.source_switch_request_id = p_switch_request_id
        and sp.status <> 'cancelled'
        and sp.start_date <= (now() at time zone 'Europe/Stockholm')::date)
    else false
  end
$$;
revoke all on function public.gridex_switch_request_is_ongoing_v1(uuid, uuid, text) from public, anon;
grant execute on function public.gridex_switch_request_is_ongoing_v1(uuid, uuid, text) to authenticated, service_role;

do $k$
declare
  v_query text;
  v_columns text;
  v_definition text;
begin
  if to_regclass('public.company_dashboard_summary_v') is not null then
    select regexp_replace(pg_get_viewdef('public.company_dashboard_summary_v'::regclass, true), ';\s*$', '') into v_query;
    select string_agg(case a.attname
      when 'ongoing_supplier_switches' then '(select count(*) from public.supplier_switch_requests x where x.company_id = base.company_id and public.gridex_switch_request_is_ongoing_v1(x.company_id, x.id, x.status)) as ongoing_supplier_switches'
      when 'open_switches' then '(select count(*) from public.supplier_switch_requests x where x.company_id = base.company_id and (x.status = ''open'' or public.gridex_switch_request_is_ongoing_v1(x.company_id, x.id, x.status))) as open_switches'
      when 'metering_values_total' then '(select count(*) from public.metering_values x where x.company_id = base.company_id and coalesce(x.is_current, true)) as metering_values_total'
      else format('base.%I', a.attname) end, ',' order by a.attnum) into v_columns
    from pg_attribute a where a.attrelid = 'public.company_dashboard_summary_v'::regclass and a.attnum > 0 and not a.attisdropped;
    if v_columns not like '%as ongoing_supplier_switches%' or v_columns not like '%as open_switches%' or v_columns not like '%as metering_values_total%' then
      raise exception 'statistics_k_dashboard_columns_required';
    end if;
    execute format('create or replace view public.company_dashboard_summary_v with(security_invoker=true) as select %s from (%s) base', v_columns, v_query);
  end if;

  if to_regprocedure('public.gridex_platform_dashboard_summary_v1()') is not null then
    select pg_get_functiondef('public.gridex_platform_dashboard_summary_v1()'::regprocedure) into v_definition;
    v_query := substring(v_definition from 'AS \$function\$([\s\S]*)\$function\$');
    if v_query is null then raise exception 'Unsupported platform summary body; preserve original function'; end if;
    v_query := regexp_replace(trim(v_query), ';\s*$', '');
    execute format($definition$
      create or replace function public.gridex_platform_dashboard_summary_v1()
      returns jsonb language sql stable security invoker set search_path=public,pg_temp
      as $body$
        select base.summary || jsonb_build_object(
          'ongoing_supplier_switches',(select count(*) from public.supplier_switch_requests x where x.company_id is not null and public.gridex_switch_request_is_ongoing_v1(x.company_id, x.id, x.status)),
          'metering_values_total',(select count(*) from public.metering_values x where coalesce(x.is_current, true)))
        from (%s) as base(summary)
      $body$
    $definition$, v_query);
    revoke all on function public.gridex_platform_dashboard_summary_v1() from public, anon, authenticated;
    grant execute on function public.gridex_platform_dashboard_summary_v1() to service_role;
  end if;
end
$k$;

commit;
