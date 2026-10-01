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
await db.exec(`ALTER TABLE public.ediel_messages ADD COLUMN intent_id uuid,ADD COLUMN customer_id uuid,ADD COLUMN site_id uuid,ADD COLUMN communication_route_id uuid,ADD COLUMN route_profile_id uuid;
ALTER TABLE public.customer_sites ADD COLUMN customer_id uuid;
CREATE TABLE public.ediel_message_intents(id uuid PRIMARY KEY,company_id uuid,environment text,message_family text,message_code text,business_process text,direction text,validation_status text,customer_id uuid,customer_site_id uuid,metering_point_id text,communication_route_id uuid,route_profile_id uuid,sender_ediel_id text,receiver_ediel_id text,application_reference text,interchange_reference text,message_reference text,transaction_reference text,payload jsonb,created_at timestamptz);
CREATE TABLE public.customer_supply_periods(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,start_date date,end_date date,actual_start_date date,actual_end_date date);
CREATE TABLE gridex_received_sources.object_selection_snapshots(id uuid PRIMARY KEY,company_id uuid,environment text,cutoff_at timestamptz,captured_at timestamptz,readset_text text,readset_hash text);`)
const decoder=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8');await db.exec(decoder.slice(0,decoder.indexOf('CREATE FUNCTION gridex_received_sources.permission_wire_v1'))+'\nCOMMIT;')
for(const file of ['20260930165219_ediel_ai_processing_decision_consumer.sql','20260930174145_ediel_ai_source_atomic_reconciliation.sql','20260930181141_ediel_ai_personal_mail_storage_guards.sql','20260930190501_ediel_ai_message_personal_scope_guard.sql','20260930201813_ediel_ai_outbound_source_authority.sql','20260930203354_ediel_ai_intent_source_origination.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=id(1),actor=id(2),source=id(3),decision=id(4),intent=id(5),site=id(6),customer=id(7),snapshot=id(8),route=id(9),profileId=id(10)
const csv='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;'
await db.query('INSERT INTO public.companies VALUES($1)',[company])
await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[actor])
await db.query('INSERT INTO public.customer_sites VALUES($1,$2,$3)',[site,company,customer])
await db.query("INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES($1,'test','electricity',true,now()-interval '1 day')",[company])
await db.query("INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES($1,'test',$2,'EdielId','12345',now()-interval '1 day')",[company,actor])
await db.query("INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES($1,'test',$2,'electricity_supplier',now()-interval '1 day')",[company,actor])
const profile=(await db.query('SELECT gridex_ai_processing.native_profile_v1() AS profile')).rows[0].profile
await db.query("INSERT INTO public.ediel_message_intents VALUES($1,$2,'test','AI_LIST','AI','reconciliation','outbound','validated',$3,$4,NULL,$5,$6,'12345','54321','','','',NULL,$7,now()-interval '1 minute')",[intent,company,customer,site,route,profileId,{owner:'ai-list-export-request-v1',fromDate:'20261001',toDate:'20261101',sourceSha256:profile.sourceSha256,technicalVersion:profile.technicalVersion,requestId:id(11)}])
const rowSources=[{sourceMessageId:id(12),baselineSourceMessageId:id(12),addressSourceMessageId:id(12),supplyPeriodId:id(14)}]
const record=(snap=snapshot,raw=csv,refs=rowSources,rowHash=hash)=>db.query('SELECT public.gridex_ai_record_outbound_original_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[company,actor,intent,snap,rowHash,raw,'AI.csv','text/csv; charset=utf-8',JSON.stringify(refs)])
const baselineRaw="UNB+UNOC:3+54321:14+12345:14+261001:1200+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+BASE+9'NAD+FR+54321:160:SVK'NAD+DO+12345:160:SVK'LIN+1++735123456789012345:::9'DTM+92:202610010000:203'RFF+Z05:NET'NAD+UD+199001011234:SE2:260++Person'NAD+IT+735123456789012345::9+++Street+Town++12345+SE'NAD+Z02+12345:160:SVK'UNT+10+M'UNZ+1+I'"
const sha=async text=>(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') AS hash",[text])).rows[0].hash
const multiPartyRaw=baselineRaw.replace('++Person','++ Person : Second Name').replace('+++Street','+++ First Street : : Third Street ')
const partyProjection=(await db.query("SELECT gridex_ai_processing.party_text_v1(t,CASE WHEN t#>>'{elements,1,0}'='UD' THEN 4 ELSE 5 END,CASE WHEN t#>>'{elements,1,0}'='UD' THEN 2 ELSE 3 END) AS value FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2($1)) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}' IN('UD','IT') ORDER BY t#>>'{elements,1,0}'",[multiPartyRaw])).rows
assert.deepEqual(partyProjection.map(row=>row.value),['First Street\n\nThird Street','Person\nSecond Name'])
const payloadHash=await sha(baselineRaw)
const factsText=JSON.stringify({objects:[{object:{objectId:'735123456789012345',identityAgency:'9',registers:[{segmentIndex:5}]},disposition:'accepted',business:{owner:'reviewed-received-structure-v1',companyId:company,environment:'test',customerId:customer,siteId:site,sourceMessageId:id(12),sourcePayloadHash:payloadHash,supplyPeriodId:id(14),coverageWindow:{baselineSourceMessageId:id(12)},wire:{businessCase:'supply_baseline',messageCode:'Z04',legalSender:'54321',legalReceiver:'12345',effectiveFrom:{marketMinute:'202610010000'}}}}]})
const body=JSON.stringify({complete:true,sources:[{sourceMessageId:id(12),rawPayload:baselineRaw,payloadHash,assessments:[{id:id(13),previousAssessmentId:null,availabilityWitnessId:id(90),availableAt:'2026-09-30T01:00:00Z',factsText,factsHash:await sha(factsText)}]}]})
await db.query("INSERT INTO public.customer_supply_periods VALUES($1,$2,$3,NULL,'2026-10-01',NULL,NULL,NULL)",[id(14),company,customer])
const hash=(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') AS hash",[body])).rows[0].hash
await db.query("INSERT INTO gridex_received_sources.object_selection_snapshots VALUES($1,$2,'test',now(),now(),$3,$4)",[snapshot,company,body,hash])
await db.exec('GRANT USAGE ON SCHEMA public TO service_role;SET ROLE service_role;')
await assert.rejects(()=>record(),/ai_bi_processing_decision_missing/)
await db.exec('RESET ROLE;')
assert.equal((await db.query('SELECT count(*)::int AS n FROM gridex_ai_processing.outbound_origins')).rows[0].n,0)
await db.query("INSERT INTO gridex_ai_processing.decisions(id,company_id,list_type,purpose,revision,gdpr_basis,retention_days,valid_from,valid_until,source_reference,source_sha256,decision_owner_registry_id,decision_owner_registry_version) VALUES($1,$2,'AI','ediel_list_export',1,'SYNTHETIC_UNQUALIFIED',30,now()-interval '1 hour',now()+interval '1 hour','synthetic-only',repeat('a',64),$3,'synthetic-only')",[decision,company,id(90)])
let migration=readFileSync(new URL('../supabase/migrations/20260930201813_ediel_ai_outbound_source_authority.sql',import.meta.url),'utf8')
let owner=migration.slice(migration.indexOf('CREATE FUNCTION gridex_ai_processing.current_purpose_decision_v1'),migration.indexOf('REVOKE ALL ON FUNCTION gridex_ai_processing.current_purpose_decision_v1'))
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
assert.equal((await db.query("SELECT gridex_ai_processing.require_original_row_sources_v1($1::jsonb,now(),(SELECT i FROM public.ediel_message_intents i WHERE id=$2),$3,$4) AS refs",[multiText,intent,twoCsv,JSON.stringify(twoRefs)])).rows[0].refs.length,2)
await db.exec('SET ROLE service_role;')
await record()
await assert.rejects(()=>record(snapshot,csv.replace('Person','DIFFERENT')),/ai_list_original_conflict/)
await db.exec('RESET ROLE;')
const insert=()=>db.query("INSERT INTO public.ediel_messages(id,company_id,created_by,direction,message_standard,message_family,message_code,message_version,raw_payload,sender_ediel_id,receiver_ediel_id,file_name,mime_type,intent_id,customer_id,site_id,communication_route_id,route_profile_id) VALUES($1,$2,$3,'outbound','ai_list','AI_LIST','AI','Ver20140401',$4,'12345','54321','AI.csv','text/csv; charset=utf-8',$5,$6,$7,$8,$9)",[source,company,actor,csv,intent,customer,site,route,profileId])
// A late message constraint rolls back its private origin binding too.
await db.exec("CREATE FUNCTION public.synthetic_message_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_late_message_failure';END$$;CREATE TRIGGER zz_synthetic_failure AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION public.synthetic_message_failure();")
await assert.rejects(()=>insert(),/synthetic_late_message_failure/)
assert.equal((await db.query('SELECT count(*)::int AS n FROM gridex_ai_processing.outbound_origin_bindings')).rows[0].n,0)
await db.exec('DROP TRIGGER zz_synthetic_failure ON public.ediel_messages;')
await insert()
const gate=(await db.query('SELECT gridex_ai_processing.require_ai_outbound_source_v1($1,$2,$3) AS result',[company,source,actor])).rows[0].result
assert.equal(gate.origin.intentId,intent);assert.equal(gate.origin.snapshotId,snapshot);assert.equal(gate.origin.readsetHash,hash)
await db.exec('SET ROLE service_role;')
assert.equal((await db.query('SELECT public.gridex_ai_outbound_origin_status_v1($1,$2,$3) AS result',[company,actor,intent])).rows[0].result.messageId,source)
await db.exec('RESET ROLE;')
await assert.rejects(()=>db.exec("UPDATE gridex_ai_processing.outbound_origins SET payload_hash=repeat('b',64)"),/received_source_evidence_is_append_only/)
assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.gridex_ai_record_outbound_original_v1(uuid,uuid,uuid,uuid,text,text,text,text,text)','EXECUTE') AS allowed")).rows[0].allowed,false)
await db.close()
console.log('PASS: synthetic purpose-qualified AI intent/original/private complete snapshot/hash/atomic first-message binding/replay; every personal CSV cell compared to exact scoped original sources, caller history JSON never accepted. Native/actual-owner/semantic history acceptance NOT RUN.')
