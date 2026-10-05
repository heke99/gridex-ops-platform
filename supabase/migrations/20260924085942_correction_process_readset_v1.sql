-- A prospective, bounded third-set receipt. It cannot attest pre-epoch history.
BEGIN;
CREATE TABLE gridex_correction_process.readsets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 environment text NOT NULL CHECK (environment IN ('test','production')),
 cutoff_at timestamptz NOT NULL,
 customer_id uuid,
 point_id text,
 supply_period_id uuid,
 readset_text text NOT NULL,
 readset_hash text NOT NULL CHECK (readset_hash ~ '^[a-f0-9]{64}$'),
 saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 visibility_snapshot text NOT NULL DEFAULT pg_current_snapshot()::text,
 created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 CHECK (octet_length(readset_text)<=6291456)
);
CREATE INDEX ON gridex_correction_process.readsets(company_id,cutoff_at,id);
ALTER TABLE gridex_correction_process.readsets ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_correction_process.readsets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_correction_process.readsets FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_correction_process.readsets
 FOR EACH ROW EXECUTE FUNCTION gridex_correction_process.immutable_v1();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON gridex_correction_process.readsets
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_correction_process.immutable_v1();

CREATE FUNCTION gridex_correction_process.open_readset_v1(
 p_company_id uuid,p_environment text,p_actor_user_id uuid,p_cutoff_at timestamptz,
 p_customer_id uuid,p_point_id text,p_supply_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 ids bigint[]; witness_ids uuid[]; n bigint; input_bytes bigint; gap_count bigint; witness_count bigint;
 facts_body jsonb; gaps_body jsonb; witnesses_body jsonb; epochs_body jsonb;
 body jsonb; serialized text; stored gridex_correction_process.readsets%rowtype;
 reason text := NULL;
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN ('test','production') OR p_environment IS NULL
 OR p_cutoff_at IS NULL OR NOT isfinite(p_cutoff_at) OR p_cutoff_at>clock_timestamp()
 OR p_actor_user_id IS NULL
 OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'customers.read'),false)
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=p_actor_user_id
  AND is_active AND status='active' AND accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.companies WHERE id=p_company_id AND coalesce(is_active,true)
  AND coalesce(status,'active') NOT IN ('archived','suspended','pending_deletion','deleted','deleted_test_only','inactive','paused','closed'))
 THEN RAISE EXCEPTION 'process_reader_unavailable' USING ERRCODE='42501'; END IF;

 -- Scope before limiting; a known unrelated dimension excludes a transition,
 -- while a missing dimension is conservatively relevant. Both OLD and NEW
 -- scopes are considered for moves. Opaque gaps never disclose cross-tenant facts.
 WITH scoped AS (
  SELECT f.id,f.old_fact,f.new_fact, g.fact_id IS NOT NULL AS has_gap,
   w.fact_id IS NOT NULL AS has_witness,w.id AS witness_id
  FROM gridex_correction_process.facts f
  LEFT JOIN gridex_correction_process.gaps g ON g.fact_id=f.id
  LEFT JOIN gridex_correction_process.witnesses w ON w.fact_id=f.id AND w.observed_at<=p_cutoff_at
  WHERE f.captured_at<=p_cutoff_at
   AND (f.company_id=p_company_id OR f.old_fact->>'company_id'=p_company_id::text
    OR f.new_fact->>'company_id'=p_company_id::text)
   AND (p_customer_id IS NULL OR EXISTS (
    SELECT FROM (VALUES (f.old_fact),(f.new_fact)) side(v) WHERE side.v IS NOT NULL
    AND (nullif(side.v->>'customer_id','') IS NULL OR side.v->>'customer_id'=p_customer_id::text)))
   AND (p_point_id IS NULL OR EXISTS (
    SELECT FROM (VALUES (f.old_fact),(f.new_fact)) side(v) WHERE side.v IS NOT NULL
    AND (coalesce(nullif(side.v->>'metering_point_id',''),nullif(side.v->>'meter_point_id',''),
      nullif(side.v->>'normalized_metering_point_id',''),nullif(side.v->>'ediel_metering_point_id',''),
      nullif(side.v->>'facility_id',''),nullif(side.v->>'normalized_facility_id',''),
      nullif(side.v->>'site_facility_id','')) IS NULL
     OR p_point_id IN (side.v->>'metering_point_id',side.v->>'meter_point_id',
      side.v->>'normalized_metering_point_id',side.v->>'ediel_metering_point_id',
      side.v->>'facility_id',side.v->>'normalized_facility_id',side.v->>'site_facility_id')
     -- Supply periods store the row UUID, not the physical EDIEL identity.
     -- Resolve it against the latest immutable point fact at this transition;
     -- an absent/unknown alias remains a wildcard, never a false exclusion.
     OR (f.table_name='customer_supply_periods' AND nullif(side.v->>'metering_point_id','') IS NOT NULL
      AND coalesce((SELECT CASE
       WHEN coalesce(nullif(coalesce(pf.new_fact,pf.old_fact)->>'normalized_metering_point_id',''),
        nullif(coalesce(pf.new_fact,pf.old_fact)->>'metering_point_id',''),
        nullif(coalesce(pf.new_fact,pf.old_fact)->>'meter_point_id','')) IS NULL THEN true
       ELSE coalesce(p_point_id IN (coalesce(pf.new_fact,pf.old_fact)->>'normalized_metering_point_id',
        coalesce(pf.new_fact,pf.old_fact)->>'metering_point_id',
        coalesce(pf.new_fact,pf.old_fact)->>'meter_point_id',
        coalesce(pf.new_fact,pf.old_fact)->>'site_facility_id'),false) END
       FROM gridex_correction_process.facts pf
       WHERE pf.table_name='metering_points' AND pf.row_id=(side.v->>'metering_point_id')::uuid
        AND pf.captured_at<=f.captured_at AND pf.company_id=p_company_id
       ORDER BY pf.id DESC LIMIT 1),true)))))
   AND (p_supply_period_id IS NULL OR EXISTS (
    SELECT FROM (VALUES (f.old_fact),(f.new_fact)) side(v) WHERE side.v IS NOT NULL
    AND (CASE WHEN f.table_name='customer_supply_periods' THEN f.row_id=p_supply_period_id
     ELSE nullif(side.v->>'supply_period_id','') IS NULL
       OR side.v->>'supply_period_id'=p_supply_period_id::text END)))
 ) SELECT count(*),coalesce(sum(coalesce(octet_length(old_fact::text),0)
      +coalesce(octet_length(new_fact::text),0)),0),
   count(*) FILTER (WHERE has_gap),count(*) FILTER (WHERE has_witness),
   CASE WHEN count(*)<=1000 THEN array_agg(id ORDER BY id) ELSE NULL END,
   CASE WHEN count(*)<=1000 THEN array_agg(witness_id ORDER BY id)
    FILTER (WHERE has_witness) ELSE NULL END
  INTO n,input_bytes,gap_count,witness_count,ids,witness_ids FROM scoped;
 IF n>1000 THEN reason:='scoped_process_count_overflow';
 ELSIF input_bytes>6291456 THEN reason:='scoped_process_bytes_overflow'; END IF;
 IF reason IS NULL THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'table',f.table_name,'rowId',f.row_id,
    'operation',f.operation,'old',f.old_fact,'new',f.new_fact,'factsHash',f.facts_hash,
    'capturedAt',f.captured_at) ORDER BY f.id),'[]'::jsonb)
   INTO facts_body FROM gridex_correction_process.facts f WHERE f.id=ANY(ids)
   AND NOT EXISTS(SELECT FROM gridex_correction_process.gaps g WHERE g.fact_id=f.id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('factId',g.fact_id,'reason',g.reason) ORDER BY g.fact_id),'[]'::jsonb)
   INTO gaps_body FROM gridex_correction_process.gaps g WHERE g.fact_id=ANY(ids);
  SELECT coalesce(jsonb_agg(jsonb_build_object('factId',w.fact_id,'id',w.id,
     'factsHash',w.facts_hash,'observedAt',w.observed_at) ORDER BY w.fact_id),'[]'::jsonb)
   INTO witnesses_body FROM gridex_correction_process.witnesses w
   WHERE w.id=ANY(witness_ids) AND w.observed_at<=p_cutoff_at;
 ELSE
  facts_body:='[]'::jsonb;gaps_body:='[]'::jsonb;witnesses_body:='[]'::jsonb;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.table_name),'[]'::jsonb)
  INTO epochs_body FROM gridex_correction_process.epochs e;
 body:=jsonb_build_object('version',1,'companyId',p_company_id,'environment',p_environment,
  'cutoffAt',p_cutoff_at,'scope',jsonb_build_object('customerId',p_customer_id,'pointId',p_point_id,
   'supplyPeriodId',p_supply_period_id),'complete',false,'authority','none',
  'historyCoverage','before_epoch_unknown','factCount',n,'gapCount',gap_count,
  'witnessCount',witness_count,'reason',reason,'facts',facts_body,'gaps',gaps_body,
  'witnesses',witnesses_body,'epochs',epochs_body,'visibilitySnapshot',pg_current_snapshot()::text);
 serialized:=body::text;
 IF octet_length(serialized)>6291456 THEN
  body:=jsonb_build_object('version',1,'companyId',p_company_id,'environment',p_environment,
   'cutoffAt',p_cutoff_at,'complete',false,'authority','none','historyCoverage','before_epoch_unknown',
   'scope',jsonb_build_object('customerId',p_customer_id,'pointId',p_point_id,
    'supplyPeriodId',p_supply_period_id),
   'factCount',n,'gapCount',gap_count,'witnessCount',witness_count,
   'reason','scoped_process_output_overflow','facts','[]'::jsonb,'gaps','[]'::jsonb,
   'witnesses','[]'::jsonb,'epochs',epochs_body,'visibilitySnapshot',pg_current_snapshot()::text);
  serialized:=body::text;
 END IF;
 INSERT INTO gridex_correction_process.readsets(company_id,environment,cutoff_at,customer_id,point_id,
  supply_period_id,readset_text,readset_hash)
 VALUES(p_company_id,p_environment,p_cutoff_at,p_customer_id,p_point_id,p_supply_period_id,
  serialized,encode(sha256(convert_to(serialized,'UTF8')),'hex')) RETURNING * INTO stored;
 RETURN jsonb_build_object('snapshotId',stored.id,'readsetText',stored.readset_text,
  'readsetHash',stored.readset_hash);
END $$;
REVOKE ALL ON FUNCTION gridex_correction_process.open_readset_v1(uuid,text,uuid,timestamptz,uuid,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_correction_process.open_readset_v1(uuid,text,uuid,timestamptz,uuid,text,uuid) TO service_role;

CREATE FUNCTION public.gridex_open_correction_process_readset_v1(
 p_company_id uuid,p_environment text,p_actor_user_id uuid,p_cutoff_at timestamptz,
 p_customer_id uuid,p_point_id text,p_supply_period_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT gridex_correction_process.open_readset_v1($1,$2,$3,$4,$5,$6,$7)
$$;
REVOKE ALL ON FUNCTION public.gridex_open_correction_process_readset_v1(uuid,text,uuid,timestamptz,uuid,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_open_correction_process_readset_v1(uuid,text,uuid,timestamptz,uuid,text,uuid) TO service_role;
COMMIT;
