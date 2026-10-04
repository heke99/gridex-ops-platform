\set ON_ERROR_STOP on
\pset pager off
-- Disposable empty-replay database ONLY. Committed canonical owner leaves are
-- deliberately required, so these declared synthetic control rows cannot roll
-- back as one transaction. Never run against a retained or production database.
-- Modeled canonical facets below test native reservation/retry boundaries; they
-- do not prove an actual TS rule pass, legal mandate, market ACK or old V1 origin.
BEGIN;
CREATE TEMP TABLE utilts_retry_results(name text PRIMARY KEY, passed boolean NOT NULL) ON COMMIT PRESERVE ROWS;
CREATE TEMP TABLE utilts_retry_state(company uuid,source uuid,witness jsonb,held jsonb,accepted jsonb,negative jsonb,later_positive jsonb) ON COMMIT PRESERVE ROWS;
GRANT SELECT ON TABLE utilts_retry_state TO service_role;
CREATE FUNCTION pg_temp.retry_check(label text, passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO utilts_retry_results VALUES (label,coalesce(passed,false)); END $$;

-- Every attempt supplies the SAME complete physical batch. New effects use V2
-- lexical quantities and the one actual named witness captured at setup. Both
-- downstream attribution capabilities stay skipped: this is reservation-only.
CREATE FUNCTION pg_temp.retry_persist(p_company uuid,p_environment text,p_source uuid,p_code text,p_requested jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE tx text; item jsonb; owned jsonb; batch jsonb:='[]'; contract jsonb; attribution jsonb; existing public.ediel_ack_transaction_results%rowtype; results jsonb; raw text; witness jsonb;
BEGIN
 SELECT f.witness INTO STRICT witness FROM utilts_retry_state f WHERE f.source=p_source;
 attribution:=jsonb_build_object('capability','skip','reason','native_no_consumption_control','customerId',NULL,'siteId',NULL,'customerSiteId',NULL,'meteringPointId',NULL,'gridOwnerId',NULL,'sourceRequestId',NULL);
 FOREACH tx IN ARRAY ARRAY['TX-1','TX-2'] LOOP
  SELECT value INTO item FROM jsonb_array_elements(p_requested) WHERE value->>'transactionId'=tx;
  IF item IS NULL THEN
   SELECT a.* INTO existing FROM public.ediel_ack_transaction_results a WHERE a.source_message_id=p_source AND a.source_transaction_id=tx;
   -- A sibling not yet persisted carries the canonical owner's own recorded
   -- outcome; persistence verifies every item against that owner facet.
   SELECT t INTO owned FROM jsonb_array_elements(current_setting('gridex.utilts_retry_owner_facet')::jsonb->'transactions') t WHERE t->>'transactionId'=tx;
   item:=jsonb_build_object('transactionId',tx,'disposition',coalesce(existing.disposition,owned->>'disposition','internal_review'),'responseType',coalesce(existing.planned_response_type,owned->>'responseType','none'),'issueCodes',coalesce(to_jsonb(existing.issue_codes),owned->'issueCodes','[]'),'seriesKind','actual');
  END IF;
  item:=item||jsonb_build_object('unit','KWH','quantities',jsonb_build_array(jsonb_build_object('qualifier','136','value','500')));
  contract:=jsonb_build_object('version',2,'projectionVersion','utilts-consumption-v2','attributionVersion','tenant-match-v1','companyId',p_company,'environment',p_environment,'messageCode',p_code,'transactionId',tx,'seriesKind','actual',
   'profileKey',witness->'profileKey','profileVersion',witness->'version','rulePackHash',witness->'sourceHash','guideRevision',witness#>'{snapshot,rulePack,guide_version}','sourceType','ediel_utilts',
   'interpretation',jsonb_build_object('localPeriodStart',NULL,'localPeriodEnd',NULL,'localRegistration',NULL,'resolutionValue',NULL,'resolutionFormat',NULL,'timezoneRaw',NULL,'timezoneFormat',NULL,'offsetMinutes',NULL,'timestampPolicy','no-consumption-v1'),
   'observations','[]'::jsonb,'metering',attribution,'billing',attribution||jsonb_build_object('requestScope',NULL,'periodStart',NULL,'periodEnd',NULL,'month',NULL,'year',NULL,'status','received','sourceSystem','ediel_utilts','currency','SEK'),'billingContributionOrdinals','[]'::jsonb);
  batch:=batch||jsonb_build_array(item||jsonb_build_object('consumptionContract',contract));
 END LOOP;
 SELECT m.raw_payload INTO raw FROM public.ediel_messages m WHERE m.id=p_source;
 -- Persistence runs as the current tenant execution actor (110500).
 results:=public.gridex_persist_utilts_consumption_v1(p_company,p_environment,p_source,p_code,raw,batch,current_setting('gridex.utilts_retry_actor_user')::uuid);
 RETURN (SELECT jsonb_agg(value) FROM jsonb_array_elements(results) WHERE value->>'transactionId'=p_requested#>>'{0,transactionId}');
END $$;

-- Append a declared complete owner-bound control via the actual V4 facade;
-- no direct private receipt, actor-basis, history or rule-pack backfill occurs.
CREATE FUNCTION pg_temp.retry_owner_facet(first_accepted boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; raw text; hash text; facets jsonb; facts jsonb;
BEGIN
 SELECT * INTO STRICT f FROM utilts_retry_state;
 SELECT m.raw_payload INTO STRICT raw FROM public.ediel_messages m WHERE m.id=f.source;
 hash:=encode(sha256(convert_to(raw,'UTF8')),'hex');
 facets:=jsonb_build_object('version',1,'sourcePayloadHash',hash,'transactions',jsonb_build_array(
  jsonb_build_object('transactionIndex',0,'transactionId','TX-1','disposition',CASE WHEN first_accepted THEN 'accepted' ELSE 'internal_review' END,'responseType',CASE WHEN first_accepted THEN 'positive_aperak' ELSE 'none' END,'issueCodes',CASE WHEN first_accepted THEN '[]'::jsonb ELSE '["UTILTS_STRUCTURE_UNAVAILABLE"]'::jsonb END),
  jsonb_build_object('transactionIndex',1,'transactionId','TX-2','disposition','processability_rejected','responseType','utilts_err','issueCodes','["E14"]'::jsonb)));
 facts:=jsonb_build_object('version',1,'owner','canonical-runtime-with-registry-v1','sourceDisposition','not_established','objectDisposition','not_checked','partyDisposition','not_checked','coverage','canonical_runtime_only','originalTenantMatch','matched',
  'syntaxDecision','accepted','applicationDecision','accepted','functionalDecision','rejected','messageReference','RESERVATION','reasonCodes',CASE WHEN first_accepted THEN '["E14"]'::jsonb ELSE '["UTILTS_STRUCTURE_UNAVAILABLE","E14"]'::jsonb END,'rulePackEvidence',f.witness);
 PERFORM public.gridex_record_utilts_source_validation_v4(f.company,'test',f.source,hash,facts::text,facets::text,NULL,NULL);
 PERFORM set_config('gridex.utilts_retry_owner_facet',facets::text,false);
END $$;

DO $$
DECLARE company constant uuid:='00000000-0000-4000-8000-00000000f921';source constant uuid:='00000000-0000-4000-8000-00000000f922';actor constant uuid:='00000000-0000-4000-8000-00000000f923';actor_user constant uuid:='00000000-0000-4000-8000-00000000f924';selected jsonb;witness jsonb;
 raw text:='UNB+UNOC:3+91100:ZZ+99621:ZZ+260701:0000+RETRY++23-DDQ-E66-T++1++1''UNH+1+UTILTS:D:02B:UN:E5SE5A''BGM+E66::260+RESERVATION+9+AB''DTM+137:DOCUMENT_DATE:203''DTM+735:?+0100:406''MKS+23+E02::260''NAD+MS+91100:SVK:260''NAD+MR+99621:SVK:260''NAD+DDQ''IDE+24+TX-1''LOC+172+735999260731000007::9''LIN+++8716867000030:::9''DTM+324:202607010000202607010015:719''DTM+597:202607010020:203''DTM+354:15:806''STS+7++E23::260''MEA+AAZ++KWH''SEQ++1''QTY+136:500''DTM+597:202607010000:203''IDE+24+TX-2''LOC+172+735999260731000014::9''LIN+++8716867000030:::9''DTM+324:202607010000202607010015:719''DTM+597:202607010020:203''DTM+354:15:806''STS+7++E23::260''MEA+AAZ++KWH''SEQ++1''QTY+136:500''DTM+597:202607010000:203''UNT+31+1''UNZ+1+RETRY''';
BEGIN
 INSERT INTO public.companies(id,name,status) VALUES(company,'E035 UTILTS retry declared synthetic control','active');
 INSERT INTO auth.users(instance_id,confirmation_token,recovery_token,email_change_token_new,email_change,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES('00000000-0000-0000-0000-000000000000','','','','',actor_user,'authenticated','authenticated',actor_user||'@example.invalid',now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(actor_user,actor_user||'@example.invalid','UTILTS retry actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(company,actor_user,'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
 -- The canonical catalog key, registered as the native fixtures do when absent.
 INSERT INTO public.permissions(key,name,description,category) SELECT 'metering.write','metering.write','Native fixture catalog key','native_fixture'
  WHERE NOT EXISTS(SELECT FROM public.permissions WHERE key='metering.write');
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT actor_user,company,id,key FROM public.permissions WHERE key='metering.write';
 PERFORM set_config('gridex.utilts_retry_actor_user',actor_user::text,false);
 -- Prospective local identity/role configuration BEFORE the actual INSERT.
 -- The genuine database capture observes this control's current basis.
 INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES(company,'test','electricity',true,clock_timestamp()-interval '1 minute');
 INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(company,'test',actor,'EdielId','99621',clock_timestamp()-interval '1 minute');
 INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(company,'test',actor,'electricity_supplier',clock_timestamp()-interval '1 minute');
 EXECUTE 'SET LOCAL ROLE service_role';
 SELECT value INTO STRICT selected FROM public.resolve_canonical_ediel_rule_pack_with_witness_v1('electricity','UTILTS','E66','','inbound',current_date) value;
 EXECUTE 'RESET ROLE';
 witness:=jsonb_build_object('rulePackId',selected->'rule_pack_id','messageProfileId',selected->'message_profile_id','profileKey',selected->'profile_key','sourceHash',selected->'source_hash','version',selected->'original_version','snapshot',selected->'original_snapshot');
 raw:=replace(raw,'DOCUMENT_DATE',to_char((clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','YYYYMMDDHH24MI'));
 -- The grid-owner issuer (NAD+MS 91100, UNB sender 91100:ZZ) has an approved
 -- synthetic issuer version and transport mandate before capture (015127).
 WITH ns AS (INSERT INTO gridex_utilts_issuer.namespaces(id,environment,registry_actor_key,created_at) SELECT gen_random_uuid(),e,'SYNTHETIC-RETRY-ISSUER:91100',clock_timestamp()-interval '1 day'
   FROM unnest(ARRAY['test','production']) e WHERE NOT EXISTS(SELECT FROM gridex_utilts_issuer.namespaces x WHERE x.environment=e AND x.registry_actor_key='SYNTHETIC-RETRY-ISSUER:91100') RETURNING id),
 iv AS (INSERT INTO gridex_utilts_issuer.issuer_versions(id,namespace_id,legal_identity,registry_version,registry_original_uri,registry_original_bytes,registry_sha256,legal_decision_ref,legal_decision_version,legal_decision_bytes,legal_decision_sha256,valid_from,approved_at,approved_by)
  SELECT gen_random_uuid(),ns.id,jsonb_build_array('91100','SVK','260'),'SYNTHETIC-1','synthetic://retry/issuer/91100',convert_to('SYNTHETIC retry issuer 91100','UTF8'),encode(sha256(convert_to('SYNTHETIC retry issuer 91100','UTF8')),'hex'),
   'SYNTHETIC-DECISION','1',convert_to('SYNTHETIC retry decision','UTF8'),encode(sha256(convert_to('SYNTHETIC retry decision','UTF8')),'hex'),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',actor_user FROM ns RETURNING id)
 INSERT INTO gridex_utilts_issuer.transport_mandate_versions(id,issuer_version_id,transport_sender,mandate_ref,mandate_version,mandate_original_uri,mandate_original_bytes,mandate_sha256,valid_from,approved_at,approved_by)
  SELECT gen_random_uuid(),iv.id,jsonb_build_array('91100','ZZ'),'SYNTHETIC-MANDATE','1','synthetic://retry/mandate/91100',convert_to('SYNTHETIC retry mandate','UTF8'),encode(sha256(convert_to('SYNTHETIC retry mandate','UTF8')),'hex'),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',actor_user FROM iv;
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,execution_context_snapshot)
 VALUES(source,company,'test','inbound','edifact','UTILTS','E66','received',raw,clock_timestamp(),'{}');
 -- Reviewed synthetic history-coverage ground bound to this source's actual
 -- issuer admission; genuine 203/505 reuse is still reported as collision.
 INSERT INTO gridex_utilts_issuer.source_absence_grounds(source_message_id,source_payload_hash,namespace_id,issuer_version_id,mandate_version_id,namespace_epoch,scope,identifiers_scope,
   registry_version,registry_original_uri,registry_original_bytes,registry_sha256,deletion_history_version,deletion_history_original_uri,deletion_history_bytes,deletion_history_sha256,
   retention_decision_ref,retention_decision_version,retention_decision_bytes,retention_decision_sha256,normalized_issued_identifiers,approval_ref,approval_version,approval_bytes,approval_sha256,approved_at,approved_by)
  SELECT a.source_message_id,a.source_payload_hash,a.namespace_id,a.issuer_version_id,a.mandate_version_id,a.namespace_epoch,'over_time_all_issuer_applications','other_prior_issued_originals',
   'SYNTHETIC-1','synthetic://retry/registry',convert_to('SYNTHETIC registry','UTF8'),encode(sha256(convert_to('SYNTHETIC registry','UTF8')),'hex'),
   'SYNTHETIC-1','synthetic://retry/deletions',convert_to('SYNTHETIC deletions','UTF8'),encode(sha256(convert_to('SYNTHETIC deletions','UTF8')),'hex'),
   'SYNTHETIC-RETENTION','1',convert_to('SYNTHETIC retention','UTF8'),encode(sha256(convert_to('SYNTHETIC retention','UTF8')),'hex'),
   coalesce((SELECT jsonb_agg(jsonb_build_object('field',o.field_number,'reference',o.physical_reference,'originalIssuanceReference',o.source_message_id::text,
     'originalSourceSha256',pa.source_payload_hash,'originEvidenceSha256',pa.source_payload_hash) ORDER BY o.source_message_id,o.field_number,o.physical_reference)
    FROM gridex_utilts_issuer.observed_identifiers o JOIN gridex_utilts_issuer.source_admissions pa ON pa.source_message_id=o.source_message_id
    WHERE o.namespace_id=a.namespace_id AND o.source_message_id<>a.source_message_id),'[]'::jsonb),
   'SYNTHETIC-APPROVAL','1',convert_to('SYNTHETIC approval','UTF8'),encode(sha256(convert_to('SYNTHETIC approval','UTF8')),'hex'),clock_timestamp(),actor_user
  FROM gridex_utilts_issuer.source_admissions a WHERE a.source_message_id=source AND a.namespace_id IS NOT NULL;
 INSERT INTO utilts_retry_state(company,source,witness,held,accepted,negative,later_positive) VALUES(company,source,witness,
  '[{"transactionId":"TX-1","disposition":"internal_review","responseType":"none","issueCodes":["UTILTS_STRUCTURE_UNAVAILABLE"],"seriesKind":"actual"}]',
  '[{"transactionId":"TX-1","disposition":"accepted","responseType":"positive_aperak","issueCodes":[],"seriesKind":"actual","externalMeteringPointId":"735999260731000007","periodStart":"2026-06-30T23:00:00Z","periodEnd":"2026-06-30T23:15:00Z","resolution":"15m"}]',
  '[{"transactionId":"TX-2","disposition":"processability_rejected","responseType":"utilts_err","issueCodes":["E14"],"seriesKind":"actual"}]',
  '[{"transactionId":"TX-2","disposition":"accepted","responseType":"positive_aperak","issueCodes":[],"seriesKind":"actual","externalMeteringPointId":"735999260731000014"}]');
END $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.retry_owner_facet(false);
RESET ROLE;
COMMIT; -- owner leaf must be genuinely committed before any new effect

BEGIN;
DO $$
DECLARE f record;result jsonb;blocked boolean;basis jsonb;
BEGIN
 SELECT * INTO STRICT f FROM utilts_retry_state;
 EXECUTE 'SET LOCAL ROLE service_role';
 basis:=public.ediel_probe_source_rule_pack_capture_v1(f.company,f.source);
 IF basis->>'status' IS DISTINCT FROM 'captured' THEN RAISE EXCEPTION 'utilts_retry_control_source_basis_unavailable';END IF;
 result:=pg_temp.retry_persist(f.company,'test',f.source,'E66',f.held);
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.retry_check('held-has-no-series',result#>>'{0,persistenceStatus}'='not_applicable' AND NOT EXISTS(SELECT FROM public.meter_reading_series WHERE source_ediel_message_id=f.source));
 -- Simulate interruption AFTER reservation and BEFORE actual ACK creation.
 EXECUTE 'SET LOCAL ROLE service_role';
 result:=pg_temp.retry_persist(f.company,'test',f.source,'E66',f.negative);
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.retry_check('negative-ack-plan-is-durable-before-finalization',result#>>'{0,responseType}'='utilts_err' AND
  (SELECT planned_response_type='utilts_err' AND final_response_type IS NULL AND persisted_series_id IS NULL FROM public.ediel_ack_transaction_results WHERE source_message_id=f.source AND source_transaction_id='TX-2'));
 blocked:=false;
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';PERFORM pg_temp.retry_persist(f.company,'test',f.source,'E66',f.later_positive);EXECUTE 'RESET ROLE';
 EXCEPTION WHEN SQLSTATE '23514' OR SQLSTATE 'P0U01' THEN
  blocked:=SQLERRM IN('utilts_committed_transaction_retry_conflict','utilts_transaction_owner_outcome_mismatch');EXECUTE 'RESET ROLE';
 END;
 PERFORM pg_temp.retry_check('interrupted-err-cannot-become-positive-aperak',blocked AND
  (SELECT disposition='processability_rejected' AND planned_response_type='utilts_err' AND final_response_type IS NULL FROM public.ediel_ack_transaction_results WHERE source_message_id=f.source AND source_transaction_id='TX-2'));
END $$;
-- The held own IDE gets a fresh modeled canonical assessment; its sibling's
-- original negative disposition stays unchanged. No rule witness is reselected.
SET LOCAL ROLE service_role;
SELECT pg_temp.retry_owner_facet(true);
RESET ROLE;
COMMIT;

BEGIN;
DO $$
DECLARE f record;result jsonb;v_series_id uuid;blocked boolean;
BEGIN
 SELECT * INTO STRICT f FROM utilts_retry_state;
 EXECUTE 'SET LOCAL ROLE service_role';result:=pg_temp.retry_persist(f.company,'test',f.source,'E66',f.accepted);EXECUTE 'RESET ROLE';
 v_series_id:=(result#>>'{0,seriesId}')::uuid;
 PERFORM pg_temp.retry_check('fresh-authority-releases-held-transaction',result#>>'{0,persistenceStatus}'='persisted' AND v_series_id IS NOT NULL AND
  (SELECT disposition FROM public.ediel_ack_transaction_results WHERE source_message_id=f.source AND source_transaction_id='TX-1')='accepted');
 EXECUTE 'SET LOCAL ROLE service_role';result:=pg_temp.retry_persist(f.company,'test',f.source,'E66',f.accepted);EXECUTE 'RESET ROLE';
 PERFORM pg_temp.retry_check('persisted-retry-preserves-series',result#>>'{0,idempotentReplay}'='true' AND (result#>>'{0,seriesId}')::uuid=v_series_id AND
  (SELECT count(*) FROM public.meter_reading_series WHERE source_ediel_message_id=f.source)=1);
 blocked:=false;
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';PERFORM pg_temp.retry_persist(f.company,'test',f.source,'E66',f.held);EXECUTE 'RESET ROLE';
 EXCEPTION WHEN SQLSTATE '23514' OR SQLSTATE 'P0U01' THEN
  blocked:=SQLERRM IN('utilts_committed_transaction_retry_conflict','utilts_transaction_owner_outcome_mismatch');EXECUTE 'RESET ROLE';
 END;
 PERFORM pg_temp.retry_check('persisted-retry-cannot-become-held',blocked AND
  (SELECT persisted_series_id FROM public.ediel_ack_transaction_results WHERE source_message_id=f.source AND source_transaction_id='TX-1')=v_series_id);
 -- Same declared finalization simulation as the original control. The synthetic
 -- FK points at this source row; this is not proof of a market ACK/create/send.
 UPDATE public.ediel_ack_transaction_results SET final_response_type='positive_aperak',response_message_id=f.source,finalized_at=clock_timestamp()
  WHERE source_message_id=f.source AND source_transaction_id='TX-1';
 EXECUTE 'SET LOCAL ROLE service_role';result:=pg_temp.retry_persist(f.company,'test',f.source,'E66',f.accepted);EXECUTE 'RESET ROLE';
 PERFORM pg_temp.retry_check('same-finalized-retry-idempotent',result#>>'{0,idempotentReplay}'='true' AND
  (SELECT final_response_type FROM public.ediel_ack_transaction_results WHERE source_message_id=f.source AND source_transaction_id='TX-1')='positive_aperak');
 blocked:=false;
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';PERFORM pg_temp.retry_persist(f.company,'test',f.source,'E66',f.held);EXECUTE 'RESET ROLE';
 EXCEPTION WHEN SQLSTATE '23514' OR SQLSTATE 'P0U01' THEN
  blocked:=SQLERRM IN('utilts_committed_transaction_retry_conflict','utilts_transaction_owner_outcome_mismatch');EXECUTE 'RESET ROLE';
 END;
 PERFORM pg_temp.retry_check('finalized-ack-cannot-be-rewritten',blocked AND
  (SELECT disposition='accepted' AND final_response_type='positive_aperak' AND persisted_series_id=v_series_id FROM public.ediel_ack_transaction_results WHERE source_message_id=f.source AND source_transaction_id='TX-1'));
END $$;
TABLE utilts_retry_results;
DO $$ DECLARE failures text;BEGIN
 SELECT string_agg(name,', ' ORDER BY name) INTO failures FROM utilts_retry_results WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'utilts_committed_retry_regression_failed: %',failures;END IF;
 RAISE NOTICE 'E035 committed UTILTS retries: % checks PASS',(SELECT count(*) FROM utilts_retry_results);
END $$;
COMMIT;
