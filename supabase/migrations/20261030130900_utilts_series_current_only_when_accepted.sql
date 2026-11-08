-- claude-track3/017: a UTILTS series moves is_current only when its own
-- 532/512 is STRICTLY newer than the current series, i.e. exactly when the
-- consumer (gridex_consume_utilts_metering_v1) will accept it as a correction.
--
-- Before: persist_series_v2 compared with strict '<' only, so an equal 532/512
-- displaced the current series although consumption then refused it with
-- utilts_consumption_correction_not_newer. The flag stayed on the refused
-- series; VH history (coverage_v1), SC046 return state and later corrections
-- all read the wrong head.
--
-- Now, with both times present and equal:
--  * different content: the new original is stored unchanged as non-current
--    history (same shape as U-04 late-older history; no predecessor link) and
--    one tenant-scoped review item 'utilts_series_version_conflict' is opened
--    in public.ediel_manual_review_items for the source message;
--  * identical content (only the transaction id differs): stored as
--    non-current history, no review item. Current head is untouched.
-- Strictly newer, strictly older and missing-time cases are unchanged.
-- Body rewrite with exact pre-image hash and unchanged pg_proc metadata
-- (signature, SECURITY DEFINER, search_path, owner, ACL). No RLS/grant change.
BEGIN;
DO $t3017$DECLARE f record;pair text[];body text;
 pairs CONSTANT text[][]:=ARRAY[
  ARRAY[$n$  v_late_older boolean;
$n$,$n$  v_late_older boolean;
  v_same_time boolean;
  v_same_content boolean;
$n$],
  ARRAY[$n$      v_late_older := false;
$n$,$n$      v_late_older := false;
      v_same_time := false;
      v_same_content := false;
$n$],
  ARRAY[$n$        select coalesce(nullif(v_item->>'latestUpdateDate','')::timestamptz,nullif(v_item->>'registrationDate','')::timestamptz)
               < coalesce(p.latest_update_date,p.registration_date)
          into v_late_older from public.meter_reading_series p where p.id=v_previous_id;
        v_late_older := coalesce(v_late_older,false);
$n$,$n$        select coalesce(nullif(v_item->>'latestUpdateDate','')::timestamptz,nullif(v_item->>'registrationDate','')::timestamptz)
               < coalesce(p.latest_update_date,p.registration_date),
               coalesce(nullif(v_item->>'latestUpdateDate','')::timestamptz,nullif(v_item->>'registrationDate','')::timestamptz)
               = coalesce(p.latest_update_date,p.registration_date),
               ((v_item-'transactionId')#-'{consumptionContract,transactionId}')
               = ((p.raw_transaction-'transactionId')#-'{consumptionContract,transactionId}')
          into v_late_older,v_same_time,v_same_content from public.meter_reading_series p where p.id=v_previous_id;
        v_late_older := coalesce(v_late_older,false);
        -- T3-017: an equal 532/512 is not newer; the consumer refuses it, so it
        -- never displaces the current head. It is retained as history.
        v_same_time := coalesce(v_same_time,false);
        v_same_content := v_same_time and coalesce(v_same_content,false);
        v_late_older := v_late_older or v_same_time;
$n$],
  ARRAY[$n$        if v_previous_id is not null and not v_late_older then
          update public.meter_reading_series set is_current=false where id=v_previous_id;$n$,$n$        if v_same_time and not v_same_content then
          -- T3-017: same 532/512, different content: version conflict for review.
          insert into public.ediel_manual_review_items(company_id,ediel_message_id,issue_type,title,description,status,payload)
          values (p_company_id,p_source_message_id,'utilts_series_version_conflict',
            'UTILTS series version conflict',
            'Same 532/512 as the current series with different content; stored as non-current history.',
            'open',jsonb_build_object('environment',p_environment,'conflicts',jsonb_build_array(jsonb_build_object(
              'transactionId',v_transaction_id,'seriesId',v_series_id,'currentSeriesId',v_previous_id,
              'versionTime',coalesce(nullif(v_item->>'latestUpdateDate','')::timestamptz,nullif(v_item->>'registrationDate','')::timestamptz),
              'seriesHash',encode(digest(convert_to(v_item::text,'UTF8'),'sha256'),'hex'),
              'currentSeriesHash',(select p.immutable_hash from public.meter_reading_series p where p.id=v_previous_id)))))
          on conflict(ediel_message_id,issue_type) do update
            set payload=jsonb_set(ediel_manual_review_items.payload,'{conflicts}',
                  coalesce(ediel_manual_review_items.payload->'conflicts','[]'::jsonb)||(excluded.payload->'conflicts')),
                updated_at=now()
            where ediel_manual_review_items.company_id=p_company_id;
          if not found then raise exception 'utilts_series_version_conflict_unrecorded' using errcode='23514'; end if;
        end if;
        if v_previous_id is not null and not v_late_older then
          update public.meter_reading_series set is_current=false where id=v_previous_id;$n$]];
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='gridex_utilts_binding.persist_series_v2(uuid,text,uuid,text,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')<>'afd313aca7c2ba1ef5022c766eb2852669042b6fc37c7fd3e8dffeb9624d712f'
 THEN RAISE EXCEPTION 'utilts_series_current_accepted_predecessor_required';END IF;
 body:=f.prosrc;
 FOREACH pair SLICE 1 IN ARRAY pairs LOOP
  IF (length(body)-length(replace(body,pair[1],'')))/length(pair[1])<>1 THEN RAISE EXCEPTION 'utilts_series_current_accepted_anchor_required';END IF;
  body:=replace(body,pair[1],pair[2]);
 END LOOP;
 IF (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1 THEN RAISE EXCEPTION 'utilts_series_current_accepted_definition_conflict';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'utilts_series_current_accepted_metadata_changed';END IF;
END$t3017$;
COMMIT;
