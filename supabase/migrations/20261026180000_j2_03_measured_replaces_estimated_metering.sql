-- FINDINGS J2-03 (reality scenario J2, native test scripts/j2-inbound-utilts-native.test.ts): when the meter cannot be
-- read the grid owner sends the day estimated (STS+8+56: quality 56, reading type 'estimated'); the billing gate holds
-- those values (quality_not_final). When the meter is read the same period is sent again with a later registration
-- time and no estimate flag. public.gridex_consume_utilts_metering_v1 refused that measured file
-- (utilts_consumption_existing_metering_conflict): its correction branch accepted only a quantity difference and
-- compared quality_code/reading_type as identity, so neither a changed quarter nor an unchanged one could replace the
-- estimate, and the facility was never billable.
--
-- Change (exact-needle rewrite of the installed body, takeover in #840 comment 6423229557):
--   an estimated current value (quality 56 or reading type 'estimated') may be replaced by a final (not estimated)
--   value of the same key, also with an equal quantity, through the existing authenticated correction branch. Every
--   other check is unchanged: the measured file must be a strictly newer, authenticated version of the same cohort,
--   with the same attribution, period, register, product, direction and unit. Only quality_code and reading_type may
--   differ, and only in the estimate-to-final direction; a final value is never replaced by an estimate, and a
--   quantity-only correction behaves as before. gridex_ingest_metering_value_atomic already stores a new revision when
--   the quality differs at an equal quantity.
--
-- Refuses (j2_03_consumer_source_changed) unless every needle is present exactly once and the marker is absent. Owner,
-- ACL, security definer, volatility and configuration (proconfig) are preserved and checked.
begin;

do $j203$
declare
  old_decl constant text := $c$ sc046_old_result public.metering_values%rowtype; sc046_current_count bigint;$c$;
  new_decl constant text := $c$ sc046_old_result public.metering_values%rowtype; sc046_current_count bigint;
 -- J2-03 (20261026180000): an estimated current value is replaced by a final one.
 j203_estimate_to_final boolean := false;$c$;
  old_gate constant text := $c$   IF SQLERRM IS DISTINCT FROM 'utilts_consumption_existing_metering_conflict'
    OR v_result.value_kwh IS NOT DISTINCT FROM (v_payload->>'value_kwh')::numeric THEN RAISE; END IF;$c$;
  new_gate constant text := $c$   j203_estimate_to_final:=(v_result.quality_code IS NOT DISTINCT FROM '56' OR v_result.reading_type IS NOT DISTINCT FROM 'estimated')
    AND (v_payload->>'quality_code') IS DISTINCT FROM '56' AND (v_payload->>'reading_type') IS DISTINCT FROM 'estimated';
   IF SQLERRM IS DISTINCT FROM 'utilts_consumption_existing_metering_conflict'
    OR (v_result.value_kwh IS NOT DISTINCT FROM (v_payload->>'value_kwh')::numeric AND NOT j203_estimate_to_final) THEN RAISE; END IF;$c$;
  old_compare constant text := $c$   IF (v_payload-ARRAY['value_kwh','source_ediel_message_id','source_transaction_reference','source_line_reference','created_by','raw_payload'])
    IS DISTINCT FROM (sc046_old_payload-ARRAY['value_kwh','source_ediel_message_id','source_transaction_reference','source_line_reference','created_by','raw_payload']) THEN$c$;
  new_compare constant text := $c$   IF (v_payload-ARRAY['value_kwh','source_ediel_message_id','source_transaction_reference','source_line_reference','created_by','raw_payload']
     -CASE WHEN j203_estimate_to_final THEN ARRAY['quality_code','reading_type'] ELSE ARRAY[]::text[] END)
    IS DISTINCT FROM (sc046_old_payload-ARRAY['value_kwh','source_ediel_message_id','source_transaction_reference','source_line_reference','created_by','raw_payload']
     -CASE WHEN j203_estimate_to_final THEN ARRAY['quality_code','reading_type'] ELSE ARRAY[]::text[] END) THEN$c$;
  f record;
  body text;
  needle text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p
  where p.oid = 'public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb)'::regprocedure;
  foreach needle in array array[old_decl, old_gate, old_compare] loop
    if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1 then
      raise exception 'j2_03_consumer_source_changed' using errcode = 'P0U01';
    end if;
  end loop;
  if position('J2-03 (20261026180000)' in f.prosrc) <> 0
    or not (f.metadata->>'prosecdef')::boolean
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'j2_03_consumer_source_changed' using errcode = 'P0U01';
  end if;
  body := replace(replace(replace(f.prosrc, old_decl, new_decl), old_gate, new_gate), old_compare, new_compare);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'j2_03_consumer_metadata_changed' using errcode = 'P0U01';
  end if;
end
$j203$;

commit;
