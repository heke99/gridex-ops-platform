-- Keep production readiness distinct from component capability. Parsers and
-- validators can exist while complete field matrices/domain disposition remain
-- unverified; UI/API consumers must not report those profiles as production-ready.

update public.ediel_message_profiles mp
set profile = mp.profile || jsonb_build_object(
      'productionReadiness', 'partial',
      'productionBlockers', jsonb_build_array(
        'complete_25_a_3_field_matrix_required',
        'aggregate_and_forecast_disposition_required',
        'transaction_partial_success_evidence_required',
        'official_tgt_agt_evidence_required'
      )
    )
from public.ediel_rule_packs rp
where rp.id = mp.rule_pack_id
  and rp.family = 'UTILTS';

do $$
begin
  if exists (
    select 1
    from public.ediel_message_profiles mp
    join public.ediel_rule_packs rp on rp.id = mp.rule_pack_id
    where rp.family = 'UTILTS'
      and mp.profile->>'productionReadiness' is distinct from 'partial'
  ) then
    raise exception 'utilts_production_readiness_truth_incomplete';
  end if;
end $$;
