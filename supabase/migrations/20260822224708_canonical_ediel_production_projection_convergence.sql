create or replace function public.canonical_sync_company_ediel_projection_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_projection_status text;
begin
  v_projection_status := case new.state
    when 'live' then 'live'
    when 'paused' then 'paused'
    when 'blocked' then 'blocked'
    when 'prepared' then 'production_prepared'
    when 'retired' then 'blocked'
    when 'configuring' then 'not_ready'
    when 'disabled' then 'not_ready'
    else 'not_ready'
  end;

  update public.companies
     set production_status = v_projection_status,
         ediel_production_status = v_projection_status,
         live_ediel_enabled = new.state = 'live',
         ediel_production_enabled = new.state = 'live',
         operating_environment = case when new.state = 'live' then 'production' else operating_environment end,
         live_approved_by = coalesce(new.approved_by, live_approved_by),
         live_approved_at = coalesce(new.approved_at, live_approved_at),
         ediel_production_enabled_by = case
           when new.state = 'live' then coalesce(new.approved_by, ediel_production_enabled_by)
           else ediel_production_enabled_by
         end,
         ediel_production_enabled_at = case
           when new.state = 'live' then coalesce(new.approved_at, ediel_production_enabled_at)
           else ediel_production_enabled_at
         end,
         ediel_production_paused_by = case
           when new.state = 'paused' then new.paused_by
           when new.state = 'live' then null
           else ediel_production_paused_by
         end,
         ediel_production_paused_at = case
           when new.state = 'paused' then new.paused_at
           when new.state = 'live' then null
           else ediel_production_paused_at
         end,
         ediel_production_pause_reason = case
           when new.state = 'paused' then new.pause_reason
           when new.state = 'live' then null
           else ediel_production_pause_reason
         end,
         live_blocked_reason = case
           when new.state = 'blocked' then new.blocked_reason
           when new.state = 'paused' then coalesce(new.pause_reason, new.blocked_reason)
           when new.state = 'retired' then coalesce(new.blocked_reason, 'ediel_production_retired')
           when new.state in ('prepared', 'live') then null
           else live_blocked_reason
         end,
         ediel_first_live_send_approved_by = coalesce(new.first_live_send_approved_by, ediel_first_live_send_approved_by),
         ediel_first_live_send_approved_at = coalesce(new.first_live_send_approved_at, ediel_first_live_send_approved_at),
         updated_at = now()
   where id = new.company_id;

  return new;
end;
$$;

revoke all on function public.canonical_sync_company_ediel_projection_v1() from public, anon, authenticated;
grant execute on function public.canonical_sync_company_ediel_projection_v1() to service_role;

drop trigger if exists ediel_production_state_sync_company_projection on public.ediel_production_state;
create trigger ediel_production_state_sync_company_projection
after insert or update of state, approved_by, approved_at, paused_by, paused_at, pause_reason, blocked_reason, first_live_send_approved_by, first_live_send_approved_at
on public.ediel_production_state
for each row execute function public.canonical_sync_company_ediel_projection_v1();

create or replace function public.canonical_enforce_company_ediel_projection_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.ediel_production_state%rowtype;
  v_projection_status text;
begin
  select * into v_state
    from public.ediel_production_state
   where company_id = new.id;

  if not found then
    return new;
  end if;

  v_projection_status := case v_state.state
    when 'live' then 'live'
    when 'paused' then 'paused'
    when 'blocked' then 'blocked'
    when 'prepared' then 'production_prepared'
    when 'retired' then 'blocked'
    when 'configuring' then 'not_ready'
    when 'disabled' then 'not_ready'
    else 'not_ready'
  end;

  new.production_status := v_projection_status;
  new.ediel_production_status := v_projection_status;
  new.live_ediel_enabled := v_state.state = 'live';
  new.ediel_production_enabled := v_state.state = 'live';

  if v_state.state = 'live' then
    new.operating_environment := 'production';
    new.live_blocked_reason := null;
  elsif v_state.state = 'prepared' then
    new.live_blocked_reason := null;
  elsif v_state.state = 'blocked' then
    new.live_blocked_reason := v_state.blocked_reason;
  elsif v_state.state = 'paused' then
    new.live_blocked_reason := coalesce(v_state.pause_reason, v_state.blocked_reason);
  elsif v_state.state = 'retired' then
    new.live_blocked_reason := coalesce(v_state.blocked_reason, 'ediel_production_retired');
  end if;

  return new;
end;
$$;

revoke all on function public.canonical_enforce_company_ediel_projection_v1() from public, anon, authenticated;
grant execute on function public.canonical_enforce_company_ediel_projection_v1() to service_role;

drop trigger if exists companies_enforce_canonical_ediel_projection on public.companies;
create trigger companies_enforce_canonical_ediel_projection
before insert or update of production_status, ediel_production_status, live_ediel_enabled, ediel_production_enabled, operating_environment, live_blocked_reason
on public.companies
for each row execute function public.canonical_enforce_company_ediel_projection_v1();

update public.companies c
   set production_status = case eps.state
         when 'live' then 'live'
         when 'paused' then 'paused'
         when 'blocked' then 'blocked'
         when 'prepared' then 'production_prepared'
         when 'retired' then 'blocked'
         else 'not_ready'
       end,
       ediel_production_status = case eps.state
         when 'live' then 'live'
         when 'paused' then 'paused'
         when 'blocked' then 'blocked'
         when 'prepared' then 'production_prepared'
         when 'retired' then 'blocked'
         else 'not_ready'
       end,
       live_ediel_enabled = eps.state = 'live',
       ediel_production_enabled = eps.state = 'live',
       operating_environment = case when eps.state = 'live' then 'production' else c.operating_environment end,
       live_blocked_reason = case
         when eps.state = 'blocked' then eps.blocked_reason
         when eps.state = 'paused' then coalesce(eps.pause_reason, eps.blocked_reason)
         when eps.state = 'retired' then coalesce(eps.blocked_reason, 'ediel_production_retired')
         when eps.state in ('prepared', 'live') then null
         else c.live_blocked_reason
       end,
       updated_at = now()
  from public.ediel_production_state eps
 where eps.company_id = c.id;

create or replace view public.gridex_automation_control_center_v as
select
  c.id as company_id,
  c.name as company_name,
  coalesce(c.status, 'active'::text) as company_status,
  case eps.state
    when 'live' then 'live'
    when 'paused' then 'paused'
    when 'blocked' then 'blocked'
    when 'prepared' then 'production_prepared'
    when 'retired' then 'blocked'
    when 'configuring' then 'not_ready'
    when 'disabled' then 'not_ready'
    else coalesce(c.production_status, 'not_ready'::text)
  end as production_status,
  case when eps.company_id is not null then eps.state = 'live' else coalesce(c.live_ediel_enabled, false) end as live_ediel_enabled,
  coalesce(public.gridex_company_go_live_readiness(c.id) ->> 'status', 'blocked'::text) as go_live_readiness,
  coalesce((select count(*) from public.customer_cases cc where cc.company_id = c.id and coalesce(cc.status, '') <> all(array['closed'::text, 'resolved'::text])), 0::bigint) as open_case_count,
  coalesce((select count(*) from public.outbound_requests o where o.company_id = c.id and coalesce(o.status, '') = any(array['draft'::text, 'queued'::text, 'failed'::text, 'blocked'::text])), 0::bigint) as unresolved_outbound_count,
  coalesce((select count(*) from public.billing_export_run_items bei where bei.company_id = c.id and bei.status = 'blocked'), 0::bigint) as blocked_billing_rows,
  coalesce((select count(*) from public.partner_exports pe where pe.company_id = c.id and coalesce(pe.status, '') = any(array['failed'::text, 'blocked'::text])), 0::bigint) as failed_partner_exports,
  c.updated_at
from public.companies c
left join public.ediel_production_state eps on eps.company_id = c.id
where coalesce(c.status, '') <> 'deleted_test_only';

create or replace view public.gridex_batch_2b_live_control_tower_v as
select
  c.id as company_id,
  c.name as company_name,
  c.status as company_status,
  case eps.state
    when 'live' then 'live'
    when 'paused' then 'paused'
    when 'blocked' then 'blocked'
    when 'prepared' then 'production_prepared'
    when 'retired' then 'blocked'
    when 'configuring' then 'not_ready'
    when 'disabled' then 'not_ready'
    else c.production_status
  end as production_status,
  case when eps.company_id is not null then eps.state = 'live' else c.live_ediel_enabled end as live_ediel_enabled,
  coalesce((select count(*) from public.outbound_requests o where o.company_id = c.id and o.status = any(array['failed'::text, 'queued'::text, 'prepared'::text])), 0::bigint)::integer as open_outbound_count,
  coalesce((select count(*) from public.customer_cases cc where cc.company_id = c.id and cc.status <> all(array['resolved'::text, 'closed'::text, 'cancelled'::text])), 0::bigint)::integer as open_case_count,
  coalesce((select count(*) from public.billing_export_run_items bei where bei.company_id = c.id and bei.status = 'blocked'), 0::bigint)::integer as blocked_export_rows,
  coalesce((select count(*) from public.billing_import_rows bir where bir.company_id = c.id and bir.status = 'failed'), 0::bigint)::integer as failed_import_rows,
  coalesce((select count(*) from public.operations_automation_runs ar where ar.company_id = c.id), 0::bigint)::integer as automation_run_count,
  coalesce((select max(ar.created_at) from public.operations_automation_runs ar where ar.company_id = c.id), null::timestamptz) as last_automation_run_at,
  c.updated_at
from public.companies c
left join public.ediel_production_state eps on eps.company_id = c.id;

create or replace view public.gridex_batch_2c_control_tower_summary_v as
select
  c.id as company_id,
  c.name as company_name,
  coalesce((select count(*) from public.gridex_batch_2c_drift_queue_v q where q.company_id = c.id), 0::bigint)::integer as open_queue_count,
  coalesce((select count(*) from public.gridex_batch_2c_drift_queue_v q where q.company_id = c.id and q.severity = 'critical'), 0::bigint)::integer as critical_queue_count,
  coalesce((select count(*) from public.metering_period_gaps g where g.company_id = c.id and g.status = any(array['open'::text, 'request_queued'::text, 'waiting_for_data'::text, 'failed'::text])), 0::bigint)::integer as open_metering_gap_count,
  coalesce((select count(*) from public.billing_export_run_items bei where bei.company_id = c.id and bei.status = 'blocked'), 0::bigint)::integer as blocked_export_row_count,
  coalesce((select count(*) from public.external_contract_intakes eci where eci.company_id = c.id and eci.status = any(array['received'::text, 'needs_review'::text, 'failed'::text])), 0::bigint)::integer as open_external_intake_count,
  coalesce((select count(*) from public.customer_portal_completions cpc where cpc.company_id = c.id and cpc.status = any(array['submitted'::text, 'in_review'::text])), 0::bigint)::integer as open_portal_completion_count,
  case eps.state
    when 'live' then 'live'
    when 'paused' then 'paused'
    when 'blocked' then 'blocked'
    when 'prepared' then 'production_prepared'
    when 'retired' then 'blocked'
    when 'configuring' then 'not_ready'
    when 'disabled' then 'not_ready'
    else c.production_status
  end as production_status,
  case when eps.company_id is not null then eps.state = 'live' else c.live_ediel_enabled end as live_ediel_enabled,
  c.updated_at
from public.companies c
left join public.ediel_production_state eps on eps.company_id = c.id;

comment on function public.canonical_sync_company_ediel_projection_v1() is
  'Projects canonical ediel_production_state into legacy company compatibility fields after every canonical state change.';
comment on function public.canonical_enforce_company_ediel_projection_v1() is
  'Prevents direct legacy company-field writes from drifting away from canonical ediel_production_state when a canonical state row exists.';
