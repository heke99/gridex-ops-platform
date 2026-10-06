import {existsSync,readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {expect,it,vi} from 'vitest'
import type {RequestedChangeBasis} from '@/lib/ediel/production/requestedChangeSource'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
import {buildRequestedChangeDraft} from '@/lib/ediel/intent/renderers/lifeEvent'

// Actual retained SQL producer plus real renderer and transport intent guard.
// Source qualification, graph lock and wire decoding are explicitly declared
// finite ports. These records are not business authority or native send proof.
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const signature='public.ediel_originate_requested_change_before_scope_fence_v1(uuid,uuid,uuid,jsonb)'
const forward=new URL('../supabase/migrations/20261006214250_ediel_requested_change_owned_site_origin.sql',import.meta.url)
const schema=readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8')
function table(name:string){const start=schema.indexOf(`CREATE TABLE ${name} (`),end=schema.indexOf('\n);',start);if(start<0||end<start)throw Error('actual_table_required:'+name);return schema.slice(start,end+3)}
function fn(source:string,name:string){const start=source.indexOf(`CREATE FUNCTION ${name}(`),end=source.indexOf('$$;',start);if(start<0||end<start)throw Error('actual_function_required:'+name);return source.slice(start,end+3)}
async function setup(){
 const db=new PGlite()
 await db.exec(`CREATE ROLE service_role;CREATE ROLE declared_owner;CREATE ROLE declared_reader;
 CREATE SCHEMA gridex_requested_changes;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_received_sources;
 ${['public.ediel_message_intents','public.outbound_requests','public.ediel_route_profiles','gridex_requested_changes.events','gridex_requested_changes.origins'].map(table).join('\n')}
 CREATE TABLE public.metering_points(id uuid,company_id uuid,customer_id uuid,site_id uuid,meter_point_id text,ediel_metering_point_id text,grid_area_code text);
 CREATE TABLE public.customer_sites(id uuid,company_id uuid,customer_id uuid);
 CREATE TABLE public.communication_routes(id uuid,company_id uuid,is_active boolean);
 CREATE TABLE public.declared_source_context(status text);INSERT INTO public.declared_source_context VALUES('authorized');
 CREATE FUNCTION gridex_requested_changes.context_v1(c uuid,event_id uuid,actor uuid)RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF c IS DISTINCT FROM '${id(1)}'::uuid OR event_id IS DISTINCT FROM '${id(2)}'::uuid OR actor IS DISTINCT FROM '${id(3)}'::uuid THEN RAISE EXCEPTION 'declared_source_scope_refused';END IF;
 RETURN jsonb_build_object('status',(SELECT status FROM public.declared_source_context),'source','declared_context','variant','E');END$$;
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2()RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 INSERT INTO gridex_requested_changes.events(id,company_id,environment,supply_period_id,supply_source_message_id,supply_state_version,contract_id,protected_contract_hash,customer_id,metering_point_id,customer_snapshot_hash,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,brp_ediel_id,variant,event_kind,effective_at,customer_identity,invoicee_profile,source_reference,source_sha256,source_version,approved_by,approved_at)
 VALUES('${id(2)}','${id(1)}','test','${id(20)}','${id(21)}',1,'${id(22)}',repeat('a',64),'${id(9)}','${id(11)}',repeat('b',64),'${id(12)}','12345','54321','735999123456789012','9','TES','99999','E','death','2026-10-06T21:00:00Z','{}','{}','DECLARED',repeat('c',64),'1','${id(3)}',now());
 INSERT INTO public.metering_points VALUES('${id(11)}','${id(1)}','${id(9)}','${id(10)}','735999123456789012',NULL,'TES');
 INSERT INTO public.customer_sites VALUES('${id(10)}','${id(1)}','${id(9)}');
 INSERT INTO public.communication_routes VALUES('${id(6)}','${id(1)}',true);
 INSERT INTO public.ediel_route_profiles(id,company_id,environment,communication_route_id,is_active,sender_ediel_id,receiver_ediel_id)VALUES('${id(8)}','${id(1)}','test','${id(6)}',true,'12345','54321');`)
 const original=readFileSync(new URL('../supabase/migrations/20260930224540_ediel_source_bound_requested_changes.sql',import.meta.url),'utf8')
 await db.exec(fn(original,'public.ediel_originate_requested_change_v1').replace('CREATE FUNCTION public.ediel_originate_requested_change_v1(','CREATE FUNCTION public.ediel_originate_requested_change_before_scope_fence_v1('))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261002235600_ediel_requested_change_origin_outbound_request_columns.sql',import.meta.url),'utf8'))
 await db.exec(fn(schema,'public.ediel_originate_requested_change_v1'))
 await db.exec(`ALTER FUNCTION ${signature} OWNER TO declared_owner;REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;GRANT EXECUTE ON FUNCTION ${signature} TO declared_reader;
 GRANT USAGE ON SCHEMA public,gridex_requested_changes TO declared_owner;GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public,gridex_requested_changes TO declared_owner;`)
 const before=(await db.query(`SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='${signature}'::regprocedure`)).rows
 const wrapper=(await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid='public.ediel_originate_requested_change_v1(uuid,uuid,uuid,jsonb)'::regprocedure`)).rows
 if(existsSync(forward))await db.exec(readFileSync(forward,'utf8'))
 expect((await db.query(`SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='${signature}'::regprocedure`)).rows).toEqual(before)
 expect((await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p WHERE oid='public.ediel_originate_requested_change_v1(uuid,uuid,uuid,jsonb)'::regprocedure`)).rows).toEqual(wrapper)
 return db
}
const route={routeProfileId:id(8),communicationRouteId:id(6),senderEdielId:'12345',receiverEdielId:'54321',applicationReference:'23-DDQ-PRODAT',siteId:id(99),customerSiteId:id(99)}
const call=`SELECT public.ediel_originate_requested_change_before_scope_fence_v1('${id(1)}','${id(2)}','${id(3)}','${JSON.stringify(route)}') result`
async function state(db:PGlite){return(await db.query(`SELECT jsonb_build_object('intents',(SELECT jsonb_agg(to_jsonb(i)) FROM public.ediel_message_intents i),'requests',(SELECT jsonb_agg(to_jsonb(r)) FROM public.outbound_requests r),'origins',(SELECT jsonb_agg(to_jsonb(o)) FROM gridex_requested_changes.origins o)) value`)).rows}
it('fresh actual origination captures the owned point site before freezing intent binding, ignoring caller site selectors',async()=>{
 const db=await setup();try{
  expect((await db.query<{result:{status:string}}>(call)).rows[0].result.status).toBe('originated')
  expect((await db.query(`SELECT i.customer_site_id,o.intent_binding->>'customer_site_id' frozen_site,i.validation_status,i.validation_result FROM public.ediel_message_intents i JOIN gridex_requested_changes.origins o ON o.intent_id=i.id`)).rows).toEqual([{customer_site_id:id(10),frozen_site:id(10),validation_status:'draft',validation_result:{}}])
 }finally{await db.close()}
},20000)
it('a legitimate null point site remains null in the fresh intent and its frozen binding',async()=>{
 const db=await setup();try{await db.exec('UPDATE public.metering_points SET site_id=NULL');await db.query(call);expect((await db.query(`SELECT i.customer_site_id,o.intent_binding->'customer_site_id' frozen_site FROM public.ediel_message_intents i JOIN gridex_requested_changes.origins o ON o.intent_id=i.id`)).rows).toEqual([{customer_site_id:null,frozen_site:null}])}finally{await db.close()}
},20000)
it.each([
 ['missing point','DELETE FROM public.metering_points'],
 ['foreign point company',`UPDATE public.metering_points SET company_id='${id(99)}'`],
 ['foreign point customer',`UPDATE public.metering_points SET customer_id='${id(99)}'`],
 ['missing owned site','DELETE FROM public.customer_sites'],
 ['foreign site company',`UPDATE public.customer_sites SET company_id='${id(99)}'`],
 ['foreign site customer',`UPDATE public.customer_sites SET customer_id='${id(99)}'`],
 ['point site absent',`UPDATE public.metering_points SET site_id='${id(99)}'`],
 ] as const)('fresh actual origination refuses %s without producing intent/request/origin',async(_label,mutation)=>{
 const db=await setup();try{await db.exec(mutation);const before=await state(db);await expect(db.query(call)).rejects.toThrow('requested_change_owned_point_site_required');expect(await state(db)).toEqual(before)}finally{await db.close()}
},20000)
it('existing frozen origin is returned before new site selection, with no historical intent/request/binding backpatch',async()=>{
 const db=await setup();try{
  await db.exec('UPDATE public.metering_points SET site_id=NULL');const first=(await db.query(call)).rows
  const before=await state(db);await db.exec(`UPDATE public.metering_points SET site_id='${id(99)}';DELETE FROM public.customer_sites`)
  expect((await db.query(call)).rows).toEqual(first);expect(await state(db)).toEqual(before)
 }finally{await db.close()}
},20000)
it('a held actual source returns before any site lookup or origin write',async()=>{
 const db=await setup();try{await db.exec("UPDATE public.declared_source_context SET status='held';DELETE FROM public.metering_points");expect((await db.query(call)).rows).toEqual([{result:{status:'held',source:'declared_context',variant:'E'}}]);expect(await state(db)).toEqual([{value:{intents:null,requests:null,origins:null}}])}finally{await db.close()}
},20000)
const address={lines:['DECLARED ROAD 1','',''] as const,city:'TEST',postalCode:'12345',country:'SE',representation:{convention:'SOURCE',reference:'DECLARED',mode:1 as const}}
const identity={id:'199001019999',qualifier:'SE1' as const,agency:'260' as const}
const basis:RequestedChangeBasis={status:'authorized',companyId:id(1),environment:'test',eventId:id(2),variant:'E',eventKind:'death',supplyPeriodId:id(20),supplySourceMessageId:id(21),supplyStateVersion:1,customerId:id(9),meteringPointId:id(11),legalActorId:id(12),legalSenderId:'12345',legalReceiverId:'54321',pointId:'735999123456789012',identityAgency:'9',gridArea:'TES',brpEdielId:'99999',effectiveAt:'2026-10-06T21:00:00Z',sourceReference:'DECLARED-EVENT',sourceVersion:'1',sourceDigest:'a'.repeat(64),invoiceeProfile:{meteringPointId:'735999123456789012',identityAgency:'9',endUser:{identity,address},invoicee:{identity,nameLines:['DECLARED CUSTOMER'],address,availability:'available'},event:{state:'none',reference:'DECLARED'},source:{kind:'caller_selection',companyId:id(1),reference:'DECLARED'}},customerIdentity:{id:identity.id,qualifier:identity.qualifier,agency:identity.agency,name:'DECLARED CUSTOMER',addressLines:['DECLARED ROAD 1'],city:'TEST',postalCode:'12345',country:'SE'}}
const draft=(site:string|null)=>buildRequestedChangeDraft({basis,intent:{id:id(4),customerSiteId:site,routeProfileId:id(8),applicationReference:'23-DDQ-PRODAT',interchangeReference:'DECLARED',messageReference:'1',transactionReference:'DECLARED'} as EdielMessageIntent,actorUserId:id(3),outboundRequestId:id(5),routeContext:{companyId:id(1),environment:'test',actor:{tenantIdentity:{legalActorId:id(12)},legalActorEdielId:'12345',marketRoles:['electricity_supplier']},senderEdielId:'12345',receiverEdielId:'54321',route:{id:id(6)}} as never,messageVersion:'E2SE6A'})
it.each([id(10),null])('actual renderer copies the captured intent site %s without changing exact wire references',site=>{
 const result=draft(site);expect(result.siteId).toBe(site);expect(result.customerId).toBe(id(9));expect(result.meteringPointId).toBe(id(11));expect(result.interchangeReference).toBe('DECLARED');expect(result.rawPayload).toContain('UNH+1');expect(result.rawPayload).toContain('RFF+LI:DECLARED')
})
async function installActualIntentGuard(db:PGlite){
 await db.exec(`CREATE TABLE public.ediel_messages(id uuid,company_id uuid,direction text,message_family text,message_code text,environment text,intent_id uuid,outbound_request_id uuid,route_profile_id uuid,communication_route_id uuid,customer_id uuid,site_id uuid,switch_request_id uuid,rule_profile_version_id uuid,canonical_rule_pack_id uuid,rule_profile_version text,raw_payload text,metering_point_id uuid);
 CREATE TABLE public.ediel_message_profiles(id uuid,is_enabled boolean,rule_pack_id uuid,message_code text,transaction_subtype text);
 CREATE TABLE public.ediel_rule_packs(id uuid,family text,field_matrix_version text);
 CREATE FUNCTION gridex_received_sources.closure_wire_tokens_v2(raw text)RETURNS jsonb LANGUAGE sql AS $$SELECT '[{"tag":"UNB","elements":[["UNB"],[""],["12345"],["54321"],[""],["DECLARED"],[""],["23-DDQ-PRODAT"]]},{"tag":"UNH","elements":[["UNH"],["1"],["PRODAT"]]},{"tag":"BGM","elements":[["BGM"],["Z09"]]},{"tag":"RFF","elements":[["RFF"],["LI","DECLARED"]]},{"tag":"LIN","elements":[["LIN"],["1"],[""],["735999123456789012"]]}]'::jsonb$$;
 INSERT INTO public.ediel_rule_packs VALUES('${id(30)}','PRODAT','DECLARED');INSERT INTO public.ediel_message_profiles VALUES('${id(31)}',true,'${id(30)}','Z09','E');
 UPDATE public.ediel_message_intents SET validation_status='validated',validation_result='{"ok":true,"status":"validated"}',blocking_reasons='[]',ediel_message_id='${id(7)}',outbound_request_id=(SELECT outbound_request_id FROM gridex_requested_changes.origins),interchange_reference='DECLARED',transaction_reference='DECLARED';
 INSERT INTO public.ediel_messages SELECT '${id(7)}',i.company_id,'outbound',i.message_family,i.message_code,i.environment,i.id,i.outbound_request_id,i.route_profile_id,i.communication_route_id,i.customer_id,i.customer_site_id,NULL,'${id(31)}','${id(30)}','DECLARED','DECLARED wire port','${id(11)}' FROM public.ediel_message_intents i;`)
 await db.exec(fn(schema,'gridex_ediel_transport.require_message_intent_v1'))
}
const guard=`SELECT gridex_ediel_transport.require_message_intent_v1(m) FROM public.ediel_messages m`
it('the unchanged actual intent guard accepts matching declared site binding then refuses current point site drift without backpatch',async()=>{
 const db=await setup();try{
  await db.query(call);await installActualIntentGuard(db);await expect(db.query(guard)).resolves.toBeDefined()
  const frozen=await state(db);await db.exec(`UPDATE public.metering_points SET site_id='${id(99)}'`)
  await expect(db.query(guard)).rejects.toThrow('ediel_native_intent_owned_point_required');expect(await state(db)).toEqual(frozen)
 }finally{await db.close()}
},20000)
it('the unchanged actual intent guard refuses an independently changed message site before wire checks',async()=>{
 const db=await setup();try{await db.query(call);await installActualIntentGuard(db);await db.exec(`UPDATE public.ediel_messages SET site_id='${id(99)}'`);await expect(db.query(guard)).rejects.toThrow('ediel_native_validated_intent_required')}finally{await db.close()}
},20000)
