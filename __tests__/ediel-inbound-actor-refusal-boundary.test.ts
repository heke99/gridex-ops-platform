// masterplan: SC-014, AT-Z14V-ESCO
// Actual public receiver, actor guard, tenant/identity resolver, syntax and
// canonical owner. Named database/registry/domain IO is finite and synthetic;
// these probes establish ordering, not native RBAC or business acceptance.
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {ownerId,ownerRows,ownerSource} from './helpers/sourceOwnerFixtures'
import {sourceOwnerTestDatabase} from './helpers/sourceOwnerTestDatabase'
import {prodatFixtureAckResult,prodatFixtureSourceRpc,withProdatFixtureInsertContext} from './helpers/prodatInboundSourceFixture'

type Row=Record<string,unknown>
const io=vi.hoisted(()=>({message:{} as EdielMessageRow,rows:{} as Record<string,Row[]>,calls:[] as {name:string;args:Row}[],
 writes:[] as {port:string;value:unknown}[],reads:[] as string[],endpoint:'present',endpointError:null as unknown,
 actorReadError:null as unknown,writeAllowed:true,badReceipt:'',badCount:false,failTable:'',hideSupply:false,nativeUnavailable:true}))
const actor=ownerId(50),company=ownerId(2),foreign=ownerId(999)
const technicalNames=new Set(['ediel_read_technical_source_endpoint_v2','ediel_record_technical_syntax_facet_v2',
 'ediel_capture_technical_syntax_ack_basis_v2','ediel_require_technical_syntax_ack_basis_v2','ediel_read_technical_syntax_ack_route_v1'])
const ownerNames=new Set(['resolve_canonical_ediel_rule_pack_with_witness_v1','gridex_actor_has_company_permission',
 'gridex_record_prodat_source_validation_v6','ediel_probe_source_rule_pack_capture_v1','ediel_read_source_rule_pack_basis_v1',
 'gridex_read_outbound_acks_for_source_v2','ediel_apply_supply_source_v1','gridex_record_source_object_decisions_v1','gridex_witness_source_objects_v1'])
const writerNames=new Set(['ediel_record_technical_syntax_facet_v2','gridex_record_prodat_source_validation_v6',
 'ediel_probe_source_rule_pack_capture_v1','ediel_apply_supply_source_v1','gridex_record_source_object_decisions_v1','gridex_witness_source_objects_v1'])
const result=(data:unknown,error:unknown=null)=>{const p=Promise.resolve({data,error});return Object.assign(p,{abortSignal:()=>p})}
function rpc(name:string,args:Row){
 if(!technicalNames.has(name)&&!ownerNames.has(name))throw Error('UNDECLARED_ACTOR_BOUNDARY_RPC:'+name)
 io.reads.push(name)
 if(writerNames.has(name))io.writes.push({port:name,value:structuredClone(args)})
 if(name==='ediel_read_technical_source_endpoint_v2'){
  if(io.endpoint==='none')return result(null)
  if(io.endpointError)return result(null,io.endpointError)
 }
 if(name==='gridex_actor_has_company_permission'&&!io.writeAllowed)return result(false)
 return technicalNames.has(name)?prodatFixtureSourceRpc(name,args):sourceOwnerTestDatabase(io).rpc(name,args)
}
function table(tableName:string){
 if(!Object.hasOwn(io.rows,tableName))throw Error('UNDECLARED_ACTOR_BOUNDARY_TABLE:'+tableName)
 io.reads.push('table:'+tableName)
 const filters:((r:Row)=>boolean)[]=[],matching=()=>io.rows[tableName].filter(r=>filters.every(f=>f(r)))
 let columns='*',patch:Row|undefined
 const read=(single=false)=>{
  const rows=matching()
  if(patch){rows.forEach(r=>Object.assign(r,patch));if(tableName==='ediel_messages')io.message=rows[0] as unknown as EdielMessageRow}
  const data=rows.map(r=>columns==='*'?structuredClone(r):Object.fromEntries(columns.split(',').map(k=>[k,r[k]])))
  return {data:single?data[0]??null:data,error:tableName==='company_memberships'?io.actorReadError:null,count:data.length}
 }
 const q={select:(value='*')=>{columns=value;return q},eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q},
  not:(k:string,operator:string,v:unknown)=>{if(operator!=='is')throw Error('UNDECLARED_ACTOR_BOUNDARY_NOT');filters.push(r=>r[k]!==v);return q},
  limit:()=>q,abortSignal:()=>q,update:(value:Row)=>{io.writes.push({port:'table:'+tableName,value:structuredClone(value)});patch=value;return q},
  maybeSingle:async()=>read(true),single:async()=>read(true),then:(resolve:(v:ReturnType<typeof read>)=>unknown)=>Promise.resolve(read()).then(resolve)}
 return q
}
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Row)=>rpc(name,args),from:(name:string)=>table(name)}}))
vi.mock('@/lib/ediel/db',()=>({
 getEdielMessageById:async(id:string)=>id===io.message.id?io.message:null,
 createEdielMessageEvent:async(value:Row)=>{io.writes.push({port:'event',value:structuredClone(value)});return {id:'finite-event'}},
 updateEdielMessageStatus:async(value:{status:string;parsedPayload?:Row;validationReport?:Row})=>{
  io.writes.push({port:'status',value:structuredClone(value)})
  io.message={...io.message,status:value.status,parsed_payload:value.parsedPayload??io.message.parsed_payload,validation_report:value.validationReport??io.message.validation_report} as EdielMessageRow
  io.rows.ediel_messages[0]=io.message as unknown as Row;return io.message
 },
 linkEdielMessage:async(value:Row)=>{io.writes.push({port:'link',value});return io.message},
 listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[],
}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:async(input:{ackFamily:string;sourceMessage:EdielMessageRow;draft:Row})=>{
 io.writes.push({port:'ack',value:structuredClone(input)});return prodatFixtureAckResult(input)
}}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:async(value:Row)=>{io.writes.push({port:'outbox',value});return {id:'finite-outbox'}}}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'synthetic@example.invalid',host:'smtp.example.invalid',port:465})}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>null}))
vi.mock('@/lib/ediel/inboundCases',()=>({createOrUpdateInboundProdatCase:async(value:Row)=>{io.writes.push({port:'case',value});return null}}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))

beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-30T13:00:00Z'))
 io.message=withProdatFixtureInsertContext(ownerSource());io.rows=ownerRows()
 io.rows.ediel_messages=[io.message as unknown as Row]
 // Complete legal identity is independent of the execution-user membership.
 // Both current tenant graphs are retained even when the execution user fails.
 io.rows.customers=[{id:ownerId(3),company_id:company},{id:ownerId(903),company_id:foreign}]
 io.rows.metering_permissions=[{id:ownerId(904),company_id:company,status:'pending'},{id:ownerId(905),company_id:foreign,status:'active'}]
 for(const name of ['tenant_ediel_profiles','tenant_actor_identifiers','tenant_actor_roles']){
  io.rows[name].push(...structuredClone(io.rows[name]).map(r=>({...r,company_id:foreign,id:ownerId(950+io.rows[name].length),
   ...(name==='tenant_actor_identifiers'?{identifier_value:'99999'}:{})})))
 }
 for(const name of ['ediel_actor_settings','ediel_route_profiles','communication_routes'])io.rows[name]=[]
 io.calls=[];io.writes=[];io.reads=[];io.endpoint='present';io.endpointError=null;io.actorReadError=null;io.writeAllowed=true
 io.badReceipt='';io.badCount=false;io.failTable='';io.hideSupply=false;io.nativeUnavailable=true
})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
const run=()=>processInboundEdielMessage({actorUserId:actor,edielMessageId:io.message.id})
const observation=()=>({writerPorts:io.writes.map(w=>w.port),canonicalCalls:io.calls.filter(c=>c.name==='gridex_record_prodat_source_validation_v6').length,
 tenantPatches:io.writes.filter(w=>w.port==='table:ediel_messages').length,reads:io.reads})
const causeContains=(error:unknown,original:unknown)=>{
 const seen=new Set<unknown>();let current=error
 for(let i=0;i<12&&current&&typeof current==='object'&&!seen.has(current);i++){
  if(current===original)return true;seen.add(current);current=(current as {cause?:unknown}).cause
 }
 return false
}
async function denied(expected:{same?:unknown;sql?:unknown}){
 const before=structuredClone({source:io.message,graphs:io.rows}),outcome=await run().then(()=>({error:null}),error=>({error}))
 console.info('Finite inbound actor refusal observation',JSON.stringify(observation()))
 // Check effects separately before exception taxonomy, exposing old writes.
 expect.soft(io.writes).toEqual([])
 expect.soft({source:io.message,graphs:io.rows}).toEqual(before)
 expect(outcome.error).toBeInstanceOf(EdielExecutionFailure)
 expect((outcome.error as EdielExecutionFailure).disposition.kind).toBe('security_quarantine')
 if(expected.same)expect(outcome.error).toBe(expected.same)
 if(expected.sql)expect(causeContains(outcome.error,expected.sql)).toBe(true)
}
it('a foreign-only execution membership and actual technical RPC42501 refuse before every writer',async()=>{
 io.rows.company_memberships[0].company_id=foreign
 const error={code:'42501',message:'ediel_technical_ack_current_actor_required'};io.endpointError=error
 await denied({sql:error})
})
it('the real actor guard refuses absent membership after endpoint read without diagnostic or canonical writes',async()=>{
 io.rows.company_memberships=[];await denied({})
})
it('the real actor guard refuses revoked communication.write after endpoint read before every writer',async()=>{
 io.writeAllowed=false;await denied({})
})
it('actual actor-check PostgREST42501 becomes security quarantine with the original cause',async()=>{
 const error={code:'42501',message:'permission denied during actor membership read'};io.actorReadError=error
 await denied({sql:error})
})
it('preserves the identical typed security refusal returned by the actual actor-check stage',async()=>{
 io.rows.company_memberships=[]
 const error=await assertEdielTenantActor({companyId:company,actorUserId:actor,permission:'communication.write'}).catch(e=>e)
 expect(error).toBeInstanceOf(EdielExecutionFailure)
 io.rows.company_memberships=ownerRows().company_memberships;io.actorReadError=error;io.reads=[]
 await denied({same:error})
})
it('typed security identity takes precedence over an incidental own SQLSTATE42501 label',async()=>{
 io.rows.company_memberships=[]
 const error=await assertEdielTenantActor({companyId:company,actorUserId:actor,permission:'communication.write'}).catch(e=>e)
 expect(error).toBeInstanceOf(EdielExecutionFailure)
 Object.defineProperty(error,'code',{value:'42501'})
 io.rows.company_memberships=ownerRows().company_memberships;io.actorReadError=error;io.reads=[]
 await denied({same:error})
})
it('retains a trusted SQL42501 underneath the endpoint wrapper cause chain',async()=>{
 const sql={code:'42501',message:'ediel_technical_ack_current_actor_required'}
 io.endpointError=new Error('trusted technical RPC adapter wrapper',{cause:new Error('trusted transport wrapper',{cause:sql})})
 await denied({sql})
})
async function continues(){
 await expect(run()).resolves.toMatchObject({id:io.message.id,company_id:company})
 expect(io.writes.map(w=>w.port)).toContain('table:ediel_messages')
 expect(io.calls.filter(c=>c.name==='gridex_record_prodat_source_validation_v6')).toHaveLength(1)
 expect(io.writes.map(w=>w.port)).toContain('status')
 expect(io.message.raw_payload).toBe(ownerSource().raw_payload)
 expect(io.rows.customers.filter(r=>r.company_id===foreign)).toEqual([{id:ownerId(903),company_id:foreign}])
}
it('the authorized execution actor still reaches real tenant resolution and canonical persistence',async()=>{await continues()})
it('trusted internal P0001 retains diagnostic handling and authorized continuation',async()=>{
 io.endpointError={code:'P0001',message:'ediel_technical_endpoint_unqualified'};await continues()
 expect(io.writes.some(w=>w.port==='event')).toBe(true)
})
it('an unavailable technical endpoint retains its existing authorized continuation',async()=>{io.endpoint='none';await continues()})
it('public payload security labels and an error-message42501 cannot mint a security refusal',async()=>{
 io.message.parsed_payload={...io.message.parsed_payload,code:'42501',disposition:{kind:'security_quarantine'}}
 io.endpointError=Object.assign(new Error('42501 security_quarantine'),{payload:{code:'42501'}})
 await continues()
})
it('a cyclic nonsafety cause remains bounded and retains internal continuation',async()=>{
 const error=new Error('internal cause cycle');Object.defineProperty(error,'cause',{value:error});io.endpointError=error;await continues()
})
it('a security-looking tail outside the bounded trusted cause walk does not change internal disposition',async()=>{
 let error:unknown={code:'42501',message:'outside bounded trusted walk'}
 for(let i=0;i<32;i++)error=new Error('internal depth',{cause:error})
 io.endpointError=error;await continues()
})
