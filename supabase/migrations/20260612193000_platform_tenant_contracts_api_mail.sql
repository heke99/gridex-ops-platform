-- Platform admin tenant contracts, website/API permission groups and automatic mail readiness.
-- Additive/idempotent. Keeps tenant contracts, public website offers and API permissions configurable per company.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Public contract offers: platform-admin controlled offer cards per tenant.
-- -----------------------------------------------------------------------------
alter table if exists public.public_contract_offers
  add column if not exists offer_code text,
  add column if not exists publication_status text not null default 'draft',
  add column if not exists website_enabled boolean not null default false,
  add column if not exists website_cta_enabled boolean not null default true,
  add column if not exists public_price_text text,
  add column if not exists terms_url text,
  add column if not exists binding_months integer,
  add column if not exists notice_months integer,
  add column if not exists spot_weight_percent numeric not null default 100,
  add column if not exists portfolio_weight_percent numeric not null default 0,
  add column if not exists fixed_weight_percent numeric not null default 0,
  add column if not exists price_area text,
  add column if not exists published_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists readiness_issues jsonb not null default '[]'::jsonb,
  add column if not exists publication_notes text;

create unique index if not exists public_contract_offers_company_offer_code_uidx
  on public.public_contract_offers(company_id, offer_code)
  where offer_code is not null;
create index if not exists public_contract_offers_company_publication_status_idx
  on public.public_contract_offers(company_id, publication_status, website_enabled, sort_order);

do $$
begin
  if to_regclass('public.public_contract_offers') is not null then
    alter table public.public_contract_offers drop constraint if exists public_contract_offers_publication_status_check;
    alter table public.public_contract_offers
      add constraint public_contract_offers_publication_status_check
      check (publication_status in ('draft','review','published','unpublished','archived','expired'));

    alter table public.public_contract_offers drop constraint if exists public_contract_offers_contract_type_check;
    alter table public.public_contract_offers
      add constraint public_contract_offers_contract_type_check
      check (contract_type in ('spot','variable','variable_spot','variable_monthly','variable_hourly','hourly_spot','fixed','portfolio','mixed','manual_override'));

    alter table public.public_contract_offers drop constraint if exists public_contract_offers_weight_percent_check;
    alter table public.public_contract_offers
      add constraint public_contract_offers_weight_percent_check
      check (
        spot_weight_percent between 0 and 100
        and portfolio_weight_percent between 0 and 100
        and fixed_weight_percent between 0 and 100
        and (
          contract_type not in ('portfolio','mixed')
          or round(coalesce(spot_weight_percent, 0) + coalesce(portfolio_weight_percent, 0) + coalesce(fixed_weight_percent, 0), 6) = 100
        )
      );

    alter table public.public_contract_offers drop constraint if exists public_contract_offers_price_area_check;
    alter table public.public_contract_offers
      add constraint public_contract_offers_price_area_check
      check (price_area is null or price_area in ('SE1','SE2','SE3','SE4'));

    alter table public.public_contract_offers drop constraint if exists public_contract_offers_months_check;
    alter table public.public_contract_offers
      add constraint public_contract_offers_months_check
      check ((binding_months is null or binding_months >= 0) and (notice_months is null or notice_months >= 0));
  end if;
end $$;

update public.public_contract_offers
set publication_status = case
    when is_archived then 'archived'
    when is_public then 'published'
    else coalesce(nullif(publication_status, ''), 'draft')
  end,
  website_enabled = case when is_public then true else website_enabled end,
  published_at = case when is_public and published_at is null then updated_at else published_at end,
  archived_at = case when is_archived and archived_at is null then updated_at else archived_at end
where to_regclass('public.public_contract_offers') is not null;

create or replace view public.gridex_public_contract_offer_admin_v as
select
  o.id,
  o.company_id,
  c.name as company_name,
  o.offer_code,
  o.public_name,
  o.public_description,
  o.contract_type,
  o.billing_model,
  o.customer_type,
  o.price_plan_id,
  pp.name as price_plan_name,
  pp.pricing_model as price_plan_model,
  pp.status as price_plan_status,
  o.price_plan_version_id,
  ppv.version_label as price_plan_version_label,
  ppv.status as price_plan_version_status,
  ppv.valid_from as price_plan_version_valid_from,
  ppv.valid_to as price_plan_version_valid_to,
  o.campaign_version_id,
  o.monthly_fee_sek,
  o.invoice_fee_sek,
  o.markup_ore_per_kwh,
  o.spot_markup_ore_per_kwh,
  o.variable_fee_ore_per_kwh,
  o.fixed_price_ore_per_kwh,
  o.green_fee_mode,
  o.green_fee_value,
  o.terms_version,
  o.terms_url,
  o.public_price_text,
  o.binding_months,
  o.notice_months,
  o.spot_weight_percent,
  o.portfolio_weight_percent,
  o.fixed_weight_percent,
  o.price_area,
  o.valid_from,
  o.valid_to,
  o.publication_status,
  o.website_enabled,
  o.website_cta_enabled,
  o.is_public,
  o.is_archived,
  o.sort_order,
  o.readiness_issues,
  array_remove(array[
    case when o.price_plan_id is null then 'Prisplan saknas' end,
    case when o.price_plan_version_id is null then 'Prisversion saknas' end,
    case when o.price_plan_id is not null and pp.company_id is distinct from o.company_id then 'Prisplanen tillhör annat bolag' end,
    case when o.price_plan_version_id is not null and ppv.company_id is distinct from o.company_id then 'Prisversionen tillhör annat bolag' end,
    case when o.price_plan_version_id is not null and ppv.price_plan_id is distinct from o.price_plan_id then 'Prisversionen hör inte till vald prisplan' end,
    case when nullif(o.terms_version, '') is null then 'Villkorsversion saknas' end,
    case when nullif(o.public_price_text, '') is null then 'Publik pristext saknas' end,
    case when o.contract_type in ('portfolio','mixed') and round(coalesce(o.spot_weight_percent,0) + coalesce(o.portfolio_weight_percent,0) + coalesce(o.fixed_weight_percent,0), 6) <> 100 then 'Fördelningen måste bli 100%' end,
    case when o.valid_to is not null and o.valid_from is not null and o.valid_to < o.valid_from then 'Giltighetsdatum är fel' end
  ], null) as calculated_readiness_issues,
  (
    o.price_plan_id is not null
    and o.price_plan_version_id is not null
    and pp.company_id = o.company_id
    and ppv.company_id = o.company_id
    and ppv.price_plan_id = o.price_plan_id
    and nullif(o.terms_version, '') is not null
    and nullif(o.public_price_text, '') is not null
    and (o.contract_type not in ('portfolio','mixed') or round(coalesce(o.spot_weight_percent,0) + coalesce(o.portfolio_weight_percent,0) + coalesce(o.fixed_weight_percent,0), 6) = 100)
    and (o.valid_to is null or o.valid_from is null or o.valid_to >= o.valid_from)
  ) as can_publish,
  o.published_at,
  o.archived_at,
  o.created_at,
  o.updated_at,
  o.metadata
from public.public_contract_offers o
left join public.companies c on c.id = o.company_id
left join public.price_plans pp on pp.id = o.price_plan_id
left join public.price_plan_versions ppv on ppv.id = o.price_plan_version_id;

-- -----------------------------------------------------------------------------
-- API permission groups: superadmin sees plain-language groups, not raw scopes.
-- -----------------------------------------------------------------------------
create table if not exists public.integration_api_permission_groups (
  group_key text primary key,
  label text not null,
  description text not null,
  category text not null default 'website',
  scopes text[] not null default '{}'::text[],
  recommended_default boolean not null default true,
  risk_level text not null default 'normal',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_api_permission_groups_risk_check check (risk_level in ('low','normal','high'))
);

insert into public.integration_api_permission_groups(group_key, label, description, category, scopes, recommended_default, risk_level, sort_order)
values
  ('website_contracts', 'Hämta avtal till hemsidan', 'Hemsidan får läsa publicerade elavtal från Ops för rätt bolag.', 'website', array['website_contracts.read']::text[], true, 'low', 10),
  ('website_applications', 'Skicka kundansökningar', 'Hemsidan får skicka in nya kunder och teckningar till Ops.', 'website', array['website_applications.write']::text[], true, 'normal', 20),
  ('customer_portal', 'Mina sidor', 'Kunden kan se och komplettera uppgifter, avtal, anläggningar, fakturor och status.', 'portal', array['customer_portal.read','customer_portal.write']::text[], true, 'normal', 30),
  ('customer_events', 'Kundhändelser och status', 'Hemsidan kan skicka och läsa kundhändelser/statusar.', 'events', array['website_events.write','events.read']::text[], true, 'low', 40),
  ('documents_notifications', 'Dokument och notiser', 'Kunden kan se dokument/notiser och markera notiser som lästa.', 'portal', array['customer_documents.read','customer_notifications.read','customer_notifications.write']::text[], true, 'normal', 50),
  ('facility_power_of_attorney', 'Komplettera anläggning och fullmakt', 'Kunden kan uppdatera kontaktuppgifter, komplettera anläggningsdata och godkänna fullmakt.', 'portal', array['customer_contact.write','customer_facility_data.write','customer_power_of_attorney.write']::text[], true, 'high', 60)
on conflict (group_key) do update
set label = excluded.label,
    description = excluded.description,
    category = excluded.category,
    scopes = excluded.scopes,
    recommended_default = excluded.recommended_default,
    risk_level = excluded.risk_level,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

alter table if exists public.integration_api_clients
  add column if not exists permission_groups text[] not null default '{}'::text[],
  add column if not exists purpose_label text,
  add column if not exists deleted_at timestamptz;

update public.integration_api_clients c
set permission_groups = coalesce(nullif(c.permission_groups, '{}'::text[]), (
  select coalesce(array_agg(g.group_key order by g.sort_order), '{}'::text[])
  from public.integration_api_permission_groups g
  where g.is_active
    and g.scopes && coalesce(c.scopes, '{}'::text[])
))
where to_regclass('public.integration_api_clients') is not null;

create or replace view public.gridex_api_client_permission_summary_v as
select
  c.id,
  c.company_id,
  co.name as company_name,
  c.name,
  c.status,
  c.key_prefix,
  c.scopes,
  c.permission_groups,
  c.allowed_origins,
  c.allowed_ips,
  c.last_used_at,
  c.expires_at,
  c.purpose_label,
  c.created_at,
  c.updated_at,
  coalesce(jsonb_agg(jsonb_build_object(
    'group_key', g.group_key,
    'label', g.label,
    'description', g.description,
    'category', g.category,
    'scopes', g.scopes,
    'risk_level', g.risk_level
  ) order by g.sort_order) filter (where g.group_key is not null), '[]'::jsonb) as permission_group_details
from public.integration_api_clients c
left join public.companies co on co.id = c.company_id
left join public.integration_api_permission_groups g on g.group_key = any(coalesce(c.permission_groups, '{}'::text[]))
where c.deleted_at is null
group by c.id, co.name;

-- -----------------------------------------------------------------------------
-- Automatic customer mail readiness per tenant/event. Events stay separate from scopes.
-- -----------------------------------------------------------------------------
create or replace view public.gridex_tenant_email_dispatch_readiness_v as
select
  c.id as company_id,
  c.name as company_name,
  e.event_key,
  e.template_key,
  e.enabled,
  t.id as template_id,
  t.name as template_name,
  t.subject,
  t.is_active as template_active,
  s.sender_email,
  s.reply_to_email,
  s.domain,
  coalesce(s.verification_status, 'not_started') as domain_status,
  case
    when e.enabled is not true then false
    when t.id is null then false
    when t.is_active is not true then false
    when nullif(coalesce(t.subject, ''), '') is null then false
    when nullif(coalesce(t.body_html, t.body_text, ''), '') is null then false
    when nullif(coalesce(s.sender_email, ''), '') is null then false
    else true
  end as can_send,
  array_remove(array[
    case when e.enabled is not true then 'Utskicket är avstängt' end,
    case when t.id is null then 'Mailmall saknas' end,
    case when t.is_active is not true then 'Mailmallen är inaktiv' end,
    case when nullif(coalesce(t.subject, ''), '') is null then 'Ämnesrad saknas' end,
    case when nullif(coalesce(t.body_html, t.body_text, ''), '') is null then 'Mallinnehåll saknas' end,
    case when nullif(coalesce(s.sender_email, ''), '') is null then 'Avsändare saknas' end,
    case when coalesce(s.verification_status, 'not_started') not in ('verified','active','ready') then 'Domänen är inte verifierad; fallback kan krävas' end
  ], null) as issues,
  e.updated_at as event_rule_updated_at,
  t.updated_at as template_updated_at
from public.companies c
left join public.email_event_rules e on e.company_id = c.id
left join public.company_email_templates t on t.company_id = c.id and t.template_key = e.template_key and t.language = 'sv'
left join public.company_email_settings s on s.company_id = c.id;

-- Snapshot carries the offer id and public terms used at signing.
alter table if exists public.contract_price_snapshots
  add column if not exists public_contract_offer_id uuid references public.public_contract_offers(id) on delete set null,
  add column if not exists public_price_text text,
  add column if not exists terms_url text,
  add column if not exists spot_weight_percent numeric,
  add column if not exists portfolio_weight_percent numeric,
  add column if not exists fixed_weight_percent numeric;

create index if not exists contract_price_snapshots_public_offer_idx
  on public.contract_price_snapshots(company_id, public_contract_offer_id, created_at desc)
  where public_contract_offer_id is not null;
