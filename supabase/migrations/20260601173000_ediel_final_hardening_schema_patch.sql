-- Final Ediel hardening schema patch.
-- Additive/idempotent repair for actor subaddresses, transport source-of-truth and audit-safe send lock fields.

begin;

create extension if not exists pgcrypto;

alter table if exists public.ediel_actor_settings
  add column if not exists sender_subaddress_prodat text,
  add column if not exists sender_subaddress_utilts text,
  add column if not exists default_transport_channel text,
  add column if not exists transport_profile_id uuid,
  add column if not exists production_send_lock_enabled boolean not null default true,
  add column if not exists first_production_send_approved boolean not null default false,
  add column if not exists first_production_message_id uuid,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

update public.ediel_actor_settings
   set sender_subaddress_prodat = coalesce(nullif(sender_subaddress_prodat, ''), nullif(sender_subaddress, ''), nullif(sender_sub_address, '')),
       sender_subaddress_utilts = coalesce(nullif(sender_subaddress_utilts, ''), nullif(sender_subaddress, ''), nullif(sender_sub_address, '')),
       default_transport_channel = coalesce(nullif(default_transport_channel, ''), case when nullif(mailbox, '') is not null then 'smtp' end),
       ediel_id = coalesce(nullif(ediel_id, ''), nullif(actor_ediel_id, '')),
       legal_name = coalesce(nullif(legal_name, ''), nullif(actor_name, ''))
 where to_regclass('public.ediel_actor_settings') is not null;

alter table if exists public.ediel_routing_decisions
  add column if not exists customer_site_id uuid,
  add column if not exists supplier_switch_request_id uuid,
  add column if not exists data_request_id uuid,
  add column if not exists outbound_request_id uuid,
  add column if not exists inbound_message_id uuid,
  add column if not exists counterparty_id uuid,
  add column if not exists receiver_name text,
  add column if not exists receiver_role text,
  add column if not exists resolved_from jsonb not null default '{}'::jsonb;

create index if not exists ediel_actor_settings_company_environment_active_idx
  on public.ediel_actor_settings(company_id, environment, is_active, updated_at desc);

create index if not exists ediel_routing_decisions_context_idx
  on public.ediel_routing_decisions(company_id, environment, message_family, message_code, created_at desc);

-- Keep production identities isolated. Skip index creation if the live database already contains conflicts.
do $$
begin
  if to_regclass('public.ediel_actor_settings') is null then
    return;
  end if;

  if not exists (
    select 1
      from public.ediel_actor_settings
     where environment = 'production'
       and coalesce(is_active, true) = true
       and nullif(coalesce(ediel_id, actor_ediel_id), '') is not null
     group by environment, upper(coalesce(ediel_id, actor_ediel_id))
     having count(distinct company_id) > 1
  ) then
    create unique index if not exists ediel_actor_settings_unique_active_production_ediel_v2_idx
      on public.ediel_actor_settings(environment, upper(coalesce(ediel_id, actor_ediel_id)))
      where environment = 'production'
        and coalesce(is_active, true) = true
        and nullif(coalesce(ediel_id, actor_ediel_id), '') is not null;
  end if;
end $$;

commit;
