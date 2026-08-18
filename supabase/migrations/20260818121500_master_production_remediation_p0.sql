-- GRIDEX MASTER REMEDIATION P0
-- 1) O(1) public contract fingerprint with complete invalidation ownership.
-- 2) Server-side monthly spot aggregation (no PostgREST row cap).
-- 3) Tenant lifecycle write/claim fail-closed.
-- 4) Contract identity allocation and duplicate trigger cleanup.
-- 5) Retire orphan onboarding outbox destination.

create or replace function public.gridex_public_catalog_dependency_revision_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $$
declare
  v_row jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_company_id uuid;
  v_entity_id text := v_row->>'id';
begin
  case tg_table_name
    when 'companies' then
      v_company_id := (v_row->>'id')::uuid;
    when 'tenant_contract_assignments' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    when 'contract_offers' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    when 'contract_products' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    when 'contract_product_versions' then
      select cp.company_id into v_company_id
      from public.contract_products cp
      where cp.id = nullif(v_row->>'contract_product_id','')::uuid;
    when 'legal_bundle_versions' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    when 'legal_bundle_version_documents' then
      select lb.company_id into v_company_id
      from public.legal_bundle_versions lb
      where lb.id = nullif(v_row->>'legal_bundle_version_id','')::uuid;
    when 'tenant_legal_profiles' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    when 'price_plans' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    when 'price_plan_versions' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    when 'price_books' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    when 'integration_api_clients' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    when 'portfolios' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    when 'portfolio_monthly_settlements' then
      v_company_id := nullif(v_row->>'company_id','')::uuid;
    else
      v_company_id := null;
  end case;

  if v_company_id is not null then
    perform public.gridex_bump_contract_publication_revision(
      v_company_id,
      'website',
      tg_table_name || '.' || lower(tg_op),
      v_entity_id
    );
    perform public.gridex_bump_contract_publication_revision(
      v_company_id,
      'api',
      tg_table_name || '.' || lower(tg_op),
      v_entity_id
    );
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('tenant_contract_assignments','trg_gridex_catalog_rev_tenant_assignment'),
      ('contract_offers','trg_gridex_catalog_rev_contract_offer'),
      ('contract_products','trg_gridex_catalog_rev_contract_product'),
      ('contract_product_versions','trg_gridex_catalog_rev_contract_product_version'),
      ('legal_bundle_versions','trg_gridex_catalog_rev_legal_bundle'),
      ('legal_bundle_version_documents','trg_gridex_catalog_rev_legal_document'),
      ('tenant_legal_profiles','trg_gridex_catalog_rev_legal_profile'),
      ('price_plans','trg_gridex_catalog_rev_price_plan'),
      ('price_plan_versions','trg_gridex_catalog_rev_price_plan_version'),
      ('price_books','trg_gridex_catalog_rev_price_book'),
      ('portfolios','trg_gridex_catalog_rev_portfolio'),
      ('portfolio_monthly_settlements','trg_gridex_catalog_rev_portfolio_settlement')
    ) as t(table_name, trigger_name)
  loop
    execute format('drop trigger if exists %I on public.%I', r.trigger_name, r.table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.gridex_public_catalog_dependency_revision_trigger_v1()',
      r.trigger_name, r.table_name
    );
  end loop;
end $$;

drop trigger if exists trg_gridex_catalog_rev_api_client on public.integration_api_clients;
create trigger trg_gridex_catalog_rev_api_client
after insert or delete or update of status, scopes
on public.integration_api_clients
for each row execute function public.gridex_public_catalog_dependency_revision_trigger_v1();

drop trigger if exists trg_gridex_catalog_rev_company on public.companies;
create trigger trg_gridex_catalog_rev_company
after update of name, slug, company_slug, org_number, status, branding, metadata, external_tenant_reference
on public.companies
for each row execute function public.gridex_public_catalog_dependency_revision_trigger_v1();

create or replace function public.public_contract_feed_fingerprint_v1(
  p_company_id uuid,
  p_customer_type text default null,
  p_channel text default 'website'
)
returns table(
  fingerprint text,
  publication_revision bigint,
  publication_updated_at timestamptz,
  stockholm_date date
)
language sql
stable
set search_path to 'public','pg_catalog'
as $$
  select
    md5(concat_ws(
      ':',
      p_company_id::text,
      p_channel,
      coalesce(p_customer_type,'all'),
      (current_timestamp at time zone 'Europe/Stockholm')::date::text,
      coalesce(r.revision,0)::text,
      coalesce(r.revision_token::text,'initial')
    )) as fingerprint,
    coalesce(r.revision,0)::bigint as publication_revision,
    r.updated_at as publication_updated_at,
    (current_timestamp at time zone 'Europe/Stockholm')::date as stockholm_date
  from (select 1) seed
  left join public.contract_publication_revisions r
    on r.company_id=p_company_id and r.channel=p_channel;
$$;

create or replace function public.gridex_recompute_spot_price_month_v1(
  p_source text,
  p_price_area text,
  p_billing_month text
)
returns public.spot_price_monthly_summaries
language plpgsql
security definer
set search_path to 'public','extensions','pg_catalog','pg_temp'
as $$
declare
  v_month_start_date date;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_expected_days int;
  v_verified_days int;
  v_expected_intervals int;
  v_actual_intervals int;
  v_expected_minutes bigint;
  v_covered_minutes bigint;
  v_avg numeric;
  v_min numeric;
  v_max numeric;
  v_checksum text;
  v_complete boolean;
  v_now timestamptz := now();
  v_row public.spot_price_monthly_summaries%rowtype;
begin
  if p_source is null or nullif(btrim(p_price_area),'') is null
     or p_billing_month !~ '^\d{4}-\d{2}$' then
    raise exception using errcode='22023', message='spot_month_scope_invalid';
  end if;

  v_month_start_date := to_date(p_billing_month || '-01','YYYY-MM-DD');
  v_period_start := (v_month_start_date::timestamp at time zone 'Europe/Stockholm');
  v_period_end := ((v_month_start_date + interval '1 month')::timestamp at time zone 'Europe/Stockholm');
  v_expected_minutes := extract(epoch from (v_period_end-v_period_start))::bigint / 60;

  select
    count(*)::int,
    coalesce(sum(expected_interval_count),0)::int,
    count(*) filter (where status in ('verified','locked'))::int
  into v_expected_days, v_expected_intervals, v_verified_days
  from public.spot_price_daily_summaries
  where source=p_source
    and price_area=p_price_area
    and price_date>=v_month_start_date
    and price_date<(v_month_start_date + interval '1 month')::date;

  select
    count(*)::int,
    avg(sek_per_kwh),
    min(sek_per_kwh),
    max(sek_per_kwh),
    coalesce(sum(extract(epoch from (time_end-time_start))/60),0)::bigint,
    encode(
      digest(
        coalesce(string_agg(
          concat_ws('|',time_start::text,time_end::text,sek_per_kwh::text),
          '||' order by time_start,time_end
        ),''),
        'sha256'
      ),
      'hex'
    )
  into v_actual_intervals,v_avg,v_min,v_max,v_covered_minutes,v_checksum
  from public.spot_price_intervals
  where source=p_source
    and price_area=p_price_area
    and time_start>=v_period_start
    and time_start<v_period_end;

  v_complete :=
    v_expected_days = extract(day from ((v_month_start_date + interval '1 month' - interval '1 day')::date))::int
    and v_verified_days = v_expected_days
    and v_expected_intervals > 0
    and v_actual_intervals = v_expected_intervals
    and v_covered_minutes = v_expected_minutes;

  insert into public.spot_price_monthly_summaries(
    source,price_area,billing_month,period_start,period_end,
    average_sek_per_kwh,min_sek_per_kwh,max_sek_per_kwh,
    interval_count,expected_interval_count,
    covered_duration_minutes,expected_duration_minutes,
    quality_issues,provider_fetched_at,verified_at,status,source_checksum,updated_at
  ) values (
    p_source,p_price_area,p_billing_month,v_period_start,v_period_end,
    v_avg,v_min,v_max,v_actual_intervals,v_expected_intervals,
    v_covered_minutes,v_expected_minutes,
    case when v_complete then '[]'::jsonb else jsonb_build_array(jsonb_build_object('code','incomplete_month_coverage')) end,
    v_now,case when v_complete then v_now else null end,
    case when v_complete then 'verified' else 'incomplete' end,
    v_checksum,v_now
  )
  on conflict(source,price_area,billing_month) do update set
    period_start=excluded.period_start,
    period_end=excluded.period_end,
    average_sek_per_kwh=excluded.average_sek_per_kwh,
    min_sek_per_kwh=excluded.min_sek_per_kwh,
    max_sek_per_kwh=excluded.max_sek_per_kwh,
    interval_count=excluded.interval_count,
    expected_interval_count=excluded.expected_interval_count,
    covered_duration_minutes=excluded.covered_duration_minutes,
    expected_duration_minutes=excluded.expected_duration_minutes,
    quality_issues=excluded.quality_issues,
    provider_fetched_at=excluded.provider_fetched_at,
    verified_at=excluded.verified_at,
    status=excluded.status,
    source_checksum=excluded.source_checksum,
    updated_at=excluded.updated_at
  where public.spot_price_monthly_summaries.locked_at is null
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.spot_price_monthly_summaries
    where source=p_source and price_area=p_price_area and billing_month=p_billing_month;
  end if;
  return v_row;
end
$$;

create or replace function public.gridex_enforce_spot_price_month_server_aggregate_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','extensions','pg_catalog','pg_temp'
as $$
declare
  v_row public.spot_price_monthly_summaries%rowtype;
begin
  if tg_op='UPDATE' and old.locked_at is not null then
    return new;
  end if;
  select * into v_row
  from public.gridex_recompute_spot_price_month_v1(new.source,new.price_area,new.billing_month);
  return null;
end
$$;

drop trigger if exists spot_price_monthly_server_aggregate_v1 on public.spot_price_monthly_summaries;
create trigger spot_price_monthly_server_aggregate_v1
before insert or update on public.spot_price_monthly_summaries
for each row
when (pg_trigger_depth() = 0)
execute function public.gridex_enforce_spot_price_month_server_aggregate_v1();

-- Recompute all currently unlocked monthly summaries from authoritative intervals.
do $$
declare r record;
begin
  for r in
    select source,price_area,billing_month
    from public.spot_price_monthly_summaries
    where locked_at is null
  loop
    perform public.gridex_recompute_spot_price_month_v1(r.source,r.price_area,r.billing_month);
  end loop;
end $$;

-- Tenant operational guards must run for any UPDATE, not only company_id changes.
do $$
declare r record;
begin
  for r in
    select c.relname as table_name, tg.tgname as trigger_name
    from pg_trigger tg
    join pg_class c on c.oid=tg.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not tg.tgisinternal
      and n.nspname='public'
      and tg.tgfoid=(
        select p.oid from pg_proc p
        join pg_namespace pn on pn.oid=p.pronamespace
        where pn.nspname='public'
          and p.proname='gridex_assert_company_operational_for_write'
        limit 1
      )
  loop
    execute format('drop trigger %I on public.%I',r.trigger_name,r.table_name);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.gridex_assert_company_operational_for_write()',
      r.trigger_name,r.table_name
    );
  end loop;
end $$;

create or replace function public.gridex_claim_customer_operation_jobs(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.customer_operation_jobs
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  with candidates as (
    select jobs.id
    from public.customer_operation_jobs jobs
    join public.companies company on company.id=jobs.company_id
    where company.status in ('active','onboarding')
      and coalesce(jobs.lifecycle_blocked_by_tenant,false)=false
      and (
        (
          jobs.status='queued'
          and jobs.run_after<=now()
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<now()-interval '15 minutes')
        )
        or
        (
          jobs.status='running'
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<now()-interval '15 minutes')
        )
      )
    order by jobs.priority asc,jobs.run_after asc,jobs.created_at asc
    for update of jobs skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.customer_operation_jobs jobs
  set status='running',
      attempts=case when jobs.status='queued' then jobs.attempts+1 else jobs.attempts end,
      locked_at=now(),
      locked_by=nullif(trim(p_worker_id),''),
      lock_token=gen_random_uuid(),
      last_error=case when jobs.status='running' then coalesce(jobs.last_error,'stale_customer_operation_lock_reclaimed') else jobs.last_error end,
      updated_at=now()
  from candidates
  where jobs.id=candidates.id
  returning jobs.*;
end
$$;

-- One immutable guard is enough. Keep the broader DELETE OR UPDATE trigger.
drop trigger if exists customer_contracts_signed_immutable on public.customer_contracts;

create or replace function public.gridex_assign_customer_contract_identity_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  if new.customer_id is null or new.company_id is null then
    return new;
  end if;

  if nullif(btrim(new.customer_number),'') is null then
    select c.customer_number into new.customer_number
    from public.customers c
    where c.id=new.customer_id and c.company_id=new.company_id;
  end if;
  if nullif(btrim(new.customer_number),'') is null then
    raise exception using errcode='23502',message='customer_contract_customer_number_required';
  end if;

  if nullif(btrim(new.contract_number),'') is null then
    new.contract_number := public.gridex_next_contract_number(new.company_id,new.customer_number);
  end if;
  return new;
end
$$;

drop trigger if exists aa_customer_contracts_assign_identity_v1 on public.customer_contracts;
create trigger aa_customer_contracts_assign_identity_v1
before insert on public.customer_contracts
for each row execute function public.gridex_assign_customer_contract_identity_v1();

-- Retire orphan durable destination without breaking the existing canonical transaction.
create or replace function public.gridex_suppress_retired_onboarding_outbox_v1()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
begin
  if new.destination_type='internal'
     and new.destination_key='customer-onboarding-orchestrator' then
    return null;
  end if;
  return new;
end
$$;

drop trigger if exists aa_event_outbox_retired_onboarding_destination_v1 on public.event_outbox;
create trigger aa_event_outbox_retired_onboarding_destination_v1
before insert on public.event_outbox
for each row execute function public.gridex_suppress_retired_onboarding_outbox_v1();

update public.event_outbox
set status='failed',
    failed_at=coalesce(failed_at,now()),
    last_error='orphan_destination_retired:customer-onboarding-orchestrator',
    locked_at=null,
    locked_by=null,
    updated_at=now()
where destination_type='internal'
  and destination_key='customer-onboarding-orchestrator'
  and status in ('queued','processing');

revoke all on function public.gridex_public_catalog_dependency_revision_trigger_v1() from public,anon,authenticated;
revoke all on function public.public_contract_feed_fingerprint_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.public_contract_feed_fingerprint_v1(uuid,text,text) to service_role;
revoke all on function public.gridex_recompute_spot_price_month_v1(text,text,text) from public,anon,authenticated;
grant execute on function public.gridex_recompute_spot_price_month_v1(text,text,text) to service_role;
revoke all on function public.gridex_enforce_spot_price_month_server_aggregate_v1() from public,anon,authenticated;
revoke all on function public.gridex_claim_customer_operation_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.gridex_claim_customer_operation_jobs(text,integer) to service_role;
revoke all on function public.gridex_assign_customer_contract_identity_v1() from public,anon,authenticated;
revoke all on function public.gridex_suppress_retired_onboarding_outbox_v1() from public,anon,authenticated;
