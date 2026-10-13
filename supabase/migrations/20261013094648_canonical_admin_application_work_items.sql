-- One tenant-scoped read model for website intake lists, status filters and counts.
-- Canonical signups own their state. Only unambiguously linked external mirrors
-- are suppressed; optional customer links and unfamiliar states never hide work.

create or replace function public.gridex_website_application_status(p_status text, p_source_table text)
returns text language sql immutable security invoker set search_path = public, pg_temp
as $$
  select case when p_source_table = 'external_contract_intakes' then
    case coalesce(nullif(trim(p_status), ''), 'received')
      when 'created' then 'customer_created'
      when 'partially_created' then 'pending_review'
      when 'duplicate_ignored' then 'duplicate_facility_id'
      else coalesce(nullif(trim(p_status), ''), 'received') end
    else coalesce(nullif(trim(p_status), ''), 'received') end
$$;

create or replace function public.gridex_website_application_work_state(p_status text)
returns text language sql immutable security invoker set search_path = public, pg_temp
as $$
  select case
    when p_status in ('active','completed','switch_confirmed','linked_existing_customer') then 'completed'
    when p_status in ('cancelled','duplicate_ignored','archived','deleted') then 'closed'
    when p_status in ('failed','rejected','switch_rejected') then 'failed'
    when p_status in ('ready_for_switch','facility_data_received','pending_validation') then 'ready'
    when p_status in ('information_request_sent','waiting_grid_owner_response','waiting_response','switch_requested') then 'waiting'
    else 'action_required' end
$$;

create or replace view public.gridex_website_application_work_items_v
with (security_invoker = true)
as
with external_identity as (
  select e.*,
    case
      -- A stronger identifier that is missing/ambiguous must remain visible;
      -- it must never borrow an unrelated owner through a weaker key.
      when nullif(trim(e.payload->>'website_application_id'), '') is not null then
        (select w.id from public.website_customer_applications w
         where w.company_id=e.company_id and w.id::text=lower(trim(e.payload->>'website_application_id')))
      when e.intake_id is not null then
        (select case when count(*)=1 then min(w.id::text)::uuid end
         from public.website_customer_applications w
         where w.company_id=e.company_id and w.intake_id=e.intake_id)
      when e.idempotency_key is not null then
        (select case when count(*)=1 then min(w.id::text)::uuid end
         from public.website_customer_applications w
         where w.company_id=e.company_id and w.idempotency_key=e.idempotency_key)
    end as canonical_application_id
  from public.external_contract_intakes e
), canonical as (
  select w.id as application_id, w.company_id, 'website_customer_applications'::text as source_table,
    public.gridex_website_application_status(w.status, 'website_customer_applications') as status,
    public.gridex_website_application_work_state(w.status) as work_state,
    w.created_at, w.updated_at,
    (select e.id from external_identity e
     where e.company_id=w.company_id and e.canonical_application_id=w.id
     order by e.created_at desc,e.id limit 1) as linked_external_intake_id
  from public.website_customer_applications w
), fallback as (
  select e.id as application_id, e.company_id, 'external_contract_intakes'::text as source_table,
    public.gridex_website_application_status(e.status, 'external_contract_intakes') as status,
    public.gridex_website_application_work_state(e.status) as work_state,
    e.created_at,e.updated_at,e.id as linked_external_intake_id
  from external_identity e
  where e.canonical_application_id is null
)
select a.*, a.work_state not in ('completed','closed') as is_pending
from (select * from canonical union all select * from fallback) a;

revoke all on public.gridex_website_application_work_items_v from public, anon;
grant select on public.gridex_website_application_work_items_v to authenticated,service_role;
revoke all on function public.gridex_website_application_status(text,text) from public,anon;
revoke all on function public.gridex_website_application_work_state(text) from public,anon;
grant execute on function public.gridex_website_application_status(text,text),public.gridex_website_application_work_state(text) to authenticated,service_role;

create or replace function public.gridex_pending_website_application_count(p_company_id uuid default null)
returns bigint language sql stable security invoker set search_path=public,pg_temp
as $$
  select count(*) from public.gridex_website_application_work_items_v
  where is_pending and (p_company_id is null or company_id=p_company_id)
$$;
revoke all on function public.gridex_pending_website_application_count(uuid) from public,anon;
grant execute on function public.gridex_pending_website_application_count(uuid) to authenticated,service_role;

-- Preserve every existing summary column, guard and unrelated query. PostgreSQL
-- prunes the two superseded subqueries from this wrapper's unused base columns.
do $$
declare
  v_query text;
  v_columns text;
  v_definition text;
begin
  if to_regclass('public.company_dashboard_summary_v') is not null then
    select regexp_replace(pg_get_viewdef('public.company_dashboard_summary_v'::regclass,true), ';\s*$', '') into v_query;
    select string_agg(case a.attname
      when 'pending_customer_applications' then '(select public.gridex_pending_website_application_count(base.company_id)) as pending_customer_applications'
      when 'missing_metering_values' then '(select count(*) from public.gridex_actionable_data_quality_issues_v q where q.company_id=base.company_id and q.issue_type=''missing_metering_values'') as missing_metering_values'
      else format('base.%I',a.attname) end, ',' order by a.attnum) into v_columns
    from pg_attribute a where a.attrelid='public.company_dashboard_summary_v'::regclass and a.attnum>0 and not a.attisdropped;
    execute format('create or replace view public.company_dashboard_summary_v with(security_invoker=true) as select %s from (%s) base',v_columns,v_query);
  end if;

  if to_regprocedure('public.gridex_platform_dashboard_summary_v1()') is not null then
    select pg_get_functiondef('public.gridex_platform_dashboard_summary_v1()'::regprocedure) into v_definition;
    v_query:=substring(v_definition from 'AS \$function\$([\s\S]*)\$function\$');
    if v_query is null then raise exception 'Unsupported platform summary body; preserve original function'; end if;
    v_query:=regexp_replace(trim(v_query), ';\s*$', '');
    execute format($definition$
      create or replace function public.gridex_platform_dashboard_summary_v1()
      returns jsonb language sql stable security invoker set search_path=public,pg_temp
      as $body$
        select base.summary || jsonb_build_object(
          'pending_customer_applications',public.gridex_pending_website_application_count(null),
          'missing_metering_values',(select count(*) from public.gridex_actionable_data_quality_issues_v where issue_type='missing_metering_values'))
        from (%s) as base(summary)
      $body$
    $definition$,v_query);
    revoke all on function public.gridex_platform_dashboard_summary_v1() from public,anon,authenticated;
    grant execute on function public.gridex_platform_dashboard_summary_v1() to service_role;
  end if;
end $$;
