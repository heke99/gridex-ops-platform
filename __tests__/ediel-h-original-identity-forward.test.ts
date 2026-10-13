// Finite embedded Postgres: complete production functions and persisted rows.
// Source/canonical/legal/provider IO are declared synthetic ports. No native,
// issuer, RLS/trigger, two-session concurrency or whole-H approval is claimed.
import {readFileSync,existsSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import type {PGlite} from '@electric-sql/pglite'
import {beforeAll,beforeEach,afterAll,afterEach,expect,it} from 'vitest'

const source='99b10d2d735daab556ed0b03df3f9ba3466b5c19'
const schema=execFileSync('git',['show',`${source}:supabase/schema.sql`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024})
const migration=resolve('supabase/migrations/20261013000500_ediel_h_original_identity_guard.sql')
const names=['gridex_bilateral_prodat.confirm_h_end_v1','public.ediel_apply_supply_source_v1']
const signatures=names.map(name=>name+'(uuid,uuid,uuid)')
const preimages=['aa3ad717c57558b1939381722e5319084477ff79f62233880abc3c4c037b5e1b','a56f7b44a37144e73ea61d91fb27ffb46e3b091b8064bd5c20b940a9431a2165']
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const company=id(1),actor=id(2),customer=id(3),point=id(4),period=id(5),original=id(6),incoming=id(7),mandate=id(8),nationalOriginal=id(9),external='735123456789012345'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
let db:PGlite,tables:string[],beforeMetadata:unknown[]
function definition(name:string){
 const start=schema.indexOf('CREATE FUNCTION '+name+'(')
 if(start<0)throw Error('source_function_missing:'+name)
 const marker=/\bAS (\$[\w]*\$)/.exec(schema.slice(start))!
 const end=schema.indexOf(marker[1]+';',start+marker.index+marker[0].length)
 return schema.slice(start,end+marker[1].length+1)
}
async function insert(table:string,row:Record<string,unknown>){const keys=Object.keys(row);await db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row))}
async function rows(){const snapshot:Record<string,unknown>={};for(const table of tables)snapshot[table]=(await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;return snapshot}
async function metadata(){return Promise.all(signatures.map(async signature=>(await db.query<{metadata:unknown}>("SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid=to_regprocedure($1)",[signature])).rows[0].metadata))}
async function bodies(){return Promise.all(signatures.map(async signature=>(await db.query<{body:string}>("SELECT prosrc body FROM pg_proc WHERE oid=to_regprocedure($1)",[signature])).rows[0].body))}
function raw(code:string,agency='9',li='OWN-END',reason=code==='Z04'?'Z25':'Z25',pointId=external){
 const segments=['UNH+SYNTHETIC+PRODAT:D:97A:UN:E2SE6A','BGM+'+code+'+SYNTHETIC','NAD+FR+60000:160:SVK','NAD+DO+40000:160:SVK','LIN+1++'+pointId+':::'+agency,'DTM+'+(code==='Z04'?'92:209910141330:203':'93:209910161330:203'),'CCI++Z13','CAV+'+reason,'RFF+LI:'+li,'RFF+Z05:NET','NAD+UD+199001011234:SE2:260']
 return "UNA:+.? '"+segments.join("'")+"'UNT+12+SYNTHETIC'"
}
async function call(name:string,sourceId=incoming,c=company,a=actor){
 await db.exec('SAVEPOINT source_call;SET LOCAL ROLE service_role')
 try{const result=(await db.query<{result:Record<string,unknown>}>(`SELECT ${name}($1,$2,$3) result`,[c,sourceId,a])).rows[0].result;await db.exec('RESET ROLE;RELEASE SAVEPOINT source_call');return result}
 catch(error){await db.exec('ROLLBACK TO SAVEPOINT source_call;RESET ROLE;RELEASE SAVEPOINT source_call');throw error}
}

beforeAll(async()=>{
 const fixtureModule=await import(/* @vite-ignore */ pathToFileURL(resolve('scripts/ediel-sc-012-dual-role-state-sql-regression.mjs')).href)
 const fixture=await fixtureModule.createDualRoleDatabase() as {db:PGlite;tables:string[]};db=fixture.db;tables=[...fixture.tables,'auth.users','public.sc012_legal_port','public.sc012_rule_port','public.sc012_provider_port','public.sc012_actor_port']
 // Retain complete real table declarations, defaults and local constraints.
 await db.exec(definition('gridex_received_sources.closure_wire_tokens_v1'))
 const fullFunctions=['gridex_regulated_supply.ground_current_v1','gridex_received_sources.supply_effect_assessment_owns_period_v1','gridex_received_sources.supply_period_source_basis_v1','gridex_bilateral_prodat.draft_wire_v1','gridex_supply_rescission.own_customer_identity_v1','gridex_bilateral_prodat.confirm_h_end_v1','gridex_received_sources.other_supply_scope_effect_v1','gridex_received_sources.supply_wire_for_period_receipt_v1','gridex_supply_rescission.matched_end_v1','gridex_supply_rescission.require_matched_end_v1','gridex_supply_rescission.confirm_end_v1','gridex_supply_rescission.recorded_end_current_v1','gridex_supply_rescission.record_end_v1','public.ediel_apply_supply_source_v1']
 const extra=new Set(['gridex_received_sources.regulated_supply_ground_versions','gridex_received_sources.sources','gridex_received_sources.object_assessments'])
 for(const name of fullFunctions)for(const ref of definition(name).matchAll(/(?:public|gridex_[\w]+)\.[\w]+/g))if(schema.includes('CREATE TABLE '+ref[0]+' ('))extra.add(ref[0])
 for(const table of extra)if(!tables.includes(table)){
  await db.exec('CREATE SCHEMA IF NOT EXISTS '+table.split('.')[0])
  const start=schema.indexOf('CREATE TABLE '+table+' ('),end=schema.indexOf('\n);',start)
  const body=schema.slice(start,end+3)
  for(const ref of body.matchAll(/(?:public|gridex_[\w]+)\.[\w]+(?=\()/g))if(schema.includes('CREATE FUNCTION '+ref[0]+'('))await db.exec(definition(ref[0]).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
  await db.exec(body);tables.push(table)
 }
 for(const name of fullFunctions)await db.exec(definition(name).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 // Exact synthetic port rows decide only actor/source-current availability.
 // Actual target bodies, decoder, selectors and writes are never mocked.
 await db.exec("ALTER TABLE public.audit_logs ALTER COLUMN actor_type SET DEFAULT 'user',ALTER COLUMN request_id SET DEFAULT 'declared-synthetic',ALTER COLUMN correlation_id SET DEFAULT 'declared-synthetic',ALTER COLUMN resource_type SET DEFAULT 'ediel_message',ALTER COLUMN resource_id SET DEFAULT 'declared-synthetic'") // Declared audit sink; native enrichment trigger is outside this model.
 await db.exec(`CREATE TABLE public.h_declared_current(allowed boolean NOT NULL);INSERT INTO public.h_declared_current VALUES(true);
 CREATE TABLE public.h_application_port(source_id uuid,company_id uuid,payload_hash text,basis jsonb);
 CREATE OR REPLACE FUNCTION gridex_received_sources.require_prodat_application_objects_v1(c uuid, source_id uuid)RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE b jsonb;BEGIN SELECT p.basis INTO b FROM public.h_application_port p JOIN public.ediel_messages m ON m.id=p.source_id AND m.company_id=p.company_id WHERE p.company_id=$1 AND p.source_id=$2 AND p.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');IF b IS NULL THEN RAISE EXCEPTION 'declared_current_canonical_source_unavailable';END IF;RETURN b;END$$;
 CREATE FUNCTION gridex_supply_rescission.actor_v1(uuid,uuid,text)RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.user_profiles u JOIN public.company_memberships cm ON cm.user_id=u.id WHERE u.id=$2 AND cm.company_id=$1 AND u.user_status='active' AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) AND public.gridex_actor_has_company_permission($2,$1,'metering.write')$$;
 CREATE FUNCTION gridex_supply_rescission.mandate_current_v1(uuid,uuid,boolean)RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM gridex_supply_rescission.mandates WHERE company_id=$1 AND id=$2) AND EXISTS(SELECT FROM public.h_declared_current WHERE allowed)$$;
 CREATE FUNCTION gridex_supply_rescission.require_recorded_outbound_source_current_v1(public.ediel_messages)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.h_declared_current WHERE allowed) THEN RAISE EXCEPTION 'declared_recorded_original_not_current';END IF;END$$;
`)
 await db.exec('GRANT USAGE ON SCHEMA '+[...new Set(tables.map(table=>table.split('.')[0]))].join(',')+' TO service_role')
 tables.push('public.h_declared_current','public.h_application_port')
 expect((await bodies()).map(hash)).toEqual(preimages)
 beforeMetadata=await metadata()
 if(existsSync(migration))await db.exec(readFileSync(migration,'utf8'))
},30000)
beforeEach(async()=>{await db.exec('TRUNCATE '+tables.join(',')+';INSERT INTO public.h_declared_current VALUES(true);BEGIN;SET TIME ZONE \'UTC\'')})
afterEach(async()=>{await db.exec('ROLLBACK')})
afterAll(async()=>{await db?.close()})

async function seed(agency='9',li='OWN-END',reason='Z25'){
 await insert('public.companies',{id:company,name:'Synthetic H correlation tenant'})
 await insert('auth.users',{id:actor});await insert('public.user_profiles',{id:actor,user_status:'active'})
 await insert('public.company_memberships',{company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:'2020-01-01'})
 await insert('public.sc012_actor_port',{actor_id:actor,company_id:company,permission:'metering.write'})
 await insert('public.tenant_ediel_profiles',{id:id(20),company_id:company,environment:'test',market:'electricity',is_enabled:true,valid_from:'2020-01-01'})
 await insert('public.tenant_actor_identifiers',{id:id(21),company_id:company,environment:'test',actor_id:actor,identifier_type:'EdielId',identifier_value:'40000',valid_from:'2020-01-01'})
 await insert('public.tenant_actor_roles',{id:id(22),company_id:company,environment:'test',actor_id:actor,role_code:'electricity_supplier',valid_from:'2020-01-01'})
 await insert('public.customers',{id:customer,company_id:company,personal_number:'199001011234'})
 await insert('public.customer_sites',{id:id(23),company_id:company,customer_id:customer})
 await insert('public.metering_points',{id:point,company_id:company,customer_id:customer,site_id:id(23),customer_site_id:id(23),meter_point_id:external,ediel_metering_point_id:external,grid_area_code:'NET',grid_owner_ediel_id:'60000'})
 const originalRaw=raw('Z04','9','OWN-BASE'),sourceRaw=raw('Z05',agency,li,reason)
 for(const [messageId,payload,code]of [[original,originalRaw,'Z04'],[incoming,sourceRaw,'Z05']])await insert('public.ediel_messages',{id:messageId,company_id:company,environment:'test',direction:'inbound',message_family:'PRODAT',message_code:code,raw_payload:payload,status:'received',message_received_at:'2026-10-13',customer_id:customer,metering_point_id:point})
 await insert('public.customer_supply_periods',{id:period,company_id:company,customer_id:customer,metering_point_id:point,start_date:'2099-10-14',market_start_at:'2099-10-14T12:30:00Z',source:'ediel_qualified_source',source_process:'normal_supplier_switch',source_message_id:original,status:'active',market_state_version:1})
 await insert('gridex_received_sources.validation_assessments',{id:id(30),source_message_id:incoming,company_id:company,environment:'test',source_payload_hash:hash(sourceRaw),facts_text:'{"syntaxDecision":"accepted","applicationDecision":"accepted","functionalDecision":"accepted"}',facts_hash:hash('{"syntaxDecision":"accepted","applicationDecision":"accepted","functionalDecision":"accepted"}')})
 await insert('gridex_received_sources.sources',{source_message_id:original,company_id:company,environment:'test',origin:'database_insert',payload_hash:hash(originalRaw),raw_payload:originalRaw})
 const originalFacts=JSON.stringify({objects:[{disposition:'accepted',object:{objectId:external,identityAgency:'9'},business:{supplyPeriodId:period,customerId:customer,meteringPointId:point,owner:'reviewed-received-structure-v1'},party:{parties:{legalSender:'60000',legalReceiver:'40000'}}}]})
 await insert('gridex_received_sources.object_assessments',{id:id(31),source_message_id:original,company_id:company,environment:'test',source_payload_hash:hash(originalRaw),canonical_assessment_id:id(32),facts_text:originalFacts,facts_hash:hash(originalFacts),owner_readsets:[]})
 await db.exec('COMMIT;BEGIN') // Actual capture is committed before execution, never same-XID evidence.
 return {sourceRaw,originalRaw}
}

it('a mismatched original agency has no period, transition or unrelated row effect through the full H05 body',async()=>{
 await seed('89');const before=await rows()
 expect(await call(names[0])).toMatchObject({applied:false,reason:'z05_original_object_mismatch'})
 expect(await rows()).toEqual(before)
})
it('matching agency preserves the actual full H05 period update, transition and exact replay',async()=>{
 await seed();const before=await rows(),result=await call(names[0]);expect(result.applied).toBe(true)
 const after=await rows();expect(after).not.toEqual(before)
 expect((await db.query('SELECT source_end_message_id,status,market_state_version FROM public.customer_supply_periods WHERE id=$1',[period])).rows[0]).toMatchObject({source_end_message_id:incoming,status:'ending',market_state_version:2})
 expect((await db.query('SELECT source_message_id,source_code FROM gridex_received_sources.supply_source_transitions')).rows).toEqual([{source_message_id:incoming,source_code:'Z05'}])
 expect(await call(names[0])).toMatchObject({applied:true,idempotent:true});expect(await rows()).toEqual(after)
})
it('current actor denial refuses before a H05 original or domain write',async()=>{
 await seed();await db.exec('DELETE FROM public.sc012_actor_port');const before=await rows()
 expect(await call(names[0])).toMatchObject({applied:false,reason:'supply_execution_actor_unqualified'});expect(await rows()).toEqual(before)
})
it('forward preserves complete function metadata including OID, ownership, ACL and search_path',async()=>{expect(await metadata()).toEqual(beforeMetadata)})

async function nationalSeed(li='FOREIGN-LI',requestCompany=company,requestEnvironment='test',open=true){
 const seeded=await seed('9',li,'Z22')
 const scope={messageIndex:0,messageReference:'SYNTHETIC',objectId:external,identityAgency:'9',registers:[{lineIndex:0,segmentIndex:4,lineNumber:'1',registerIndex:null,registerPosition:1}]}
 await insert('public.h_application_port',{source_id:incoming,company_id:company,payload_hash:hash(seeded.sourceRaw),basis:{assessmentId:id(30),headerDecision:'accepted',objects:[{...scope,applicationDecision:'accepted',reasonCodes:[]}]}})
 await insert('public.sc012_legal_port',{source_id:incoming,company_id:company,payload_hash:hash(seeded.sourceRaw),basis:{actorRole:'electricity_supplier',family:'PRODAT',code:'Z05',legalEdielId:'40000'}})
 await insert('public.sc012_rule_port',{source_id:incoming,company_id:company,payload_hash:hash(seeded.sourceRaw),basis:{declared:'finite captured source rule witness'}})
 const mandateLi='H'+mandate.replaceAll('-',''),outboundRaw=raw('Z08','9',mandateLi,'Z25').replace('NAD+FR+60000','NAD+FR+40000').replace('NAD+DO+40000','NAD+DO+60000')
 await insert('gridex_supply_rescission.mandates',{id:mandate,company_id:requestCompany,environment:requestEnvironment,artifact_id:id(41),review_id:id(42),source_hash:'a'.repeat(64),scope:{periodId:period,stateVersion:1,customerId:customer,pointId:point,externalPoint:external,identityAgency:'9',customerIdentity:{id:'199001011234',qualifier:'SE2',agency:'260'},gridArea:'NET',effectiveAt:'2099-10-16T12:30:00Z'}})
 await insert('public.ediel_messages',{id:nationalOriginal,company_id:requestCompany,environment:requestEnvironment,direction:'outbound',message_family:'PRODAT',message_code:'Z08',raw_payload:outboundRaw,status:'sent',message_sent_at:'2026-10-13',immutable_rendered_at:'2026-10-13',immutable_payload_hash:hash(outboundRaw),source_operation_id:mandate})
 await insert('gridex_supply_rescission.outbound_operations',{message_id:nationalOriginal,company_id:requestCompany,environment:requestEnvironment,actor_user_id:actor,mandate_id:mandate,payload_hash:hash(outboundRaw),capability:{objects:[{objectId:external,identityAgency:'9',lineItemReference:mandateLi}]},creation_txid:1})
 await insert('public.sc012_provider_port',{source_id:nationalOriginal,payload_hash:hash(outboundRaw)})
 if(!open)await db.query('UPDATE public.customer_supply_periods SET source_end_message_id=$1,market_end_at=$2 WHERE id=$3',[id(49),'2099-10-16T12:30:00Z',period])
 await db.exec('COMMIT;BEGIN')
 return {mandateLi,outboundRaw,scope}
}

it('wrong LI for its recorded open national operation never falls into generic end and preserves all rows',async()=>{
 await nationalSeed();const before=await rows()
 await expect(call(names[1])).rejects.toThrow('supply_rescission_exact_sent_original_required')
 expect(await rows()).toEqual(before)
})
it.each(['foreign_company','foreign_environment'] as const)('an unrelated %s operation cannot capture an otherwise ordinary end',async(kind)=>{
 await nationalSeed('ORDINARY-END',kind==='foreign_company'?id(99):company,kind==='foreign_environment'?'production':'test')
 expect((await call(names[1])).applied).toBe(true)
 expect((await db.query<{source_end_message_id:string|null}>('SELECT source_end_message_id FROM public.customer_supply_periods WHERE id=$1',[period])).rows[0].source_end_message_id).toBe(incoming)
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM gridex_supply_rescission.end_receipts')).rows[0].n).toBe(0)
})
it('withdrawn current actor permission cannot gain generic authority through a wrong national LI',async()=>{
 await nationalSeed();await db.exec('DELETE FROM public.sc012_actor_port');const before=await rows()
 await expect(call(names[1])).rejects.toThrow('supply_rescission_execution_actor_forbidden')
 expect(await rows()).toEqual(before)
})
it('a closed former national period cannot classify a distinct ordinary period as its request',async()=>{
 await nationalSeed('ORDINARY-END',company,'test',false)
 await db.query('UPDATE public.customer_supply_periods SET id=$1,source_end_message_id=NULL,market_end_at=NULL WHERE id=$2',[id(51),period])
 await db.query("UPDATE gridex_received_sources.object_assessments SET facts_text=replace(facts_text,$1,$2),facts_hash=encode(sha256(convert_to(replace(facts_text,$1,$2),'UTF8')),'hex')",[period,id(51)])
 expect((await call(names[1])).applied).toBe(true)
 expect((await db.query<{source_end_message_id:string|null}>('SELECT source_end_message_id FROM public.customer_supply_periods WHERE id=$1',[id(51)])).rows[0].source_end_message_id).toBe(incoming)
})

it('correct own LI retains actual national matching, persisted end receipt and replay',async()=>{
 await nationalSeed('H'+mandate.replaceAll('-',''));const result=await call(names[1]);expect(result.applied).toBe(true)
 expect((await db.query('SELECT source_message_id,original_message_id,period_id FROM gridex_supply_rescission.end_receipts')).rows).toEqual([{source_message_id:incoming,original_message_id:nationalOriginal,period_id:period}])
 const after=await rows();expect(await call(names[1])).toMatchObject({applied:true,idempotent:true});expect(await rows()).toEqual(after)
})
it('current original-owner withdrawal remains a refusal on the exact national LI',async()=>{
 await nationalSeed('H'+mandate.replaceAll('-',''));await db.exec('UPDATE public.h_declared_current SET allowed=false');const before=await rows()
 await expect(call(names[1])).rejects.toThrow('declared_recorded_original_not_current');expect(await rows()).toEqual(before)
})
it('a stored national tuple with changed physical bytes is held rather than becoming an ordinary end',async()=>{
 await nationalSeed('H'+mandate.replaceAll('-',''));await db.query("UPDATE public.ediel_messages SET raw_payload=raw_payload||' ' WHERE id=$1",[nationalOriginal]);const before=await rows()
 await expect(call(names[1])).rejects.toThrow('supply_rescission_exact_sent_original_required');expect(await rows()).toEqual(before)
})
it.each(['point','agency','cohort'] as const)('a %s mismatch in the recorded operation cannot classify another ordinary end',async(kind)=>{
 await nationalSeed('ORDINARY-END')
 if(kind==='point')await db.exec("UPDATE gridex_supply_rescission.outbound_operations SET capability=jsonb_set(capability,'{objects,0,objectId}','\"FOREIGN-POINT\"')")
 if(kind==='agency')await db.exec("UPDATE gridex_supply_rescission.outbound_operations SET capability=jsonb_set(capability,'{objects,0,identityAgency}','\"89\"')")
 if(kind==='cohort')await db.exec('UPDATE public.customer_supply_periods SET market_state_version=3')
 expect((await call(names[1])).applied).toBe(true)
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM gridex_supply_rescission.end_receipts')).rows[0].n).toBe(0)
})
it('the public bulk-loop checks a wrong-LI candidate alongside an exact national object before any write',async()=>{
 await nationalSeed('H'+mandate.replaceAll('-',''))
 const otherExternal='735123456789012352',otherPoint=id(54),otherPeriod=id(55),otherSource=id(56),otherMandate=id(57),otherRequest=id(58)
 const originalRaw=raw('Z04','9','OTHER-BASE','Z25',otherExternal),outboundRaw=raw('Z08','9','H'+otherMandate.replaceAll('-',''),'Z25',otherExternal).replace('NAD+FR+60000','NAD+FR+40000').replace('NAD+DO+40000','NAD+DO+60000')
 await insert('public.metering_points',{id:otherPoint,company_id:company,customer_id:customer,site_id:id(23),customer_site_id:id(23),meter_point_id:otherExternal,ediel_metering_point_id:otherExternal,grid_area_code:'NET',grid_owner_ediel_id:'60000'})
 await insert('public.ediel_messages',{id:otherSource,company_id:company,environment:'test',direction:'inbound',message_family:'PRODAT',message_code:'Z04',raw_payload:originalRaw,status:'received',message_received_at:'2026-10-13'})
 await insert('public.customer_supply_periods',{id:otherPeriod,company_id:company,customer_id:customer,metering_point_id:otherPoint,start_date:'2099-10-14',market_start_at:'2099-10-14T12:30:00Z',source:'ediel_qualified_source',source_process:'normal_supplier_switch',source_message_id:otherSource,status:'active',market_state_version:1})
 await insert('gridex_received_sources.sources',{source_message_id:otherSource,company_id:company,environment:'test',origin:'database_insert',payload_hash:hash(originalRaw),raw_payload:originalRaw})
 const otherFacts=JSON.stringify({objects:[{disposition:'accepted',object:{objectId:otherExternal,identityAgency:'9'},business:{supplyPeriodId:otherPeriod,customerId:customer,meteringPointId:otherPoint,owner:'reviewed-received-structure-v1'},party:{parties:{legalSender:'60000',legalReceiver:'40000'}}}]})
 await insert('gridex_received_sources.object_assessments',{id:id(63),source_message_id:otherSource,company_id:company,environment:'test',source_payload_hash:hash(originalRaw),canonical_assessment_id:id(64),facts_text:otherFacts,facts_hash:hash(otherFacts),owner_readsets:[]})
 await insert('gridex_supply_rescission.mandates',{id:otherMandate,company_id:company,environment:'test',artifact_id:id(61),review_id:id(62),source_hash:'b'.repeat(64),scope:{periodId:otherPeriod,stateVersion:1,customerId:customer,pointId:otherPoint,externalPoint:otherExternal,identityAgency:'9'}})
 await insert('public.ediel_messages',{id:otherRequest,company_id:company,environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z08',raw_payload:outboundRaw,status:'sent',message_sent_at:'2026-10-13',immutable_rendered_at:'2026-10-13',immutable_payload_hash:hash(outboundRaw),source_operation_id:otherMandate})
 await insert('gridex_supply_rescission.outbound_operations',{message_id:otherRequest,company_id:company,environment:'test',actor_user_id:actor,mandate_id:otherMandate,payload_hash:hash(outboundRaw),capability:{objects:[{objectId:otherExternal,identityAgency:'9',lineItemReference:'H'+otherMandate.replaceAll('-','')}]},creation_txid:1})
 const sourceRaw=(await db.query<{raw_payload:string}>('SELECT raw_payload FROM public.ediel_messages WHERE id=$1',[incoming])).rows[0].raw_payload
 const second=raw('Z05','9','FOREIGN-LI','Z22',otherExternal)
 const object=second.slice(second.indexOf('LIN+1'),second.indexOf('UNT+')).replace('LIN+1','LIN+2')
 const completeRaw=sourceRaw.replace('UNT+12',object+'UNT+19')
 await db.query('UPDATE public.ediel_messages SET raw_payload=$1,customer_id=NULL,metering_point_id=NULL WHERE id=$2',[completeRaw,incoming])
 await db.query('UPDATE gridex_received_sources.validation_assessments SET source_payload_hash=$1 WHERE source_message_id=$2',[hash(completeRaw),incoming])
 await db.query('UPDATE public.h_application_port SET payload_hash=$1 WHERE source_id=$2',[hash(completeRaw),incoming])
 await db.exec('COMMIT;BEGIN')

 const before=await rows();await expect(call(names[1])).rejects.toThrow('supply_rescission_exact_sent_original_required');expect(await rows()).toEqual(before)
 // Restore only the old bulk-loop selector: a corrected outer dispatch alone
 // cannot prevent the complete old adapter from closing the second period.
 const installed=(await bodies())[1];let sites=0
 const loopBefore=installed.replace(/\(gridex_supply_rescission\.has_end_selector_v1\(m,o\) OR \([\s\S]*?\n    \)\)\)/g,match=>++sites===2?'gridex_supply_rescission.has_end_selector_v1(m,o)':match)
 expect(sites).toBe(2)
 const installedDefinition=(await db.query<{d:string}>('SELECT pg_get_functiondef(to_regprocedure($1)) d',[signatures[1]])).rows[0].d
 await db.exec(installedDefinition.replace(installed,loopBefore))
 expect((await call(names[1])).applied).toBe(true)
 expect((await db.query<{source_end_message_id:string|null}>('SELECT source_end_message_id FROM public.customer_supply_periods ORDER BY id')).rows).toEqual([{source_end_message_id:incoming},{source_end_message_id:incoming}])
})
it('reapplying the actual forward preserves both bodies and complete metadata',async()=>{
 const sql=readFileSync(migration,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')
 const beforeBodies=await bodies(),before=await metadata();await db.exec(sql)
 expect(await bodies()).toEqual(beforeBodies);expect(await metadata()).toEqual(before)
})
it.each([0,1])('unknown body drift at function%s refuses before any other function or catalog changes',async(index)=>{
 const signature=signatures[index],definition=(await db.query<{d:string}>('SELECT pg_get_functiondef(to_regprocedure($1)) d',[signature])).rows[0].d
 const originalBody=(await bodies())[index]
 await db.exec(definition.replace(originalBody,originalBody+'\n-- unrecognized source drift\n'))
 const beforeBodies=await bodies(),before=await metadata()
 await db.exec('SAVEPOINT forward_refusal')
 await expect(db.exec(readFileSync(migration,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''))).rejects.toThrow('h_original_identity_unrecognized_preimage')
 await db.exec('ROLLBACK TO SAVEPOINT forward_refusal;RELEASE SAVEPOINT forward_refusal')
 expect(await bodies()).toEqual(beforeBodies);expect(await metadata()).toEqual(before)
})

it('inverse scoped replacements restore both exact full source bodies byte for byte',async()=>{
 const [hBody,pBody]=await bodies()
 const inverseH=hBody.replace("original:=gridex_received_sources.normal_switch_wire_v1(origin.raw_payload);\n   IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z04'","original:=gridex_received_sources.supply_wire_v1(origin.raw_payload);\n   IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z04'").replace("o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'gridArea'=own->>'gridArea' AND gridex_received_sources.permission_time_v1(o->>'start')<event_at","o->>'point'=own->>'point' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'gridArea'=own->>'gridArea' AND gridex_received_sources.permission_time_v1(o->>'start')<event_at")
 let restoredSites=0
 const inversePublic=pBody.replace(/\(gridex_supply_rescission\.has_end_selector_v1\(m,o\) OR \([\s\S]*?\n    \)\)\)/g,()=>{restoredSites++;return 'gridex_supply_rescission.has_end_selector_v1(m,o)'})
 expect(restoredSites).toBe(2);expect([hash(inverseH),hash(inversePublic)]).toEqual(preimages)
})
it.each([0,1])('restoring exact predecessor%s reproduces the actual forbidden persisted effect',async(index)=>{
 if(index===0)await seed('89');else await nationalSeed()
 await db.exec(definition(names[index]).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 expect(hash((await bodies())[index])).toBe(preimages[index])
 const result=await call(names[index]);expect(result.applied).toBe(true)
 expect((await db.query<{source_end_message_id:string|null}>('SELECT source_end_message_id FROM public.customer_supply_periods WHERE id=$1',[period])).rows[0].source_end_message_id).toBe(incoming)
 expect((await db.query('SELECT source_message_id FROM gridex_received_sources.supply_source_transitions')).rows).toEqual([{source_message_id:incoming}])
})
it.each([0,1])('unexpected security metadata at function%s refuses without touching any full body or catalog',async(index)=>{
 await db.exec(`ALTER FUNCTION ${signatures[index]} SECURITY INVOKER`)
 const beforeBodies=await bodies(),before=await metadata();await db.exec('SAVEPOINT metadata_refusal')
 await expect(db.exec(readFileSync(migration,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''))).rejects.toThrow('h_original_identity_predecessor_metadata_required')
 await db.exec('ROLLBACK TO SAVEPOINT metadata_refusal;RELEASE SAVEPOINT metadata_refusal')
 expect(await bodies()).toEqual(beforeBodies);expect(await metadata()).toEqual(before)
})
it('second-function drift cannot commit a first-function replacement in the atomic forward',async()=>{
 await db.exec(definition(names[0]).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 const definition2=(await db.query<{d:string}>('SELECT pg_get_functiondef(to_regprocedure($1)) d',[signatures[1]])).rows[0].d
 const wrapper=(await bodies())[1];await db.exec(definition2.replace(wrapper,wrapper+'\n-- refused second-function drift\n'))
 const beforeBodies=await bodies(),before=await metadata();await db.exec('SAVEPOINT atomic_refusal')
 await expect(db.exec(readFileSync(migration,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''))).rejects.toThrow('h_original_identity_unrecognized_preimage')
 await db.exec('ROLLBACK TO SAVEPOINT atomic_refusal;RELEASE SAVEPOINT atomic_refusal')
 expect(await bodies()).toEqual(beforeBodies);expect(await metadata()).toEqual(before)
})
