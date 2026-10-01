/** Declared synthetic mechanical probe only. Legal-owner/network overrides below
 * are explicit test-only branches; no native/RLS/authentic-original claims. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
if(!process.env.PGLITE_MODULE_URL)throw Error('PGLITE_MODULE_URL required')
const {PGlite}=await import(process.env.PGLITE_MODULE_URL),db=new PGlite()
await db.exec(readFileSync(new URL('./fixtures/ediel-ai-source-embedded-schema.sql',import.meta.url),'utf8'))
await db.exec(`CREATE TABLE public.inbound_email_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,raw_email text,raw_edifact_payload text,body_text text,body_html text,message_family text);
CREATE TABLE public.inbound_email_attachments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,inbound_email_message_id uuid,raw_text text);
CREATE TABLE public.ediel_message_payloads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,ediel_message_id uuid,raw_payload text,created_by uuid);
ALTER TABLE public.ediel_messages ADD COLUMN message_version text,ADD COLUMN mime_type text;
CREATE SCHEMA gridex_ediel_readiness;CREATE TABLE gridex_ediel_readiness.evidence(company_id uuid,scope jsonb,dependencies jsonb,expires_at timestamptz);
CREATE FUNCTION public.ediel_require_scoped_capability_for_message_v1(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;`)
await db.exec(`ALTER TABLE public.ediel_messages ADD COLUMN intent_id uuid,ADD COLUMN customer_id uuid,ADD COLUMN site_id uuid,ADD COLUMN communication_route_id uuid,ADD COLUMN route_profile_id uuid,ADD COLUMN source_operation_id uuid,ADD COLUMN process_type text,ADD COLUMN switch_request_id uuid,ADD COLUMN rule_pack_snapshot jsonb;
ALTER TABLE public.customer_sites ADD COLUMN customer_id uuid;
CREATE TABLE public.ediel_message_intents(market text DEFAULT 'electricity',operation_id uuid,validation_result jsonb DEFAULT '{"ok":true}',blocking_reasons jsonb DEFAULT '[]',supplier_switch_request_id uuid,customer_info_request_id uuid,grid_owner_information_request_id uuid,id uuid PRIMARY KEY,company_id uuid,environment text,message_family text,message_code text,business_process text,direction text,validation_status text,customer_id uuid,customer_site_id uuid,metering_point_id text,communication_route_id uuid,route_profile_id uuid,sender_ediel_id text,receiver_ediel_id text,application_reference text,interchange_reference text,message_reference text,transaction_reference text,payload jsonb,created_at timestamptz);
CREATE TABLE public.customer_supply_periods(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,start_date date,end_date date,actual_start_date date,actual_end_date date);
CREATE TABLE gridex_received_sources.object_selection_snapshots(id uuid PRIMARY KEY,company_id uuid,environment text,cutoff_at timestamptz,captured_at timestamptz,readset_text text,readset_hash text);
CREATE TABLE gridex_received_sources.sources(source_message_id uuid,company_id uuid,environment text,payload_hash text,raw_payload text);
CREATE TABLE gridex_received_sources.object_assessments(id uuid,company_id uuid,source_message_id uuid,environment text,source_payload_hash text,canonical_assessment_id uuid,facts_text text,facts_hash text);
CREATE TABLE gridex_received_sources.structural_apply_receipts(source_message_id uuid,company_id uuid,environment text,payload_hash text,object_assessment_id uuid,canonical_assessment_id uuid,objects jsonb,applied_at timestamptz);
CREATE TABLE gridex_received_sources.structural_object_apply_receipts(source_message_id uuid,company_id uuid,environment text,payload_hash text,object_assessment_id uuid,canonical_assessment_id uuid,effect jsonb,applied_at timestamptz);`)
const decoder=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8');await db.exec(decoder.slice(0,decoder.indexOf('CREATE FUNCTION gridex_received_sources.permission_wire_v1'))+'\nCOMMIT;')
for(const file of ['20260930165219_ediel_ai_processing_decision_consumer.sql','20260930174145_ediel_ai_source_atomic_reconciliation.sql','20260930181141_ediel_ai_personal_mail_storage_guards.sql','20260930190501_ediel_ai_message_personal_scope_guard.sql','20260930201813_ediel_ai_outbound_source_authority.sql','20260930203354_ediel_ai_intent_source_origination.sql','20260930220942_ediel_ai_prospective_original_authority.sql','20260930224737_ediel_ai_environment_qualified_origination_permissions.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
// Execute the real immutable old/own receipt union reader, not a boolean mock.
const effectSql=readFileSync(new URL('../supabase/migrations/20261001011232_ediel_partial_prodat_structural_owner_effects.sql',import.meta.url),'utf8')
await db.exec(effectSql.match(/CREATE OR REPLACE FUNCTION gridex_received_sources\.structural_effect_matches_v1[\s\S]*?\$\$;/)[0])
await db.exec(readFileSync(new URL('../supabase/migrations/20261001015237_ediel_ai_applied_structure_history_fence.sql',import.meta.url),'utf8'))
// Run the real protected source-only E patch projection. Its first-effect
// proof port is explicitly synthetic and source-bound; it does not authenticate
// a real owner, legal approval or historical availability.
await db.exec(`CREATE SCHEMA gridex_customer_life_events;
CREATE TABLE gridex_customer_life_events.customer_versions(company_id uuid,customer_id uuid,source_message_id uuid,effective_at timestamptz,version bigint);
CREATE TABLE gridex_customer_life_events.transitions(company_id uuid,source_message_id uuid,payload_hash text,recorded_at timestamptz,approved_scope jsonb,source_objects jsonb);
ALTER TABLE gridex_received_sources.object_assessments ADD COLUMN previous_assessment_id uuid,ADD COLUMN assessed_at timestamptz DEFAULT '2000-01-01Z';
CREATE TABLE gridex_received_sources.object_availability_witnesses(assessment_id uuid,company_id uuid,environment text,source_message_id uuid,facts_hash text,observed_at timestamptz);
CREATE FUNCTION gridex_customer_life_events.owner_proof_consistent_v1(party jsonb,business jsonb,source_id uuid) RETURNS boolean LANGUAGE sql AS $$SELECT business->>'syntheticUnqualified'='true' AND business->>'sourceMessageId'=source_id::text$$;`)
for(const [file,name,namespace] of [['20260930164804_ediel_prodat_retry_correction_authority.sql','prodat_recovery_wire_v1','gridex_received_sources'],['20261001023512_ediel_partial_customer_life_event_source_effects.sql','wire_partition_v1','gridex_customer_life_events']]){const sql=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');await db.exec(sql.match(new RegExp('CREATE FUNCTION '+namespace+'\\.'+name+'[\\s\\S]*?\\$\\$;'))[0])}
await db.exec(readFileSync(new URL('../supabase/migrations/20261001020309_ediel_customer_life_event_scoped_patches.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../supabase/migrations/20261001021408_ediel_ai_customer_epoch_source_projection.sql',import.meta.url),'utf8'))
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=id(1),actor=id(2),source=id(3),decision=id(4),intent=id(5),site=id(6),customer=id(7),snapshot=id(8),route=id(9),profileId=id(10)
const csv='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;'
await db.query('INSERT INTO public.companies VALUES($1)',[company])
await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[actor])
await db.query('INSERT INTO public.customers VALUES($1,$2)',[customer,company])
await db.query('INSERT INTO public.customer_sites VALUES($1,$2,$3)',[site,company,customer])
await db.query("INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES($1,'test','electricity',true,now()-interval '1 day')",[company])
await db.query("INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES($1,'test',$2,'EdielId','12345',now()-interval '1 day')",[company,actor])
await db.query("INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES($1,'test',$2,'electricity_supplier',now()-interval '1 day')",[company,actor])
const profile=(await db.query('SELECT gridex_ai_processing.native_profile_v1() AS profile')).rows[0].profile
await db.query("INSERT INTO public.ediel_message_intents(id,company_id,environment,message_family,message_code,business_process,direction,validation_status,customer_id,customer_site_id,metering_point_id,communication_route_id,route_profile_id,sender_ediel_id,receiver_ediel_id,application_reference,interchange_reference,message_reference,transaction_reference,payload,created_at,operation_id) VALUES($1,$2,'test','AI_LIST','AI','reconciliation','outbound','validated',$3,$4,NULL,$5,$6,'12345','54321','','','',NULL,$7,now()-interval '1 minute',$8)",[intent,company,customer,site,route,profileId,{owner:'ai-list-export-request-v1',fromDate:'20261001',toDate:'20261101',sourceSha256:profile.sourceSha256,technicalVersion:profile.technicalVersion,requestId:id(11)},id(11)])
const rowSources=[{sourceMessageId:id(12),baselineSourceMessageId:id(12),addressSourceMessageId:id(12),supplyPeriodId:id(14)}]
const record=(snap=snapshot,raw=csv,refs=rowSources,rowHash=hash)=>db.query('SELECT public.gridex_ai_record_outbound_original_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[company,actor,intent,snap,rowHash,raw,'AI.csv','text/csv; charset=utf-8',JSON.stringify(refs)])
const baselineRaw="UNB+UNOC:3+54321:14+12345:14+261001:1200+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+BASE+9'NAD+FR+54321:160:SVK'NAD+DO+12345:160:SVK'LIN+1++735123456789012345:::9'DTM+92:202610010000:203'RFF+Z05:NET'RFF+LI:CASE'NAD+UD+199001011234:SE2:260++Person'NAD+IT+735123456789012345::9+++Street+Town++12345+SE'NAD+Z02+12345:160:SVK'UNT+10+M'UNZ+1+I'"
const sha=async text=>(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') AS hash",[text])).rows[0].hash
const multiPartyRaw=baselineRaw.replace('++Person','++ Person : Second Name').replace('+++Street','+++ First Street : : Third Street ')
const partyProjection=(await db.query("SELECT gridex_ai_processing.party_text_v1(t,CASE WHEN t#>>'{elements,1,0}'='UD' THEN 4 ELSE 5 END,CASE WHEN t#>>'{elements,1,0}'='UD' THEN 2 ELSE 3 END) AS value FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2($1)) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}' IN('UD','IT') ORDER BY t#>>'{elements,1,0}'",[multiPartyRaw])).rows
assert.deepEqual(partyProjection.map(row=>row.value),['First Street\n\nThird Street','Person\nSecond Name'])
const payloadHash=await sha(baselineRaw)
const factsText=JSON.stringify({objects:[{object:{objectId:'735123456789012345',identityAgency:'9',registers:[{segmentIndex:5}]},disposition:'accepted',business:{owner:'reviewed-received-structure-v1',companyId:company,environment:'test',customerId:customer,siteId:site,meteringPointId:id(20),sourceMessageId:id(12),sourcePayloadHash:payloadHash,supplyPeriodId:id(14),coverageWindow:{baselineSourceMessageId:id(12)},wire:{businessCase:'supply_baseline',messageCode:'Z04',legalSender:'54321',legalReceiver:'12345',effectiveFrom:{marketMinute:'202610010000'}}}}]})
const body=JSON.stringify({complete:true,sources:[{sourceMessageId:id(12),rawPayload:baselineRaw,payloadHash,assessments:[{id:id(13),previousAssessmentId:null,availabilityWitnessId:id(90),availableAt:'2026-09-30T01:00:00Z',factsText,factsHash:await sha(factsText)}]}]})
await db.query("INSERT INTO public.customer_supply_periods VALUES($1,$2,$3,NULL,'2026-10-01',NULL,NULL,NULL)",[id(14),company,customer])
const hash=(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') AS hash",[body])).rows[0].hash
await db.query("INSERT INTO gridex_received_sources.object_selection_snapshots VALUES($1,$2,'test',now(),now(),$3,$4)",[snapshot,company,body,hash])
await db.exec('GRANT USAGE ON SCHEMA public TO service_role;SET ROLE service_role;')
await assert.rejects(()=>record(),/ai_bi_processing_decision_missing/)
await db.exec('RESET ROLE;')
assert.equal((await db.query('SELECT count(*)::int AS n FROM gridex_ai_processing.outbound_origins')).rows[0].n,0)
await db.query("INSERT INTO gridex_ai_processing.decisions(id,company_id,list_type,purpose,revision,gdpr_basis,retention_days,valid_from,valid_until,source_reference,source_sha256,decision_owner_registry_id,decision_owner_registry_version) VALUES($1,$2,'AI','ediel_list_export',1,'SYNTHETIC_UNQUALIFIED',30,now()-interval '1 hour',now()+interval '1 hour','synthetic-only',repeat('a',64),$3,'synthetic-only')",[decision,company,id(90)])
let migration=readFileSync(new URL('../supabase/migrations/20260930224737_ediel_ai_environment_qualified_origination_permissions.sql',import.meta.url),'utf8')
let owner=migration.slice(migration.indexOf('CREATE FUNCTION gridex_ai_processing.purpose_decision_after_actor_v1'),migration.indexOf('REVOKE ALL ON FUNCTION gridex_ai_processing.purpose_decision_after_actor_v1'))
owner=owner.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace("RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_owner_registry_unqualified');","RETURN jsonb_build_object('status','authorized','decision',jsonb_build_object('id',d.id,'companyId',c,'listType',list_type,'purpose',purpose,'syntheticUnqualified',true));")
await db.exec(owner)
await db.exec(`CREATE FUNCTION gridex_received_sources.permission_time_v1(value text) RETURNS timestamptz LANGUAGE sql AS $$SELECT CASE WHEN value IS NULL THEN NULL ELSE (substring(value,1,4)||'-'||substring(value,5,2)||'-'||substring(value,7,2)||'T'||substring(value,9,2)||':'||substring(value,11,2)||':00+01:00')::timestamptz END$$;
CREATE FUNCTION gridex_received_sources.supply_period_source_basis_v1(c uuid,p uuid,s timestamptz,e timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('qualified',true,'customerId','${customer}','siteId','${site}','initialSourceMessageId','${id(12)}','marketStartAt','2026-09-30T23:00:00Z','marketEndAt',NULL,'syntheticUnqualified',true)$$;`)
await db.exec("CREATE OR REPLACE FUNCTION gridex_ai_processing.network_registry_basis_v1(network_id text,env text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','authorized','syntheticUnqualified',true)$$;SET ROLE service_role;")
await assert.rejects(()=>record(id(99)),/ai_list_original_complete_history_snapshot_required/)
await assert.rejects(()=>record(snapshot,csv.replace('20261101','20261201')),/ai_list_original_search_scope_mismatch/)
await assert.rejects(()=>record(snapshot,csv.replace('Person','FOREIGN')),/ai_list_original_row_source_mismatch/)
await assert.rejects(()=>record(snapshot,csv.replace('Street','OTHER')),/ai_list_original_row_source_mismatch/)
await assert.rejects(()=>record(snapshot,csv.replace('735123456789012345','735123456789012352')),/ai_list_original_row_source_mismatch/)
await assert.rejects(()=>record(snapshot,csv,[{...rowSources[0],baselineSourceMessageId:id(99)}]),/ai_list_original_row_source_mismatch/)
// A full immutable snapshot contains the real next structural epoch. A direct
// native caller cannot hide it behind a plausible old row or stale address.
await db.exec('RESET ROLE;')
const changeRaw=baselineRaw.replace('BGM+Z04+BASE','BGM+Z06+CHANGE').replace('DTM+92:202610010000','DTM+157:202610150000').replace('Street','NewStreet')
const changeHash=await sha(changeRaw),changeFacts=JSON.parse(factsText)
Object.assign(changeFacts.objects[0].business,{sourceMessageId:id(15),sourcePayloadHash:changeHash})
Object.assign(changeFacts.objects[0].business.wire,{businessCase:'change_with_reading',messageCode:'Z06',effectiveFrom:{marketMinute:'202610150000'}})
const changeFactsText=JSON.stringify(changeFacts),multi=JSON.parse(body)
multi.sources.push({sourceMessageId:id(15),rawPayload:changeRaw,payloadHash:changeHash,assessments:[{id:id(16),previousAssessmentId:null,availabilityWitnessId:id(91),availableAt:'2026-09-30T01:01:00Z',factsText:changeFactsText,factsHash:await sha(changeFactsText)}]})
const multiText=JSON.stringify(multi),multiHash=await sha(multiText)
await db.query("INSERT INTO gridex_received_sources.object_selection_snapshots VALUES($1,$2,'test',now(),now(),$3,$4)",[id(17),company,multiText,multiHash])
await db.exec('SET ROLE service_role;')
await assert.rejects(()=>record(id(17),csv,rowSources,multiHash),/ai_list_original_row_source_mismatch/)
const csvLines=csv.split('\n'),firstRow=csvLines[1].split(';'),secondRow=[...firstRow]
firstRow[20]='20261015';secondRow[19]='20261015';secondRow[7]='NewStreet'
const twoCsv=[csvLines[0],firstRow.join(';'),secondRow.join(';')].join('\n')
const twoRefs=[rowSources[0],{...rowSources[0],sourceMessageId:id(15),addressSourceMessageId:id(15)}]
const staleCsv=twoCsv.replace('NewStreet','Street'),staleRefs=[twoRefs[0],{...twoRefs[1],addressSourceMessageId:id(12)}]
await assert.rejects(()=>record(id(17),staleCsv,staleRefs,multiHash),/ai_list_original_row_address_epoch_mismatch/)
await assert.rejects(()=>record(id(17),[csvLines[0],firstRow.join(';')].join('\n'),rowSources,multiHash),/ai_list_original_supply_epoch_omitted/)
await db.exec('RESET ROLE;')
const unknown=JSON.parse(multiText),unknownFacts=JSON.parse(changeFactsText)
unknownFacts.objects[0].business=null
const unknownFactsText=JSON.stringify(unknownFacts)
Object.assign(unknown.sources[1].assessments[0],{factsText:unknownFactsText,factsHash:await sha(unknownFactsText)})
const unknownText=JSON.stringify(unknown),unknownHash=await sha(unknownText)
await db.query("INSERT INTO gridex_received_sources.object_selection_snapshots VALUES($1,$2,'test',now(),now(),$3,$4)",[id(18),company,unknownText,unknownHash])
await db.exec('SET ROLE service_role;')
await assert.rejects(()=>record(id(18),csv,rowSources,unknownHash),/ai_list_original_dated_source_owner_missing/)

await db.exec('RESET ROLE;')
const checkRows=()=>db.query("SELECT gridex_ai_processing.require_original_row_sources_v1($1::jsonb,now(),(SELECT i FROM public.ediel_message_intents i WHERE id=$2),$3,$4) AS refs",[multiText,intent,twoCsv,JSON.stringify(twoRefs)])
await assert.rejects(checkRows,/ai_list_applied_structural_source_unconfirmed/)
await db.query("INSERT INTO gridex_received_sources.sources VALUES($1,$2,'test',$3,$4)",[id(15),company,changeHash,changeRaw])
await db.query("INSERT INTO gridex_received_sources.object_assessments(id,company_id,source_message_id,environment,source_payload_hash,canonical_assessment_id,facts_text,facts_hash) VALUES($1,$2,$3,'test',$4,$5,$6,$7)",[id(16),company,id(15),changeHash,id(21),changeFactsText,await sha(changeFactsText)])
const changeObject=changeFacts.objects[0],effect={object:changeObject.object,meteringPointId:id(20),siteId:site,wire:changeObject.business.wire}
const putEffect=(value=effect,appliedAt='2000-01-01Z')=>db.query("INSERT INTO gridex_received_sources.structural_object_apply_receipts VALUES($1,$2,'test',$3,$4,$5,$6,$7)",[id(15),company,changeHash,id(16),id(21),value,appliedAt])
await putEffect({...effect,siteId:id(99)})
await assert.rejects(checkRows,/ai_list_applied_structural_source_unconfirmed/)
await db.exec('DELETE FROM gridex_received_sources.structural_object_apply_receipts;')
await putEffect(effect,'2100-01-01Z')
await assert.rejects(checkRows,/ai_list_applied_structural_source_unconfirmed/)
await db.exec('DELETE FROM gridex_received_sources.structural_object_apply_receipts;')
await putEffect()
assert.equal((await checkRows()).rows[0].refs.length,2)
// Duplicate effects are not an authority; the real exact-count reader holds.
await putEffect()
await assert.rejects(checkRows,/ai_list_applied_structural_source_unconfirmed/)
await db.exec('DELETE FROM gridex_received_sources.structural_object_apply_receipts;')
await db.query("INSERT INTO gridex_received_sources.structural_apply_receipts VALUES($1,$2,'test',$3,$4,$5,$6,'2000-01-01Z')",[id(15),company,changeHash,id(16),id(21),[effect]])
assert.equal((await checkRows()).rows[0].refs.length,2)
// Actual E patch owner composes over the same qualified original Z04; repeated
// structural refs are legal only for genuine source-approved customer epochs.
const eventId=id(30),eventAssessment=id(31),eventVersionAt='2026-10-09T23:00:00Z'
const eventRaw=baselineRaw.replace('BGM+Z04+BASE','BGM+Z06+CUSTOMER').replace('DTM+92:202610010000','DTM+157:202610100000').replace('199001011234','198001011234').replace('++Person',"++Updated Person").replace('RFF+Z05',"CCI++Z13'CAV+E34'RFF+Z05")
const eventHash=await sha(eventRaw)
const eventFactsText=JSON.stringify({objects:[{object:{objectId:'735123456789012345',identityAgency:'9'},disposition:'accepted',party:{syntheticUnqualified:true},business:{syntheticUnqualified:true,sourceMessageId:eventId,customerId:customer}}]})
const eventFactsHash=await sha(eventFactsText)
await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z06',$3)",[eventId,company,eventRaw])
await db.query("INSERT INTO gridex_received_sources.object_assessments(id,company_id,source_message_id,environment,source_payload_hash,facts_text,facts_hash) VALUES($1,$2,$3,'test',$4,$5,$6)",[eventAssessment,company,eventId,eventHash,eventFactsText,eventFactsHash])
await db.query("INSERT INTO gridex_received_sources.object_availability_witnesses VALUES($1,$2,'test',$3,$4,'2000-01-01Z')",[eventAssessment,company,eventId,eventFactsHash])
await db.query('INSERT INTO gridex_customer_life_events.customer_versions VALUES($1,$2,$3,$4,1)',[company,customer,eventId,eventVersionAt])
await db.query("INSERT INTO gridex_customer_life_events.transitions VALUES($1,$2,$3,'2000-01-01Z',$4,$5)",[company,eventId,eventHash,[{customerId:customer,effectiveAt:eventVersionAt,pointId:'735123456789012345',identityAgency:'9',allowedFields:['227','228']}],[{point:'735123456789012345',identityAgency:'9',customerParty:['198001011234','SE2','260'],name:['Updated Person']} ]])
const epochFirst=[...csvLines[1].split(';')],epochSecond=[...epochFirst],epochThird=[...epochFirst]
epochFirst[20]='20261010';epochSecond[17]='198001011234';epochSecond[18]='Updated Person';epochSecond[19]='20261010';epochSecond[20]='20261015'
epochThird[17]='198001011234';epochThird[18]='Updated Person';epochThird[19]='20261015';epochThird[7]='NewStreet'
const epochCsv=[csvLines[0],epochFirst.join(';'),epochSecond.join(';'),epochThird.join(';')].join('\n'),epochRefs=[rowSources[0],rowSources[0],twoRefs[1]]
const eventUniverse=JSON.parse(multiText);eventUniverse.sources.push({sourceMessageId:eventId,rawPayload:eventRaw,payloadHash:eventHash,assessments:[{id:eventAssessment,previousAssessmentId:null,availabilityWitnessId:id(34),availableAt:'2000-01-01Z',factsText:eventFactsText,factsHash:eventFactsHash}]})
const eventUniverseText=JSON.stringify(eventUniverse)
const customerRows=(raw=epochCsv,refs=epochRefs)=>db.query("SELECT gridex_ai_processing.require_original_row_sources_v1($1::jsonb,now(),(SELECT i FROM public.ediel_message_intents i WHERE id=$2),$3,$4) AS refs",[eventUniverseText,intent,raw,JSON.stringify(refs)])
assert.equal((await customerRows()).rows[0].refs.length,3)
// Genuine own E remains usable in a mixed source with a separate physical F/G.
// The second scope is not this row's point and grants it no structural approval.
const mixedGoodRaw=eventRaw.replace('UNT+',"LIN+2++735123456789012346:::9'DTM+157:202610100000:203'CCI++Z13'CAV+E32'RFF+LI:OTHER'UNT+")
const mixedGoodHash=await sha(mixedGoodRaw),mixedGoodUniverse=JSON.parse(eventUniverseText);Object.assign(mixedGoodUniverse.sources[2],{rawPayload:mixedGoodRaw,payloadHash:mixedGoodHash})
await db.query('UPDATE gridex_customer_life_events.transitions SET payload_hash=$1 WHERE source_message_id=$2',[mixedGoodHash,eventId]);await db.query('UPDATE gridex_received_sources.object_assessments SET source_payload_hash=$1 WHERE source_message_id=$2',[mixedGoodHash,eventId])
assert.equal((await db.query("SELECT gridex_ai_processing.require_original_row_sources_v1($1::jsonb,now(),(SELECT i FROM public.ediel_message_intents i WHERE id=$2),$3,$4) AS refs",[JSON.stringify(mixedGoodUniverse),intent,epochCsv,JSON.stringify(epochRefs)])).rows[0].refs.length,3)
const mixedRaw=eventRaw.replace('LIN+1++735123456789012345','LIN+1++735123456789012346').replace("UNT+","LIN+2++735123456789012345:::9'DTM+157:202610100000:203'CCI++Z13'CAV+E32'RFF+LI:UNKNOWN'UNT+")
const mixedHash=await sha(mixedRaw),mixedUniverse=JSON.parse(eventUniverseText);Object.assign(mixedUniverse.sources[2],{rawPayload:mixedRaw,payloadHash:mixedHash})
await db.query('UPDATE gridex_customer_life_events.transitions SET payload_hash=$1 WHERE source_message_id=$2',[mixedHash,eventId]);await db.query('UPDATE gridex_received_sources.object_assessments SET source_payload_hash=$1 WHERE source_message_id=$2',[mixedHash,eventId])
await assert.rejects(()=>db.query("SELECT gridex_ai_processing.require_original_row_sources_v1($1::jsonb,now(),(SELECT i FROM public.ediel_message_intents i WHERE id=$2),$3,$4)",[JSON.stringify(mixedUniverse),intent,epochCsv,JSON.stringify(epochRefs)]),/ai_list_original_dated_source_owner_missing/)
await db.query('UPDATE gridex_customer_life_events.transitions SET payload_hash=$1 WHERE source_message_id=$2',[eventHash,eventId]);await db.query('UPDATE gridex_received_sources.object_assessments SET source_payload_hash=$1 WHERE source_message_id=$2',[eventHash,eventId])

await assert.rejects(()=>customerRows(twoCsv,twoRefs),/ai_list_original_row_source_mismatch/)
await assert.rejects(()=>customerRows(epochCsv.replace('Updated Person','WRONG')),/ai_list_original_row_source_mismatch/)
await assert.rejects(()=>customerRows(epochCsv.replace('20261010','20261011')),/ai_list_original_row_source_mismatch/)
await assert.rejects(()=>customerRows([csvLines[0],epochFirst.join(';'),epochThird.join(';')].join('\n'),[rowSources[0],twoRefs[1]]),/ai_list_original_supply_epoch_omitted/)
await db.query("UPDATE gridex_received_sources.object_availability_witnesses SET observed_at='2100-01-01Z' WHERE assessment_id=$1",[eventAssessment])
await assert.rejects(customerRows,/ai_list_original_customer_patch_owner_required/)
await db.query("UPDATE gridex_received_sources.object_availability_witnesses SET observed_at='2000-01-01Z' WHERE assessment_id=$1",[eventAssessment])
await db.query("UPDATE gridex_customer_life_events.customer_versions SET effective_at=effective_at+interval '1 microsecond' WHERE source_message_id=$1",[eventId])
await db.query("UPDATE gridex_customer_life_events.transitions SET approved_scope=jsonb_set(approved_scope,'{0,effectiveAt}',to_jsonb($1::timestamptz)) WHERE source_message_id=$2",['2026-10-09T23:00:00.000001Z',eventId])
await assert.rejects(customerRows,/ai_list_date_only_customer_boundary_unrepresentable/)
await db.query('UPDATE gridex_customer_life_events.customer_versions SET effective_at=$1 WHERE source_message_id=$2',[eventVersionAt,eventId]);await db.query("UPDATE gridex_customer_life_events.transitions SET approved_scope=jsonb_set(approved_scope,'{0,effectiveAt}',to_jsonb($1::timestamptz)) WHERE source_message_id=$2",[eventVersionAt,eventId])
// Seal the actual E-derived original under another genuine validated intent.
const epochIntent=id(32)
await db.query("INSERT INTO public.ediel_message_intents SELECT (i).* FROM public.ediel_message_intents i WHERE false")
await db.query("INSERT INTO public.ediel_message_intents SELECT (jsonb_populate_record(NULL::public.ediel_message_intents,to_jsonb(i)||jsonb_build_object('id',$2::uuid,'operation_id',$3::uuid,'payload',jsonb_set(i.payload,'{requestId}',to_jsonb($3::text))))).* FROM public.ediel_message_intents i WHERE i.id=$1",[intent,epochIntent,id(33)])
await db.exec('SET ROLE service_role;')
await db.query('SELECT public.gridex_ai_record_outbound_original_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)',[company,actor,epochIntent,id(17),multiHash,epochCsv,'AI.csv','text/csv; charset=utf-8',JSON.stringify(epochRefs)])
await db.exec('RESET ROLE;')
const frozenEpoch=(await db.query('SELECT customer_history_basis,source_ids FROM gridex_ai_processing.outbound_origins WHERE intent_id=$1',[epochIntent])).rows[0]
assert.equal(frozenEpoch.customer_history_basis.authorizesInitialCustomer,false);assert.equal(frozenEpoch.customer_history_basis.patches[0].sourceMessageId,eventId);assert.ok(frozenEpoch.source_ids.includes(eventId))
await db.query("UPDATE gridex_received_sources.object_availability_witnesses SET observed_at='2100-01-01Z' WHERE assessment_id=$1",[eventAssessment]);await db.exec('SET ROLE service_role;')
assert.equal((await db.query('SELECT public.gridex_ai_record_outbound_original_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[company,actor,epochIntent,id(17),multiHash,epochCsv,'AI.csv','text/csv; charset=utf-8',JSON.stringify(epochRefs)])).rows[0].result.status,'original')
await db.exec('RESET ROLE;')
// Remove these deliberately mutable synthetic E fixtures before old no-change
// probes. Authentic transitions and outcomes are immutable in the real schema.
await db.exec('DELETE FROM gridex_customer_life_events.customer_versions;DELETE FROM gridex_customer_life_events.transitions;')
await db.exec('SET ROLE service_role;')
await record()
await assert.rejects(()=>record(snapshot,csv.replace('Person','DIFFERENT')),/ai_list_original_conflict/)
const draft={actorUserId:actor,companyId:company,intentId:intent,sourceOperationId:id(11),direction:'outbound',messageStandard:'ai_list',messageFamily:'AI_LIST',messageCode:'AI',messageVersion:profile.technicalVersion,environment:'test',processType:'ai_list_export',rawPayload:csv,fileName:'AI.csv',mimeType:'text/csv; charset=utf-8',senderEdielId:'12345',receiverEdielId:'54321',customerId:customer,siteId:site,meteringPointId:null,communicationRouteId:route,routeProfileId:profileId}
const prospective=(d=draft)=>db.query('SELECT public.gridex_ai_prepare_outbound_original_v1($1,$2,$3,$4) AS result',[company,actor,intent,JSON.stringify(d)])
const prepared=(await prospective()).rows[0].result
assert.equal(prepared.owner,'ai-list-private-original-v1');assert.equal(prepared.operationId,id(11));assert.equal(prepared.sourceHash,await sha(csv))
for(const bad of [{...draft,sourceOperationId:id(99)},{...draft,siteId:id(99)},{...draft,rawPayload:csv.replace('Person','OTHER')},{...draft,messageVersion:'FABRICATED'},{...draft,rulePackSnapshot:{originalWitness:{claimed:true}}},{...draft,switchRequestId:id(99)},{...draft,externalReference:'FAKE'}])await assert.rejects(()=>prospective(bad),/ai_list_private_original_required|ai_list_edifact_or_foreign_link_forbidden/)
await db.exec('RESET ROLE;')
await db.query("UPDATE public.ediel_message_intents SET payload=jsonb_set(payload,'{toDate}','\"20261201\"') WHERE id=$1",[intent])
await db.exec('SET ROLE service_role;')
await assert.rejects(()=>prospective(),/ai_list_private_original_required/)
await db.exec('RESET ROLE;')
await db.query("UPDATE public.ediel_message_intents SET payload=jsonb_set(payload,'{toDate}','\"20261101\"') WHERE id=$1",[intent])
await db.exec('SET ROLE service_role;')

await db.exec('RESET ROLE;')
const insert=()=>db.query("INSERT INTO public.ediel_messages(id,company_id,created_by,direction,message_standard,message_family,message_code,message_version,raw_payload,sender_ediel_id,receiver_ediel_id,file_name,mime_type,intent_id,customer_id,site_id,communication_route_id,route_profile_id,source_operation_id,process_type) VALUES($1,$2,$3,'outbound','ai_list','AI_LIST','AI','Ver20140401',$4,'12345','54321','AI.csv','text/csv; charset=utf-8',$5,$6,$7,$8,$9,$10,'ai_list_export')",[source,company,actor,csv,intent,customer,site,route,profileId,id(11)])
// A late message constraint rolls back its private origin binding too.
await db.exec("CREATE FUNCTION public.synthetic_message_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_late_message_failure';END$$;CREATE TRIGGER zz_synthetic_failure AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION public.synthetic_message_failure();")
await assert.rejects(()=>insert(),/synthetic_late_message_failure/)
assert.equal((await db.query('SELECT count(*)::int AS n FROM gridex_ai_processing.outbound_origin_bindings')).rows[0].n,0)
await db.exec('DROP TRIGGER zz_synthetic_failure ON public.ediel_messages;')
await insert()
const gate=(await db.query('SELECT gridex_ai_processing.require_ai_outbound_source_v1($1,$2,$3) AS result',[company,source,actor])).rows[0].result
assert.equal(gate.origin.intentId,intent);assert.equal(gate.origin.snapshotId,snapshot);assert.equal(gate.origin.readsetHash,hash)
// Sender-only capabilities can send the already source-bound original, but
// cannot originate/register/disclose a new personal export request.
await db.exec("CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT CASE current_setting('gridex.synthetic_permissions',true) WHEN 'send' THEN $3 IN('ediel.send','communication.send') WHEN 'write' THEN $3='communication.write' WHEN 'testing' THEN $3='ediel_testing.write' ELSE true END$$;SET gridex.synthetic_permissions='send';")
assert.equal((await db.query('SELECT gridex_ai_processing.require_ai_outbound_source_v1($1,$2,$3) AS result',[company,source,actor])).rows[0].result.origin.intentId,intent)
await db.exec('SET ROLE service_role;')
await assert.rejects(()=>prospective(),/ediel_tenant_actor_forbidden/)
await db.exec("RESET ROLE;SET gridex.synthetic_permissions='write';")
await assert.rejects(()=>db.query('SELECT gridex_ai_processing.require_ai_outbound_source_v1($1,$2,$3)',[company,source,actor]),/ediel_tenant_actor_forbidden/)
// A TEST-only actor cannot use the environment-less personal-history API.
await db.exec("SET gridex.synthetic_permissions='testing';SET ROLE service_role;")
await assert.rejects(()=>db.query('SELECT public.gridex_ai_export_decision_v1($1,$2)',[company,actor]),/ediel_tenant_actor_forbidden/)
assert.equal((await prospective()).rows[0].result.owner,'ai-list-private-original-v1')
await db.exec('RESET ROLE;')
await db.query("UPDATE public.ediel_message_intents SET environment='production' WHERE id=$1",[intent])
await db.exec('SET ROLE service_role;')
await assert.rejects(()=>prospective(),/ediel_tenant_actor_forbidden/)
await db.exec('RESET ROLE;')
await db.query("UPDATE public.ediel_message_intents SET environment='test' WHERE id=$1",[intent])
await db.exec("SET gridex.synthetic_permissions='all';")

await db.exec('SET ROLE service_role;')
assert.equal((await db.query('SELECT public.gridex_ai_outbound_origin_status_v1($1,$2,$3) AS result',[company,actor,intent])).rows[0].result.messageId,source)
await db.exec('RESET ROLE;')
await assert.rejects(()=>db.exec("UPDATE gridex_ai_processing.outbound_origins SET payload_hash=repeat('b',64)"),/received_source_evidence_is_append_only/)
assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.gridex_ai_record_outbound_original_v1(uuid,uuid,uuid,uuid,text,text,text,text,text)','EXECUTE') AS allowed")).rows[0].allowed,false)
await db.close()
console.log('PASS: synthetic purpose-qualified AI intent/original/private complete snapshot/hash/atomic first-message binding/replay; every personal CSV cell compared to exact scoped original sources, caller history JSON never accepted. Native/actual-owner/semantic history acceptance NOT RUN.')
