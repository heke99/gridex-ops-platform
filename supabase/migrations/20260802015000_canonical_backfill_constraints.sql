-- Canonical hardening preflight, conditional constraint validation and queue blockers.

begin;

alter table public.ediel_outbox
  add column if not exists blocked_reason text,
  add column if not exists blocked_at timestamptz,
  add column if not exists company_status_snapshot text;

alter table public.ediel_outbox drop constraint if exists ediel_outbox_status_check;
alter table public.ediel_outbox add constraint ediel_outbox_status_check
  check(status in (
    'draft','prepared','queued','sending','sent','failed','superseded',
    'blocked','blocked_tenant_state','delivery_uncertain'
  ));

create table if not exists public.ediel_active_test_configurations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null default 'test',
  test_suite text not null,
  actor_role text not null,
  message_family text not null,
  setup_package text not null,
  configuration_snapshot_id uuid not null references public.ediel_configuration_snapshots(id) on delete restrict,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ediel_active_test_configurations_status_check check(status in ('active','inactive','archived'))
);
create unique index if not exists ediel_active_test_configurations_active_key
  on public.ediel_active_test_configurations(
    company_id,environment,test_suite,actor_role,message_family,setup_package
  ) where status='active';

alter table public.ediel_active_test_configurations enable row level security;
drop policy if exists ediel_active_test_configurations_service_role_all on public.ediel_active_test_configurations;
create policy ediel_active_test_configurations_service_role_all on public.ediel_active_test_configurations
for all to service_role using(true) with check(true);
drop policy if exists ediel_active_test_configurations_tenant_read on public.ediel_active_test_configurations;
create policy ediel_active_test_configurations_tenant_read on public.ediel_active_test_configurations
for select to authenticated using(public.gridex_can_read_company(company_id));
grant all on public.ediel_active_test_configurations to service_role;
grant select on public.ediel_active_test_configurations to authenticated;

-- Keep both legacy Application Reference columns synchronized during cutover.
update public.ediel_actor_settings
set application_reference=default_application_reference
where application_reference is null and default_application_reference is not null;
update public.ediel_actor_settings
set default_application_reference=application_reference
where default_application_reference is null and application_reference is not null;

insert into public.ediel_tenant_relation_quarantine(
  source_table,source_id,reason_code,source_company_id,payload
)
select 'ediel_actor_settings',id,'application_reference_mismatch',company_id,
  jsonb_build_object('application_reference',application_reference,
    'default_application_reference',default_application_reference)
from public.ediel_actor_settings
where application_reference is distinct from default_application_reference
  and application_reference is not null and default_application_reference is not null
on conflict do nothing;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='ediel_actor_settings_application_reference_sync_v2') then
    alter table public.ediel_actor_settings
      add constraint ediel_actor_settings_application_reference_sync_v2
      check(application_reference is not distinct from default_application_reference) not valid;
  end if;
end $$;

create table if not exists public.canonical_migration_manifest (
  version text not null,
  filename text not null,
  checksum text,
  applied_environment text,
  registered_at timestamptz not null default now(),
  registered_by uuid references auth.users(id) on delete set null,
  primary key(version,filename)
);

create table if not exists public.canonical_hardening_preflight_results (
  id uuid primary key default gen_random_uuid(),
  check_key text not null,
  status text not null,
  affected_rows bigint not null default 0,
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  constraint canonical_hardening_preflight_results_status_check
    check(status in ('pass','blocked','warning','error'))
);

create or replace function public.canonical_run_hardening_preflight()
returns table(check_key text,status text,affected_rows bigint,details jsonb)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  truncate public.canonical_hardening_preflight_results;

  insert into public.canonical_hardening_preflight_results(check_key,status,affected_rows,details)
  select 'companies_noncanonical_status',case when count(*)=0 then 'pass' else 'blocked' end,count(*),
    jsonb_build_object('action','review_each_tenant_status_without_active_fallback')
  from public.companies c
  where c.status is null or c.status not in (
    'onboarding','active','paused','suspended','archived','pending_deletion','closed','deleted_test_only'
  );

  insert into public.canonical_hardening_preflight_results(check_key,status,affected_rows,details)
  select 'ediel_test_runs_missing_company',case when count(*)=0 then 'pass' else 'blocked' end,count(*),
    jsonb_build_object('action','quarantine_and_resolve_without_guessing')
  from public.ediel_test_runs where company_id is null;

  insert into public.canonical_hardening_preflight_results(check_key,status,affected_rows,details)
  select 'ediel_test_run_messages_missing_company',case when count(*)=0 then 'pass' else 'blocked' end,count(*),
    jsonb_build_object('action','review_ediel_tenant_relation_quarantine')
  from public.ediel_test_run_messages where company_id is null;

  insert into public.canonical_hardening_preflight_results(check_key,status,affected_rows,details)
  select 'cross_tenant_run_message',case when count(*)=0 then 'pass' else 'blocked' end,count(*),
    jsonb_build_object('invariant','run_message_company_ids_must_match')
  from public.ediel_test_run_messages trm
  join public.ediel_test_runs r on r.id=trm.test_run_id
  join public.ediel_messages m on m.id=trm.ediel_message_id
  where trm.company_id is distinct from r.company_id or trm.company_id is distinct from m.company_id;

  insert into public.canonical_hardening_preflight_results(check_key,status,affected_rows,details)
  select 'application_reference_mismatch',case when count(*)=0 then 'pass' else 'blocked' end,count(*),
    jsonb_build_object('action','resolve_canonical_application_reference')
  from public.ediel_actor_settings
  where application_reference is distinct from default_application_reference;

  insert into public.canonical_hardening_preflight_results(check_key,status,affected_rows,details)
  select 'production_without_snapshot',case when count(*)=0 then 'pass' else 'blocked' end,count(*),
    jsonb_build_object('action','capture_snapshot_and_rerun_readiness_dry_run')
  from public.ediel_production_state
  where state in ('prepared','live') and configuration_snapshot_id is null;

  return query select r.check_key,r.status,r.affected_rows,r.details
  from public.canonical_hardening_preflight_results r order by r.check_key;
end;
$$;

revoke all on function public.canonical_run_hardening_preflight() from public,anon,authenticated;
grant execute on function public.canonical_run_hardening_preflight() to service_role;

select * from public.canonical_run_hardening_preflight();

-- Validate only clean relations. Dirty historical rows remain quarantined and
-- the migration continues without pretending validation succeeded.
do $$
declare v_constraint text;
begin
  for v_constraint in select unnest(array[
    'companies_canonical_status_check',
    'ediel_test_runs_company_id_required_v2',
    'ediel_test_run_messages_company_id_required_v2',
    'ediel_test_run_steps_company_id_required_v2',
    'ediel_test_artifacts_company_id_required_v2',
    'ediel_test_run_messages_company_run_fk_v2',
    'ediel_test_run_messages_company_message_fk_v2',
    'ediel_test_run_steps_company_run_fk_v2',
    'ediel_test_artifacts_company_run_fk_v2',
    'ediel_actor_settings_application_reference_sync_v2',
    'ediel_production_state_configuration_snapshot_fk'
  ]) loop
    begin
      execute format('alter table public.%I validate constraint %I',
        case
          when v_constraint like 'companies_%' then 'companies'
          when v_constraint like 'ediel_test_runs_%' then 'ediel_test_runs'
          when v_constraint like 'ediel_test_run_messages_%' then 'ediel_test_run_messages'
          when v_constraint like 'ediel_test_run_steps_%' then 'ediel_test_run_steps'
          when v_constraint like 'ediel_test_artifacts_%' then 'ediel_test_artifacts'
          when v_constraint like 'ediel_actor_settings_%' then 'ediel_actor_settings'
          else 'ediel_production_state'
        end,
        v_constraint
      );
    exception when others then
      insert into public.canonical_hardening_preflight_results(check_key,status,affected_rows,details)
      values('constraint_validation:'||v_constraint,'blocked',0,jsonb_build_object('error',sqlerrm));
    end;
  end loop;
end $$;

-- Promote to physical NOT NULL only when the historical data is already clean.
do $$
declare v_table text; v_count bigint;
begin
  foreach v_table in array array['ediel_test_runs','ediel_test_run_messages','ediel_test_run_steps','ediel_test_artifacts'] loop
    execute format('select count(*) from public.%I where company_id is null',v_table) into v_count;
    if v_count=0 then
      execute format('alter table public.%I alter column company_id set not null',v_table);
    else
      insert into public.canonical_hardening_preflight_results(check_key,status,affected_rows,details)
      values(v_table||':company_id_not_null','blocked',v_count,
        jsonb_build_object('reason','ambiguous_legacy_rows_were_not_guessed'));
    end if;
  end loop;
end $$;

-- External queues retain blocked rows instead of deleting or retrying them.
alter table public.tenant_email_outbox
  add column if not exists blocked_reason text,
  add column if not exists blocked_at timestamptz,
  add column if not exists company_status_snapshot text;
alter table public.tenant_email_outbox drop constraint if exists tenant_email_outbox_status_check;
alter table public.tenant_email_outbox add constraint tenant_email_outbox_status_check
  check(status in ('queued','processing','delivery_uncertain','sent','failed','cancelled','blocked_tenant_state'));

alter table public.webhook_deliveries
  add column if not exists blocked_reason text,
  add column if not exists blocked_at timestamptz,
  add column if not exists company_status_snapshot text;
alter table public.webhook_deliveries drop constraint if exists webhook_deliveries_status_check;
alter table public.webhook_deliveries add constraint webhook_deliveries_status_check
  check(status in ('queued','processing','sent','failed','dead_letter','skipped','blocked_tenant_state'));

-- Conservative capability backfill from explicit operational evidence only.
update public.company_capabilities cc set enabled=true,readiness_status='ready',updated_at=now()
where cc.capability_code='ediel_test' and exists(
  select 1 from public.ediel_actor_settings a
  where a.company_id=cc.company_id and a.environment='test' and a.is_active=true and coalesce(a.actor_ediel_id,a.ediel_id) is not null
);
update public.company_capabilities cc set enabled=true,readiness_status='ready',updated_at=now()
where cc.capability_code='ediel_production' and exists(
  select 1 from public.ediel_production_state ps where ps.company_id=cc.company_id and ps.state='live'
);
update public.company_capabilities cc set enabled=true,readiness_status='ready',updated_at=now()
where cc.capability_code='webhooks' and exists(
  select 1 from public.webhook_subscriptions ws where ws.company_id=cc.company_id and ws.status='active'
);
update public.company_capabilities cc set enabled=true,readiness_status='ready',updated_at=now()
where cc.capability_code='email_outbound' and exists(
  select 1 from public.company_email_settings es
  where es.company_id=cc.company_id
    and coalesce(es.is_active,false)=true
    and coalesce(es.verification_status,'') in ('verified','success')
    and nullif(btrim(es.sender_email),'') is not null
);

commit;
