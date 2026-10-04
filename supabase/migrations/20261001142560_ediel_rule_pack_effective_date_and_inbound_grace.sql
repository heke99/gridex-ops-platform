-- Rule-pack effectiveness follows the guide calendar, not a manually flipped
-- status. UTILTS 25-A-3 ended 2026-09-30 and 25-A-4 starts 2026-10-01 with
-- status 'future'. The registry resolver already selects it by date, but the
-- source/outbound capture gates admitted only 'active'/'transition', so every
-- UTILTS source failed closed from its effective date.
--
-- The General Technical Rules require receivers to support the immediately
-- preceding guide for the first two weeks after a new guide takes effect
-- (lib/ediel/rulebook/guideRegistry.ts resolveEdielGuideAcceptance: new
-- effective date plus 13 calendar days, inbound only). Outbound traffic always
-- uses the current guide.
--
-- No pack status changes and no approval is claimed. 'draft' and 'retired'
-- remain refused. A 'future' pack is effective only inside its own validity
-- interval. The previous pack is effective for inbound traffic only while its
-- direct successor is in its first 14 days.
BEGIN;
CREATE FUNCTION gridex_ediel_source_rules.pack_effective_v1(p_pack_id uuid,p_direction text,p_date date) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
 SELECT EXISTS(
  SELECT FROM public.ediel_rule_packs r
  WHERE r.id=p_pack_id AND r.status IN('active','transition','future') AND r.valid_from<=p_date
   AND (r.valid_to IS NULL OR p_date<=r.valid_to
    OR (p_direction='inbound' AND EXISTS(
     SELECT FROM public.ediel_rule_packs s
     WHERE s.family=r.family AND s.market=r.market AND s.id<>r.id AND s.status IN('active','transition','future')
      AND s.valid_from=r.valid_to+1 AND p_date>=s.valid_from AND p_date<=s.valid_from+13))))
$$;
REVOKE ALL ON FUNCTION gridex_ediel_source_rules.pack_effective_v1(uuid,text,date) FROM PUBLIC,anon,authenticated,service_role;

DO $rewrite$DECLARE f record;needle text;replacement text;
 targets CONSTANT text[][]:=ARRAY[
  ARRAY['gridex_ediel_source_rules.capture_before_outbound_owner_v1(uuid,uuid)',
   $n$ OR pack.status NOT IN('active','transition')
  OR pack.valid_from>(observed AT TIME ZONE 'Europe/Stockholm')::date OR (pack.valid_to IS NOT NULL AND pack.valid_to<(observed AT TIME ZONE 'Europe/Stockholm')::date)$n$,
   $n$ OR gridex_ediel_source_rules.pack_effective_v1(pack.id,m.direction,(observed AT TIME ZONE 'Europe/Stockholm')::date) IS NOT TRUE$n$],
  ARRAY['gridex_ediel_outbound_owner.prepare_before_native_ack_guide_v1(jsonb)',
   $n$ OR r.status NOT IN('active','transition') OR r.valid_from>business_date OR (r.valid_to IS NOT NULL AND r.valid_to<business_date)$n$,
   $n$ OR gridex_ediel_source_rules.pack_effective_v1(r.id,'outbound',business_date) IS NOT TRUE$n$],
  ARRAY['gridex_ediel_common_header.capture_source()',
   $n$ AND r.status IN('active','transition') AND r.guide_version$n$,
   $n$ AND r.status IN('active','transition','future') AND r.guide_version$n$],
  ARRAY['gridex_bilateral_prodat.scope_v1(uuid,jsonb)',
   $n$ AND market='electricity' AND status IN('active','transition') AND valid_from<=current_date$n$,
   $n$ AND market='electricity' AND status IN('active','transition','future') AND valid_from<=current_date$n$]];
BEGIN
 FOR i IN 1..array_length(targets,1) LOOP
  needle:=targets[i][2];replacement:=targets[i][3];
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=targets[i][1]::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'rule_pack_effective_predecessor_required:%',targets[i][1];END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'rule_pack_effective_metadata_changed:%',targets[i][1];END IF;
 END LOOP;
END$rewrite$;
COMMIT;
