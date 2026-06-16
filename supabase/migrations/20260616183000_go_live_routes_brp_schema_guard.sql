-- Go-live routes and BRP schema guard.
-- Keeps production route wizard/runtime compatible with historical DBs where
-- ediel_route_profiles used is_enabled as the only active flag.

do $$
begin
  if to_regclass('public.ediel_route_profiles') is not null then
    alter table public.ediel_route_profiles
      add column if not exists is_active boolean not null default true,
      add column if not exists message_family text,
      add column if not exists receiver_source text,
      add column if not exists dynamic_receiver_strategy text,
      add column if not exists transport_mode text,
      add column if not exists mailbox_id uuid,
      add column if not exists production_mode text not null default 'disabled',
      add column if not exists is_production_route boolean not null default false,
      add column if not exists allow_unencrypted_production boolean not null default false,
      add column if not exists signing_mode text not null default 'none',
      add column if not exists tls_required boolean not null default true;

    update public.ediel_route_profiles
       set is_active = coalesce(is_active, is_enabled, true),
           message_family = coalesce(message_family, upper(application_reference)),
           receiver_source = coalesce(receiver_source, case when receiver_ediel_id is null then 'selected_metering_point_grid_owner' else 'fixed_counterparty' end),
           dynamic_receiver_strategy = coalesce(dynamic_receiver_strategy, case when receiver_ediel_id is null then 'resolve_from_selected_metering_point_grid_owner' else 'resolve_from_counterparty_id' end),
           transport_mode = coalesce(transport_mode, case when mailbox_id is not null or mailbox is not null then 'shared_platform_mailbox' else null end),
           is_production_route = case when environment = 'production' then true else coalesce(is_production_route, false) end;

    create index if not exists ediel_route_profiles_company_env_family_active_idx
      on public.ediel_route_profiles(company_id, environment, message_family, updated_at desc)
      where coalesce(is_enabled, true) = true and coalesce(is_active, true) = true;
  end if;

  if to_regclass('public.ediel_brp_settings') is not null then
    create index if not exists ediel_brp_settings_company_production_default_idx
      on public.ediel_brp_settings(company_id, environment, is_default, updated_at desc)
      where environment = 'production';
  end if;
end $$;
