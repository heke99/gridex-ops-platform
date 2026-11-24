-- Keep source-qualified historical V authority. Only the ordinary automatic
-- new-request selector may skip a conclusively elapsed, non-revoked candidate.
DO $migration$
DECLARE
  signature CONSTANT text := 'gridex_service_administration.coordinate_before_manual_resolution_v1(uuid,uuid,uuid,bigint,text)';
  before_sha CONSTANT text := 'f39b9aa54cfff475fa3ca1ffac9126fd1ec9d6150bfe74a621a3faea952d51e7';
  after_sha CONSTANT text := '7bfa2c375d5733bb72fcf2b99794ed8cd9c3dd24a79f9f17d4424168f9fe9e22';
  before_condition CONSTANT text := $condition$ and p.status in ('draft','z13_ready','z13_sent','waiting_for_customer_approval','approved','partially_approved','z14_received','active')
 order by l.created_at,l.id limit 1;$condition$;
  after_condition CONSTANT text := $condition$ and p.status in ('draft','z13_ready','z13_sent','waiting_for_customer_approval','approved','partially_approved','z14_received','active')
 -- A new V request that starts after its predecessor's naturally elapsed
 -- Z14 reporting period needs its own permission. Keep historical readings
 -- and the old market receipt available through their ordinary owners.
 and (CASE WHEN a.mode='V'
        AND p.status IN ('active','approved')
        AND (p.permission_scope IS NULL OR p.permission_scope='V')
        AND p.metadata#>>'{marketPermission,mode}'='S17'
        AND p.inbound_z15_message_id IS NULL
        AND cardinality(a.object_ids)>0 AND cardinality(a.product_ids)>0
        AND a.data_start IS NOT NULL AND isfinite(a.data_start)
        AND (
          SELECT count(*)=cardinality(a.object_ids)::bigint * cardinality(a.product_ids)
            AND count(DISTINCT (site.facility_id, site.metadata->>'product'))=count(*)
            AND bool_and(
              site.status IN ('approved','active')
              AND site.permission_end_at IS NULL
              AND site.start_at IS NOT NULL AND isfinite(site.start_at)
              AND site.end_at IS NOT NULL AND isfinite(site.end_at)
              AND site.end_at>site.start_at
              AND site.end_at<=least(a.data_start,statement_timestamp())
            )
          FROM public.metering_permission_sites site
          WHERE site.company_id=p.company_id AND site.metering_permission_id=p.id
          AND site.customer_id=p.customer_id AND site.facility_id=ANY(a.object_ids)
          AND site.metadata->>'source'='inbound_prodat_z14'
          AND site.metadata->>'mode'='S17' AND site.metadata->>'product'=ANY(a.product_ids)
          AND site.metadata->>'edielMessageId'=coalesce(p.inbound_z14_message_id,p.source_z14_message_id)::text
        )
    THEN gridex_service_administration.permission_matches_assignment_v1(a,p)
    ELSE false END) IS NOT TRUE
 order by l.created_at,l.id limit 1;$condition$;
  function_id regprocedure := to_regprocedure(signature);
  predecessor pg_proc%ROWTYPE;
  successor pg_proc%ROWTYPE;
  definition text;
  next_body text;
BEGIN
  IF function_id IS NULL THEN
    RAISE EXCEPTION 'service_permission_selector_predecessor_required' USING ERRCODE='55000';
  END IF;
  SELECT * INTO STRICT predecessor FROM pg_proc WHERE oid=function_id;
  IF encode(sha256(convert_to(predecessor.prosrc,'UTF8')),'hex') IS DISTINCT FROM before_sha
    OR length(predecessor.prosrc)-length(replace(predecessor.prosrc,before_condition,'')) <> length(before_condition)
    OR predecessor.prosecdef IS NOT TRUE
    OR predecessor.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  THEN
    RAISE EXCEPTION 'service_permission_selector_predecessor_required' USING ERRCODE='55000';
  END IF;

  definition := pg_get_functiondef(function_id);
  next_body := replace(predecessor.prosrc,before_condition,after_condition);
  IF length(definition)-length(replace(definition,predecessor.prosrc,'')) <> length(predecessor.prosrc)
    OR encode(sha256(convert_to(next_body,'UTF8')),'hex') IS DISTINCT FROM after_sha
  THEN
    RAISE EXCEPTION 'service_permission_selector_definition_changed' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,predecessor.prosrc,next_body);

  SELECT * INTO STRICT successor FROM pg_proc WHERE oid=function_id;
  IF successor.prosrc IS DISTINCT FROM next_body
    OR (to_jsonb(successor)-'prosrc') IS DISTINCT FROM (to_jsonb(predecessor)-'prosrc')
  THEN
    RAISE EXCEPTION 'service_permission_selector_authority_changed' USING ERRCODE='55000';
  END IF;
END
$migration$;
