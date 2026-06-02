-- Dual-role Ediel actor profiles and precise runtime environments.
-- Additive/idempotent: keeps legacy environment/test columns for existing runtime.

create extension if not exists pgcrypto;

alter table if exists public.ediel_actor_settings
  add column if not exists environment_type text,
  add column if not exists actor_subrole text,
  add column if not exists sub_role text,
  add column if not exists registered_smtp_address text not null default 'ediel@gridex.se',
  add column if not exists contact_email text,
  add column if not exists test_resource_name text,
  add column if not exists test_resource_email text,
  add column if not exists is_ombud boolean not null default false,
  add column if not exists prodat_enabled boolean not null default true,
  add column if not exists utilts_enabled boolean not null default true,
  add column if not exists approved_it_system_profile_id uuid,
  add column if not exists default_supplier_brp_ediel_id text,
  add column if not exists default_supplier_brp_name text,
  add column if not exists production_mode text not null default 'disabled',
  add column if not exists status text not null default 'active';

update public.ediel_actor_settings
   set environment_type = case
       when environment = 'production' then 'production'
       when coalesce(actor_role, role, '') in ('system_supplier', 'gridex_system_supplier') then 'tgt_test'
       else 'agt_test'
     end
 where to_regclass('public.ediel_actor_settings') is not null
   and coalesce(environment_type, '') = '';

update public.ediel_actor_settings
   set actor_role = case
       when actor_role in ('esco', 'service_provider') then 'energy_service_company'
       else actor_role
     end,
       role = case
       when role in ('esco', 'service_provider') then 'energy_service_company'
       else role
     end,
       actor_subrole = coalesce(
         nullif(actor_subrole, ''),
         nullif(sub_role, ''),
         case
           when coalesce(actor_role, role, '') in ('energy_service_company', 'esco', 'service_provider') then 'DGI'
           when coalesce(actor_role, role, '') = 'supplier' then 'DDQ'
           else null
         end
       ),
       sub_role = coalesce(
         nullif(sub_role, ''),
         nullif(actor_subrole, ''),
         case
           when coalesce(actor_role, role, '') in ('energy_service_company', 'esco', 'service_provider') then 'DGI'
           when coalesce(actor_role, role, '') = 'supplier' then 'DDQ'
           else null
         end
       ),
       registered_smtp_address = coalesce(nullif(registered_smtp_address, ''), nullif(smtp_from_email, ''), 'ediel@gridex.se'),
       contact_email = coalesce(nullif(contact_email, ''), nullif(smtp_reply_to_email, '')),
       default_supplier_brp_ediel_id = coalesce(nullif(default_supplier_brp_ediel_id, ''), nullif(brp_ediel_id, '')),
       default_supplier_brp_name = coalesce(nullif(default_supplier_brp_name, ''), nullif(brp_name, ''))
 where to_regclass('public.ediel_actor_settings') is not null;

alter table if exists public.ediel_route_profiles
  add column if not exists environment_type text,
  add column if not exists actor_setting_id uuid,
  add column if not exists actor_profile_id uuid,
  add column if not exists actor_role text,
  add column if not exists actor_subrole text,
  add column if not exists default_brp_ediel_id text,
  add column if not exists message_family text,
  add column if not exists business_code text,
  add column if not exists transport_mode text not null default 'smtp_imap',
  add column if not exists smtp_from text,
  add column if not exists smtp_to text,
  add column if not exists signing_mode text not null default 'none',
  add column if not exists tls_required boolean not null default true,
  add column if not exists allow_unencrypted_test boolean not null default true,
  add column if not exists allow_unencrypted_production boolean not null default false,
  add column if not exists security_policy_status text not null default 'not_checked';

update public.ediel_route_profiles
   set environment_type = case
       when environment = 'production' then 'production'
       when coalesce(application_reference, '') ilike '%TGT%' then 'tgt_test'
       else 'agt_test'
     end,
       actor_profile_id = coalesce(actor_profile_id, actor_setting_id),
       actor_role = case
         when actor_role in ('esco', 'service_provider') then 'energy_service_company'
         else actor_role
       end,
       actor_subrole = coalesce(
         nullif(actor_subrole, ''),
         case
           when coalesce(actor_role, '') in ('energy_service_company', 'esco', 'service_provider') or coalesce(application_reference, '') ilike '%DGI%' then 'DGI'
           when coalesce(actor_role, '') = 'supplier' or coalesce(application_reference, '') ilike '%DDQ%' then 'DDQ'
           else null
         end
       ),
       smtp_from = coalesce(nullif(smtp_from, ''), nullif(mailbox, ''), 'ediel@gridex.se'),
       receiver_message_subaddress = coalesce(nullif(receiver_message_subaddress, ''), nullif(receiver_subaddress, ''), nullif(receiver_sub_address, '')),
       default_brp_ediel_id = nullif(default_brp_ediel_id, '')
 where to_regclass('public.ediel_route_profiles') is not null;

alter table if exists public.ediel_test_runs
  add column if not exists environment_type text,
  add column if not exists actor_profile_id uuid,
  add column if not exists actor_subrole text,
  add column if not exists route_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists actor_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists security_snapshot jsonb not null default '{}'::jsonb;

update public.ediel_test_runs
   set environment_type = case
       when coalesce(environment, '') = 'production' or production_like = true then 'production'
       when coalesce(approval_version, test_suite, '') ilike '%TGT%' then 'tgt_test'
       else 'agt_test'
     end,
       actor_subrole = coalesce(
         nullif(actor_subrole, ''),
         case
           when role_code in ('esco', 'energy_service_company') then 'DGI'
           when role_code = 'supplier' then 'DDQ'
           else null
         end
       )
 where to_regclass('public.ediel_test_runs') is not null
   and coalesce(environment_type, '') = '';

do $$
begin
  if to_regclass('public.ediel_actor_settings') is not null
     and to_regclass('public.ediel_it_system_profiles') is not null
     and not exists (
       select 1 from pg_constraint where conname = 'ediel_actor_settings_it_system_profile_fkey'
     ) then
    alter table public.ediel_actor_settings
      add constraint ediel_actor_settings_it_system_profile_fkey
      foreign key (approved_it_system_profile_id)
      references public.ediel_it_system_profiles(id)
      on delete set null;
  end if;

  if to_regclass('public.ediel_route_profiles') is not null
     and to_regclass('public.ediel_actor_settings') is not null
     and not exists (
       select 1 from pg_constraint where conname = 'ediel_route_profiles_actor_profile_fkey'
     ) then
    alter table public.ediel_route_profiles
      add constraint ediel_route_profiles_actor_profile_fkey
      foreign key (actor_profile_id)
      references public.ediel_actor_settings(id)
      on delete set null;
  end if;

  if to_regclass('public.ediel_test_runs') is not null
     and to_regclass('public.ediel_actor_settings') is not null
     and not exists (
       select 1 from pg_constraint where conname = 'ediel_test_runs_actor_profile_fkey'
     ) then
    alter table public.ediel_test_runs
      add constraint ediel_test_runs_actor_profile_fkey
      foreign key (actor_profile_id)
      references public.ediel_actor_settings(id)
      on delete set null;
  end if;
end $$;

create index if not exists ediel_actor_settings_dual_role_idx
  on public.ediel_actor_settings(company_id, environment_type, actor_role, actor_subrole, is_active);

create unique index if not exists ediel_actor_settings_company_role_subrole_env_uidx
  on public.ediel_actor_settings(company_id, environment_type, actor_role, coalesce(actor_subrole, ''))
  where is_active = true and company_id is not null;

create index if not exists ediel_route_profiles_dual_role_route_idx
  on public.ediel_route_profiles(company_id, environment_type, actor_role, actor_subrole, message_family, business_code);

create index if not exists ediel_test_runs_environment_type_idx
  on public.ediel_test_runs(company_id, environment_type, role_code, actor_subrole, test_suite, test_case_code, created_at desc);

alter table if exists public.ediel_messages
  add column if not exists environment_type text;

update public.ediel_messages
   set environment_type = case
       when environment = 'production' then 'production'
       when coalesce(test_flag, 1) = 1 then 'agt_test'
       else 'agt_test'
     end
 where to_regclass('public.ediel_messages') is not null
   and coalesce(environment_type, '') = '';

create index if not exists ediel_messages_environment_type_idx
  on public.ediel_messages(company_id, environment_type, direction, message_family, message_code, created_at desc);
