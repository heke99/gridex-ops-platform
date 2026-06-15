-- Platform go-live cleanup: tenant-owned Ediel identity, automatic receiver resolution,
-- shared mailbox transport and global message-center readiness.
-- Additive/idempotent only. Does not delete or rewrite approved Ediel flows.

begin;

create extension if not exists pgcrypto;

alter table if exists public.companies
  add column if not exists ediel_id text,
  add column if not exists production_ediel_id text,
  add column if not exists production_sender_sub_address text,
  add column if not exists production_application_reference text,
  add column if not exists production_mailbox text,
  add column if not exists production_counterparty_ediel_id text,
  add column if not exists ediel_route_resolution_mode text not null default 'automatic',
  add column if not exists ediel_shared_transport_mode text not null default 'shared_platform_mailbox',
  add column if not exists ediel_customer_intake_edifact_mode text not null default 'auto_after_readiness',
  add column if not exists ediel_manual_receiver_locked boolean not null default true,
  add column if not exists ediel_go_live_notes text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if to_regclass('public.companies') is not null then
    if not exists (select 1 from pg_constraint where conname = 'companies_ediel_route_resolution_mode_chk') then
      alter table public.companies
        add constraint companies_ediel_route_resolution_mode_chk check (ediel_route_resolution_mode in ('automatic','manual_review_required','disabled'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'companies_ediel_shared_transport_mode_chk') then
      alter table public.companies
        add constraint companies_ediel_shared_transport_mode_chk check (ediel_shared_transport_mode in ('shared_platform_mailbox','company_specific_mailbox','disabled'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'companies_ediel_customer_intake_edifact_mode_chk') then
      alter table public.companies
        add constraint companies_ediel_customer_intake_edifact_mode_chk check (ediel_customer_intake_edifact_mode in ('auto_after_readiness','manual_review_first','disabled'));
    end if;
  end if;
end $$;

alter table if exists public.ediel_route_profiles
  add column if not exists receiver_source text,
  add column if not exists dynamic_receiver_strategy text,
  add column if not exists receiver_message_subaddress text,
  add column if not exists transport_mode text,
  add column if not exists is_production_route boolean not null default false,
  add column if not exists allow_unencrypted_production boolean not null default false,
  add column if not exists certificate_required boolean not null default false,
  add column if not exists receiver_certificate_id uuid,
  add column if not exists security_policy_status text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.ediel_route_profiles
   set receiver_source = coalesce(receiver_source, case when receiver_ediel_id is null then 'selected_metering_point_grid_owner' else 'fixed_counterparty' end),
       dynamic_receiver_strategy = coalesce(dynamic_receiver_strategy, case when receiver_ediel_id is null then 'resolve_from_selected_metering_point_grid_owner' else 'resolve_from_counterparty_id' end),
       transport_mode = coalesce(transport_mode, 'shared_platform_mailbox'),
       is_production_route = case when environment = 'production' then true else coalesce(is_production_route, false) end,
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('manualReceiverLockedByDefault', true)
 where to_regclass('public.ediel_route_profiles') is not null;

create index if not exists ediel_route_profiles_go_live_auto_idx
  on public.ediel_route_profiles(company_id, environment, message_family, receiver_source, is_enabled, is_active)
  where coalesce(is_enabled, true) = true and coalesce(is_active, true) = true;

create index if not exists ediel_messages_platform_center_idx
  on public.ediel_messages(company_id, environment, direction, message_family, status, created_at desc);

create table if not exists public.platform_go_live_route_simulations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  message_family text not null default 'PRODAT',
  process_type text not null default 'supplier_switch',
  receiver_source text,
  counterparty_ediel_id text,
  route_profile_id uuid,
  status text not null default 'simulated',
  blockers text[] not null default '{}'::text[],
  warnings text[] not null default '{}'::text[],
  decision jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists platform_go_live_route_simulations_company_idx
  on public.platform_go_live_route_simulations(company_id, created_at desc);

create or replace function public.gridex_resolve_ediel_route_for_process(
  p_company_id uuid,
  p_message_family text default 'PRODAT',
  p_process_type text default 'supplier_switch',
  p_receiver_source text default null,
  p_counterparty_ediel_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.ediel_actor_settings%rowtype;
  v_route public.ediel_route_profiles%rowtype;
  v_mailbox public.ediel_mailboxes%rowtype;
  v_sender_ediel_id text;
  v_sender_subaddress text;
  v_receiver_source text;
  v_receiver_ediel_id text;
  v_receiver_subaddress text;
  v_application_reference text;
  v_blockers text[] := '{}'::text[];
  v_warnings text[] := '{}'::text[];
begin
  if p_company_id is null then
    return jsonb_build_object('status','blocked','blockers',jsonb_build_array('missing_company_id'));
  end if;

  select * into v_actor
  from public.ediel_actor_settings a
  where a.company_id = p_company_id
    and a.environment = 'production'
    and coalesce(a.is_active, true) = true
  order by a.updated_at desc nulls last, a.created_at desc nulls last
  limit 1;

  select * into v_route
  from public.ediel_route_profiles r
  where r.company_id = p_company_id
    and r.environment = 'production'
    and coalesce(r.is_enabled, true) = true
    and coalesce(r.is_active, true) = true
    and (
      upper(coalesce(r.message_family, '')) = upper(coalesce(p_message_family, 'PRODAT'))
      or upper(coalesce(r.application_reference, '')) = upper(coalesce(p_message_family, 'PRODAT'))
      or (upper(coalesce(p_message_family, 'PRODAT')) = 'PRODAT' and coalesce(r.message_family, '') = '')
    )
  order by coalesce(r.is_production_route, false) desc, r.updated_at desc nulls last, r.created_at desc nulls last
  limit 1;

  select * into v_mailbox
  from public.ediel_mailboxes m
  where m.environment = 'production'
    and coalesce(m.is_active, true) = true
    and m.company_id is null
  order by m.updated_at desc nulls last, m.created_at desc nulls last
  limit 1;

  v_sender_ediel_id := upper(nullif(btrim(coalesce(v_actor.ediel_id, v_actor.actor_ediel_id, '')), ''));
  v_sender_subaddress := upper(nullif(btrim(coalesce(v_actor.sender_subaddress, v_actor.sender_sub_address, '')), ''));
  v_receiver_source := coalesce(nullif(btrim(p_receiver_source), ''), v_route.receiver_source, 'selected_metering_point_grid_owner');
  v_receiver_ediel_id := upper(nullif(btrim(coalesce(p_counterparty_ediel_id, v_route.receiver_ediel_id, '')), ''));
  v_receiver_subaddress := upper(nullif(btrim(coalesce(v_route.receiver_subaddress, v_route.receiver_sub_address, v_route.receiver_message_subaddress, '')), ''));
  v_application_reference := upper(nullif(btrim(coalesce(v_route.application_reference, p_message_family, 'PRODAT')), ''));

  if v_sender_ediel_id is null then
    v_blockers := array_append(v_blockers, 'missing_tenant_ediel_id');
  end if;
  if v_route.id is null then
    v_blockers := array_append(v_blockers, 'missing_production_route_profile');
  end if;
  if v_mailbox.id is null then
    v_blockers := array_append(v_blockers, 'missing_shared_production_mailbox');
  end if;
  if v_receiver_source in ('fixed_counterparty','manual_superadmin_only') and v_receiver_ediel_id is null then
    v_blockers := array_append(v_blockers, 'missing_fixed_receiver_ediel_id');
  end if;
  if v_receiver_source not in ('fixed_counterparty','manual_superadmin_only') and v_receiver_ediel_id is not null then
    v_warnings := array_append(v_warnings, 'dynamic_route_contains_fixed_receiver');
  end if;
  if upper(coalesce(p_message_family, 'PRODAT')) = 'PRODAT' and coalesce(v_route.allow_unencrypted_production, false) = true then
    v_blockers := array_append(v_blockers, 'prodat_production_must_not_allow_unencrypted_send');
  end if;

  return jsonb_build_object(
    'status', case when cardinality(v_blockers) > 0 then 'blocked' when cardinality(v_warnings) > 0 then 'manual_review_required' else 'ready' end,
    'companyId', p_company_id,
    'messageFamily', upper(coalesce(p_message_family, 'PRODAT')),
    'processType', coalesce(p_process_type, 'supplier_switch'),
    'senderEdielId', v_sender_ediel_id,
    'senderSubaddress', v_sender_subaddress,
    'receiverSource', v_receiver_source,
    'receiverEdielId', v_receiver_ediel_id,
    'receiverSubaddress', v_receiver_subaddress,
    'applicationReference', v_application_reference,
    'routeProfileId', v_route.id,
    'transportMode', case when v_mailbox.id is not null then 'shared_platform_mailbox' else 'missing' end,
    'sharedMailboxId', v_mailbox.id,
    'encryptionRequired', upper(coalesce(p_message_family, 'PRODAT')) = 'PRODAT',
    'manualReceiverAllowed', v_receiver_source in ('fixed_counterparty','manual_superadmin_only'),
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;

create or replace view public.platform_go_live_readiness_v as
select
  c.id as company_id,
  c.name as company_name,
  coalesce(pa.ediel_id, pa.actor_ediel_id, c.production_ediel_id, c.ediel_id) as ediel_id,
  b.brp_ediel_id,
  exists (
    select 1 from public.ediel_actor_settings a
    where a.company_id = c.id and a.environment = 'production' and coalesce(a.is_active, true) = true and coalesce(a.ediel_id, a.actor_ediel_id) is not null
  ) as has_actor_setting,
  exists (
    select 1 from public.ediel_brp_settings brp
    where brp.company_id = c.id and brp.environment = 'production'
  ) as has_brp,
  exists (
    select 1 from public.ediel_route_profiles r
    where r.company_id = c.id and r.environment = 'production' and coalesce(r.is_enabled, true) = true and coalesce(r.is_active, true) = true and upper(coalesce(r.message_family, r.application_reference, '')) = 'PRODAT'
  ) as has_prodat_route,
  exists (
    select 1 from public.ediel_route_profiles r
    where r.company_id = c.id and r.environment = 'production' and coalesce(r.is_enabled, true) = true and coalesce(r.is_active, true) = true and upper(coalesce(r.message_family, r.application_reference, '')) = 'UTILTS'
  ) as has_utilts_route,
  exists (
    select 1 from public.ediel_mailboxes m
    where m.company_id is null and m.environment = 'production' and coalesce(m.is_active, true) = true
  ) as has_shared_mailbox,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'terms' and l.status = 'published') as has_terms,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'privacy_policy' and l.status = 'published') as has_privacy_policy,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'withdrawal' and l.status = 'published') as has_withdrawal,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'power_of_attorney' and l.status = 'published') as has_power_of_attorney_text,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'price_terms' and l.status = 'published') as has_price_terms,
  exists (
    select 1 from public.price_plan_versions ppv
    where ppv.company_id = c.id and ppv.status in ('active','published')
  ) as has_published_contracts,
  exists (
    select 1 from public.company_email_settings s
    where s.company_id = c.id
      and lower(coalesce(s.verification_status, '')) in ('verified','completed','active')
  ) as has_sender_identity,
  public.gridex_resolve_ediel_route_for_process(c.id, 'PRODAT', 'supplier_switch', null, null) as prodat_route_decision,
  now() as evaluated_at
from public.companies c
left join lateral (
  select * from public.ediel_actor_settings a
  where a.company_id = c.id and a.environment = 'production' and coalesce(a.is_active, true) = true
  order by a.updated_at desc nulls last, a.created_at desc nulls last
  limit 1
) pa on true
left join lateral (
  select * from public.ediel_brp_settings brp
  where brp.company_id = c.id and brp.environment = 'production'
  order by brp.is_default desc nulls last, brp.updated_at desc nulls last, brp.created_at desc nulls last
  limit 1
) b on true;

grant select on public.platform_go_live_readiness_v to authenticated;
grant execute on function public.gridex_resolve_ediel_route_for_process(uuid,text,text,text,text) to authenticated;

commit;
