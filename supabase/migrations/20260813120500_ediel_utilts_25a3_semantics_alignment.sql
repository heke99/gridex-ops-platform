-- Align the canonical UTILTS rule-pack identity and effective window with the
-- currently effective Swedish production guide. The EDIFACT association code
-- (E5SE5A) is deliberately stored separately from guide 25-A-3.

do $$
declare
  v_current_id uuid;
  v_future_id uuid;
begin
  select id into strict v_current_id
  from public.ediel_rule_packs
  where family = 'UTILTS'
    and unh_association_code = 'E5SE5A'
    and valid_to = date '2026-09-30';

  select id into strict v_future_id
  from public.ediel_rule_packs
  where family = 'UTILTS'
    and unh_association_code = 'E5SE5A'
    and valid_from = date '2026-10-01';

  update public.ediel_rule_packs
  set guide_version = '25-A-3',
      guide_revision = '3',
      valid_from = date '2025-06-01',
      source_document = 'UTILTS 25-A-3',
      source_hash = encode(
        digest(convert_to('UTILTS|25-A-3|E5SE5A|2025-06-01|2026-09-30', 'UTF8'), 'sha256'),
        'hex'
      ),
      field_matrix_version = '25-A-3',
      metadata = metadata || jsonb_build_object(
        'activation', '2025-06-01',
        'retirement', '2026-09-30',
        'associationAssignedCode', 'E5SE5A'
      ),
      updated_at = now()
  where id = v_current_id;

  update public.ediel_rule_packs
  set guide_version = '25-A-4',
      guide_revision = '4',
      source_document = 'UTILTS 25-A-4 effective 2026-10-01',
      source_hash = encode(
        digest(convert_to('UTILTS|25-A-4|E5SE5A|2026-10-01', 'UTF8'), 'sha256'),
        'hex'
      ),
      field_matrix_version = '25-A-4',
      metadata = metadata || jsonb_build_object(
        'activation', '2026-10-01',
        'associationAssignedCode', 'E5SE5A'
      ),
      updated_at = now()
  where id = v_future_id;

  update public.ediel_message_profiles mp
  set profile = mp.profile || jsonb_build_object(
        'guideVersion', case when mp.rule_pack_id = v_current_id then '25-A-3' else '25-A-4' end,
        'guideRevision', case when mp.rule_pack_id = v_current_id then '3' else '4' end,
        'associationAssignedCode', 'E5SE5A',
        'validFrom', case when mp.rule_pack_id = v_current_id then '2025-06-01' else '2026-10-01' end
      )
  where mp.rule_pack_id in (v_current_id, v_future_id);

  update public.ediel_rule_pack_sources s
  set title = rp.source_document,
      revision = rp.guide_revision,
      valid_from = rp.valid_from,
      valid_to = rp.valid_to,
      source_hash = rp.source_hash,
      metadata = s.metadata || jsonb_build_object(
        'guideVersion', rp.guide_version,
        'associationAssignedCode', rp.unh_association_code
      )
  from public.ediel_rule_packs rp
  where s.rule_pack_id = rp.id
    and rp.id in (v_current_id, v_future_id);

  if not exists (
    select 1 from public.ediel_rule_packs
    where id = v_current_id
      and guide_version = '25-A-3'
      and guide_revision = '3'
      and unh_association_code = 'E5SE5A'
      and valid_from = date '2025-06-01'
      and valid_to = date '2026-09-30'
      and status = 'active'
  ) then
    raise exception 'utilts_25_a_3_alignment_failed';
  end if;

  if not exists (
    select 1 from public.ediel_rule_packs
    where id = v_future_id
      and guide_version = '25-A-4'
      and guide_revision = '4'
      and unh_association_code = 'E5SE5A'
      and valid_from = date '2026-10-01'
      and status = 'future'
  ) then
    raise exception 'utilts_25_a_4_future_guard_failed';
  end if;
end $$;
