-- Simplified Go-live, contract pricing and live/test separation polish
-- Additive/idempotent. Does not change network-owner data quality or send locks.

-- Plain-language contract availability per tenant.
create or replace view public.tenant_contract_offer_readiness_v as
select
  c.id as company_id,
  c.name as company_name,
  count(o.id) as total_contract_offers,
  count(o.id) filter (where lower(coalesce(o.status,'')) = 'draft') as draft_contracts,
  count(o.id) filter (where lower(coalesce(o.status,'')) = 'active' and coalesce(o.is_active,false) = true) as internal_active_contracts,
  count(o.id) filter (where lower(coalesce(o.status,'')) = 'active' and coalesce(o.is_active,false) = false) as active_but_hidden_contracts,
  count(o.id) filter (where coalesce(o.price_version,'') <> '') as contracts_with_price_version,
  count(o.id) filter (where coalesce(o.terms_version,'') <> '') as contracts_with_terms_version,
  count(pco.id) filter (where coalesce(pco.website_enabled,false) = true and coalesce(pco.is_public,false) = true and coalesce(pco.is_archived,false) = false) as website_published_contracts,
  case
    when count(o.id) filter (where lower(coalesce(o.status,'')) = 'active' and coalesce(o.is_active,false) = true) > 0 then true
    else false
  end as can_use_internal_customer_intake,
  case
    when count(pco.id) filter (where coalesce(pco.website_enabled,false) = true and coalesce(pco.is_public,false) = true and coalesce(pco.is_archived,false) = false) > 0 then true
    else false
  end as can_show_contracts_on_website,
  array_remove(array[
    case when count(o.id) = 0 then 'contract_missing' end,
    case when count(o.id) filter (where lower(coalesce(o.status,'')) = 'active' and coalesce(o.is_active,false) = true) = 0 then 'internal_active_contract_missing' end,
    case when count(o.id) filter (where coalesce(o.price_version,'') <> '') = 0 then 'price_version_missing' end
  ], null) as internal_blockers,
  array_remove(array[
    case when count(pco.id) filter (where coalesce(pco.website_enabled,false) = true and coalesce(pco.is_public,false) = true and coalesce(pco.is_archived,false) = false) = 0 then 'website_contract_publication_missing' end
  ], null) as website_blockers
from public.companies c
left join public.contract_offers o on o.company_id = c.id
left join public.public_contract_offers pco on pco.company_id = c.id
group by c.id, c.name;

comment on view public.tenant_contract_offer_readiness_v is
  'Plain-language tenant contract readiness. Internal active contracts can be used in OPS without website/API; website-published contracts require website/API readiness.';

comment on column public.contract_offers.price_version is
  'Price version label for the exact price rules used by this internal contract offer. If omitted in UI, OPS generates an initial label when the offer is saved.';
comment on column public.contract_offers.version_snapshot is
  'Immutable-ish JSON snapshot of price/version fields at save time. Customer contracts must copy the current version into their own snapshot when accepted.';
comment on column public.public_contract_offers.publication_status is
  'Website/API publication status. This is separate from internal contract availability in contract_offers.';

-- Normalize route names created by older wizard copy without touching actual routing semantics.
update public.communication_routes
set route_name = 'PRODAT produktion',
    notes = coalesce(nullif(notes,''), 'Produktionsprofil för PRODAT. Receiver löses automatiskt från kundens nätägare/process.')
where route_name in ('Automatisk production Ediel route', 'Production Ediel route', 'Automatisk Ediel-route')
  and target_system = 'production_ediel';

update public.ediel_route_profiles
set notes = coalesce(nullif(notes,''), 'PRODAT produktion: receiver löses från kundprocess och verifierad nätägare. Gridex shared mailbox är endast transportkanal.'),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'receiverResolutionOwner', 'system',
      'manualReceiverAllowed', false,
      'uiMode', 'simplified_go_live'
    )
where environment = 'production'
  and message_family = 'PRODAT'
  and coalesce(is_production_route, false) = true;
