-- Persist the canonical object/aggregate/request taxonomy used by runtime.
-- This prevents UI/API consumers of DB rule packs from inferring that every
-- UTILTS transaction belongs to a metering point or carries observations.

with semantics(
  message_code,
  scope,
  requires_metering_point,
  requires_grid_area,
  requires_quantities,
  supplier_capability
) as (
  values
    ('S01','grid_area',false,true,true,'not_normal'),
    ('S02','metering_point',true,true,true,'primary_inbound'),
    ('S03','grid_area',false,true,true,'primary_inbound'),
    ('S04','grid_area',false,true,true,'not_normal'),
    ('S05','grid_area',false,true,true,'configurable_bilateral'),
    ('S06','request',false,true,false,'not_normal'),
    ('S07','metering_point',true,false,true,'configurable_bilateral'),
    ('E30','metering_point',true,true,true,'not_normal'),
    ('E31','grid_area',false,true,true,'primary_inbound'),
    ('E66','metering_point',true,true,true,'primary_inbound'),
    ('E72','request',true,false,false,'not_normal'),
    ('E73','request',true,false,false,'configurable_bilateral'),
    ('E74','request',false,true,false,'configurable_bilateral'),
    ('ERR','error',false,false,false,'acknowledgement')
)
update public.ediel_message_profiles mp
set profile = mp.profile || jsonb_build_object(
      'scope', s.scope,
      'requiresMeteringPoint', s.requires_metering_point,
      'requiresGridArea', s.requires_grid_area,
      'requiresQuantities', s.requires_quantities,
      'supplierCapability', s.supplier_capability
    )
from semantics s
join public.ediel_rule_packs rp
  on rp.family = 'UTILTS'
where mp.rule_pack_id = rp.id
  and mp.message_code = s.message_code;

do $$
begin
  if exists (
    select 1
    from public.ediel_message_profiles mp
    join public.ediel_rule_packs rp on rp.id = mp.rule_pack_id
    where rp.family = 'UTILTS'
      and (
        not (mp.profile ? 'scope')
        or not (mp.profile ? 'requiresMeteringPoint')
        or not (mp.profile ? 'requiresGridArea')
        or not (mp.profile ? 'requiresQuantities')
        or not (mp.profile ? 'supplierCapability')
      )
  ) then
    raise exception 'utilts_profile_semantics_incomplete';
  end if;

  if exists (
    select 1
    from public.ediel_message_profiles mp
    join public.ediel_rule_packs rp on rp.id = mp.rule_pack_id
    where rp.family = 'UTILTS'
      and mp.message_code in ('S01','S03','S04','S05','E31','E74','S06')
      and coalesce((mp.profile->>'requiresMeteringPoint')::boolean, true)
  ) then
    raise exception 'aggregate_utilts_requires_metering_point';
  end if;
end $$;
