-- Migration: public contract offer API readiness fix
-- Aligns tenant website readiness with the current OPS-managed public_contract_offers model.
-- Public website/API contracts are owned by OPS per tenant and exposed through API clients,
-- not by manually passing company_id from the website.

create or replace view public.tenant_website_readiness_v as
select
  c.id as company_id,
  c.name as company_name,
  exists (
    select 1 from public.integration_api_clients i
    where i.company_id = c.id
      and i.status = 'active'
      and i.scopes @> array['website_contracts.read','website_applications.write']::text[]
  ) as has_api_client,
  exists (
    select 1 from public.integration_api_clients i
    where i.company_id = c.id
      and i.status = 'active'
      and coalesce(array_length(i.allowed_origins, 1), 0) > 0
  ) as has_allowed_origin,
  (
    exists (
      select 1
      from public.public_contract_offers o
      where o.company_id = c.id
        and coalesce(o.publication_status, 'draft') = 'published'
        and o.website_enabled = true
        and o.is_public = true
        and coalesce(o.is_archived, false) = false
        and (o.valid_from is null or o.valid_from <= current_date)
        and (o.valid_to is null or o.valid_to >= current_date)
    )
    or exists (
      select 1 from public.price_plan_versions ppv
      join public.price_plans pp on pp.id = ppv.price_plan_id and pp.company_id = ppv.company_id
      where ppv.company_id = c.id
        and ppv.status in ('active','published')
        and coalesce(ppv.snapshot_json ->> 'website_visible', ppv.snapshot_json ->> 'is_public', 'false') in ('true','1')
    )
  ) as has_public_contracts,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'terms' and l.status = 'published') as has_terms,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'privacy_policy' and l.status = 'published') as has_privacy_policy,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'withdrawal' and l.status = 'published') as has_withdrawal,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'power_of_attorney' and l.status = 'published') as has_power_of_attorney_text,
  exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'price_terms' and l.status = 'published') as has_price_terms,
  exists (
    select 1 from public.company_email_settings s
    where s.company_id = c.id and coalesce(s.verification_status, '') in ('verified','completed')
  ) as has_verified_sender,
  exists (
    select 1 from public.company_email_templates t
    where t.company_id = c.id and t.is_active = true
  ) as has_mail_templates,
  array_remove(array[
    case when not exists (select 1 from public.integration_api_clients i where i.company_id = c.id and i.status = 'active' and i.scopes @> array['website_contracts.read','website_applications.write']::text[]) then 'API-klient för hemsida/Mina sidor saknas' end,
    case when not exists (select 1 from public.integration_api_clients i where i.company_id = c.id and i.status = 'active' and coalesce(array_length(i.allowed_origins, 1), 0) > 0) then 'Tillåten hemsidedomän/origin saknas' end,
    case when not (
      exists (
        select 1
        from public.public_contract_offers o
        where o.company_id = c.id
          and coalesce(o.publication_status, 'draft') = 'published'
          and o.website_enabled = true
          and o.is_public = true
          and coalesce(o.is_archived, false) = false
          and (o.valid_from is null or o.valid_from <= current_date)
          and (o.valid_to is null or o.valid_to >= current_date)
      )
      or exists (
        select 1
        from public.price_plan_versions ppv
        join public.price_plans pp on pp.id = ppv.price_plan_id and pp.company_id = ppv.company_id
        where ppv.company_id = c.id
          and ppv.status in ('active','published')
          and coalesce(ppv.snapshot_json ->> 'website_visible', ppv.snapshot_json ->> 'is_public', 'false') in ('true','1')
      )
    ) then 'Publicerade avtal saknas' end,
    case when not exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'terms' and l.status = 'published') then 'Allmänna villkor saknas' end,
    case when not exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'privacy_policy' and l.status = 'published') then 'Integritetspolicy saknas' end,
    case when not exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'withdrawal' and l.status = 'published') then 'Ångerrättstext saknas' end,
    case when not exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'power_of_attorney' and l.status = 'published') then 'Fullmaktstext saknas' end,
    case when not exists (select 1 from public.legal_text_versions l where l.company_id = c.id and l.type = 'price_terms' and l.status = 'published') then 'Prisvillkor saknas' end,
    case when not exists (select 1 from public.company_email_templates t where t.company_id = c.id and t.is_active = true) then 'Aktiva mailmallar saknas' end
  ], null) as missing_items,
  now() as evaluated_at
from public.companies c;

comment on view public.tenant_website_readiness_v is 'Plain-language tenant readiness for website contracts, applications, legal texts and mail setup. Counts OPS public_contract_offers and legacy website-visible price plan versions.';
