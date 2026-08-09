-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260722133000_external_tenant_quote_api_completion.sql
-- Restores only the stable external tenant reference required by tracked public
-- contract snapshot migrations. It creates no tenants or integration records.

create or replace function public.gridex_new_external_tenant_reference()
returns text
language sql
volatile
set search_path=public,pg_catalog,pg_temp
as $$
  select 'tenant_'
    || replace(gen_random_uuid()::text, '-', '')
    || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)
$$;

alter table public.companies
  add column if not exists external_tenant_reference text;

update public.companies
set external_tenant_reference = public.gridex_new_external_tenant_reference()
where external_tenant_reference is null or btrim(external_tenant_reference) = '';

alter table public.companies
  alter column external_tenant_reference set default public.gridex_new_external_tenant_reference(),
  alter column external_tenant_reference set not null;

create unique index if not exists companies_external_tenant_reference_uidx
  on public.companies(external_tenant_reference);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.companies'::regclass
      and conname='companies_external_tenant_reference_format_check'
  ) then
    alter table public.companies
      add constraint companies_external_tenant_reference_format_check
      check (external_tenant_reference ~ '^tenant_[0-9a-f]{36}$');
  end if;
end $$;
