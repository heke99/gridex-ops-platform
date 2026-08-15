-- Align BRP runtime schema with the application/readiness model.
-- is_active is tenant-scoped and defaults to true for existing/current records.

alter table public.ediel_brp_settings
  add column if not exists is_active boolean not null default true;

update public.ediel_brp_settings
set is_active = false,
    updated_at = now()
where is_active = true
  and valid_to is not null
  and valid_to < current_date;

create index if not exists idx_ediel_brp_settings_company_environment_active
  on public.ediel_brp_settings(company_id, environment, is_default desc, updated_at desc)
  where is_active = true;
