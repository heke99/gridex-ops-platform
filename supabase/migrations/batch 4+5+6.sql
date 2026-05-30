-- Batch 4-6 — inbound actor routing hardening.
-- Derives active actor settings from route profiles so shared mailbox inbound
-- can resolve the receiving Gridex actor (for example 92825) without using the
-- mailbox as tenant identity.
begin;
insert into public.ediel_actor_settings (
  company_id,
  actor_name,
  actor_ediel_id,
  ediel_id,
  actor_role,
  role,
  environment,
  sender_sub_address,
  sender_subaddress,
  receiver_sub_address,
  receiver_subaddress,
  default_application_reference,
  application_reference,
  is_active,
  metadata,
  created_at,
  updated_at
)
select distinct on (erp.company_id, erp.environment, erp.own_ediel_id)
  erp.company_id,
  coalesce(c.name, 'Gridex tenant actor'),
  erp.own_ediel_id,
  erp.own_ediel_id,
  coalesce(erp.metadata->>'actor_role', 'supplier'),
  coalesce(erp.metadata->>'actor_role', 'supplier'),
  erp.environment,
  nullif(erp.own_subaddress, ''),
  nullif(erp.own_subaddress, ''),
  null,
  null,
  null,
  null,
  true,
  jsonb_build_object(
    'derivedFrom', 'ediel_route_profiles',
    'sourceRouteProfileId', erp.id,
    'batch', 'batch_4_6_inbound_actor_routing'
  ),
  now(),
  now()
from public.ediel_route_profiles erp
left join public.companies c on c.id = erp.company_id
where erp.company_id is not null
  and erp.environment in ('test', 'production')
  and nullif(erp.own_ediel_id, '') is not null
  and coalesce(erp.is_active, erp.is_enabled, true) = true
  and not exists (
    select 1
    from public.ediel_actor_settings eas
    where eas.company_id = erp.company_id
      and eas.environment = erp.environment
      and upper(coalesce(eas.ediel_id, eas.actor_ediel_id, '')) = upper(erp.own_ediel_id)
      and coalesce(eas.is_active, true) = true
  )
order by erp.company_id, erp.environment, erp.own_ediel_id, erp.updated_at desc nulls last, erp.created_at desc nulls last;
create index if not exists idx_ediel_actor_settings_active_receiver
  on public.ediel_actor_settings(environment, ediel_id, company_id)
  where coalesce(is_active, true) = true and ediel_id is not null;
commit;