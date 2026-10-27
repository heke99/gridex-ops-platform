import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

// This composition runs real commercial application, continuation, readiness,
// scheduling and job-enqueue code. Every identity, accepted POA, source proof,
// contract/route authority and SQL result below is a synthetic in-memory port.
// It does not qualify native SQL durability, worker/EDIEL intent or delivery.
type Row = Record<string, unknown>
const CO='11111111-1111-4111-8111-111111111111', CU='22222222-2222-4222-8222-222222222222'
const SI='33333333-3333-4333-8333-333333333333', SW='44444444-4444-4444-8444-444444444444'
const MP='55555555-5555-4555-8555-555555555555', CT='66666666-6666-4666-8666-666666666666'
const PO='77777777-7777-4777-8777-777777777777', SU='88888888-8888-4888-8888-888888888888'
const IN='99999999-9999-4999-8999-999999999999', RE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const AC='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', GO='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const HASH='a'.repeat(64)
const io=vi.hoisted(()=>({db:null as unknown as FakeDb,rpc:vi.fn(),route:vi.fn(),legal:vi.fn(),events:[] as Row[],rpcCalls:[] as Row[],proof:true,poa:true}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>io.db.client.from(table),rpc:(name:string,args:Row)=>io.rpc(name,args),auth:{getUser:async()=>({data:{user:{id:AC}},error:null})}}}))
// Scoped repository reads are modeled; readiness, commercial normalizer,
// continuation, orchestration, canonical scheduler and job enqueue are REAL.
vi.mock('@/lib/operations/db',async()=>({
 findCustomerSiteById:async(_client:unknown,id:string)=>structuredClone(io.db.tables.customer_sites.find(r=>r.id===id)??null),
 listMeteringPointsForSite:async(_client:unknown,id:string)=>structuredClone(io.db.tables.metering_points.filter(r=>r.site_id===id)),
 listPowersOfAttorneyByCustomerId:async()=>io.poa?[{id:PO,company_id:CO,customer_id:CU,site_id:SI,scope:'supplier_switch',status:'signed',accepted_at:'2027-02-01T12:00:00Z',created_at:'2027-02-01T12:00:00Z'}]:[],
 findOpenSupplierSwitchRequestForSite:async(_client:unknown,scope:Row)=>structuredClone(io.db.tables.supplier_switch_requests.find(r=>r.company_id===scope.companyId&&r.customer_id===scope.customerId&&r.site_id===scope.siteId)??null),
 syncOperationTasksFromReadiness:async()=>undefined,
 createSupplierSwitchRequest:(await import('@/lib/operations/db.part-2')).createSupplierSwitchRequest,
}))
vi.mock('@/lib/customers/customerOperationEvents',()=>({emitCustomerOperationEvent:async(event:Row)=>{io.events.push(structuredClone(event))}}))
vi.mock('@/lib/customer-operations/automation',async()=>{
 const actual=await import('@/lib/customer-operations/automation.part-1')
 return {enqueueSupplierSwitchAutomation:actual.enqueueSupplierSwitchAutomation}
})
vi.mock('@/lib/customer-operations/customerIntakeOrchestrator',()=>({evaluateSiteFacilityIdentity:async()=>({siteExists:true,facilityReady:true}),resumeCustomerIntake:async()=>{throw Error('UNEXPECTED resume intake')}}))
vi.mock('@/lib/customer-operations/customerProcessRouteReadiness',()=>({evaluateCustomerProcessRouteReadiness:(...args:unknown[])=>io.route(...args)}))
vi.mock('@/lib/grid-owners/verification',()=>({getGridOwnerVerification:async()=>({gridOwnerId:GO,verificationStatus:'verified',canStartSupplierSwitch:true,canUseForProdat:true})}))
vi.mock('@/lib/legal/authorizationChain',()=>({verifyAuthorizationScopeCoverage:(...args:unknown[])=>io.legal(...args),resolveAuthorizationDocumentIdForPowerOfAttorney:async()=> 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}))
// This port supplies no lifecycle hold. Scheduler itself is real and rereads
// persisted request status, negative ACK state, date and duplicate request rows.
vi.mock('@/lib/operations/switchLifecycleBlocks',()=>({OPEN_SUPPLIER_SWITCH_STATUSES:['queued','manual_followup_required','prepared','sent','waiting_response'],findActiveSwitchLifecycleBlock:async()=>null,assertNoActiveSwitchLifecycleBlock:async()=>undefined}))
vi.mock('@/lib/energy/resolver',()=>({resolveEnergyContext:async()=>{throw Error('UNEXPECTED energy resolver')}}))

import { applyManualCommercialReply } from '@/lib/inbound-mail/manualReplyApplication'
import { evaluateSupplierSwitchSchedule } from '@/lib/operations/supplierSwitchScheduler'

function record(value: unknown): Row {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected synthetic fixture object')
 return value as Row
}
function row(table: string): Row {
 const found = io.db.tables[table]?.[0]
 if (!found) throw Error(`Missing synthetic fixture: ${table}`)
 return found
}
const jobs = () => io.db.tables.customer_operation_jobs ?? []
const manualTerms = () => record(record(row('customer_sites').metadata).manual_supplier_terms)
const continuation = () => record(record(record(row('manual_inbound_messages').extracted_payload).manual_automation).continuation)
function seed(requested: string | null = '2027-03-10'){
 io.db=createFakeDb({
 customer_sites:[{id:SI,company_id:CO,customer_id:CU,facility_id:'735999000000000001',grid_owner_id:GO,grid_area_code:'SYN',price_area_code:'SE3',move_in_date:null,current_supplier_id:SU,current_supplier_name:'Synthetic Supplier',current_supplier_unknown:false,current_supplier_response_status:'waiting_response',current_supplier_termination_fee:null,street:'Synthetic 1',postal_code:'11122',city:'Stockholm',address_hash:'synthetic-address-hash',metadata:{}}],
 metering_points:[{id:MP,company_id:CO,customer_id:CU,site_id:SI,meter_point_id:'735999000000000001',grid_owner_id:GO,grid_area_code:'SYN',price_area_code:'SE3',status:'active'}],
 supplier_switch_requests:[{id:SW,company_id:CO,customer_id:CU,site_id:SI,customer_site_id:SI,metering_point_id:MP,requested_start_date:requested,status:'queued',request_type:'switch',prodat_variant:'L',prodat_reason:'Z22',lifecycle_blocked:false,lifecycle_block_source:null,lifecycle_block_id:null,paused_at:null,paused_by:null,pause_reason:null,submitted_at:null,completed_at:null,outbound_z03_message_id:null,updated_at:'2027-02-01T12:00:00Z',metadata:{contract_id:CT,power_of_attorney_id:PO,supplier_switch_blockers:[]},validation_snapshot:{}}],
 customer_contract_lifecycle_readiness_v:[{customer_contract_id:CT,company_id:CO,customer_id:CU,customer_site_id:SI,accepted_document_count:5,blockers:[],switch_ready:true}],
 grid_owner_information_requests:[{id:RE,company_id:CO,customer_id:CU,customer_site_id:SI,created_by:AC,poa_id:PO,request_type:'current_supplier_contract_information_request',status:'waiting_manual_response',metadata:{},parsed_payload:{}}],
 manual_inbound_messages:[{id:IN,company_id:CO,customer_id:CU,customer_site_id:SI,request_id:RE,processing_state:'received',resolution_status:'matched',received_at:'2027-03-01T10:00:00Z',extracted_payload:{sender_credible:true,sender_verification:{status:'verified'},manual_automation:{sourceHash:HASH}}}],
 customer_operation_jobs:[],customer_operation_request_snapshots:[],
 })
 io.db.unique.customer_operation_jobs=['idempotency_key']
}
function installFiniteSqlPort(){
 io.rpc.mockImplementation(async(name:string,args:Row)=>{
  io.rpcCalls.push({name,args:structuredClone(args)})
  expect(args.p_company_id).toBe(CO)
  if(name==='gridex_create_supplier_switch_v1'){
   // Finite SQL transaction/result port models established normal L/Z22 defaults;
   // actual TS creator supplies date, business hold and canonical payload.
   // This port does not qualify SQL defaults, authority or durability.
   const payload=record(args.p_request)
   expect(payload.company_id).toBe(CO);expect(payload.customer_id).toBe(CU)
   expect(payload.site_id).toBe(SI);expect(payload.customer_site_id).toBe(SI)
   expect(io.db.tables.supplier_switch_requests).toHaveLength(0)
   const created={id:SW,prodat_variant:'L',prodat_reason:'Z22',paused_at:null,paused_by:null,pause_reason:null,lifecycle_block_id:null,submitted_at:null,completed_at:null,outbound_z03_message_id:null,...structuredClone(payload)}
   io.db.tables.supplier_switch_requests.push(created)
   return {data:{request:structuredClone(created)},error:null}
  }
  if(name==='gridex_apply_manual_commercial_reply_v1'){
   expect(args.p_request_id).toBe(RE);expect(args.p_inbound_id).toBe(IN)
   const request=row('grid_owner_information_requests'),source=row('manual_inbound_messages'),site=row('customer_sites')
   const sourcePayload=record(source.extracted_payload)
   const previous=record(sourcePayload.manual_automation).application
   if(previous)return {data:{ok:true,applied:true,complete:true,customerId:CU,customerSiteId:SI,alreadyApplied:true},error:null}
   const payload=record(args.p_payload);expect(payload.sourceHash).toBe(HASH)
   const application={version:1,ok:true,applied:true,complete:true,inboundId:IN,inbound_id:IN,companyId:CO,customerId:CU,customerSiteId:SI,siteId:SI,requestId:RE,sourceHash:HASH,terms:structuredClone(payload.terms)}
   Object.assign(site,{current_supplier_response_status:'free_to_switch',current_supplier_termination_fee:0,metadata:{manual_supplier_terms:{version:1,companyId:CO,customerId:CU,siteId:SI,inboundId:IN,requestId:RE,sourceHash:HASH,receivedAt:source.received_at,terms:structuredClone(payload.terms)}}})
   Object.assign(request,{status:'completed',parsed_payload:structuredClone(application)})
   Object.assign(source,{processing_state:'applied',extracted_payload:{...sourcePayload,manual_automation:{sourceHash:HASH,application:structuredClone(application)}}})
   return {data:{ok:true,applied:true,complete:true,customerId:CU,customerSiteId:SI},error:null}
  }
  expect(args.p_customer_id).toBe(CU);expect(args.p_site_id).toBe(SI)
  const snapshot=manualTerms()
  if(name==='gridex_manual_supplier_start_floor_v1')return {data:record(snapshot.terms).effectiveStartDate,error:null}
  if(name==='gridex_manual_supplier_terms_verified_v1'){
   expect(args.p_snapshot).toEqual(snapshot);return {data:io.proof,error:null}
  }
  throw Error(`UNMODELED SQL RPC ${name}`)
 })
}
function apply(options:{earliest?:string,text?:string,receivedAt?:string}={}){
 const earliest=options.earliest??'2027-04-01',receivedAt=options.receivedAt??'2027-03-01T10:00:00Z'
 row('manual_inbound_messages').received_at=receivedAt
 return applyManualCommercialReply({companyId:CO,customerId:CU,siteId:SI,request:structuredClone(row('grid_owner_information_requests')),inboundId:IN,extracted:{earliest_supplier_start_date:earliest,termination_fee:'Ingen'},authoredText:options.text??`Tidigaste leveransstart: ${earliest}\nBrytavgift: Ingen`,receivedAt,receivedAtSource:'imap_internal_date',sourceHash:HASH})
}
function expectScopedJob(date:string){
 expect.soft(row('supplier_switch_requests')).toMatchObject({company_id:CO,customer_id:CU,customer_site_id:SI,request_type:'switch',prodat_variant:'L',requested_start_date:date,status:'queued',lifecycle_blocked:false})
 expect.soft(continuation()).toMatchObject({status:'completed',supplierSwitchRequestId:SW})
 expect.soft(continuation().reviewRequired).not.toBe(true)
 expect.soft(jobs()).toHaveLength(1)
 if(jobs().length){
  expect(jobs()[0]).toMatchObject({company_id:CO,customer_id:CU,customer_site_id:SI,job_type:'start_supplier_switch',status:'queued',payload:{supplier_switch_request_id:SW,requested_start_date:date}})
  expect(io.db.tables.customer_operation_request_snapshots).toHaveLength(1)
 }
}
beforeEach(()=>{
 vi.clearAllMocks();io.events=[];io.rpcCalls=[];io.proof=true;io.poa=true
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2027-03-02T12:00:00Z'))
 seed();installFiniteSqlPort()
 io.route.mockResolvedValue({ready:true,blockers:[],warnings:[],routeProfileId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'})
 io.legal.mockResolvedValue({covered:true,missing:[],healed:false,schemaAvailable:true})
 vi.stubGlobal('fetch',async()=>{throw Error('UNEXPECTED NETWORK/AI: composition forbids external calls')})
})
afterEach(()=>{
 vi.useRealTimers();vi.unstubAllGlobals()
})
describe('commercial reply to canonical normal switch - actual TS composition',()=>{
 it('raises an earlier customer requested normal start to verified commercial floor and enqueues one real adapter job',async()=>{
  expect(await apply()).toMatchObject({outcome:'applied',nextStepDecision:'supplier_terms_complete'})
  expect(record(manualTerms().terms).effectiveStartDate).toBe('2027-04-01')
  expectScopedJob('2027-04-01')
 })
 it('preserves a later customer requested normal start rather than replacing it by the commercial floor',async()=>{
  seed('2027-05-01');await apply();expectScopedJob('2027-05-01')
 })
 it('anchors exact 30 calendar days to original Stockholm receipt across DST and uses the resulting normal start',async()=>{
  await apply({earliest:'om 30 dagar',text:'Kunden kan starta om 30 dagar\nBrytavgift: Ingen',receivedAt:'2027-02-28T23:30:00Z'})
  expect(record(manualTerms().terms).effectiveStartDate).toBe('2027-03-31')
  expectScopedJob('2027-03-31')
 })
 it('replaying the same applied source adds no second canonical job, no site term rewrite and no external/AI call',async()=>{
  await apply();const after=structuredClone(row('customer_sites'));const calls=io.rpcCalls.length
  await apply()
  expect(row('customer_sites')).toEqual(after)
  expect(io.rpcCalls.slice(calls).map(r=>r.name)).toEqual(['gridex_apply_manual_commercial_reply_v1'])
  expectScopedJob('2027-04-01')
 })
 it.each(['identity','authority','route','poa'] as const)('persists review and refuses automatic work when %s is missing',async kind=>{
  if(kind==='identity')Object.assign(row('customer_contract_lifecycle_readiness_v'),{switch_ready:false,blockers:['customer_identity_missing']})
  if(kind==='authority')io.legal.mockResolvedValue({covered:false,missing:['current_supplier_contract'],healed:false,schemaAvailable:true})
  if(kind==='route')io.route.mockResolvedValue({ready:false,blockers:[{code:'route_missing',message:'Synthetic absent route'}],warnings:[]})
  if(kind==='poa')io.poa=false
  await apply()
  expect(jobs()).toHaveLength(0)
  expect(continuation()).toMatchObject({status:'completed',reviewRequired:true})
  expect(continuation().reviewReasons).toContain({identity:'customer_identity_missing',authority:'authorization_scope_missing',route:'route_missing',poa:'power_of_attorney_missing'}[kind])
 })
 it.each([null, '2027-02-30'])('requires a valid persisted normal start before dispatch (%s)', async requested => {
  seed(requested)
  await apply()
  expect(jobs()).toHaveLength(0)
  expect(row('supplier_switch_requests').requested_start_date).toBe(requested)
  expect(continuation()).toMatchObject({ status: 'completed', reviewRequired: true })
  expect(continuation().reviewReasons).toContain('current_supplier_start_date_missing')
 })
 it('independently executes real canonical normal schedule date/policy gates with same persisted scope',async()=>{
  row('supplier_switch_requests').requested_start_date='2027-04-01'
  const result=await evaluateSupplierSwitchSchedule({companyId:CO,switchRequestId:SW,requestedStartDate:'2027-04-01',requestType:'switch',transactionSubtype:'L',status:'queued',siteId:SI,meteringPointId:MP})
  expect(result).toMatchObject({ok:true,blockers:[],window:{requestedStartDate:'2027-04-01',windowOpen:true,transactionSubtype:'L'}})
 })
})

// A first post-facility commercial reply need not have an earlier switch row.
// Every signed agreement below is a synthetic legal/readiness port.
// expected_start_at makes actual start_date_ready possible for earliest_possible;
// it does not invent a customer-requested date or an unrelated move-in date.
function seedFirst(options: {
 mode?: string; requested?: string | null; expected?: string | null;
 contractCompanyId?: string; contractCustomerId?: string; contractSiteId?: string;
} = {}) {
 seed(null)
 io.db.tables.supplier_switch_requests=[]
 io.db.tables.electricity_suppliers=[{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',company_id:CO,is_active:true,is_own_supplier:true,name:'Synthetic Incoming Supplier',org_number:'synthetic-only',updated_at:'2027-02-01T12:00:00Z'}]
 const requested=options.requested??null
 const expected=options.expected===undefined?'2027-04-01':options.expected
 io.db.tables.customer_contracts=[{id:CT,company_id:options.contractCompanyId??CO,customer_id:options.contractCustomerId??CU,customer_site_id:options.contractSiteId??SI,site_id:options.contractSiteId??SI,status:'signed',signed_at:'2027-02-01T12:00:00Z',requested_start_mode:options.mode??'earliest_possible',requested_start_date:requested,expected_start_at:expected,starts_at:null}]
 // Distinct application hints cannot override exact signed-contract intent.
 io.db.tables.website_customer_applications=[{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',company_id:CO,customer_id:CU,customer_site_id:SI,contract_id:CT,requested_start_mode:'earliest_possible',requested_start_date:'2027-04-01',status:'processing'}]
 const hasStart=Boolean(requested||expected)
 Object.assign(row('customer_contract_lifecycle_readiness_v'),{start_date_ready:hasStart,switch_ready:hasStart,blockers:hasStart?[]:['contract_start_date_missing']})
}
function expectFirstReview() {
 expect(jobs()).toHaveLength(0)
 expect(continuation()).toMatchObject({status:'completed',reviewRequired:true})
}
function creationCalls() { return io.rpcCalls.filter(call=>call.name==='gridex_create_supplier_switch_v1') }

describe('first normal switch after verified commercial reply',()=>{
 it('uses actual creator for earliest_possible with a ready expected date and no existing switch',async()=>{
  seedFirst()
  await apply()
  expect(creationCalls()).toHaveLength(1)
  expect(row('supplier_switch_requests').requested_start_date).toBe('2027-04-01')
  expectScopedJob('2027-04-01')
 })
 it('raises the exact earliest_possible expected date to the later verified supplier floor',async()=>{
  seedFirst({expected:'2027-03-16'})
  await apply()
  expect(creationCalls()).toHaveLength(1)
  expect(row('supplier_switch_requests').requested_start_date).toBe('2027-04-01')
  expectScopedJob('2027-04-01')
 })
 it.each(['earliest_possible','specific_date'])('preserves the later exact signed contract date for first %s request',async mode=>{
  seedFirst({mode,requested:'2027-05-01',expected:'2027-05-01'})
  await apply()
  expect(creationCalls()).toHaveLength(1)
  expectScopedJob('2027-05-01')
 })
 it('never replaces the later signed expected date by an earlier supplier floor',async()=>{
  seedFirst({expected:'2027-05-01'})
  await apply()
  expect(creationCalls()).toHaveLength(1)
  expectScopedJob('2027-05-01')
 })
 it('replays the first applied commercial source without a second request, job or interpretation',async()=>{
  seedFirst();await apply()
  const savedSite=structuredClone(row('customer_sites'));const calls=io.rpcCalls.length
  await apply()
  expect(row('customer_sites')).toEqual(savedSite)
  expect(creationCalls()).toHaveLength(1)
  expect(io.rpcCalls.slice(calls).map(call=>call.name)).toEqual(['gridex_apply_manual_commercial_reply_v1'])
  expectScopedJob('2027-04-01')
 })
 it('keeps an unverified commercial source in review before first dispatch',async()=>{
  seedFirst();io.proof=false
  await apply()
  expectFirstReview()
  expect(continuation().reviewReasons).toContain('supplier_commercial_source_unverified')
 })
 it.each([null,'2027-02-30'])('refuses absent or malformed specific-date intent even with another expected date (%s)',async requested=>{
  seedFirst({mode:'specific_date',requested,expected:'2027-04-01'})
  await apply()
  expectFirstReview()
 })
 it('retains the real canonical missing-start gate when all contract start dates are absent',async()=>{
  seedFirst({expected:null})
  await apply()
  expectFirstReview()
  expect(continuation().reviewReasons).toContain('contract_start_date_missing')
 })
 it('refuses a malformed unknown start mode from the contract read port',async()=>{
  seedFirst({mode:'unknown_mode'})
  await apply()
  expectFirstReview()
 })
 it('does not infer customer intent when the exact signed contract is absent',async()=>{
  seedFirst();io.db.tables.customer_contracts=[]
  await apply()
  expectFirstReview()
 })
 it.each(['contractCompanyId','contractCustomerId','contractSiteId'] as const)('keeps wrong-scope first-request contract facts in review (%s)',async field=>{
  seedFirst({[field]:'abababab-abab-4bab-8bab-abababababab'})
  await apply()
  expectFirstReview()
 })
 it('rejects conflicting contract site aliases even when one matches the customer site',async()=>{
  seedFirst()
  row('customer_contracts').site_id='abababab-abab-4bab-8bab-abababababab'
  await apply()
  expectFirstReview()
  expect(creationCalls()).toHaveLength(0)
  expect(continuation().reviewReasons).toContain('customer_requested_start_intent_invalid')
 })
})
