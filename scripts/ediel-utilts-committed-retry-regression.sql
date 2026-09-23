\set ON_ERROR_STOP on
\pset pager off
-- Disposable empty-replay database only. The synthetic rows roll back.
BEGIN;
CREATE TEMP TABLE utilts_retry_results(name text PRIMARY KEY, passed boolean NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.retry_check(label text, passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO utilts_retry_results VALUES (label,coalesce(passed,false)); END $$;

-- V1 now requires one complete physical batch and an explicit contract. Keep
-- all eight reservation assertions, supplying both physical siblings on every
-- attempt instead of the old unbound subset calls. No legacy backfill adapter.
CREATE FUNCTION pg_temp.retry_persist(p_company uuid,p_environment text,p_source uuid,p_code text,p_requested jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_transaction_id text; v_item jsonb; v_batch jsonb:='[]'; v_contract jsonb; v_attribution jsonb; v_existing public.ediel_ack_transaction_results%rowtype; v_results jsonb; v_raw text;
BEGIN
 v_attribution:=jsonb_build_object('capability','skip','reason','native_no_consumption_control','customerId',NULL,'siteId',NULL,'customerSiteId',NULL,'meteringPointId',NULL,'gridOwnerId',NULL,'sourceRequestId',NULL);
 FOREACH v_transaction_id IN ARRAY ARRAY['TX-1','TX-2'] LOOP
  SELECT value INTO v_item FROM jsonb_array_elements(p_requested) WHERE value->>'transactionId'=v_transaction_id;
  IF v_item IS NULL THEN
   SELECT q_ack.* INTO v_existing FROM public.ediel_ack_transaction_results q_ack WHERE q_ack.source_message_id=p_source AND q_ack.source_transaction_id=v_transaction_id;
   v_item:=jsonb_build_object('transactionId',v_transaction_id,'disposition',coalesce(v_existing.disposition,'internal_review'),'responseType',coalesce(v_existing.planned_response_type,'none'),'issueCodes',coalesce(to_jsonb(v_existing.issue_codes),'[]'),'seriesKind','actual','quantities','[]'::jsonb);
  END IF;
  v_contract:=jsonb_build_object('version',1,'projectionVersion','utilts-consumption-v1','attributionVersion','tenant-match-v1','companyId',p_company,'environment',p_environment,'messageCode',p_code,'transactionId',v_transaction_id,'seriesKind','actual','profileKey','native-reservation-control','profileVersion',NULL,'rulePackHash',NULL,'guideRevision','25-A-4','sourceType','ediel_utilts',
   'interpretation',jsonb_build_object('localPeriodStart',NULL,'localPeriodEnd',NULL,'localRegistration',NULL,'resolutionValue',NULL,'resolutionFormat',NULL,'timezoneRaw',NULL,'timezoneFormat',NULL,'offsetMinutes',NULL,'timestampPolicy','no-consumption-v1'),
   'observations','[]'::jsonb,'metering',v_attribution,'billing',v_attribution||jsonb_build_object('requestScope',NULL,'periodStart',NULL,'periodEnd',NULL,'month',NULL,'year',NULL,'status','received','sourceSystem','ediel_utilts','currency','SEK'),'billingContributionOrdinals','[]'::jsonb);
  v_batch:=v_batch||jsonb_build_array(v_item||jsonb_build_object('consumptionContract',v_contract));
 END LOOP;
 SELECT m.raw_payload INTO v_raw FROM public.ediel_messages m WHERE m.id=p_source;
 v_results:=public.gridex_persist_utilts_consumption_v1(p_company,p_environment,p_source,p_code,v_raw,v_batch);
 RETURN (SELECT jsonb_agg(value) FROM jsonb_array_elements(v_results) WHERE value->>'transactionId'=p_requested#>>'{0,transactionId}');
END $$;

DO $$
DECLARE
  company constant uuid := '00000000-0000-4000-8000-00000000f921';
  source constant uuid := '00000000-0000-4000-8000-00000000f922';
  profile public.ediel_message_profiles%rowtype;
  pack public.ediel_rule_packs%rowtype;
  held jsonb := '[{"transactionId":"TX-1","disposition":"internal_review","responseType":"none","issueCodes":["UTILTS_STRUCTURE_UNAVAILABLE"],"seriesKind":"actual","quantities":[]}]';
  accepted jsonb := '[{"transactionId":"TX-1","disposition":"accepted","responseType":"positive_aperak","issueCodes":[],"seriesKind":"actual","externalMeteringPointId":"POINT","periodStart":"2026-10-01T00:00:00Z","periodEnd":"2026-11-01T00:00:00Z","resolution":"monthly","quantities":[]}]';
  negative jsonb := '[{"transactionId":"TX-2","disposition":"processability_rejected","responseType":"utilts_err","issueCodes":["E14"],"seriesKind":"actual","quantities":[]}]';
  later_positive jsonb := '[{"transactionId":"TX-2","disposition":"accepted","responseType":"positive_aperak","issueCodes":[],"seriesKind":"actual","externalMeteringPointId":"POINT","quantities":[]}]';
  result jsonb;
  series_id uuid;
  blocked boolean;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES (company,'E035 UTILTS retry synthetic','active');
  SELECT * INTO STRICT profile FROM public.ediel_message_profiles
    WHERE message_code='E66' AND direction IN ('inbound','both') AND is_enabled
    ORDER BY profile_key LIMIT 1;
  SELECT * INTO STRICT pack FROM public.ediel_rule_packs WHERE id=profile.rule_pack_id;
  INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,execution_context_snapshot,
    canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
  VALUES (source,company,'test','inbound','edifact','UTILTS','E66','received','UNH+1+UTILTS:D:02B:UN:E5SE5A''BGM+E66+RESERVATION+9''IDE+24+TX-1''IDE+24+TX-2''UNT+5+1''',clock_timestamp(),'{}',
    pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile);

  EXECUTE 'SET LOCAL ROLE service_role';
  result:=pg_temp.retry_persist(company,'test',source,'E66',held);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.retry_check('held-has-no-series',result#>>'{0,persistenceStatus}'='not_applicable'
    AND NOT EXISTS(SELECT FROM public.meter_reading_series WHERE source_ediel_message_id=source));

  -- The planned negative response is committed before the ACK is created.
  -- Simulate interruption at that point: no final_response_type or series.
  EXECUTE 'SET LOCAL ROLE service_role';
  result:=pg_temp.retry_persist(company,'test',source,'E66',negative);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.retry_check('negative-ack-plan-is-durable-before-finalization',result#>>'{0,responseType}'='utilts_err'
    AND (SELECT planned_response_type='utilts_err' AND final_response_type IS NULL AND persisted_series_id IS NULL
      FROM public.ediel_ack_transaction_results WHERE source_message_id=source AND source_transaction_id='TX-2'));
  blocked:=false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM pg_temp.retry_persist(company,'test',source,'E66',later_positive);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN check_violation THEN blocked:=SQLERRM='utilts_committed_transaction_retry_conflict'; EXECUTE 'RESET ROLE'; END;
  PERFORM pg_temp.retry_check('interrupted-err-cannot-become-positive-aperak',blocked
    AND (SELECT disposition='processability_rejected' AND planned_response_type='utilts_err' AND final_response_type IS NULL
      FROM public.ediel_ack_transaction_results WHERE source_message_id=source AND source_transaction_id='TX-2'));

  EXECUTE 'SET LOCAL ROLE service_role';
  result:=pg_temp.retry_persist(company,'test',source,'E66',accepted);
  EXECUTE 'RESET ROLE';
  series_id:=(result#>>'{0,seriesId}')::uuid;
  PERFORM pg_temp.retry_check('fresh-authority-releases-held-transaction',result#>>'{0,persistenceStatus}'='persisted'
    AND series_id IS NOT NULL AND (SELECT disposition FROM public.ediel_ack_transaction_results
      WHERE source_message_id=source AND source_transaction_id='TX-1')='accepted');

  EXECUTE 'SET LOCAL ROLE service_role';
  result:=pg_temp.retry_persist(company,'test',source,'E66',accepted);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.retry_check('persisted-retry-preserves-series',result#>>'{0,idempotentReplay}'='true'
    AND (result#>>'{0,seriesId}')::uuid=series_id
    AND (SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=source)=1);

  blocked:=false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM pg_temp.retry_persist(company,'test',source,'E66',held);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN check_violation THEN blocked:=SQLERRM='utilts_committed_transaction_retry_conflict'; EXECUTE 'RESET ROLE'; END;
  PERFORM pg_temp.retry_check('persisted-retry-cannot-become-held',blocked
    AND (SELECT persisted_series_id FROM public.ediel_ack_transaction_results WHERE source_message_id=source AND source_transaction_id='TX-1')=series_id);

  -- Simulate the already finalized ACK row after ACK message creation. The
  -- response FK uses a disposable synthetic row; the guard only tests that
  -- persistence cannot overwrite the final market decision.
  UPDATE public.ediel_ack_transaction_results SET final_response_type='positive_aperak',response_message_id=source,finalized_at=clock_timestamp()
    WHERE source_message_id=source AND source_transaction_id='TX-1';
  EXECUTE 'SET LOCAL ROLE service_role';
  result:=pg_temp.retry_persist(company,'test',source,'E66',accepted);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.retry_check('same-finalized-retry-idempotent',result#>>'{0,idempotentReplay}'='true'
    AND (SELECT final_response_type FROM public.ediel_ack_transaction_results WHERE source_message_id=source AND source_transaction_id='TX-1')='positive_aperak');
  blocked:=false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM pg_temp.retry_persist(company,'test',source,'E66',held);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN check_violation THEN blocked:=SQLERRM='utilts_committed_transaction_retry_conflict'; EXECUTE 'RESET ROLE'; END;
  PERFORM pg_temp.retry_check('finalized-ack-cannot-be-rewritten',blocked
    AND (SELECT disposition='accepted' AND final_response_type='positive_aperak' AND persisted_series_id=series_id
      FROM public.ediel_ack_transaction_results WHERE source_message_id=source AND source_transaction_id='TX-1'));
END $$;

TABLE utilts_retry_results;
DO $$ DECLARE failures text; BEGIN
 SELECT string_agg(name,', ' ORDER BY name) INTO failures FROM utilts_retry_results WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'utilts_committed_retry_regression_failed: %',failures; END IF;
 RAISE NOTICE 'E035 committed UTILTS retries: % checks PASS',(SELECT count(*) FROM utilts_retry_results);
END $$;
ROLLBACK;
