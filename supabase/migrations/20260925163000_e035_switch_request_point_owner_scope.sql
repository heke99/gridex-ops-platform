-- A switch request can name an incoming customer distinct from the current
-- owner of its metering point. A matching historical point is sufficient for
-- the point subject; customer-only reads still use the customer predicate.
-- Unknown point history remains a conservative wildcard.
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
    IF (p_point_ids IS NULL OR nullif(request_side->>'metering_point_id','') IS NULL)
     AND p_customer_ids IS NOT NULL AND nullif(request_side->>'customer_id','') IS NOT NULL
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

CREATE OR REPLACE FUNCTION gridex_correction_process.combined_process_body_v3(
 p_company_id uuid,p_cutoff timestamptz,p_customer_ids uuid[],p_point_ids text[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH scoped AS MATERIALIZED (
  SELECT f.id,g.fact_id IS NOT NULL AS has_gap,w.fact_id IS NOT NULL AS has_witness
  FROM gridex_correction_process.facts f
  LEFT JOIN gridex_correction_process.gaps g ON g.fact_id=f.id
  LEFT JOIN gridex_correction_process.witnesses w ON w.fact_id=f.id AND w.observed_at<=p_cutoff
  WHERE f.captured_at<=p_cutoff
   AND (f.company_id=p_company_id OR f.old_fact->>'company_id'=p_company_id::text
    OR f.new_fact->>'company_id'=p_company_id::text)
   AND (f.table_name<>'supplier_switch_events' OR
    gridex_correction_process.switch_event_subject_v1(p_company_id,f.old_fact,f.new_fact,
     f.captured_at,p_customer_ids,p_point_ids))
   AND (f.table_name='supplier_switch_events' OR p_customer_ids IS NULL
    OR (f.table_name='supplier_switch_requests' AND p_point_ids IS NOT NULL AND EXISTS (
     SELECT FROM (VALUES(f.old_fact),(f.new_fact)) request_side(v)
     WHERE nullif(request_side.v->>'metering_point_id','') IS NOT NULL)) OR EXISTS (
    SELECT FROM (VALUES (f.old_fact),(f.new_fact)) side(v) WHERE side.v IS NOT NULL
     AND (nullif(side.v->>'customer_id','') IS NULL OR side.v->>'customer_id'=ANY(ARRAY(SELECT id::text FROM unnest(p_customer_ids) AS customer_scope(id))))))
   AND (f.table_name='supplier_switch_events' OR p_point_ids IS NULL OR EXISTS (
    SELECT FROM (VALUES (f.old_fact),(f.new_fact)) side(v) WHERE side.v IS NOT NULL
     AND ((coalesce(nullif(side.v->>'metering_point_id',''),nullif(side.v->>'meter_point_id',''),
       nullif(side.v->>'normalized_metering_point_id',''),nullif(side.v->>'ediel_metering_point_id',''),nullif(side.v->>'facility_id',''),
       nullif(side.v->>'normalized_facility_id',''),nullif(side.v->>'site_facility_id','')) IS NULL
       AND (f.table_name<>'supplier_switch_requests' OR p_customer_ids IS NULL
        OR nullif(side.v->>'customer_id','') IS NULL OR side.v->>'customer_id'=ANY(ARRAY(
         SELECT id::text FROM unnest(p_customer_ids) AS customer_scope(id)))))
      OR EXISTS(SELECT FROM unnest(p_point_ids) AS point_scope(point_id) WHERE point_id IN (side.v->>'metering_point_id',side.v->>'meter_point_id',
       side.v->>'normalized_metering_point_id',side.v->>'ediel_metering_point_id',
       side.v->>'facility_id',side.v->>'normalized_facility_id',side.v->>'site_facility_id'))
      -- These producers can retain a point row UUID after the current graph is
      -- deleted. Resolve against immutable point history as of the transition.
      -- Missing history is unknown and must stay in the subject's budget.
      OR (f.table_name IN ('customer_supply_periods','customer_contracts',
        'customer_cases','customer_operation_jobs','customer_operation_events',
        'supplier_switch_requests')
       AND side.v->>'metering_point_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND coalesce((SELECT CASE
        WHEN coalesce(nullif(coalesce(pf.new_fact,pf.old_fact)->>'normalized_metering_point_id',''),
         nullif(coalesce(pf.new_fact,pf.old_fact)->>'metering_point_id',''),
         nullif(coalesce(pf.new_fact,pf.old_fact)->>'meter_point_id','')) IS NULL THEN true
        ELSE coalesce(EXISTS(SELECT FROM unnest(p_point_ids) AS point_scope(point_id) WHERE point_id IN (coalesce(pf.new_fact,pf.old_fact)->>'normalized_metering_point_id',
         coalesce(pf.new_fact,pf.old_fact)->>'metering_point_id',
         coalesce(pf.new_fact,pf.old_fact)->>'meter_point_id',
         coalesce(pf.new_fact,pf.old_fact)->>'site_facility_id')),false) END
        FROM gridex_correction_process.facts pf
        WHERE pf.table_name='metering_points' AND pf.row_id=(side.v->>'metering_point_id')::uuid
         AND pf.captured_at<=f.captured_at AND pf.company_id=p_company_id
        ORDER BY pf.id DESC LIMIT 1),true)))))
 ), totals AS (
  SELECT count(*) AS n,count(*) FILTER (WHERE has_gap) AS gaps,
   count(*) FILTER (WHERE has_witness) AS witnesses FROM scoped
 )
 SELECT jsonb_build_object('complete',false,'authority','none',
  'historyCoverage','before_epoch_unknown','factCount',t.n,'gapCount',t.gaps,
  'witnessCount',t.witnesses,'reason',CASE WHEN t.n>1000 THEN 'scoped_process_count_overflow'
   ELSE 'before_epoch_unknown' END,
  'facts',CASE WHEN t.n<=1000 THEN (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'table',f.table_name,'rowId',f.row_id,'operation',f.operation,
    'old',f.old_fact,'new',f.new_fact,'factsHash',f.facts_hash,'capturedAt',f.captured_at,
    'gapReason',g.reason,'witnessId',w.id,'witnessAt',w.observed_at) ORDER BY f.id),'[]'::jsonb)
    FROM scoped s JOIN gridex_correction_process.facts f ON f.id=s.id
    LEFT JOIN gridex_correction_process.gaps g ON g.fact_id=f.id
    LEFT JOIN gridex_correction_process.witnesses w ON w.fact_id=f.id AND w.observed_at<=p_cutoff
    WHERE g.fact_id IS NULL
     AND (f.old_fact->>'company_id' IS NULL OR f.old_fact->>'company_id'=p_company_id::text)
     AND (f.new_fact->>'company_id' IS NULL OR f.new_fact->>'company_id'=p_company_id::text))
   ELSE '[]'::jsonb END,
  'epochs',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.table_name),'[]'::jsonb)
    FROM gridex_correction_process.epochs e)) FROM totals t;
$$;
REVOKE ALL ON FUNCTION gridex_correction_process.combined_process_body_v3(uuid,timestamptz,uuid[],text[])
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
