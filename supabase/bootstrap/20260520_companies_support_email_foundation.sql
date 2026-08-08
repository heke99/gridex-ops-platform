-- Clean-replay prerequisite derived from 20260520_batch_6e_rbac_tenant_stats_whitelabel.sql.
-- Restore only the source-defined company metadata block required by later canonical
-- tenant-mail, legal-profile, Ediel identity and white-label flows.
do $$
begin
  if to_regclass('public.companies') is not null then
    alter table public.companies
      add column if not exists billing_contact_email text null,
      add column if not exists support_email text null,
      add column if not exists address_line_1 text null,
      add column if not exists address_line_2 text null,
      add column if not exists postal_code text null,
      add column if not exists city text null,
      add column if not exists country_code text null default 'SE',
      add column if not exists ediel_id text null,
      add column if not exists actor_role text null,
      add column if not exists sender_sub_address text null,
      add column if not exists ediel_mailbox text null,
      add column if not exists operating_environment text null default 'test',
      add column if not exists branding jsonb not null default '{}'::jsonb,
      add column if not exists billing_settings jsonb not null default '{}'::jsonb;

    alter table public.companies
      drop constraint if exists companies_operating_environment_check;
    alter table public.companies
      add constraint companies_operating_environment_check
      check (operating_environment in ('test', 'production'));

    create index if not exists companies_ediel_id_idx
      on public.companies(ediel_id);
    create index if not exists companies_operating_environment_idx
      on public.companies(operating_environment);
  end if;
end $$;
