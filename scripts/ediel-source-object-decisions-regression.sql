\set ON_ERROR_STOP on
\pset pager off
-- Disposable replay only. Every synthetic row, function and result rolls back.
-- SQL checks persisted owner inputs/internal consistency; live TypeScript owners
-- separately establish raw-wire semantics and in-process seals. No second parser.
BEGIN;
CREATE TEMP TABLE source_object_results(name text PRIMARY KEY,passed boolean NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.object_check(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO source_object_results VALUES(label,coalesce(value,false)); END $$;
CREATE TEMP TABLE object_fixture(company_id uuid,other_company_id uuid,source_id uuid,source_hash text,canonical_id uuid,canonical_hash text,facts jsonb) ON COMMIT DROP;

DO $$
DECLARE
 c constant uuid:='00000000-0000-4000-8000-00000000f001'; other_c constant uuid:='00000000-0000-4000-8000-00000000f002';
 customer constant uuid:='00000000-0000-4000-8000-00000000f101'; site constant uuid:='00000000-0000-4000-8000-00000000f201';
 point constant uuid:='00000000-0000-4000-8000-00000000f301'; grid_owner constant uuid:='00000000-0000-4000-8000-00000000f401';
 source_id constant uuid:='00000000-0000-4000-8000-00000000f501'; sw constant uuid:='00000000-0000-4000-8000-00000000f601';
 supply constant uuid:='00000000-0000-4000-8000-00000000f701'; actor constant uuid:='00000000-0000-4000-8000-00000000f801';
 wire text; source_hash text; received timestamptz:=clock_timestamp()-interval '1 minute'; assessed timestamptz;
 profile public.ediel_message_profiles%rowtype; pack public.ediel_rule_packs%rowtype;
 object_scope jsonb; canonical jsonb; receipt jsonb; records jsonb; identity jsonb; receiver jsonb; facility jsonb; business jsonb; party jsonb; facts jsonb;
BEGIN
 INSERT INTO public.companies(id,name,status) VALUES(c,'E035 object decision synthetic A','active'),(other_c,'E035 object decision synthetic B','active');
 INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(customer,c,'E035-OBJECT-A','Synthetic object customer','private');
 INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status)
 VALUES(grid_owner,c,'Synthetic object grid owner','71001','test',true,'active');
 INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id)
 VALUES(site,c,customer,'Synthetic object site','consumption','active','SE','735999123456789012',grid_owner);
 INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,reading_frequency,measurement_type,is_settlement_relevant,grid_owner_id)
 VALUES(point,c,customer,site,site,'735999123456789012','735999123456789012','hourly','consumption',true,grid_owner);
 INSERT INTO public.tenant_ediel_profiles(id,company_id,environment,market,is_enabled,valid_from)
 VALUES('00000000-0000-4000-8000-00000000f901',c,'test','electricity',true,received-interval '1 day');
 INSERT INTO public.tenant_actor_identifiers(id,company_id,environment,actor_id,identifier_type,identifier_value,valid_from)
 VALUES('00000000-0000-4000-8000-00000000f902',c,'test',actor,'EdielId','71002',received-interval '1 day');
 INSERT INTO public.tenant_actor_roles(id,company_id,environment,actor_id,role_code,valid_from)
 VALUES('00000000-0000-4000-8000-00000000f903',c,'test',actor,'electricity_supplier',received-interval '1 day');
 wire:=$wire$UNB+UNOC:3+71001:ZZ+71002:ZZ+260922:0900+REF++++++1'UNH+MSG1+PRODAT:D:96B:UN'BGM+Z04+DOC+9'DTM+137:202609220900:203'DTM+ZZZ:1:805'NAD+FR+71001:160:SVK'NAD+DO+71002:160:SVK'LIN+1++735999123456789012:::9'DTM+92:202610010000:203'CCI++Z13'CAV+Z22'QTY+31:10:KWH'UNT+12+MSG1'UNZ+1+REF'$wire$;
 SELECT * INTO STRICT profile FROM public.ediel_message_profiles WHERE profile_key='PRODAT:Z04:L:26.A:r3' AND is_enabled;
 SELECT * INTO STRICT pack FROM public.ediel_rule_packs WHERE id=profile.rule_pack_id;
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,message_received_at,execution_context_snapshot,
 canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 VALUES(source_id,c,'test','inbound','edifact','PRODAT','Z04','received',wire,received,'{}',pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile);
 SELECT s.payload_hash INTO STRICT source_hash FROM gridex_received_sources.sources s WHERE s.source_message_id=source_id;
 INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_type,status,inbound_z04_message_id,requested_start_date,confirmed_start_date)
 VALUES(sw,c,customer,site,point,grid_owner,'switch','accepted',source_id,'2026-10-01','2026-10-01');
 INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,source,source_message_id,status)
 VALUES(supply,c,customer,point,'2026-10-01','ediel_inbound_state_machine',source_id,'confirmed_by_grid_owner');
 object_scope:=jsonb_build_object('messageIndex',0,'messageReference','MSG1','objectId','735999123456789012','identityAgency','9',
  'registers',jsonb_build_array(jsonb_build_object('lineIndex',0,'lineNumber','1','registerIndex',null,'registerPosition',1,'segmentIndex',7)));
 canonical:=jsonb_build_object('version',1,'owner','canonical-runtime-with-registry-v1','sourceDisposition','not_established','objectDisposition','not_checked','partyDisposition','not_checked',
  'coverage','canonical_runtime_only','originalTenantMatch','matched','syntaxDecision','accepted','applicationDecision','accepted','functionalDecision','accepted','messageReference','MSG1','reasonCodes','[]'::jsonb,
  'rulePackEvidence',jsonb_build_object('profileKey',profile.profile_key,'messageProfileId',profile.id,'rulePackId',pack.id,'sourceHash',pack.source_hash),
  'registerValidation',jsonb_build_object('version',1,'owner','validateProdatRegisterPolicy','coverage','canonical_register_only','objects',jsonb_build_array(object_scope||'{"disposition":"accepted","reasons":[]}'::jsonb)));
 EXECUTE 'SET LOCAL ROLE service_role';
 receipt:=public.gridex_record_source_validation_v1(c,'test',source_id,source_hash,canonical::text);
 EXECUTE 'RESET ROLE';
 assessed:=clock_timestamp();
 -- These are exactly the existing TypeScript SELECT projections, not whole rows
 -- with generated/customer data or synthesized approval booleans.
 records:=jsonb_build_object(
 'profiles',(SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT id,company_id,environment,market,is_enabled,valid_from,valid_to FROM public.tenant_ediel_profiles WHERE company_id=c AND environment='test' AND market='electricity' AND is_enabled)r),
 'identifiers',(SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT id,company_id,environment,actor_id,identifier_type,identifier_value,qualifier,subaddress,valid_from,valid_to FROM public.tenant_actor_identifiers WHERE company_id=c AND environment='test' AND identifier_type='EdielId')r),
 'roles',(SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT id,company_id,environment,actor_id,role_code,valid_from,valid_to FROM public.tenant_actor_roles WHERE company_id=c AND environment='test' AND actor_id=actor)r),
 'relations','[]'::jsonb,'transportIdentifiers','[]'::jsonb);
 identity:=jsonb_build_object('companyId',c,'environment','test','legalActorId',actor,'legalEdielId','71002','transportActorId',actor,'transportEdielId','71002','roleCodes',jsonb_build_array('electricity_supplier'),'representedByTransportAgent',false,'transportRelationId',null);
 receiver:=jsonb_build_object('identity',identity,'evidence',jsonb_build_object('version',1,'owner','canonical-tenant-ediel-identity-v1','evaluatedAt',assessed,'observedAt',assessed,'completedAt',assessed,'completeness','exact_count','historicalKnowledge','not_established','sourceDisposition','not_established','consistency','independent_reads','records',records));
 facility:=jsonb_build_object('owner','selected-facility-grid-owner-v1','observedAt',assessed,'completedAt',assessed,'consistency','independent_reads','historicalKnowledge','not_established',
 'meteringPoint',(SELECT to_jsonb(r) FROM (SELECT id,company_id,meter_point_id,site_id,customer_site_id,grid_owner_id FROM public.metering_points WHERE id=point)r),
 'site',(SELECT to_jsonb(r) FROM (SELECT id,company_id,facility_id,grid_owner_id FROM public.customer_sites WHERE id=site)r),
 'gridOwner',(SELECT to_jsonb(r) FROM (SELECT id,name,ediel_id,is_active,lifecycle_status,default_prodat_subaddress,default_utilts_subaddress,communication_email,email,environment FROM public.grid_owners WHERE id=grid_owner)r));
 business:=jsonb_build_object('version',1,'owner','inbound-z04-switch-confirmation-v1','coverage','committed_switch_and_supply_only','sourceDisposition','not_established','businessDisposition','committed','assessedAt',assessed,
 'sourceMessageId',source_id,'sourcePayloadHash',source_hash,'companyId',c,'environment','test','sourceReceivedAt',received,'switchRequestId',sw,'supplyPeriodId',supply,'customerId',customer,'meteringPointId',point,'siteId',site,'graphNamespace','legacy_unqualified','object',object_scope,
 'effectiveFrom',jsonb_build_object('fieldNumber','210','marketMinute','202610010000','utc','2026-09-30T23:00:00.000Z','committedDatePrecision','market_calendar_day'),
 'committedRecords',jsonb_build_object('switch',jsonb_build_object('id',sw,'companyId',c,'customerId',customer,'meteringPointId',point,'siteId',site,'sourceMessageId',source_id,'status','accepted','confirmedStartDate','2026-10-01'),
 'supply',jsonb_build_object('id',supply,'companyId',c,'customerId',customer,'meteringPointId',point,'sourceMessageId',source_id,'status','confirmed_by_grid_owner','startDate','2026-10-01')));
 party:=jsonb_build_object('version',1,'owner','received-source-party-binding-v1','ruleVersion','1','source',jsonb_build_object('sourceMessageId',source_id,'sourcePayloadHash',source_hash,'companyId',c,'environment','test','receivedAt',received),
 'object',object_scope,'assessedAt',assessed,'completedAt',assessed,'historicalKnowledge','not_established','authentication','not_assessed','disposition','accepted','reasons','[]'::jsonb,'receiver',receiver,'facility',facility,
 'parties',jsonb_build_object('legalSender','71001','legalReceiver','71002','transportSender','71001','transportReceiver','71002'));
 facts:=jsonb_build_object('version',1,'owner','received-source-object-decisions-v1','ruleVersion','1','canonicalFactsHash',receipt->>'factsHash','objects',jsonb_build_array(jsonb_build_object('object',object_scope,'disposition','accepted','reasons','[]'::jsonb,'business',business,'party',party)));
 INSERT INTO object_fixture VALUES(c,other_c,source_id,source_hash,(receipt->>'assessmentId')::uuid,receipt->>'factsHash',facts);
 PERFORM pg_temp.object_check('fixture-real-canonical-assessment',EXISTS(SELECT FROM gridex_received_sources.validation_assessments WHERE id=(receipt->>'assessmentId')::uuid AND facts_text=canonical::text));
END $$;

CREATE FUNCTION pg_temp.object_call(proof jsonb, company uuid DEFAULT NULL, env text DEFAULT 'test', source uuid DEFAULT NULL, hash text DEFAULT NULL, canonical uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f object_fixture%rowtype; receipt jsonb;
BEGIN
 SELECT * INTO STRICT f FROM object_fixture;
 EXECUTE 'SET LOCAL ROLE service_role';
 receipt:=public.gridex_record_source_object_decisions_v1(coalesce(company,f.company_id),env,coalesce(source,f.source_id),coalesce(hash,f.source_hash),coalesce(canonical,f.canonical_id),proof::text);
 EXECUTE 'RESET ROLE'; RETURN receipt;
EXCEPTION WHEN OTHERS THEN EXECUTE 'RESET ROLE'; RAISE;
END $$;
CREATE FUNCTION pg_temp.object_reject(label text,proof jsonb,company uuid DEFAULT NULL,env text DEFAULT 'test',source uuid DEFAULT NULL,hash text DEFAULT NULL,canonical uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  PERFORM pg_temp.object_call(proof,company,env,source,hash,canonical);
  -- Roll back an unexpected success so every negative is isolated.
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='unexpected object decision acceptance';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN blocked:=false;
 WHEN check_violation THEN blocked:=true;
 END;
 PERFORM pg_temp.object_check(label,blocked);
END $$;

DO $$
DECLARE f object_fixture%rowtype; receipt jsonb; first_id uuid; second_id uuid; altered jsonb; path text[]; label text; blocked boolean; role_name text; before_count bigint;
BEGIN
 SELECT * INTO STRICT f FROM object_fixture;
 receipt:=pg_temp.object_call(f.facts); first_id:=(receipt->>'assessmentId')::uuid;
 PERFORM pg_temp.object_check('actual-positive-complete-owner-rows',EXISTS(SELECT FROM gridex_received_sources.object_assessments a WHERE a.id=first_id AND a.company_id=f.company_id AND a.environment='test' AND a.source_message_id=f.source_id AND a.canonical_assessment_id=f.canonical_id AND a.facts_text=f.facts::text AND a.previous_assessment_id IS NULL AND jsonb_array_length(a.owner_readsets)=1 AND a.owner_readsets#>'{0,object}'=f.facts#>'{objects,0,object}' AND length(a.owner_readsets#>>'{0,snapshot}')>0 AND (a.owner_readsets#>>'{0,observedAt}')::timestamptz>=(SELECT assessed_at FROM gridex_received_sources.validation_assessments WHERE id=f.canonical_id)));
 PERFORM pg_temp.object_check('created-xid-is-actual-transaction',EXISTS(SELECT FROM gridex_received_sources.object_assessments WHERE id=first_id AND created_xid=pg_current_xact_id()));
 PERFORM pg_temp.object_check('positive-proof-bytes-and-hash',receipt->>'factsHash'=encode(sha256(convert_to(f.facts::text,'UTF8')),'hex'));
 PERFORM pg_temp.object_reject('wrong-tenant',f.facts,f.other_company_id);
 PERFORM pg_temp.object_reject('wrong-environment',f.facts,NULL,'production');
 PERFORM pg_temp.object_reject('wrong-source',f.facts,NULL,'test',gen_random_uuid());
 PERFORM pg_temp.object_reject('wrong-source-hash',f.facts,NULL,'test',NULL,repeat('0',64));
 PERFORM pg_temp.object_reject('wrong-canonical-assessment',f.facts,NULL,'test',NULL,NULL,gen_random_uuid());
 PERFORM pg_temp.object_reject('wrong-canonical-facts-hash',jsonb_set(f.facts,'{canonicalFactsHash}',to_jsonb(repeat('0',64))));
 PERFORM pg_temp.object_reject('missing-object',jsonb_set(f.facts,'{objects}','[]'));
 PERFORM pg_temp.object_reject('extra-object',jsonb_set(f.facts,'{objects}',(f.facts->'objects')||(f.facts->'objects')));
 PERFORM pg_temp.object_reject('missing-register',jsonb_set(f.facts,'{objects,0,object,registers}','[]'));
 PERFORM pg_temp.object_reject('extra-register',jsonb_set(f.facts,'{objects,0,object,registers}',(f.facts#>'{objects,0,object,registers}')||(f.facts#>'{objects,0,object,registers}')));
 PERFORM pg_temp.object_reject('wrong-register-position',jsonb_set(f.facts,'{objects,0,object,registers,0,segmentIndex}','8'));
 PERFORM pg_temp.object_reject('wrong-object-agency',jsonb_set(f.facts,'{objects,0,object,identityAgency}','"89"'));
 PERFORM pg_temp.object_reject('missing-business',jsonb_set(f.facts,'{objects,0,business}','null'));
 PERFORM pg_temp.object_reject('missing-party',jsonb_set(f.facts,'{objects,0,party}','null'));
 PERFORM pg_temp.object_reject('missing-owner-snapshot',f.facts#-'{objects,0,party,receiver,evidence,records}');
 PERFORM pg_temp.object_reject('missing-actual-profile',jsonb_set(f.facts,'{objects,0,party,receiver,evidence,records,profiles}','[]'));
 PERFORM pg_temp.object_reject('incomplete-owner-count',jsonb_set(f.facts,'{objects,0,party,receiver,evidence,completeness}','"not_requested"'));
 PERFORM pg_temp.object_reject('status-json-alone',jsonb_set(jsonb_set(f.facts,'{objects,0,business}','{"canonicalAccepted":true,"status":"accepted"}'),'{objects,0,party}','{"status":"accepted"}'));
 PERFORM pg_temp.object_reject('missing-effective-date',f.facts#-'{objects,0,business,effectiveFrom}');
 PERFORM pg_temp.object_reject('different-effective-market-date',jsonb_set(f.facts,'{objects,0,business,effectiveFrom,marketMinute}','"202610020000"'));
 PERFORM pg_temp.object_reject('different-effective-utc',jsonb_set(f.facts,'{objects,0,business,effectiveFrom,utc}','"2026-10-01T23:00:00Z"'));
 PERFORM pg_temp.object_reject('different-committed-switch-date',jsonb_set(f.facts,'{objects,0,business,committedRecords,switch,confirmedStartDate}','"2026-10-02"'));
 PERFORM pg_temp.object_reject('different-committed-supply-date',jsonb_set(f.facts,'{objects,0,business,committedRecords,supply,startDate}','"2026-10-02"'));
 FOREACH label IN ARRAY ARRAY['legalSender','legalReceiver','transportSender','transportReceiver'] LOOP
  PERFORM pg_temp.object_reject('party-identity-'||label,jsonb_set(f.facts,ARRAY['objects','0','party','parties',label],'"79999"'));
 END LOOP;
 FOREACH label IN ARRAY ARRAY['legalEdielId','transportEdielId'] LOOP
  PERFORM pg_temp.object_reject('receiver-identity-'||label,jsonb_set(f.facts,ARRAY['objects','0','party','receiver','identity',label],'"79999"'));
 END LOOP;
 PERFORM pg_temp.object_reject('business-time-before-source',jsonb_set(f.facts,'{objects,0,business,assessedAt}','"2000-01-01T00:00:00Z"'));
 PERFORM pg_temp.object_reject('party-time-before-source',jsonb_set(f.facts,'{objects,0,party,assessedAt}','"2000-01-01T00:00:00Z"'));
 PERFORM pg_temp.object_reject('party-time-backwards',jsonb_set(f.facts,'{objects,0,party,completedAt}','"2000-01-01T00:00:00Z"'));
 PERFORM pg_temp.object_reject('party-time-infinite',jsonb_set(f.facts,'{objects,0,party,completedAt}','"infinity"'));
 PERFORM pg_temp.object_reject('identity-evaluation-not-party-instant',jsonb_set(f.facts,'{objects,0,party,receiver,evidence,evaluatedAt}','"2000-01-01T00:00:00Z"'));
 PERFORM pg_temp.object_reject('facility-observation-before-source',jsonb_set(f.facts,'{objects,0,party,facility,observedAt}','"2000-01-01T00:00:00Z"'));
 PERFORM pg_temp.object_reject('effective-calendar-invalid',jsonb_set(f.facts,'{objects,0,business,effectiveFrom,marketMinute}','"202602300000"'));
 PERFORM pg_temp.object_reject('business-record-wrong-source',jsonb_set(f.facts,'{objects,0,business,committedRecords,supply,sourceMessageId}',to_jsonb(gen_random_uuid())));
 PERFORM pg_temp.object_reject('receiver-role-not-supplier',jsonb_set(f.facts,'{objects,0,party,receiver,identity,roleCodes}','["energy_service_company"]'));
 PERFORM pg_temp.object_reject('business-foreign-tenant',jsonb_set(f.facts,'{objects,0,business,companyId}',to_jsonb(f.other_company_id)));
 PERFORM pg_temp.object_reject('party-foreign-environment',jsonb_set(f.facts,'{objects,0,party,source,environment}','"production"'));
 PERFORM pg_temp.object_reject('party-foreign-source',jsonb_set(f.facts,'{objects,0,party,source,sourceMessageId}',to_jsonb(gen_random_uuid())));
 -- Mutate BOTH retained input snapshot and actual row: these prove temporal
 -- semantics, rather than passing solely because stale snapshot bytes differ.
 FOREACH label IN ARRAY ARRAY['profiles','identifiers','roles'] LOOP
  path:=ARRAY['objects','0','party','receiver','evidence','records',label,'0','valid_from'];
  altered:=jsonb_set(f.facts,path,to_jsonb(((f.facts#>>'{objects,0,party,receiver,evidence,evaluatedAt}')::timestamptz+interval '1 day')::text));
  EXECUTE format('UPDATE public.%I SET valid_from=$1 WHERE company_id=$2',CASE label WHEN 'profiles' THEN 'tenant_ediel_profiles' WHEN 'identifiers' THEN 'tenant_actor_identifiers' ELSE 'tenant_actor_roles' END)
   USING (altered#>>path)::timestamptz,f.company_id;
  PERFORM pg_temp.object_reject('actual-future-'||label||'-cannot-qualify',altered);
  EXECUTE format('UPDATE public.%I SET valid_from=$1 WHERE company_id=$2',CASE label WHEN 'profiles' THEN 'tenant_ediel_profiles' WHEN 'identifiers' THEN 'tenant_actor_identifiers' ELSE 'tenant_actor_roles' END)
   USING (f.facts#>>path)::timestamptz,f.company_id;
  path:=ARRAY['objects','0','party','receiver','evidence','records',label,'0','valid_to'];
  altered:=jsonb_set(f.facts,path,f.facts#>'{objects,0,party,receiver,evidence,evaluatedAt}');
  EXECUTE format('UPDATE public.%I SET valid_to=$1 WHERE company_id=$2',CASE label WHEN 'profiles' THEN 'tenant_ediel_profiles' WHEN 'identifiers' THEN 'tenant_actor_identifiers' ELSE 'tenant_actor_roles' END)
   USING (altered#>>path)::timestamptz,f.company_id;
  PERFORM pg_temp.object_reject('actual-exclusive-end-'||label||'-cannot-qualify',altered);
  EXECUTE format('UPDATE public.%I SET valid_to=NULL WHERE company_id=$1',CASE label WHEN 'profiles' THEN 'tenant_ediel_profiles' WHEN 'identifiers' THEN 'tenant_actor_identifiers' ELSE 'tenant_actor_roles' END) USING f.company_id;
 END LOOP;
 INSERT INTO public.tenant_counterparty_relations(company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from)
 VALUES(f.company_id,'test','00000000-0000-4000-8000-00000000f811','ediel_transport_agent',true,'2020-01-01'),
       (f.company_id,'test','00000000-0000-4000-8000-00000000f812','ediel_transport_agent',true,'2020-01-01');
 altered:=jsonb_set(f.facts,'{objects,0,party,receiver,evidence,records,relations}',
  (SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT id,company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from,valid_to FROM public.tenant_counterparty_relations WHERE company_id=f.company_id)r));
 PERFORM pg_temp.object_reject('actual-ambiguous-delegation-cannot-qualify',altered);
 DELETE FROM public.tenant_counterparty_relations WHERE company_id=f.company_id;
 -- Revalidation uses real current owner rows, not just internally plausible proof.
 UPDATE public.tenant_actor_identifiers SET identifier_value='71003' WHERE company_id=f.company_id;
 PERFORM pg_temp.object_reject('identity-owner-changed-after-capture',f.facts);
 UPDATE public.tenant_actor_identifiers SET identifier_value='71002' WHERE company_id=f.company_id;
 UPDATE public.grid_owners SET ediel_id='71003' WHERE id=(f.facts#>>'{objects,0,party,facility,gridOwner,id}')::uuid;
 PERFORM pg_temp.object_reject('grid-owner-changed-after-capture',f.facts);
 UPDATE public.grid_owners SET ediel_id='71001' WHERE id=(f.facts#>>'{objects,0,party,facility,gridOwner,id}')::uuid;
 UPDATE public.customer_supply_periods SET start_date='2026-10-02' WHERE id=(f.facts#>>'{objects,0,business,supplyPeriodId}')::uuid;
 PERFORM pg_temp.object_reject('committed-owner-changed-after-capture',f.facts);
 UPDATE public.customer_supply_periods SET start_date='2026-10-01' WHERE id=(f.facts#>>'{objects,0,business,supplyPeriodId}')::uuid;
 -- A NULL customer graph may already be forbidden by an existing graph trigger.
 -- Either that guard or this SQL owner revalidation must block qualification.
 FOREACH label IN ARRAY ARRAY['metering_points','customer_sites'] LOOP
  blocked:=false;
  BEGIN
   EXECUTE format('UPDATE public.%I SET customer_id=NULL WHERE company_id=$1',label) USING f.company_id;
   BEGIN
    PERFORM pg_temp.object_call(f.facts);
   EXCEPTION WHEN check_violation THEN blocked:=true;
   END;
   RAISE EXCEPTION USING ERRCODE='ZX002',MESSAGE=CASE WHEN blocked THEN 'blocked' ELSE 'accepted' END;
  EXCEPTION WHEN SQLSTATE 'ZX002' THEN blocked:=SQLERRM='blocked';
   WHEN check_violation OR not_null_violation OR foreign_key_violation THEN blocked:=true;
  END;
  PERFORM pg_temp.object_check(label||'-null-customer-never-qualifies',blocked);
 END LOOP;
 -- Immutable correction appends a successor; it does not rewrite or supersede
 -- a market source. A later negative assessment remains independently visible.
 altered:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(f.facts,'{objects,0,disposition}','"unavailable"'),'{objects,0,reasons}','["business_decision_unavailable"]'),'{objects,0,business}','null'),'{objects,0,party}','null');
 receipt:=pg_temp.object_call(altered);second_id:=(receipt->>'assessmentId')::uuid;
 PERFORM pg_temp.object_check('correction-linked-to-first',EXISTS(SELECT FROM gridex_received_sources.object_assessments WHERE id=second_id AND previous_assessment_id=first_id AND facts_text=altered::text));
 PERFORM pg_temp.object_check('first-positive-still-immutable',EXISTS(SELECT FROM gridex_received_sources.object_assessments WHERE id=first_id AND facts_text=f.facts::text));
 blocked:=false;BEGIN UPDATE gridex_received_sources.object_assessments SET facts_text='{}' WHERE id=first_id;EXCEPTION WHEN check_violation THEN blocked:=true;END;
 PERFORM pg_temp.object_check('cannot-update-assessment',blocked);
 blocked:=false;BEGIN DELETE FROM gridex_received_sources.object_assessments WHERE id=second_id;EXCEPTION WHEN check_violation THEN blocked:=true;END;
 PERFORM pg_temp.object_check('cannot-delete-assessment',blocked);
 blocked:=false;BEGIN TRUNCATE gridex_received_sources.object_assessments, gridex_received_sources.object_availability_witnesses;EXCEPTION WHEN check_violation OR foreign_key_violation THEN blocked:=true;END;
 PERFORM pg_temp.object_check('cannot-truncate-assessment',blocked);
 SELECT count(*) INTO before_count FROM gridex_received_sources.object_assessments WHERE source_message_id=f.source_id;
 PERFORM pg_temp.object_check('exact-two-retained-decisions',before_count=2);
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  blocked:=false;BEGIN
   EXECUTE format('SET LOCAL ROLE %I',role_name);
   PERFORM public.gridex_record_source_object_decisions_v1(f.company_id,'test',f.source_id,f.source_hash,f.canonical_id,f.facts::text);
   EXECUTE 'RESET ROLE';
  EXCEPTION WHEN insufficient_privilege THEN blocked:=true;END;
  PERFORM pg_temp.object_check(role_name||'-cannot-invoke-writer',blocked);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  blocked:=false;BEGIN EXECUTE format('SET LOCAL ROLE %I',role_name);PERFORM count(*) FROM gridex_received_sources.object_assessments;EXECUTE 'RESET ROLE';EXCEPTION WHEN insufficient_privilege THEN blocked:=true;END;
  PERFORM pg_temp.object_check(role_name||'-no-direct-table-read',blocked);
  blocked:=false;BEGIN EXECUTE format('SET LOCAL ROLE %I',role_name);DELETE FROM gridex_received_sources.object_assessments WHERE id=first_id;EXECUTE 'RESET ROLE';EXCEPTION WHEN insufficient_privilege THEN blocked:=true;END;
  PERFORM pg_temp.object_check(role_name||'-no-direct-table-write',blocked);
 END LOOP;
END $$;
TABLE source_object_results;
DO $$ DECLARE failures text; BEGIN
 SELECT string_agg(name,', ' ORDER BY name) INTO failures FROM source_object_results WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'source_object_decisions_regression_failed: %',failures;END IF;
 RAISE NOTICE 'E035 source object decisions SQL: % checks PASS',(SELECT count(*) FROM source_object_results);
END $$;
ROLLBACK;
