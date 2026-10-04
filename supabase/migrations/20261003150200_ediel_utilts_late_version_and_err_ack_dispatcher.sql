-- U-04 / F-U-04: persist_series_v2 chose the current meter_reading_series by
-- arrival order, so an older data version (own 532/512) that arrives late became
-- is_current and displaced newer data. It is now stored as non-current history
-- linked to nothing, and the newer current version stays current. Positive ACK
-- and storage are unchanged; no ERR is raised for arrival order.
--
-- U-14 / F-U-14: 20261001003807 replaced the public positive-ACK authority with
-- a UTILTS-only storage body, dropping the received-UTILTS_ERR dispatcher that
-- 20261001003657 installed, so a positive APERAK for a received ERR always
-- failed. The storage body moves to a private name and the dispatcher is
-- restored in front of it. Body rewrites with predecessor/metadata guards.
BEGIN;
DO $u04$DECLARE f record;pair text[];body text;
 pairs CONSTANT text[][]:=ARRAY[
  ARRAY[$n$  v_previous_id uuid;
$n$,$n$  v_previous_id uuid;
  v_late_older boolean;
$n$],
  ARRAY[$n$      v_previous_id := null;
      v_version := 1;
$n$,$n$      v_previous_id := null;
      v_version := 1;
      v_late_older := false;
$n$],
  ARRAY[$n$      if v_previous_id is not null then v_version := v_version + 1; end if;
$n$,$n$      if v_previous_id is not null then
        v_version := v_version + 1;
        -- U-04: a version whose own 532/512 is older than the current one is
        -- retained as history and never displaces newer data on late arrival.
        select coalesce(nullif(v_item->>'latestUpdateDate','')::timestamptz,nullif(v_item->>'registrationDate','')::timestamptz)
               < coalesce(p.latest_update_date,p.registration_date)
          into v_late_older from public.meter_reading_series p where p.id=v_previous_id;
        v_late_older := coalesce(v_late_older,false);
      end if;
$n$],
  ARRAY[$n$        v_version,v_previous_id,true,nullif(v_item->>'correctionReason',''),v_item,$n$,$n$        v_version,case when v_late_older then null else v_previous_id end,not v_late_older,nullif(v_item->>'correctionReason',''),v_item,$n$],
  ARRAY[$n$        if v_previous_id is not null then
          update public.meter_reading_series set is_current=false where id=v_previous_id;$n$,$n$        if v_previous_id is not null and not v_late_older then
          update public.meter_reading_series set is_current=false where id=v_previous_id;$n$]];
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='gridex_utilts_binding.persist_series_v2(uuid,text,uuid,text,jsonb)'::regprocedure;
 body:=f.prosrc;
 FOREACH pair SLICE 1 IN ARRAY pairs LOOP
  IF (length(body)-length(replace(body,pair[1],'')))/length(pair[1])<>1 THEN RAISE EXCEPTION 'utilts_series_late_version_predecessor_required';END IF;
  body:=replace(body,pair[1],pair[2]);
 END LOOP;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'utilts_series_late_version_metadata_changed';END IF;
END$u04$;

DO $u14$BEGIN
 IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid='public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text)'::regprocedure
   AND p.prosrc LIKE '%utilts_positive_ack_storage_unavailable%' AND p.prosrc NOT LIKE '%gridex_received_err_response.require_v1%')
 THEN RAISE EXCEPTION 'utilts_positive_ack_dispatcher_predecessor_required';END IF;
 IF to_regprocedure('gridex_utilts_binding.require_positive_storage_authority_v1(uuid,text,uuid,text,uuid,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'utilts_positive_ack_storage_authority_exists';END IF;
END$u14$;
ALTER FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) SET SCHEMA gridex_utilts_binding;
ALTER FUNCTION gridex_utilts_binding.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) RENAME TO require_positive_storage_authority_v1;
REVOKE ALL ON FUNCTION gridex_utilts_binding.require_positive_storage_authority_v1(uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_transaction_id text,p_ack_message_id uuid DEFAULT NULL,p_ack_raw_payload text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;basis jsonb;f gridex_received_err_response.final_responses%rowtype;ack public.ediel_messages%rowtype;
BEGIN
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
 IF source.message_family IS DISTINCT FROM 'UTILTS_ERR' THEN RETURN gridex_utilts_binding.require_positive_storage_authority_v1(p_company_id,p_environment,p_source_message_id,p_transaction_id,p_ack_message_id,p_ack_raw_payload);END IF;
 basis:=gridex_received_err_response.require_v1(p_company_id,p_environment,p_source_message_id);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(basis->'transactions')t WHERE t->>'transactionId'=p_transaction_id) THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
 IF p_ack_message_id IS NOT NULL OR p_ack_raw_payload IS NOT NULL THEN
  SELECT * INTO f FROM gridex_received_err_response.final_responses WHERE source_message_id=p_source_message_id AND transaction_id=p_transaction_id;
  SELECT * INTO ack FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id AND environment=p_environment AND direction='outbound';
  IF ack.id IS NULL OR f.ack_message_id IS DISTINCT FROM p_ack_message_id OR ack.related_message_id IS DISTINCT FROM p_source_message_id OR ack.raw_payload IS DISTINCT FROM p_ack_raw_payload
   OR f.company_id IS DISTINCT FROM p_company_id OR f.environment IS DISTINCT FROM p_environment OR f.ack_payload_hash IS DISTINCT FROM encode(sha256(convert_to(p_ack_raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
 END IF;
 RETURN jsonb_build_object('authorityVersion',1,'companyId',p_company_id,'environment',p_environment,'sourceMessageId',p_source_message_id,'transactionId',p_transaction_id,'ackMessageId',p_ack_message_id,
  'sourceRawHash',basis->'sourceHash','ackRawHash',CASE WHEN p_ack_message_id IS NULL THEN NULL ELSE encode(sha256(convert_to(p_ack_raw_payload,'UTF8')),'hex') END);
END $$;
REVOKE ALL ON FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) TO service_role;
COMMIT;
