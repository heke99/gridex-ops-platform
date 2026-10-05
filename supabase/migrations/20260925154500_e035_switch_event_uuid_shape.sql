-- Forward repair: valid UUIDs have five groups (8-4-4-4-12). The prior
-- four-group guard treated every real request/point ID as unknown wildcard.
-- A later event UPDATE/DELETE still belongs to the request's earlier owners.
-- Keep both sides of every immutable request and point transition through the
-- event cutoff. A missing or conflicting archive fact is a wildcard.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_correction_process.switch_event_subject_v1(
 p_company_id uuid,p_old jsonb,p_new jsonb,p_captured_at timestamptz,
 p_customer_ids uuid[],p_point_ids text[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE event_side jsonb; request_id text; request_fact record; request_side jsonb;
 point_id text; point_fact record; point_side jsonb;
 seen_request boolean; seen_point boolean;
BEGIN
 FOR event_side IN SELECT v FROM (VALUES(p_old),(p_new)) AS sides(v) WHERE v IS NOT NULL LOOP
  request_id:=event_side->>'switch_request_id';
  IF request_id IS NULL OR request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN RETURN true; END IF;
  seen_request:=false;
  FOR request_fact IN SELECT f.company_id,f.operation,f.old_fact,f.new_fact
   FROM gridex_correction_process.facts f
   WHERE f.table_name='supplier_switch_requests' AND f.row_id=request_id::uuid
    AND f.captured_at<=p_captured_at ORDER BY f.captured_at,f.id LOOP
   IF NOT seen_request AND request_fact.operation<>'INSERT' THEN RETURN true; END IF;
   seen_request:=true;
   IF request_fact.company_id IS DISTINCT FROM p_company_id
    OR (request_fact.old_fact IS NOT NULL AND
     request_fact.old_fact->>'company_id' IS DISTINCT FROM p_company_id::text)
    OR (request_fact.new_fact IS NOT NULL AND
     request_fact.new_fact->>'company_id' IS DISTINCT FROM p_company_id::text)
   THEN RETURN true; END IF;
   FOR request_side IN SELECT v FROM (VALUES(request_fact.old_fact),(request_fact.new_fact)) AS sides(v)
    WHERE v IS NOT NULL LOOP
    IF p_customer_ids IS NOT NULL AND nullif(request_side->>'customer_id','') IS NOT NULL
     AND NOT (request_side->>'customer_id'=ANY(ARRAY(
      SELECT id::text FROM unnest(p_customer_ids) AS customer_scope(id))))
    THEN CONTINUE; END IF;
    point_id:=request_side->>'metering_point_id';
    IF p_point_ids IS NOT NULL AND nullif(point_id,'') IS NOT NULL THEN
     IF point_id=ANY(p_point_ids) THEN RETURN true; END IF;
     IF point_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     THEN RETURN true; END IF;
     seen_point:=false;
     FOR point_fact IN SELECT f.company_id,f.operation,f.old_fact,f.new_fact
      FROM gridex_correction_process.facts f
      WHERE f.table_name='metering_points' AND f.row_id=point_id::uuid
       AND f.captured_at<=p_captured_at ORDER BY f.captured_at,f.id LOOP
      IF NOT seen_point AND point_fact.operation<>'INSERT' THEN RETURN true; END IF;
      seen_point:=true;
      IF point_fact.company_id IS DISTINCT FROM p_company_id
       OR (point_fact.old_fact IS NOT NULL AND
        point_fact.old_fact->>'company_id' IS DISTINCT FROM p_company_id::text)
       OR (point_fact.new_fact IS NOT NULL AND
        point_fact.new_fact->>'company_id' IS DISTINCT FROM p_company_id::text)
      THEN RETURN true; END IF;
      FOR point_side IN SELECT v FROM (VALUES(point_fact.old_fact),(point_fact.new_fact)) AS sides(v)
       WHERE v IS NOT NULL LOOP
       IF coalesce(nullif(point_side->>'normalized_metering_point_id',''),
        nullif(point_side->>'metering_point_id',''),nullif(point_side->>'meter_point_id','')) IS NULL
       THEN RETURN true; END IF;
       IF EXISTS(SELECT FROM unnest(p_point_ids) AS point_scope(id)
        WHERE id IN (point_side->>'normalized_metering_point_id',point_side->>'metering_point_id',
         point_side->>'meter_point_id',point_side->>'site_facility_id'))
       THEN RETURN true; END IF;
      END LOOP;
     END LOOP;
     IF NOT seen_point THEN RETURN true; END IF;
     CONTINUE;
    END IF;
    RETURN true;
   END LOOP;
  END LOOP;
  IF NOT seen_request THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION gridex_correction_process.switch_event_subject_v1(uuid,jsonb,jsonb,timestamptz,uuid[],text[])
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
