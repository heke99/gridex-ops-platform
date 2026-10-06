// Real gateway and register evidence; declared source/catalog/queue ports.
// Native tests separately qualify issuer, review, SQL and actual send effects.
import type {CustomerLifeEventBasis} from '@/lib/ediel/production/lifeEventSource'
import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),finalize:vi.fn(),reserve:vi.fn(),read:vi.fn(),intent:vi.fn(),queue:vi.fn(),update:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/core/kernel',()=>({finalizeCanonicalOutboundDraft:io.finalize}))
vi.mock('@/lib/ediel/production/lifeEventSource',()=>({readCustomerLifeEventSource:io.read,reserveCustomerLifeEventSource:io.reserve,customerLifeEventContext:()=>({declaredDeathContext:true})}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({getEdielMessageIntentById:io.intent,evaluateIntentValidation:()=>({ok:true}),updateIntentLifecycle:io.update}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:async()=> 'E2SE6A'}))
vi.mock('@/lib/ediel/flows/shared',()=>({queuePreparedEdielMessage:io.queue}))
import {renderAndQueueCustomerLifeEvent} from '@/lib/ediel/intent/customerLifeEventGateway'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {line,characteristic} from './fixtures/prodat-register'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const point='735999000000001'
const selectedTokens=[{tag:'NAD',elements:[['NAD'],['UD'],['SELECTED-CUSTOMER','SE2','260'],[''],['DESIRED NEW CUSTOMER'],['SELECTED ROAD 1'],['TEST'],[''],['12345'],['SE']]},{tag:'NAD',elements:[['NAD'],['IV'],['SELECTED-INVOICEE','SE2','260'],[''],['DESIRED NEW INVOICEE'],['OTHER ROAD 2'],['TEST'],[''],['54321'],['SE']]}]
const raw=guideOrderedFixtureRaw([line('1',point,undefined,'9'),...characteristic('Z13','E34'),['NAD','UD',['SELECTED-CUSTOMER','SE2','260'],'','DESIRED NEW CUSTOMER','SELECTED ROAD 1','TEST','','12345','SE'],['NAD','IV',['SELECTED-INVOICEE','SE2','260'],'','DESIRED NEW INVOICEE','OTHER ROAD 2','TEST','','54321','SE']],'Z09')
const sha=(v:string)=>createHash('sha256').update(v).digest('hex')
const basis={status:'authorized',companyId:id(1),environment:'test',eventId:id(2),customerId:id(3),siteId:id(4),meteringPointId:id(5),pointId:point,rawPayload:raw,sourceReference:'declared signed PDF',sourceVersion:'1',sourceDigest:'a'.repeat(64),documentReference:'OWN',interchangeReference:'I',messageReference:'M',transactionReference:'LI'}
const selection=()=>({status:'authorized',companyId:id(1),environment:'test',eventId:id(2),artifactId:id(6),customerId:id(3),sourceReference:basis.sourceReference,sourceVersion:basis.sourceVersion,sourceHash:basis.sourceDigest,claimsHash:'b'.repeat(64),payloadHash:sha(raw),effectiveAt:'2026-10-20T23:00:00Z',scope:[{periodId:id(7),customerId:id(3),siteId:id(4),meteringPointId:id(5),pointId:point,identityAgency:'9',effectiveAt:'2026-10-20T23:00:00Z'}],customerTokens:structuredClone(selectedTokens)})
const route={companyId:id(1),environment:'test',route:{id:id(8)},senderEdielId:'54321',receiverEdielId:'21660',applicationReference:'23-DDQ-PRODAT'}
const input=()=>({companyId:id(1),eventId:id(2),actorUserId:id(9),intentId:id(10),outboundRequestId:id(11),routeContext:route as never})
beforeEach(()=>{
 vi.resetAllMocks();io.rpc.mockResolvedValue({data:selection(),error:null});io.read.mockResolvedValue(basis)
 io.intent.mockResolvedValue({id:id(10),companyId:id(1),operationId:id(2),messageFamily:'PRODAT',messageCode:'Z09',routeProfileId:id(12)})
 io.reserve.mockResolvedValueOnce({status:'reserved',messageId:null,outboundRequestId:id(11)}).mockResolvedValue({status:'reserved',messageId:id(13),outboundRequestId:id(11)})
 io.finalize.mockImplementation(async({draft})=>({id:id(13),intent_id:draft.intentId,outbound_request_id:draft.outboundRequestId,raw_payload:draft.rawPayload,status:'draft'}))
})

it('passes the independently selected signed UD/IV facts to the real original gateway without changing its immutable desired bytes',async()=>{
 expect(await renderAndQueueCustomerLifeEvent(input())).toMatchObject({status:'queued',message:{raw_payload:raw}})
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_requested_customer_change_selected_facts_v1',{p_company_id:id(1),p_actor_user_id:id(9),p_event_id:id(2)})
 const draft=io.finalize.mock.calls[0][0].draft
 expect(draft.rawPayload).toBe(raw)
 expect(draft.parsedPayload.prodatEngine.registerEvidence.facts.endUserAddressObjects).toEqual([expect.objectContaining({meteringPointId:point,identityAgency:'9',endUser:{id:'SELECTED-CUSTOMER',qualifier:'SE2',agency:'260'},availability:'available',addressLines:['SELECTED ROAD 1'],source:expect.objectContaining({kind:'caller_selection',companyId:id(1)})})])
 expect(draft.parsedPayload.prodatEngine.registerEvidence.facts.invoiceeObjects).toEqual([expect.objectContaining({invoicee:expect.objectContaining({identity:{id:'SELECTED-INVOICEE',qualifier:'SE2',agency:'260'},nameLines:['DESIRED NEW INVOICEE'],availability:'available'}),event:{state:'unknown'}})])
 expect(io.finalize.mock.calls[0][0].deathStatusContext).toEqual({declaredDeathContext:true})
 expect(io.queue).toHaveBeenCalledTimes(1)
})

import {readRequestedCustomerChangeFacts,requestedCustomerChangeRegisterFacts} from '@/lib/ediel/production/requestedCustomerChangeFacts'
const selectedScope=()=>({...input(),basis:basis as unknown as CustomerLifeEventBasis})
it('keeps a linked held original held before any reservation or finalizer, with no fallback',async()=>{
 io.rpc.mockResolvedValue({data:{status:'held',missing:['current_outgoing_customer_mandate_unavailable']},error:null})
 expect(await renderAndQueueCustomerLifeEvent(input())).toEqual({status:'held',missing:['current_outgoing_customer_mandate_unavailable']})
 expect(io.reserve).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})
it('leaves unrelated unlinked life-event originals on their existing context and unchanged bytes',async()=>{
 io.rpc.mockResolvedValue({data:null,error:null})
 expect(await renderAndQueueCustomerLifeEvent(input())).toMatchObject({status:'queued'})
 expect(io.finalize.mock.calls[0][0].draft.parsedPayload.prodatEngine).toBeUndefined()
 expect(io.finalize.mock.calls[0][0].deathStatusContext).toEqual({declaredDeathContext:true})
})
it('propagates actual public qualification errors without reserving or queueing',async()=>{
 const error={code:'42501'};io.rpc.mockResolvedValue({data:null,error})
 await expect(renderAndQueueCustomerLifeEvent(input())).rejects.toBe(error)
 expect(io.reserve).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})
it('does not allow copied qualification receipts, changed scope or mutation of copied facts to manufacture selections',async()=>{
 const scope=selectedScope(),selected=await readRequestedCustomerChangeFacts(scope)
 if(!selected||selected.status!=='qualified')throw Error('qualified control required')
 expect(()=>requestedCustomerChangeRegisterFacts({...selected},scope)).toThrow('selected_facts_invalid')
 expect(()=>requestedCustomerChangeRegisterFacts(selected,{...scope,actorUserId:id(99)})).toThrow('selected_facts_invalid')
 expect(()=>requestedCustomerChangeRegisterFacts(selected,{...scope,basis:{...scope.basis,rawPayload:'altered'}})).toThrow('selected_facts_invalid')
 const facts=requestedCustomerChangeRegisterFacts(selected,scope)
 facts.endUserAddressObjects![0].endUser.id='altered'
 expect(requestedCustomerChangeRegisterFacts(selected,scope).endUserAddressObjects![0].endUser.id).toBe('SELECTED-CUSTOMER')
})
const mutations:[string,(r:ReturnType<typeof selection>)=>void][]=[
 ['foreign company',r=>{r.companyId=id(99)}],['foreign event',r=>{r.eventId=id(99)}],['foreign customer',r=>{r.customerId=id(99)}],['foreign environment',r=>{r.environment='production'}],
 ['invalid artifact',r=>{r.artifactId='no'}],['invalid claims digest',r=>{r.claimsHash='invalid'}],['wire digest swapped with PDF digest',r=>{r.sourceHash=r.payloadHash}],['PDF digest swapped with wire digest',r=>{r.payloadHash=r.sourceHash}],
 ['changed source reference',r=>{r.sourceReference='other'}],['changed source version',r=>{r.sourceVersion='2'}],['changed wire bytes',r=>{r.payloadHash=sha('other')}],
 ['extra scope',r=>{r.scope.push({...r.scope[0]})}],['foreign site',r=>{r.scope[0].siteId=id(99)}],['foreign point row',r=>{r.scope[0].meteringPointId=id(99)}],['foreign external point',r=>{r.scope[0].pointId='OTHER'}],['unknown agency',r=>{r.scope[0].identityAgency='ZZ'}],['changed effective time',r=>{r.scope[0].effectiveAt='2030-01-01T00:00:00Z'}],
 ['reordered tokens',r=>{r.customerTokens.reverse()}],
 ['unknown city',r=>{r.customerTokens[0].elements[6]=['']}],['unknown country',r=>{r.customerTokens[1].elements[9]=['']}],['omitted postcode',r=>{r.customerTokens[1].elements[8]=[]}],['ambiguous street',r=>{r.customerTokens[1].elements[5]=['.']}],['padded street',r=>{r.customerTokens[0].elements[5]=[' ROAD ']}],['unknown identity representation',r=>{r.customerTokens[0].elements[2]=['SELECTED-CUSTOMER','SE1','89']}],['extra NAD component',r=>{r.customerTokens[0].elements.push(['extra'])}]
]
it.each(mutations)('refuses independently returned malformed selection: %s',async(_name,mutate)=>{
 const r=selection();mutate(r);io.rpc.mockResolvedValue({data:r,error:null})
 await expect(renderAndQueueCustomerLifeEvent(input())).rejects.toThrow()
 expect(io.reserve).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})
it('preserves physical address component slots within the single signed NAD convention',async()=>{
 const r=selection();r.customerTokens[0].elements[5]=['','SECOND SLOT',''];io.rpc.mockResolvedValue({data:r,error:null})
 const scope=selectedScope(),selected=await readRequestedCustomerChangeFacts(scope)
 if(!selected||selected.status!=='qualified')throw Error('qualified control required')
 const facts=requestedCustomerChangeRegisterFacts(selected,scope)
 expect(facts.endUserAddressObjects![0].addressLines).toEqual(['','SECOND SLOT',''])
 expect(facts.invoiceeObjects![0].endUser.address.lines).toEqual(['','SECOND SLOT',''])
 expect(facts.invoiceeObjects![0].event).toEqual({state:'unknown'})
})

it.each(['missing IV','DTM329'])('holds an authentic unsupported %s selection without inventing availability or invoicee event',async(kind)=>{
 const r=selection();if(kind==='missing IV')r.customerTokens.pop();else r.customerTokens.push({tag:'DTM',elements:[['DTM'],['329','20261021','102']]})
 io.rpc.mockResolvedValue({data:r,error:null})
 expect(await renderAndQueueCustomerLifeEvent(input())).toEqual({status:'held',missing:['explicit_signed_ud_iv_address_comparison_required']})
 expect(io.reserve).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})

import {existsSync,readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
/** Finite real SQL actor compatibility. Only public actor/config rows; original
 * authority tables remain empty. The global lock and native permission lookup
 * are declared ports. Full native replay separately tests actual graph locks. */
async function actorCompatibilityDb(revokeAfterWait=false){
 const db=new PGlite()
 await db.exec(`CREATE ROLE service_role;CREATE ROLE anon;CREATE ROLE authenticated;
 CREATE SCHEMA auth;CREATE SCHEMA gridex_customer_life_events;CREATE SCHEMA gridex_requested_customer_changes;CREATE SCHEMA gridex_ediel_ack_replay;
 CREATE TABLE public.user_profiles(id uuid,user_status text);CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.permissions(id uuid,key text,is_active boolean);CREATE TABLE public.user_permissions(id uuid,user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
 CREATE TABLE public.user_roles(id uuid,user_id uuid,company_id uuid,role_id uuid,is_active boolean,status text);CREATE TABLE public.roles(id uuid,is_active boolean);CREATE TABLE public.role_permissions(id uuid,role_id uuid,permission_id uuid,permission_key text,effect text);
 CREATE TABLE public.user_permission_overrides(id uuid,user_id uuid,company_id uuid,permission_key text,effect text,is_active boolean,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE gridex_requested_customer_changes.origins(company_id uuid,event_id uuid,artifact_id uuid);
 CREATE TABLE gridex_requested_customer_changes.artifacts(id uuid,company_id uuid,environment text,claims jsonb,source_reference text,source_version text,source_hash text,raw_payload text,claims_hash text);
 CREATE TABLE gridex_customer_life_events.events(id uuid,company_id uuid,environment text,customer_id uuid,source_reference text,source_version text,source_sha256 text,approved_raw_payload text,approved_payload_hash text,approved_scope jsonb);
 CREATE TABLE gridex_customer_life_events.revocations(event_id uuid);
 CREATE FUNCTION public.gridex_actor_has_company_permission(actor uuid,c uuid,wanted text)RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=wanted)$$;
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2()RETURNS void LANGUAGE plpgsql AS $$BEGIN ${revokeAfterWait?"UPDATE public.user_profiles SET user_status='inactive';":''}END$$;
 INSERT INTO public.user_profiles VALUES('${id(9)}','active');INSERT INTO auth.users VALUES('${id(9)}',NULL,NULL);
 INSERT INTO public.company_memberships VALUES('${id(1)}','${id(9)}','active',true,clock_timestamp());
 INSERT INTO public.permissions VALUES('${id(21)}','communication.write',true);
 INSERT INTO public.user_permissions VALUES('${id(22)}','${id(9)}','${id(1)}','${id(21)}',NULL,true,'active','allow');`)
 const extract=(file:string,name:string)=>{
  const sql=readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'),start=sql.indexOf(`CREATE FUNCTION ${name}(`),end=sql.indexOf('$$;',start)
  if(start<0||end<start)throw Error('actual_sql_actor_required')
  return sql.slice(start,end+3)
 }
 await db.exec(extract('20260930233247_ediel_customer_life_event_source_authority.sql','gridex_customer_life_events.require_actor_v1'))
 for(const name of ['scoped_permission_v1','actor_v1'])await db.exec(extract('20260930232100_ediel_requested_change_source_intake_and_review.sql',`gridex_requested_changes.${name}`).replaceAll('gridex_requested_changes.','gridex_requested_customer_changes.').replaceAll('now()','clock_timestamp()').replaceAll('current_date','(clock_timestamp()::date)'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261006184000_ediel_requested_customer_selected_facts.sql',import.meta.url),'utf8'))
 return db
}
it('actual additive RPC preserves the existing nonrequested actor boundary without requiring contracts/customer-write permissions',async()=>{
 const db=await actorCompatibilityDb()
 try{
  await expect(db.query(`SELECT gridex_customer_life_events.require_actor_v1('${id(1)}','${id(9)}','prepare')`)).resolves.toBeDefined()
  expect((await db.query<{allowed:boolean}>(`SELECT gridex_requested_customer_changes.actor_v1('${id(1)}','${id(9)}','archive','method_contract') AS allowed`)).rows[0].allowed).toBe(false)
  await db.exec('SET ROLE service_role')
  expect((await db.query<{facts:unknown}>(`SELECT public.ediel_requested_customer_change_selected_facts_v1('${id(1)}','${id(9)}','${id(2)}') AS facts`)).rows).toEqual([{facts:null}])
 }finally{await db.close()}
},20000)
it('actual unlinked SQL discovery rejects an actor whose existing life-event permission is revoked after the graph wait',async()=>{
 const db=await actorCompatibilityDb(true)
 try{await db.exec('SET ROLE service_role');await expect(db.query(`SELECT public.ediel_requested_customer_change_selected_facts_v1('${id(1)}','${id(9)}','${id(2)}')`)).rejects.toMatchObject({code:'42501',message:'customer_life_event_actor_forbidden'})}finally{await db.close()}
},20000)

/** Finite SQL composition only: routing ledgers and current-qualification,
 * wire-token, legacy and certification functions below are declared ports.
 * These rows do not prove any business authority. Real original qualification,
 * sender authorization, revocation and durable effects remain native tests. */
async function currentConsumerDb(kind='authorized',legacy=false,linked=true){
 const db=new PGlite()
 await db.exec(`CREATE ROLE service_role;CREATE ROLE anon;CREATE ROLE authenticated;
 CREATE SCHEMA gridex_requested_changes;CREATE SCHEMA gridex_customer_life_events;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_negative_fixtures;CREATE SCHEMA gridex_ediel_ack_replay;
 CREATE TABLE public.ediel_messages(id uuid,company_id uuid,direction text,raw_payload text,environment text,message_standard text,message_family text,message_code text);
 CREATE TABLE gridex_requested_changes.origins(message_id uuid,company_id uuid,actor_user_id uuid);
 CREATE TABLE gridex_customer_life_events.originals(message_id uuid,event_id uuid,company_id uuid);
 CREATE TABLE gridex_customer_life_events.origins(event_id uuid,company_id uuid,actor_user_id uuid);
 CREATE TABLE public.declared_current_calls(kind text,company_id uuid,message_id uuid,actor_id uuid,phase text);
 CREATE FUNCTION gridex_received_sources.closure_wire_tokens_v2(raw text)RETURNS jsonb LANGUAGE sql AS $$SELECT '[{"tag":"BGM","elements":[["BGM"],["Z09"]]},{"tag":"CAV","elements":[["CAV"],["E34"]]}]'::jsonb$$;
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2()RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 CREATE FUNCTION gridex_customer_life_events.require_current_v1(c uuid,mid uuid,actor uuid,phase text)RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO public.declared_current_calls VALUES('life_event',c,mid,actor,phase);
 ${kind==='raise'?"RAISE EXCEPTION 'declared_current_source_revoked';":kind==='null'?'RETURN NULL;':`RETURN '${JSON.stringify({basis:{status:kind}})}'::jsonb;`}
 END$$;
 CREATE FUNCTION gridex_requested_changes.require_message_v1(m public.ediel_messages,actor uuid)RETURNS void LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.declared_current_calls VALUES('legacy',m.company_id,m.id,actor,'prepare');END$$;
 CREATE FUNCTION gridex_negative_fixtures.require_positive_message_v1(c uuid,mid uuid,code text)RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'ediel_positive_fixture_original_required';END$$;
 INSERT INTO public.ediel_messages VALUES('${id(13)}','${id(1)}','outbound','declared token port','test','edifact','PRODAT','Z09');
 ${legacy?`INSERT INTO gridex_requested_changes.origins VALUES('${id(13)}','${id(1)}','${id(9)}');`:''}
 ${linked?`INSERT INTO gridex_customer_life_events.originals VALUES('${id(13)}','${id(2)}','${id(1)}');INSERT INTO gridex_customer_life_events.origins VALUES('${id(2)}','${id(1)}','${id(9)}');`:''}`)
 const extract=(file:string,name:string)=>{
  const source=readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'),start=source.indexOf(`CREATE FUNCTION ${name}(`),end=source.indexOf('$$;',start)
  if(start<0||end<start)throw Error('actual_current_consumer_sql_required')
  return source.slice(start,end+3)
 }
 await db.exec(extract('20260930224540_ediel_source_bound_requested_changes.sql','public.ediel_require_requested_change_source_current_v1').replace('CREATE FUNCTION public.ediel_require_requested_change_source_current_v1(','CREATE FUNCTION public.ediel_require_requested_change_source_current_before_scope_fence_v1('))
 await db.exec(extract('20261001010758_ediel_bilateral_customer_source_owner.sql','public.ediel_require_requested_change_source_current_v1'))
 await db.exec('REVOKE ALL ON FUNCTION public.ediel_require_requested_change_source_current_before_scope_fence_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;REVOKE ALL ON FUNCTION public.ediel_require_requested_change_source_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.ediel_require_requested_change_source_current_v1(uuid,uuid) TO service_role;')
 const forward=new URL('../supabase/migrations/20261006195500_ediel_requested_change_life_event_current_guard.sql',import.meta.url)
 if(existsSync(forward))await db.exec(readFileSync(forward,'utf8'))
 return db
}
const currentConsumerCall=`SELECT public.ediel_require_requested_change_source_current_v1('${id(1)}','${id(13)}')`
it('actual current SQL consumer delegates linked life-event original to its stored preparer without certification fallback',async()=>{
 const db=await currentConsumerDb()
 try{
  await db.exec('SET ROLE service_role');await expect(db.query(currentConsumerCall)).resolves.toBeDefined();await db.exec('RESET ROLE')
  expect((await db.query('SELECT * FROM public.declared_current_calls')).rows).toEqual([{kind:'life_event',company_id:id(1),message_id:id(13),actor_id:id(9),phase:'prepare'}])
 }finally{await db.close()}
},20000)
it.each(['held','null','raise'])('actual current SQL consumer refuses a linked %s source without certification fallback',async(kind)=>{
 const db=await currentConsumerDb(kind)
 try{await db.exec('SET ROLE service_role');await expect(db.query(currentConsumerCall)).rejects.toMatchObject({code:'P0001',message:kind==='raise'?'declared_current_source_revoked':'customer_life_event_current_original_scope_changed'})}finally{await db.close()}
},20000)
it('actual current SQL consumer retains the old requested-source owner when a legacy origin exists',async()=>{
 const db=await currentConsumerDb('held',true)
 try{
  await db.exec('SET ROLE service_role');await expect(db.query(currentConsumerCall)).resolves.toBeDefined();await db.exec('RESET ROLE')
  expect((await db.query('SELECT kind,actor_id FROM public.declared_current_calls')).rows).toEqual([{kind:'legacy',actor_id:id(9)}])
 }finally{await db.close()}
},20000)
it('actual current SQL consumer still refuses an unlinked test original through its existing certification owner',async()=>{
 const db=await currentConsumerDb('authorized',false,false)
 try{await db.exec('SET ROLE service_role');await expect(db.query(currentConsumerCall)).rejects.toMatchObject({code:'P0001',message:'ediel_positive_fixture_original_required'})}finally{await db.close()}
},20000)
