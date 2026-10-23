-- FINDINGS H3c (H3 sidofynd 1), owner decision 2026-10-23 "Ediel-start + manuellt slut": the START of a supply period
-- is qualified by the received Ediel normal switch (Z04, normal_switch_confirmations + normal_supply_activations); a
-- manual end (the customer reported a move-out or termination by e-mail/phone and the operator ended the supply in the
-- platform) may SHORTEN that period, never extend it, and the days up to and including the move-out day are billed.
-- A later Z05 from the grid owner corrects the period through the existing Z05 flow (a new received state).
--
-- Defect: the billing gate, the underlay store and the underlay binding read gridex_received_sources.billing_supply_basis_v1
-- -> supply_period_source_basis_v1, which for a normal-switch period returned NULL after a manual end, also for days
-- BEFORE the move-out (*_qualified_supply_source_required), because
--   (1) the period row had to equal the received state (activation.resulting_period / the transition's resulting
--       state) in every field except updated_at/status, and the manual end changes fields of that row; and
--   (2) the carrying contract had to be signed/active or terminated 'supply_end', and the manual end terminates it
--       with 'move_out'.
--
-- What the manual end writers change on the period row (installed bodies, read from the world database):
--   * gridex_close_customer_lifecycle_v1(p_mode 'move_out'|'terminate', p_move_out_date) on an active/confirmed period:
--     end_date = the move-out date (the LAST supplied day), metadata || {planned_end_source:'customer_lifecycle_close',
--     planned_end_reason: p_mode, planned_end_recorded_at}, updated_at. Status, actual_end_date and everything else kept.
--   * gridex_end_customer_supply_v1(p_end_reason 'move_out', p_source_message_id NULL) on an active/confirmed period:
--     end_date = actual_end_date = the move-out date, status 'ended', metadata || {end_reason:'move_out',
--     end_key: '<metering_point_id>:<end date>', ended_by_grid_owner_at}, updated_at (source_message_id kept).
--   Both terminate the contract through gridex_record_customer_contract_event_v1: status 'terminated',
--   termination_reason 'move_out', ended_at = the move-out date (production_contract_hash_v1 excludes these fields).
--
-- Rule (two exact-text changes in supply_period_source_basis_v1, nothing else):
--   (a) the received-state equality still applies, unless the row is the received state shortened by exactly such a
--       manual end: every field except updated_at/status/end_date/actual_end_date/metadata equals the received state;
--       the received status is 'active'/'confirmed_by_grid_owner'; start_date <= end_date <= the received end_date (if
--       any); the metadata equals the received metadata apart from the six manual-end keys; a new, complete
--       lifecycle-close marker (status and actual_end_date kept) and/or a new, complete end-supply 'move_out' marker
--       whose end_key is this period's metering point and end date (status 'ended', actual_end_date = end_date); and
--       the queried interval ends no later than civil midnight after the move-out day. market_start_at, market_end_at
--       (so the existing p_end<=market_end_at bound), market_state_version, source ids, customer, metering point,
--       contract and tenant stay received. Not accepted: an extension, an end before the start, another tenant/customer/
--       point/contract, a 'supplier_switch' or source-message end, a bare end_date edit without a manual-end marker, a
--       received 'ending'/'ended' period, and a period without a received normal-switch start (that path is
--       billing_supply_before_normal_switch_v1 and is unchanged).
--   (b) the contract clause accepts termination_reason 'move_out' as well as 'supply_end' (ended_at on the period's
--       end date, UTC or Stockholm date), exactly as H3b (20261023200000) does in the gate, store, readers and view.
-- The returned basis object is unchanged, so a binding taken before the manual end still matches.
--
-- Exact-needle rewrite of the installed body; refuses (manual_end_ediel_supply_basis_rule_source_changed) unless both
-- needles are present exactly once and the replacement is absent. Owner, ACL, security definer, volatility and
-- configuration (proconfig) are preserved and checked.
begin;

do $h3c$
declare
  old_state constant text := $c$  OR (to_jsonb(p)-ARRAY['updated_at','status']) IS DISTINCT FROM (baseline-ARRAY['updated_at','status'])
  OR (p.status IS DISTINCT FROM baseline->>'status' AND NOT(p.status='ended' AND baseline->>'status'='ending' AND p.market_end_at<=now()))$c$;
  new_state constant text := $c$  OR (((to_jsonb(p)-ARRAY['updated_at','status']) IS DISTINCT FROM (baseline-ARRAY['updated_at','status'])
  OR (p.status IS DISTINCT FROM baseline->>'status' AND NOT(p.status='ended' AND baseline->>'status'='ending' AND p.market_end_at<=now())))
   -- H3c (20261023201000): a manual end after this received state (gridex_close_customer_lifecycle_v1, or
   -- gridex_end_customer_supply_v1 'move_out' without a source message) may shorten the period, never extend it.
   AND (p.end_date IS NOT NULL AND p.end_date>=p.start_date AND p.end_date<=coalesce((baseline->>'end_date')::date,p.end_date)
    AND p_end<=((p.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm') AND baseline->>'status' IN('active','confirmed_by_grid_owner')
    AND (to_jsonb(p)-ARRAY['updated_at','status','end_date','actual_end_date','metadata'])=(baseline-ARRAY['updated_at','status','end_date','actual_end_date','metadata'])
    AND (CASE WHEN jsonb_typeof(p.metadata)='object' THEN p.metadata ELSE '{}' END-ARRAY['planned_end_source','planned_end_reason','planned_end_recorded_at','end_reason','end_key','ended_by_grid_owner_at'])
     =(CASE WHEN jsonb_typeof(baseline->'metadata')='object' THEN baseline->'metadata' ELSE '{}' END-ARRAY['planned_end_source','planned_end_reason','planned_end_recorded_at','end_reason','end_key','ended_by_grid_owner_at'])
    AND ((p.metadata->'planned_end_source',p.metadata->'planned_end_reason',p.metadata->'planned_end_recorded_at')
      IS NOT DISTINCT FROM (baseline#>'{metadata,planned_end_source}',baseline#>'{metadata,planned_end_reason}',baseline#>'{metadata,planned_end_recorded_at}')
     OR p.metadata->>'planned_end_source'='customer_lifecycle_close' AND p.metadata->>'planned_end_reason' IN('move_out','terminate') AND p.metadata->>'planned_end_recorded_at' IS NOT NULL)
    AND ((p.metadata->'end_reason',p.metadata->'end_key',p.metadata->'ended_by_grid_owner_at')
      IS NOT DISTINCT FROM (baseline#>'{metadata,end_reason}',baseline#>'{metadata,end_key}',baseline#>'{metadata,ended_by_grid_owner_at}')
      AND p.metadata->'planned_end_recorded_at' IS DISTINCT FROM baseline#>'{metadata,planned_end_recorded_at}'
      AND p.status=baseline->>'status' AND to_jsonb(p)->'actual_end_date' IS NOT DISTINCT FROM baseline->'actual_end_date'
     OR p.metadata->'end_key' IS DISTINCT FROM baseline#>'{metadata,end_key}' AND p.metadata->>'end_reason'='move_out'
      AND p.metadata->>'end_key'=p.metering_point_id::text||':'||to_char(p.end_date,'YYYY-MM-DD') AND p.metadata->>'ended_by_grid_owner_at' IS NOT NULL
      AND p.status='ended' AND p.actual_end_date=p.end_date)) IS NOT TRUE)$c$;
  old_contract constant text := $c$c.status='terminated' AND c.termination_reason='supply_end' AND p.end_date IS NOT NULL AND c.ended_at IS NOT NULL$c$;
  new_contract constant text := $c$c.status='terminated' AND c.termination_reason IN('supply_end','move_out') AND p.end_date IS NOT NULL AND c.ended_at IS NOT NULL$c$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p
  where p.oid = 'gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, old_state, ''))) / length(old_state) <> 1
    or (length(f.prosrc) - length(replace(f.prosrc, old_contract, ''))) / length(old_contract) <> 1
    or position('H3c (20261023201000)' in f.prosrc) <> 0
    or position(new_contract in f.prosrc) <> 0
    or not (f.metadata->>'prosecdef')::boolean
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'manual_end_ediel_supply_basis_rule_source_changed' using errcode = 'P0U01';
  end if;
  body := replace(replace(f.prosrc, old_state, new_state), old_contract, new_contract);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'manual_end_ediel_supply_basis_metadata_changed' using errcode = 'P0U01';
  end if;
end
$h3c$;

commit;
