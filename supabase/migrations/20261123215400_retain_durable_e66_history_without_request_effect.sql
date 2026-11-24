ALTER TABLE gridex_e66_intake.completions
  ADD COLUMN historical_only boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT e66_historical_completion_has_no_effect CHECK (
    NOT historical_only OR (observation_count=0 AND billing_underlay_id IS NULL AND billing_underlay_fingerprint IS NULL)
  );

CREATE FUNCTION gridex_e66_intake.is_historical_completion_v1(p_source uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog
AS $history$
  SELECT EXISTS (
    SELECT FROM gridex_e66_intake.work w
    JOIN gridex_e66_intake.completions d
      ON (d.source_id,d.company_id,d.environment,d.source_sha256)=(w.source_id,w.company_id,w.environment,w.payload_sha256)
    JOIN gridex_e66_intake.qualified q ON (q.source_id,q.transaction_id,q.contract_hash)=(d.source_id,d.transaction_id,d.contract_hash)
    JOIN public.meter_reading_series s ON (s.id,s.company_id,s.source_ediel_message_id,s.source_transaction_reference)
      =(q.series_id,w.company_id,w.source_id,q.transaction_id)
    WHERE w.source_id=p_source AND w.phase='complete' AND d.historical_only
      AND s.message_code='E66' AND NOT s.is_current AND s.version_no>1 AND s.supersedes_series_id IS NULL
      AND NOT EXISTS (SELECT FROM gridex_e66_metering_stage.jobs j WHERE j.source_id=w.source_id)
      AND NOT EXISTS (SELECT FROM gridex_e66_request_retry.commands r WHERE r.source_id=w.source_id)
  )
$history$;
REVOKE ALL ON FUNCTION gridex_e66_intake.is_historical_completion_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.complete_historical_qualification_v1(
  p_work gridex_e66_intake.work,p_series uuid,p_transaction text,p_contract_hash text,p_actor uuid,p_lease uuid
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog
AS $history$
BEGIN
  IF p_work.phase IS DISTINCT FROM 'qualification' OR p_work.lease_actor IS DISTINCT FROM p_actor
    OR p_work.lease_token IS DISTINCT FROM p_lease OR p_work.lease_until<=clock_timestamp()
    OR NOT EXISTS (
      SELECT FROM public.meter_reading_series s
      WHERE (s.id,s.company_id,s.source_ediel_message_id,s.source_transaction_reference)
        =(p_series,p_work.company_id,p_work.source_id,p_transaction)
        AND s.message_code='E66' AND s.is_current IS FALSE AND s.version_no>1 AND s.supersedes_series_id IS NULL
    )
  THEN RAISE EXCEPTION 'e66_historical_qualification_unavailable' USING ERRCODE='P0U01'; END IF;
  INSERT INTO gridex_e66_intake.completions(source_id,company_id,environment,source_sha256,transaction_id,contract_hash,
    observation_count,seal_actor,seal_lease,historical_only)
  VALUES(p_work.source_id,p_work.company_id,p_work.environment,p_work.payload_sha256,p_transaction,p_contract_hash,0,p_actor,p_lease,true);
  UPDATE gridex_e66_intake.work SET phase='complete',lease_actor=NULL,lease_token=NULL,lease_until=NULL
    WHERE source_id=p_work.source_id;
  IF NOT gridex_e66_intake.is_historical_completion_v1(p_work.source_id)
  THEN RAISE EXCEPTION 'e66_historical_qualification_unavailable' USING ERRCODE='P0U01'; END IF;
END
$history$;
REVOKE ALL ON FUNCTION gridex_e66_intake.complete_historical_qualification_v1(gridex_e66_intake.work,uuid,text,text,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION pg_temp.gridex_edit_e66_history(p_target regprocedure,p_before text,p_after text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog
AS $rewrite$
DECLARE target record;
BEGIN
  SELECT oid,prosrc,pg_get_functiondef(oid) AS body,to_jsonb(p)-'prosrc' AS properties
    INTO STRICT target FROM pg_proc p WHERE oid=p_target;
  IF (length(target.prosrc)-length(replace(target.prosrc,p_before,'')))/length(p_before)<>1
  THEN RAISE EXCEPTION 'e66_historical_owner_changed:%',p_target; END IF;
  EXECUTE replace(target.body,target.prosrc,replace(target.prosrc,p_before,p_after));
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target.oid) IS DISTINCT FROM target.properties
  THEN RAISE EXCEPTION 'e66_historical_owner_permissions_changed:%',p_target; END IF;
END
$rewrite$;

SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_commit_e66_matched_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb,jsonb)',
  $old$  OR native_results#>>'{0,versionState}' IS DISTINCT FROM 'current'$old$,
  $new$  OR (native_results#>>'{0,versionState}' IN ('current','late_older_history')) IS NOT TRUE$new$);
SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_commit_e66_matched_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb,jsonb)',
  $old$  jsonb_set(p_reply - 'requestId','{normalizedMeteringPayload,utiltsTransactionPersistenceResults}',native_results,false));
 UPDATE gridex_e66_intake.work SET phase='normalization',lease_actor=NULL,lease_token=NULL,lease_until=NULL
 WHERE source_id=p_source;$old$,
  $new$  CASE WHEN native_results#>>'{0,versionState}'='current'
   THEN jsonb_set(p_reply - 'requestId','{normalizedMeteringPayload,utiltsTransactionPersistenceResults}',native_results,false) END);
 IF native_results#>>'{0,versionState}'='late_older_history' THEN
  PERFORM gridex_e66_intake.complete_historical_qualification_v1(w,series,tx_id,contract_hash,p_actor,p_lease);
 ELSE
  UPDATE gridex_e66_intake.work SET phase='normalization',lease_actor=NULL,lease_token=NULL,lease_until=NULL
  WHERE source_id=p_source;
 END IF;$new$);

SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)',
  $old$source public.ediel_messages%rowtype; command_hash text; tx_id text; series uuid; contract_hash text;$old$,
  $new$source public.ediel_messages%rowtype; command_hash text; tx_id text; series uuid; contract_hash text; native_results jsonb;$new$);
SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)',
  $old$PERFORM gridex_e66_intake.persist_owned_utilts_v1($old$,
  $new$native_results:=gridex_e66_intake.persist_owned_utilts_v1($new$);
SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)',
  $old$ UPDATE gridex_e66_intake.work SET phase='normalization',lease_actor=NULL,lease_token=NULL,lease_until=NULL
 WHERE source_id=p_source;$old$,
  $new$ IF native_results#>>'{0,versionState}'='late_older_history' THEN
  IF jsonb_array_length(native_results) IS DISTINCT FROM 1
    OR native_results#>>'{0,transactionId}' IS DISTINCT FROM tx_id
    OR native_results#>>'{0,seriesId}' IS DISTINCT FROM series::text
    OR native_results#>>'{0,contractHash}' IS DISTINCT FROM contract_hash
    OR native_results#>>'{0,sourceBinding,sourceMessageId}' IS DISTINCT FROM p_source::text
    OR native_results#>>'{0,sourceBinding,rawHash}' IS DISTINCT FROM w.payload_sha256
  THEN RAISE EXCEPTION 'e66_historical_qualification_unavailable' USING ERRCODE='P0U01'; END IF;
  PERFORM gridex_e66_intake.complete_historical_qualification_v1(w,series,tx_id,contract_hash,p_actor,p_lease);
 ELSE
  UPDATE gridex_e66_intake.work SET phase='normalization',lease_actor=NULL,lease_token=NULL,lease_until=NULL
  WHERE source_id=p_source;
 END IF;$new$);

SELECT pg_temp.gridex_edit_e66_history(
  'gridex_e66_intake.matched_request_ack_eligible_v1(uuid)',
  $old$ SELECT gridex_e66_intake.request_upgrade_state_v1(p_source) IN ('matched_basis','unmatched') AND NOT EXISTS(
   SELECT FROM gridex_e66_intake.matched_request_basis b LEFT JOIN gridex_e66_request_retry.commands c ON c.source_id=b.source_id AND
     (c.company_id,c.environment,c.request_id,c.actor_id)=(b.company_id,b.environment,b.request_id,b.actor_id)
   WHERE b.source_id=p_source AND (b.response_base IS NOT NULL
     OR coalesce(c.outcome->>'status','') NOT IN ('received','partial','replaced')))
$old$,
  $new$ SELECT gridex_e66_intake.request_upgrade_state_v1(p_source) IN ('matched_basis','unmatched')
   AND (gridex_e66_intake.is_historical_completion_v1(p_source) OR NOT EXISTS(
     SELECT FROM gridex_e66_intake.matched_request_basis b LEFT JOIN gridex_e66_request_retry.commands c ON c.source_id=b.source_id AND
       (c.company_id,c.environment,c.request_id,c.actor_id)=(b.company_id,b.environment,b.request_id,b.actor_id)
     WHERE b.source_id=p_source AND (b.response_base IS NOT NULL
       OR coalesce(c.outcome->>'status','') NOT IN ('received','partial','replaced'))))
$new$);

SELECT pg_temp.gridex_edit_e66_history(
  'gridex_utilts_binding.require_positive_storage_authority_v1(uuid,text,uuid,text,uuid,text)',
  $old$    AND d.observation_count=jsonb_array_length(stored.contract->'observations')
    AND CASE stored.contract#>>'{billing,capability}'
     WHEN 'skip' THEN d.billing_underlay_id IS NULL AND d.billing_underlay_fingerprint IS NULL
     WHEN 'write' THEN d.billing_underlay_id IS NOT NULL AND d.billing_underlay_fingerprint IS NOT NULL
      AND gridex_e66_intake.bound_underlay_fingerprint_v1(p_company_id,source.id,d.billing_underlay_id)
        = d.billing_underlay_fingerprint
     ELSE false END) THEN$old$,
  $new$    AND CASE WHEN d.historical_only THEN gridex_e66_intake.is_historical_completion_v1(w.source_id)
     ELSE d.observation_count=jsonb_array_length(stored.contract->'observations')
      AND CASE stored.contract#>>'{billing,capability}'
       WHEN 'skip' THEN d.billing_underlay_id IS NULL AND d.billing_underlay_fingerprint IS NULL
       WHEN 'write' THEN d.billing_underlay_id IS NOT NULL AND d.billing_underlay_fingerprint IS NOT NULL
        AND gridex_e66_intake.bound_underlay_fingerprint_v1(p_company_id,source.id,d.billing_underlay_id)
          = d.billing_underlay_fingerprint
       ELSE false END END) THEN$new$);

SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_read_e66_request_response_history_v1(uuid,uuid,text,integer)',
  $old$      links.value_count,links.current_count$old$,
  $new$      links.value_count,links.current_count,
      gridex_e66_intake.is_historical_completion_v1(m.id) AS historical_only$new$);
SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_read_e66_request_response_history_v1(uuid,uuid,text,integer)',
  $old$      AND links.value_count>0$old$,
  $new$      AND (links.value_count>0 OR gridex_e66_intake.is_historical_completion_v1(m.id))$new$);
SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_read_e66_request_response_history_v1(uuid,uuid,text,integer)',
  $old$ SELECT id,external_reference,value_count,current_count,$old$,
  $new$ SELECT id,external_reference,value_count,current_count,historical_only,$new$);
SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_read_e66_request_response_history_v1(uuid,uuid,text,integer)',
  $old$'firstObservedAt',(SELECT min(f.observed_at) FROM facts f),
   'latestObservedAt',(SELECT max(f.observed_at) FROM facts f),$old$,
  $new$'firstObservedAt',(SELECT min(f.observed_at) FROM facts f WHERE NOT f.historical_only),
   'latestObservedAt',(SELECT max(f.observed_at) FROM facts f WHERE NOT f.historical_only),$new$);
SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_read_e66_request_response_history_v1(uuid,uuid,text,integer)',
  $old$'storedValueCount',f.value_count,'currentValueCount',f.current_count)$old$,
  $new$'storedValueCount',f.value_count,'currentValueCount',f.current_count,'historicalOnly',f.historical_only)$new$);

-- Staff can read the historical response alongside current receptions. It must
-- never advance the independent request chronology or replace its active source.
SELECT pg_temp.gridex_edit_e66_history(
  'public.gridex_sync_current_e66_request_v1(uuid,uuid,uuid,uuid,uuid[],jsonb)',
  $old$    WHERE reply.value->>'observedAt' IS NOT NULL$old$,
  $new$    WHERE reply.value->>'observedAt' IS NOT NULL AND reply.value->>'historicalOnly' IS DISTINCT FROM 'true'$new$);
