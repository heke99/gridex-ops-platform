-- Customer contract source-type hardening for website applications.
-- Website/customer application intake creates contracts from an external website application.
-- The application lifecycle stays on website_customer_applications; this migration only makes
-- customer_contracts.source_type accept real production sources and adds retry-friendly lookup indexes.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customer_contracts') is not null then
    alter table public.customer_contracts add column if not exists metadata jsonb not null default '{}'::jsonb;
    alter table public.customer_contracts add column if not exists expected_start_at date;
    alter table public.customer_contracts add column if not exists requested_start_date date;
    alter table public.customer_contracts add column if not exists confirmed_start_date date;
    alter table public.customer_contracts add column if not exists actual_start_date date;
    alter table public.customer_contracts add column if not exists agreement_channel text;
    alter table public.customer_contracts add column if not exists campaign_code text;
    alter table public.customer_contracts add column if not exists price_version text;
    alter table public.customer_contracts add column if not exists terms_version text;

    alter table public.customer_contracts drop constraint if exists customer_contracts_source_type_check;

    -- Normalize the previous review-specific value to the canonical website application source.
    update public.customer_contracts
    set source_type = 'website_application',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('legacy_source_type', 'website_application_review'),
        updated_at = now()
    where source_type = 'website_application_review';

    alter table public.customer_contracts
      add constraint customer_contracts_source_type_check check (
        source_type is null
        or source_type in (
          'catalog',
          'manual_override',
          'manual',
          'admin',
          'api',
          'external_website',
          'website_application',
          'website_application_review',
          'customer_portal',
          'import',
          'migration',
          'system'
        )
      );

    create index if not exists customer_contracts_website_application_retry_idx
      on public.customer_contracts(
        company_id,
        customer_id,
        customer_site_id,
        site_id,
        metering_point_id,
        requested_start_date,
        starts_at,
        created_at desc
      )
      where source_type in ('website_application','website_application_review')
        and status not in ('cancelled','rejected','terminated');
  end if;
end $$;
