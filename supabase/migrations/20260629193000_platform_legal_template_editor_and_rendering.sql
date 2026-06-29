-- Platform legal template editor and tenant rendering hardening.
-- Safe/idempotent: keeps existing tenant legal versions immutable and only
-- improves platform default templates, indexes and metadata used by the OPS UI.

create extension if not exists pgcrypto;

alter table if exists public.platform_default_legal_templates
  add column if not exists updated_at timestamptz not null default now();

create index if not exists platform_default_legal_templates_type_status_updated_idx
  on public.platform_default_legal_templates(type, status, updated_at desc);

create index if not exists legal_bundle_items_bundle_type_idx
  on public.legal_bundle_items(legal_bundle_id, type);

create or replace function public.gridex_platform_default_legal_templates_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists platform_default_legal_templates_set_updated_at on public.platform_default_legal_templates;
create trigger platform_default_legal_templates_set_updated_at
  before update on public.platform_default_legal_templates
  for each row execute function public.gridex_platform_default_legal_templates_set_updated_at();

-- Archive older published defaults before inserting the new published version so
-- the partial unique index (one published template per type) is never violated.
update public.platform_default_legal_templates
set status = 'archived', updated_at = now()
where status = 'published'
  and version <> 'gridex-standard-2026-07'
  and type in ('terms','privacy_policy','withdrawal','price_terms','power_of_attorney');

-- Keep the published defaults placeholder-aware. These are platform fallback
-- texts and must still be legally reviewed before relying on them in production.
insert into public.platform_default_legal_templates(type, version, title, body, status, published_at, metadata)
values
  (
    'terms',
    'gridex-standard-2026-07',
    'General terms for electricity agreements with {{brand_name}}',
    'These general terms apply between the customer and {{company_name}}, organization number {{org_number}}, for electricity agreements signed through {{brand_name}}. Customer service can be reached at {{support_email}}. The final commercial price, agreement start date, price area and product terms are stored in the signed contract and price snapshot. This platform default text must be reviewed and replaced with tenant-approved legal wording before production launch.',
    'published',
    now(),
    '{"source":"gridex_default","requires_platform_admin_review":true,"placeholder_version":"2026-07","supported_placeholders":["company_name","brand_name","org_number","support_email","contact_email","phone","website","address_line_1","address_line_2","postal_code","city","country"]}'::jsonb
  ),
  (
    'privacy_policy',
    'gridex-standard-2026-07',
    'Privacy policy for {{brand_name}}',
    '{{company_name}}, organization number {{org_number}}, processes personal data to administer electricity agreements, customer service, invoicing, supplier switching, facility information lookup and legal obligations. Contact: {{support_email}}. This platform default text must be reviewed and replaced with tenant-approved privacy wording before production launch.',
    'published',
    now(),
    '{"source":"gridex_default","requires_platform_admin_review":true,"placeholder_version":"2026-07","supported_placeholders":["company_name","brand_name","org_number","support_email","contact_email","phone","website","address_line_1","address_line_2","postal_code","city","country"]}'::jsonb
  ),
  (
    'withdrawal',
    'gridex-standard-2026-07',
    'Withdrawal information for {{brand_name}}',
    'Consumers may have a statutory withdrawal period after signing an electricity agreement with {{company_name}}, organization number {{org_number}}. Contact {{support_email}} for withdrawal requests and customer support. This platform default text must be reviewed and replaced with tenant-approved withdrawal wording before production launch.',
    'published',
    now(),
    '{"source":"gridex_default","requires_platform_admin_review":true,"placeholder_version":"2026-07","supported_placeholders":["company_name","brand_name","org_number","support_email","contact_email","phone","website","address_line_1","address_line_2","postal_code","city","country"]}'::jsonb
  ),
  (
    'price_terms',
    'gridex-standard-2026-07',
    'Price terms for {{brand_name}}',
    'The customer price is based on the selected product, price area, fees, markups, VAT and any campaign terms shown at signing. {{company_name}}, organization number {{org_number}}, stores a price snapshot with the customer agreement. Customer support: {{support_email}}. This platform default text must be reviewed and replaced with tenant-approved price wording before production launch.',
    'published',
    now(),
    '{"source":"gridex_default","requires_platform_admin_review":true,"placeholder_version":"2026-07","supported_placeholders":["company_name","brand_name","org_number","support_email","contact_email","phone","website","address_line_1","address_line_2","postal_code","city","country"]}'::jsonb
  ),
  (
    'power_of_attorney',
    'gridex-standard-2026-07',
    'Power of attorney for {{brand_name}}',
    'The customer authorizes {{company_name}}, organization number {{org_number}}, to request, receive and process facility information, metering point information and other information required for supplier switching and facility information lookup. The authorization may be used toward grid owners and relevant market actors when needed to administer the customer agreement. Customer support: {{support_email}}. This platform default text must be reviewed and replaced with tenant-approved power of attorney wording before production launch.',
    'published',
    now(),
    '{"source":"gridex_default","requires_platform_admin_review":true,"placeholder_version":"2026-07","supported_placeholders":["company_name","brand_name","org_number","support_email","contact_email","phone","website","address_line_1","address_line_2","postal_code","city","country"]}'::jsonb
  )
on conflict (type, version) do update
set title = excluded.title,
    body = excluded.body,
    status = 'published',
    published_at = coalesce(public.platform_default_legal_templates.published_at, excluded.published_at),
    updated_at = now(),
    metadata = excluded.metadata;

-- Ensure only the newest placeholder-aware defaults are active. Older published
-- defaults are archived, but tenant legal_text_versions already copied from them
-- remain untouched and immutable.
update public.platform_default_legal_templates old
set status = 'archived', updated_at = now()
where old.status = 'published'
  and old.version <> 'gridex-standard-2026-07'
  and old.type in ('terms','privacy_policy','withdrawal','price_terms','power_of_attorney')
  and exists (
    select 1
    from public.platform_default_legal_templates latest
    where latest.type = old.type
      and latest.version = 'gridex-standard-2026-07'
      and latest.status = 'published'
  );

comment on table public.platform_default_legal_templates is 'Platform master legal templates managed by superadmin UI. Published rows are copied/rendered into tenant-scoped legal_text_versions; tenant versions remain immutable.';
