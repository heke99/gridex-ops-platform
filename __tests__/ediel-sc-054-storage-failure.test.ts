// masterplan: SC-054
// A correct UTILTS transaction whose database transaction fails: the real
// inbound processor, canonical runtime, contract preparation and persistence
// adapter refuse to continue, so no acknowledgement is created; the real
// transport journals the failure as a retryable internal failure (no external
// rejection); the real file-engine registration stores the pending APERAK with
// an ack_due_at so it stays under deadline surveillance; and the real SQL
// authority refuses a merely queued reservation as proof of storage.
// Test doubles: the Supabase port (an in-memory table/RPC model whose UTILTS
// persist RPC fails), tenant legal-identity loader, matching, dead-letter writer
// and exchange log. The ACK creator is spied on, not replaced.
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Row=Record<string,unknown>
const port=vi.hoisted(()=>({tables:{} as Record<string,Row[]>,io:null as null|((name:string,args:Row)=>unknown),
 rpcCalls:[] as Array<{name:string;args:Row}>,journal:vi.fn(),log:vi.fn(),ack:vi.fn()}))

vi.mock('@/lib/supabase/service',async()=>{
 const {createHash}=await import('node:crypto')
 class Query{
  filters:Array<(row:Row)=>boolean>=[];operation='read';value:unknown;one=false
  constructor(readonly table:string){}
  select(){return this}
  eq(key:string,value:unknown){this.filters.push(row=>row[key]===value);return this}
  in(key:string,values:unknown[]){this.filters.push(row=>values.includes(row[key]));return this}
  is(key:string,value:unknown){this.filters.push(row=>(row[key]??null)===value);return this}
  neq(){return this} not(){return this} lt(){return this} lte(){return this} gt(){return this} gte(){return this}
  ilike(){return this} or(){return this} contains(){return this} filter(){return this} match(){return this}
  order(){return this} limit(){return this} range(){return this} abortSignal(){return this}
  update(value:unknown){this.operation='update';this.value=value;return this}
  insert(value:unknown){this.operation='insert';this.value=value;return this}
  upsert(value:unknown){this.operation='upsert';this.value=value;return this}
  delete(){this.operation='delete';return this}
  maybeSingle(){this.one=true;return this} single(){this.one=true;return this}
  then(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown){return Promise.resolve().then(()=>{
   const all=port.tables[this.table]??[],selected=all.filter(row=>this.filters.every(filter=>filter(row)))
   let rows=selected
   if(this.operation==='insert'||this.operation==='upsert'){
    rows=(Array.isArray(this.value)?this.value:[this.value]).map((value,index)=>({id:`${this.table}-${all.length+index+1}`,...structuredClone(value as Row)}))
    port.tables[this.table]=[...all,...rows]
   }
   if(this.operation==='update')for(const row of selected)Object.assign(row,structuredClone(this.value as Row))
   return {data:structuredClone(this.one?rows[0]??null:rows),error:null,count:rows.length}
  }).then(resolve,reject)}
 }
 const sha=(value:unknown)=>value==null?null:createHash('sha256').update(String(value),'utf8').digest('hex')
 const rpc=(name:string,args:Row)=>{
  port.rpcCalls.push({name,args})
  const result=Promise.resolve().then(async()=>{
   if(name==='gridex_persist_utilts_consumption_v1')return {data:null,error:{message:'could not serialize access'}}
   const modeled=port.io?.(name,args) as {then?:unknown;abortSignal?:()=>unknown}|undefined
   if(modeled)return await (typeof modeled.then==='function'?modeled:modeled.abortSignal!())
   if(name==='gridex_actor_has_company_permission')return {data:true,error:null}
   if(name==='gridex_record_utilts_source_validation_v4')return {data:{version:4,companyId:args.p_company_id,environment:args.p_environment,
    sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,factsHash:sha(args.p_facts_text),
    transactionFactsHash:sha(args.p_transaction_facts_text),headerFactsHash:sha(args.p_header_facts_text),functionalFactsHash:sha(args.p_functional_facts_text),
    sourceDisposition:'not_established',assessmentId:'40000000-0000-4000-8000-000000000001'},error:null}
   return {data:null,error:null}
  })
  return Object.assign(result,{abortSignal:()=>result})
 }
 return {supabaseService:{from:(table:string)=>new Query(table),rpc}}
})
vi.mock('@/lib/ediel/tenant/tenantEdielIdentity',async(original)=>({...(await original<object>()),
 resolveCanonicalTenantEdielIdentityWithEvidence:vi.fn(async()=>({identity:{legalEdielId:'21660',transportEdielId:'21660',
  roleCodes:['supplier'],legalActorId:'actor-legal',transportActorId:'actor-legal',representedByTransportAgent:false,transportRelationId:null},evidence:{}}))}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointIdByIdentifier:vi.fn().mockResolvedValue('point-a'),
 matchMeteringPointForEdielMessage:vi.fn().mockResolvedValue('point-a'),
 matchSiteAndCustomerForMeteringPoint:vi.fn().mockResolvedValue({customerId:'customer-a',siteId:'site-a',gridOwnerId:'owner-a'}),
 findMatchingSupplierSwitchRequest:vi.fn().mockResolvedValue(null),findMatchingGridOwnerDataRequest:vi.fn().mockResolvedValue(null)}))
vi.mock('@/lib/ediel/transport/deadLetter',()=>({createEdielDeadLetterItem:port.journal}))
vi.mock('@/lib/ediel/operations/exchangeLog',()=>({recordEdielExchangeLog:port.log}))
// Spy only: every ACK the inbound chain could write goes through this creator.
vi.mock('@/lib/ediel/core/kernel',async(original)=>{
 const actual=await original<typeof import('@/lib/ediel/core/kernel')>()
 return {...actual,createCanonicalAckMessage:(...args:Parameters<typeof actual.createCanonicalAckMessage>)=>{port.ack(...args);return actual.createCanonicalAckMessage(...args)}}
})

import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'
import {buildUtiltsTransactionPersistencePayload,persistUtiltsTransactionResults} from '@/lib/ediel/utilts/transactionPersistence'
import {processInboundEdifactMessage} from '@/lib/ediel/transport/inboundProcessor'
import {getCanonicalAckState} from '@/lib/ediel/core/ackPolicy'
import {registerEdielFile} from '@/lib/ediel/fileEngine'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {createUtiltsFinalValidationIo,qualifyUtiltsFixtureSource,UTILTS_FIXTURE_ACTOR} from './helpers/utiltsCurrentOwnerFixture'
import {receivedUtiltsOwnerFixture,resetUtiltsCanonicalOwnerIo} from './helpers/utiltsCanonicalOwnerIo'

const company='11111111-1111-4111-8111-111111111111'
function seedActor(){
 port.tables.company_memberships=[{company_id:company,user_id:UTILTS_FIXTURE_ACTOR,status:'active',is_active:true,accepted_at:'2026-09-01T00:00:00Z'}]
 port.tables.user_profiles=[{id:UTILTS_FIXTURE_ACTOR,user_status:'active'}]
}

async function failingPersistence(){
 const message=energyHandoffMessage('2026-10-15')
 message.company_id=company;message.id='22222222-2222-4222-8222-222222222222'
 const runtime=runUtiltsRuntimeForMessage(message),policy=resolveCanonicalMessagePolicy(message)!
 const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,matches:[],dataRequest:null,fallback:{customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null},allowConsumption:true})
 const transactions=buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:runtime.facts.transactions,dispositions:runtime.transactionDispositions,matches:[]})
 port.rpcCalls.length=0
 const outcome=persistUtiltsTransactionResults({actorUserId:UTILTS_FIXTURE_ACTOR,companyId:company,environment:'test',
  sourceMessageId:message.id!,messageCode:'E66',rawPayload:message.raw_payload!,contracts,transactions})
 return {runtime,outcome}
}

describe('SC-054 storage failure blocks the positive APERAK',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();resetUtiltsCanonicalOwnerIo();port.tables={};port.io=null;port.rpcCalls.length=0
  port.log.mockResolvedValue(undefined);port.journal.mockResolvedValue({id:'journal'})
 })

 it('a correct transaction whose database write fails yields no persisted result to acknowledge',async()=>{
  const {runtime,outcome}=await failingPersistence()
  // Given: the UTILTS transaction itself is correct.
  expect(runtime.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
  // Expected: the failure propagates; nothing is returned to build an ACK job from.
  await expect(outcome).rejects.toThrow('utilts_transaction_persistence_failed:could not serialize access')
  expect(port.rpcCalls.map(call=>call.name)).toEqual(['gridex_persist_utilts_consumption_v1'])
 })

 it('real inbound processing propagates the failed persist, journals it retryable and creates no ACK',async()=>{
  const wire=energyHandoffMessage('2026-10-15');wire.sender_ediel_id='91100';wire.receiver_ediel_id='21660'
  const message=qualifyUtiltsFixtureSource(receivedUtiltsOwnerFixture(wire))
  Object.assign(message,{status:'received',requires_contrl:true,requires_aperak:true,contrl_status:'pending',aperak_status:'pending',utilts_err_status:'pending'})
  port.io=createUtiltsFinalValidationIo() as never
  seedActor()
  port.tables.ediel_messages=[structuredClone(message) as unknown as Row]
  port.tables.tenant_actor_identifiers=[{company_id:company,environment:'test',identifier_type:'EdielId',identifier_value:'21660',valid_from:'2020-01-01T00:00:00Z',valid_to:null}]

  const failure=await processInboundEdifactMessage({actorUserId:UTILTS_FIXTURE_ACTOR,message:message as EdielMessageRow}).catch((error:unknown)=>error)
  // The real chain reached the persist RPC with the correct accepted transaction, and its error propagated unchanged.
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).message).toBe('utilts_transaction_persistence_failed:could not serialize access')
  const persist=port.rpcCalls.filter(call=>call.name==='gridex_persist_utilts_consumption_v1')
  expect(persist).toHaveLength(1)
  expect(persist[0].args).toMatchObject({p_company_id:company,p_source_message_id:message.id,p_message_code:'E66',
   p_transactions:[expect.objectContaining({disposition:'accepted',responseType:'positive_aperak'})]})
  // Journal: retryable internal failure, not an external protocol rejection.
  expect(port.journal).toHaveBeenCalledTimes(1)
  expect(port.journal).toHaveBeenCalledWith(expect.objectContaining({companyId:company,edielMessageId:message.id,
   errorCode:'EDIEL_INTERNAL_EXECUTION_FAILURE',retryable:true,
   errorMessage:expect.stringContaining('utilts_transaction_persistence_failed'),
   metadata:expect.objectContaining({failureDisposition:{kind:'internal_failure',code:'EDIEL_INTERNAL_EXECUTION_FAILURE'}})}))
  // No ACK of any family was created, and no outbound ACK row was written.
  expect(port.ack).not.toHaveBeenCalled()
  expect((port.tables.ediel_messages??[]).filter(row=>row.direction==='outbound')).toEqual([])
 })

 it('the real inbound registration keeps the unacknowledged APERAK under its deadline and reports it overdue',async()=>{
  seedActor()
  const raw=energyHandoffMessage('2026-10-15').raw_payload!
  vi.useFakeTimers({toFake:['Date']})
  try{
   const receivedAt='2026-10-11T08:00:00.000Z';vi.setSystemTime(new Date(receivedAt))
   await registerEdielFile({actorUserId:UTILTS_FIXTURE_ACTOR,direction:'inbound',rawPayload:raw,mode:'tgt',companyId:company,
    ownActorEdielId:'21660',testPortalEdielId:'91100'})
   const stored=(port.tables.ediel_messages??[]).filter(row=>row.direction==='inbound')
   expect(stored).toHaveLength(1)
   const row=stored[0] as unknown as EdielMessageRow
   expect(row).toMatchObject({message_family:'UTILTS',message_code:'E66',requires_aperak:true,aperak_status:'pending'})
   expect(row.ack_due_at).not.toBeNull()
   expect(Date.parse(row.ack_due_at!)).toBeGreaterThan(Date.parse(receivedAt))
   // UTILTS E66 also requires CONTRL; once the CONTRL is received, the stored row awaits the APERAK.
   expect(getCanonicalAckState(row)).toBe('awaiting_contrl')
   const contrlReceived={...row,contrl_status:'received' as const}
   expect(getCanonicalAckState(contrlReceived)).toBe('awaiting_aperak')
   vi.setSystemTime(new Date(Date.parse(row.ack_due_at!)+1))
   expect(getCanonicalAckState(contrlReceived)).toBe('ack_overdue')
   expect(getCanonicalAckState(row)).toBe('ack_overdue')
  }finally{vi.useRealTimers()}
 })

 it('the real SQL authority refuses received-only and queued reservations as storage (PGlite)',()=>{
  const root=process.cwd(),require=createRequire(path.join(root,'package.json'))
  const result=spawnSync(process.execPath,[path.join(root,'scripts/ediel-utilts-u04-u14-effects-sql-regression.mjs')],{cwd:root,encoding:'utf8',timeout:120_000,
   env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
  expect(result.error,result.stderr).toBeUndefined()
  expect(result.status,result.stdout+result.stderr).toBe(0)
  expect(result.stdout).toContain('PASS 10 U-04/U-14 effect checks')
 },125_000)
})
