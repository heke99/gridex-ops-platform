// Actual closure append-time proof; its immutable supply-source owner, lexical
// and reviewer authorities are declared fixtures. Not native/original evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;
 CREATE TABLE companies(id uuid,status text);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid,company_id uuid,environment text,payload_hash text,message_code text,source_received_at timestamptz,raw_payload text);
 CREATE TABLE gridex_received_sources.object_assessments(id uuid,source_message_id uuid,company_id uuid,environment text,facts_hash text,facts_text text,source_payload_hash text,previous_assessment_id uuid);
 CREATE TABLE gridex_received_sources.object_availability_witnesses(assessment_id uuid,facts_hash text,observed_at timestamptz);
 CREATE TABLE gridex_received_sources.object_selection_snapshots(id uuid,company_id uuid,environment text,readset_hash text,cutoff_at timestamptz,readset_text text);
 CREATE TABLE gridex_received_sources.epoch(singleton bool,opened_at timestamptz);
 CREATE TABLE supplier_switch_requests(id uuid,company_id uuid,customer_id uuid,metering_point_id uuid,site_id uuid,inbound_z04_message_id uuid,rff_li_reference text,confirmed_start_date date,outbound_z03_message_id uuid,created_at timestamptz,status text);
 CREATE TABLE customer_supply_periods(id uuid,company_id uuid,customer_id uuid,metering_point_id uuid,source_message_id uuid,source_end_message_id uuid,source_switch_request_id uuid,start_date date,end_date date,status text);
 CREATE TABLE ediel_messages(id uuid,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,customer_id uuid,metering_point_id uuid,site_id uuid,created_at timestamptz,message_sent_at timestamptz);
 CREATE TABLE metering_points(id uuid,company_id uuid,customer_id uuid,site_id uuid);CREATE TABLE customer_sites(id uuid,company_id uuid,customer_id uuid);
 CREATE TABLE protected_supply_fixture(basis jsonb);
 CREATE FUNCTION gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT basis FROM public.protected_supply_fixture$$;
 CREATE FUNCTION gridex_received_sources.closure_wire_matches_v1(text,jsonb,jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION gridex_received_sources.review_party_proof_consistent(jsonb,jsonb,timestamptz) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930211258_ediel_source_qualified_supply_closure_continuity.sql',import.meta.url),'utf8'));checks++
 const c=id(2),initial=id(1),close=id(30),point=id(4),customer=id(3),site=id(5),sw=id(7),period=id(8),original=id(33),root=id(32),latest=id(34),snapshot=id(35)
 const start='2026-10-01T11:30:00Z',stop='2026-10-14T23:00:00Z',cutoff='2026-09-23T10:00:30Z',rootHash='a'.repeat(64),latestHash='b'.repeat(64),payloadHash='c'.repeat(64),closeHash='e'.repeat(64)
 const object={objectId:'735123456789012345',identityAgency:'9'}
 const cover={kind:'post_ledger_supply',baselineSourceMessageId:initial,baselineAssessmentId:root,baselineFactsHash:rootHash,supplyPeriodId:period,switchRequestId:sw,switchCreatedAt:'2026-09-23T09:00:00Z',outboundSourceMessageId:original,outboundCreatedAt:'2026-09-23T09:01:00Z',validFrom:start,validTo:null}
 const common={sourceMessageId:initial,sourcePayloadHash:payloadHash,companyId:c,environment:'test',customerId:customer,meteringPointId:point,siteId:site,switchRequestId:sw,supplyPeriodId:period}
 const rootEntry={object,disposition:'accepted',business:{...common,owner:'inbound-z04-switch-confirmation-v1',effectiveFrom:{utc:start}},party:{parties:{legalSender:'12345',legalReceiver:'54321'}}}
 const currentEntry={object,disposition:'accepted',business:{...common,owner:'reviewed-received-structure-v1',wire:{messageCode:'Z04',functionCode:'9',legalSender:'12345',legalReceiver:'54321',effectiveFrom:{utc:start},caseReference:'LI'},replaces:null,coverageWindow:cover}}
 const wire={object,messageCode:'Z05',legalSender:'12345',legalReceiver:'54321',transportSender:'12345',transportReceiver:'54321',effectiveTo:{marketMinute:'202610150000',utc:stop}}
 const business={...common,version:1,owner:'reviewed-received-closure-v1',coverage:'reviewed_post_ledger_closure',sourceDisposition:'not_established',businessDisposition:'reviewed',graphNamespace:'legacy_unqualified',sourceMessageId:close,sourcePayloadHash:closeHash,sourceReceivedAt:'2026-09-23T10:00:00Z',object,assessedAt:'2026-09-23T10:01:00Z',wire,reviewerUserId:id(9),reviewStatement:'original_supply_closure',coverageWindow:cover,baselineCurrentAssessmentId:latest,reviewSnapshot:{snapshotId:snapshot,readsetHash:'d'.repeat(64),cutoffAt:cutoff},baselineCoverageAssessment:{sourceMessageId:initial,assessmentId:latest,factsHash:latestHash,payloadHash},legacyEndDateProjection:'2026-10-15'}
 const supply={qualified:true,companyId:c,periodId:period,switchId:sw,initialSourceMessageId:initial,sourceMessageId:close,customerId:customer,meteringPointId:point,siteId:site,dsoEdielId:'12345',marketStartAt:start,marketEndAt:stop,originalMessageId:original,originalAcceptedAt:'2026-09-23T09:10:00Z',sourceObjects:[{point:object.objectId,identityAgency:'9'}]}
 await db.query('INSERT INTO protected_supply_fixture VALUES($1)',[JSON.stringify(supply)])
 await db.query("INSERT INTO companies VALUES($1,'active')",[c]);await db.exec("INSERT INTO gridex_received_sources.epoch VALUES(true,'2026-09-23T08:00:00Z')")
 for(const [message,hash,code,received]of [[initial,payloadHash,'Z04','2026-09-23T09:30:00Z'],[close,closeHash,'Z05','2026-09-23T10:00:00Z']])await db.query("INSERT INTO gridex_received_sources.sources VALUES($1,$2,'test',$3,$4,$5,'declared-original-fixture')",[message,c,hash,code,received])
 for(const [assessment,hash,entry,previous]of [[root,rootHash,rootEntry,null],[latest,latestHash,currentEntry,root]]){await db.query("INSERT INTO gridex_received_sources.object_assessments VALUES($1,$2,$3,'test',$4,$5,$6,$7)",[assessment,initial,c,hash,JSON.stringify({objects:[entry]}),payloadHash,previous]);await db.query("INSERT INTO gridex_received_sources.object_availability_witnesses VALUES($1,$2,'2026-09-23T09:40:00Z')",[assessment,hash])}
 const readset={complete:true,sources:[{sourceMessageId:close,payloadHash:closeHash,assessments:[]},{sourceMessageId:initial,payloadHash,assessments:[{id:root,factsHash:rootHash,availableAt:'2026-09-23T09:40:00Z'},{id:latest,factsHash:latestHash,availableAt:'2026-09-23T09:40:00Z'}]}]}
 await db.query("INSERT INTO gridex_received_sources.object_selection_snapshots VALUES($1,$2,'test',$3,$4,$5)",[snapshot,c,'d'.repeat(64),cutoff,JSON.stringify(readset)])
 await db.query("INSERT INTO supplier_switch_requests VALUES($1,$2,$3,$4,$5,$6,'LI','2026-10-01',$7,'2026-09-23T09:00Z','completed')",[sw,c,customer,point,site,initial,original]);await db.query("INSERT INTO customer_supply_periods VALUES($1,$2,$3,$4,$5,$6,$7,'2026-10-01','2026-10-15','ending')",[period,c,customer,point,initial,close,sw]);await db.query("INSERT INTO ediel_messages VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03',$3,$4,$5,'2026-09-23T09:01Z',NULL)",[original,c,customer,point,site]);await db.query('INSERT INTO metering_points VALUES($1,$2,$3,$4)',[point,c,customer,site]);await db.query('INSERT INTO customer_sites VALUES($1,$2,$3)',[site,c,customer])
 const call=()=>db.query('SELECT gridex_received_sources.review_closure_proof_consistent($1,$2,$3) ok',[JSON.stringify({parties:{legalSender:'12345',legalReceiver:'54321',transportSender:'12345',transportReceiver:'54321'}}),JSON.stringify(business),close])
 assert.equal((await call()).rows[0].ok,true);checks++ // precise start, ended future, actual original receipt clock
 for(const key of ['initialSourceMessageId','sourceMessageId','originalMessageId','dsoEdielId','siteId']){await db.query('UPDATE protected_supply_fixture SET basis=jsonb_set(basis,$1,$2)',[[key],JSON.stringify(id(99))]);assert.equal((await call()).rows[0].ok,false);await db.query('UPDATE protected_supply_fixture SET basis=$1',[JSON.stringify(supply)]);checks++}
 await db.query('UPDATE customer_supply_periods SET source_message_id=$1',[close]);assert.equal((await call()).rows[0].ok,false);checks++;await db.query('UPDATE customer_supply_periods SET source_message_id=$1',[initial])
 await db.query('UPDATE customer_supply_periods SET source_end_message_id=NULL');assert.equal((await call()).rows[0].ok,false);checks++;await db.query('UPDATE customer_supply_periods SET source_end_message_id=$1',[close])
 await db.exec('DELETE FROM gridex_received_sources.object_availability_witnesses');assert.equal((await call()).rows[0].ok,false);checks++
 assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_received_sources.review_closure_proof_consistent(jsonb,jsonb,uuid)','EXECUTE') ok")).rows[0].ok,false);checks++
 console.log(`PASS ${checks} focused closure initial/end UUID continuity/minute-start/frozen-original-clock/witness/ACL PostgreSQL checks; declared source owner fixtures, not native acceptance evidence`)
}finally{await db.close()}
