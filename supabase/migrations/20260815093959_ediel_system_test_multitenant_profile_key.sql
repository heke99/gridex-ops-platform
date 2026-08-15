begin;

-- A tenant may participate in several Ediel roles and run several test packages
-- in parallel. AGT/TGT alone is therefore not a sufficient runtime identity.
drop index if exists public.ediel_system_test_settings_one_active_per_suite_idx;

create unique index if not exists ediel_system_test_settings_one_active_per_profile_idx
  on public.ediel_system_test_settings (
    company_id,
    environment,
    test_suite,
    lower(coalesce(actor_role, '')),
    upper(coalesce(message_family, '')),
    coalesce(setup_package, ''),
    coalesce(environment_type, '')
  )
  where is_active = true;

create index if not exists ediel_system_test_settings_runtime_lookup_idx
  on public.ediel_system_test_settings (
    company_id,
    environment,
    test_suite,
    actor_role,
    message_family,
    setup_package,
    environment_type,
    is_active,
    updated_at desc
  );

comment on index public.ediel_system_test_settings_one_active_per_profile_idx is
  'Canonical multitenant Ediel system-test identity: tenant + environment + logical suite + actor role + message family + setup package + environment type.';

commit;
