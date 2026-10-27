-- FINDINGS J2-05 (reality scenario J2, step J2-11; native test scripts/j2-inbound-utilts-native.test.ts): a grid
-- owner's correction for part of the original period (a UTILTS E66 for 12 September 06:00-12:00, 24 quarter-hours,
-- after a full-day original) was refused with utilts_consumption_correction_binding_invalid and no quarter changed.
-- public.gridex_consume_utilts_metering_v1 accepted a correction only when the current value's source series was in the
-- correction's own cohort (same company, series kind, message code, metering point, grid area, PERIOD, resolution and
-- product). A partial-period correction is a series of its own period, so its cohort always differs.
--
-- Rule (Ediel: a correction may cover a sub-period; it replaces exactly the intervals it carries, the rest stays
-- current): a crossing correction is a series whose identity equals the old value's source series in everything but
-- the period, and whose period, like the old series' period, covers the corrected interval. It goes through the same
-- authenticated correction branch: the old series and its contract are authenticated as before, the old observation
-- must be the only one for this key and writable, the attribution/identity payload must match (J2-03's estimate-to-
-- final exception included), the own series must be the current head of its own cohort, and its registration/update
-- time must be strictly later than the old series'. Instead of the same-cohort ancestry walk, a crossing correction
-- must be strictly later than EVERY series of another period of the same identity that overlaps the interval (in the
-- same environment); a series without a time refuses. This works in both directions: a partial correction replaces a
-- full-period value, and a later full-period file replaces a partial correction; an older file never replaces a newer
-- one (utilts_consumption_correction_not_newer). The same-cohort path is unchanged (j205_crossing is false there).
-- gridex_ingest_metering_value_atomic stores the new revision and keeps the history.
--
-- Exact-needle rewrite of the installed body (last changed by 20261026180000); each needle must occur exactly once and
-- the marker must be absent (j2_05_consumer_source_changed). Owner, ACL, security definer, volatility and configuration
-- (proconfig) are preserved and checked.
begin;

do $j205$
declare
  old_decl constant text := $c$ j203_estimate_to_final boolean := false;$c$;
  new_decl constant text := $c$ j203_estimate_to_final boolean := false;
 -- J2-05 (20261027150000): a correction of another period of the same series identity (crossing correction).
 j205_crossing boolean := false;$c$;
  old_cohort constant text := $c$
    OR jsonb_build_array(sc046_old.company_id::text,sc046_old.series_kind,sc046_old.message_code,coalesce(sc046_old.external_metering_point_id,''),
    coalesce(sc046_old.grid_area_id,''),sc046_old.period_start,sc046_old.period_end,sc046_old.resolution,coalesce(sc046_old.product_id,'')) IS DISTINCT FROM sc046_cohort THEN
    RAISE EXCEPTION 'utilts_consumption_correction_binding_invalid' USING ERRCODE='P0U01'; END IF;$c$;
  new_cohort constant text := $c$ THEN
    RAISE EXCEPTION 'utilts_consumption_correction_binding_invalid' USING ERRCODE='P0U01'; END IF;
   -- J2-05: another cohort only for the same identity except the period, both periods covering this interval.
   j205_crossing:=jsonb_build_array(sc046_old.company_id::text,sc046_old.series_kind,sc046_old.message_code,coalesce(sc046_old.external_metering_point_id,''),
    coalesce(sc046_old.grid_area_id,''),sc046_old.period_start,sc046_old.period_end,sc046_old.resolution,coalesce(sc046_old.product_id,'')) IS DISTINCT FROM sc046_cohort;
   IF j205_crossing AND (jsonb_build_array(sc046_old.company_id::text,sc046_old.series_kind,sc046_old.message_code,coalesce(sc046_old.external_metering_point_id,''),
    coalesce(sc046_old.grid_area_id,''),sc046_old.resolution,coalesce(sc046_old.product_id,'')) IS DISTINCT FROM (sc046_cohort-6)-5
    OR sc046_old.period_start IS NULL OR sc046_old.period_end IS NULL OR sc046_own.period_start IS NULL OR sc046_own.period_end IS NULL
    OR sc046_old.period_start>(v_observation->>'periodStart')::timestamptz OR sc046_old.period_end<(v_observation->>'periodEnd')::timestamptz
    OR sc046_own.period_start>(v_observation->>'periodStart')::timestamptz OR sc046_own.period_end<(v_observation->>'periodEnd')::timestamptz) THEN
    RAISE EXCEPTION 'utilts_consumption_correction_binding_invalid' USING ERRCODE='P0U01'; END IF;$c$;
  old_newer constant text := $c$ OR sc046_own.version_no<=1
    OR sc046_own.supersedes_series_id IS NULL OR $c$;
  new_newer constant text := $c$ OR (NOT j205_crossing AND (sc046_own.version_no<=1
    OR sc046_own.supersedes_series_id IS NULL)) OR $c$;
  old_walk constant text := $c$
   sc046_hop:=sc046_own;sc046_seen:=ARRAY[sc046_own.id];sc046_previous_time:=sc046_time;
   LOOP
$c$;
  new_walk constant text := $c$
   -- J2-05: a crossing correction is strictly later than every overlapping series of another period (same identity
   -- and environment); the same-cohort ancestry walk below does not apply to it.
   IF j205_crossing AND EXISTS(SELECT FROM public.meter_reading_series h WHERE h.company_id=p_company_id
     AND jsonb_build_array(h.company_id::text,h.series_kind,h.message_code,coalesce(h.external_metering_point_id,''),
      coalesce(h.grid_area_id,''),h.resolution,coalesce(h.product_id,''))=(sc046_cohort-6)-5
     AND (h.period_start IS DISTINCT FROM sc046_own.period_start OR h.period_end IS DISTINCT FROM sc046_own.period_end)
     AND (h.period_start IS NULL OR h.period_end IS NULL OR (h.period_start<(v_observation->>'periodEnd')::timestamptz AND h.period_end>(v_observation->>'periodStart')::timestamptz))
     AND (EXISTS(SELECT FROM public.ediel_messages o WHERE o.id=h.source_ediel_message_id AND o.environment=v_contract->>'environment') OR EXISTS(SELECT FROM gridex_utilts_binding.receipts r WHERE r.source_message_id=h.source_ediel_message_id AND r.environment=v_contract->>'environment') OR EXISTS(SELECT FROM gridex_utilts_binding.contracts c WHERE c.series_id=h.id AND c.environment=v_contract->>'environment') OR NOT EXISTS(SELECT FROM public.ediel_messages o WHERE o.id=h.source_ediel_message_id))
     AND (coalesce(h.latest_update_date,h.registration_date) IS NULL OR coalesce(h.latest_update_date,h.registration_date)>=sc046_time)) THEN
    RAISE EXCEPTION 'utilts_consumption_correction_not_newer' USING ERRCODE='P0U01'; END IF;
   sc046_hop:=sc046_own;sc046_seen:=ARRAY[sc046_own.id];sc046_previous_time:=sc046_time;
   LOOP
    EXIT WHEN j205_crossing;
$c$;
  f record;
  body text;
  needle text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p
  where p.oid = 'public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb)'::regprocedure;
  foreach needle in array array[old_decl, old_cohort, old_newer, old_walk] loop
    if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1 then
      raise exception 'j2_05_consumer_source_changed' using errcode = 'P0U01';
    end if;
  end loop;
  if position('J2-05 (20261027150000)' in f.prosrc) <> 0
    or position('J2-03 (20261026180000)' in f.prosrc) = 0
    or not (f.metadata->>'prosecdef')::boolean
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'j2_05_consumer_source_changed' using errcode = 'P0U01';
  end if;
  body := replace(replace(replace(replace(f.prosrc, old_decl, new_decl), old_cohort, new_cohort), old_newer, new_newer), old_walk, new_walk);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'j2_05_consumer_metadata_changed' using errcode = 'P0U01';
  end if;
end
$j205$;

commit;
