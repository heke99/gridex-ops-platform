import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {OWNER,ownerRows,ownerSource,ownerId} from './helpers/sourceOwnerFixtures'
const io=vi.hoisted(()=>({rows:{} as Record<string,Record<string,unknown>[]>,calls:[] as {name:string;args:Record<string,unknown>}[],badReceipt:'',badCount:false,failTable:'',hideSupply:false,
  message:{} as EdielMessageRow,drafts:[] as Record<string,unknown>[],events:[] as Record<string,unknown>[],correlated:true,interchangeNo:0}))
vi.mock('@/lib/supabase/service',async()=>{
 const database=(await import('./helpers/sourceOwnerTestDatabase')).sourceOwnerTestDatabase(io)
 return {supabaseService:{...database,rpc:(name:string,args:Record<string,unknown>)=>{
  if(name==='ediel_supply_start_is_cancelled_v1'){
   expect(args).toEqual({p_company_id:OWNER.company,p_switch_request_id:OWNER.switch})
   io.calls.push({name,args});return Promise.resolve({data:false,error:null})
  }
  return database.rpc(name,args)
 }}}
})
// Give both runs the same distinct outbound identities. The real ACK reference
// correlation, envelope, business decisions and full wire comparison stay live.
vi.mock('@/lib/ediel/core/referenceRegistry',async(importOriginal)=>({
 ...(await importOriginal<typeof import('@/lib/ediel/core/referenceRegistry')>()),
 buildEdielInterchangeReference:()=>String(++io.interchangeNo).padStart(14,'0'),
}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:async()=>({profileKey:'prodat-test',sourceHash:'a'.repeat(64),messageProfileId:'00000000-0000-4000-8000-000000000011',rulePackId:'00000000-0000-4000-8000-000000000012'})}))
vi.mock('@/lib/ediel/db',()=>({
 getEdielMessageById:async()=>io.message,createEdielMessageEvent:async(p:Record<string,unknown>)=>{io.events.push(p)},
 updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{
 io.message={...io.message,status:p.status,parsed_payload:p.parsedPayload??io.message.parsed_payload,validation_report:p.validationReport??io.message.validation_report} as EdielMessageRow;return io.message},
 linkEdielMessage:async()=>null,listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[],
}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({status:'tenant_resolved',companyId:'00000000-0000-4000-8000-000000000002',message:io.message,evidence:{companyId:'00000000-0000-4000-8000-000000000002'}})}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:async(p:{ackFamily:string;draft:Record<string,unknown>})=>{io.drafts.push(p.draft);return{id:p.ackFamily,status:'sent'}}}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>null}))
vi.mock('@/lib/ediel/inbound/inboundFacilityRecognition',()=>({recognizeInboundFacilityData:async()=>null}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointForEdielMessage:async()=>io.message.metering_point_id,matchSiteAndCustomerForMeteringPoint:async()=>({siteId:io.message.site_id,customerId:io.message.customer_id}),findMatchingSupplierSwitchRequest:async()=>io.correlated?io.rows.supplier_switch_requests[0]:null}))
vi.mock('@/lib/ediel/inboundCases',()=>({createOrUpdateInboundProdatCase:async()=>null}))
vi.mock('@/lib/onboarding/inboundEdielLinking',()=>({applyInboundProdatZ02ToCustomerInfoRequest:async()=>null,applyInboundProdatZ14ToMeteringPermission:async()=>null}))
vi.mock('@/lib/ediel/operationalVerification',()=>({buildSafeMasterdataProposal:async()=>[]}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:async()=>null}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
vi.mock('@/lib/operations/db',()=>({createSupplierSwitchEvent:async()=>null}))
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
const reset=()=>{io.rows=ownerRows();io.calls=[];io.message=ownerSource();io.drafts=[];io.events=[];io.badReceipt='';io.badCount=false;io.failTable='';io.hideSupply=false;io.correlated=true;io.interchangeNo=0}
const run=()=>processInboundEdielMessage({actorUserId:ownerId(50),edielMessageId:OWNER.source})
const facts=()=>JSON.parse(String(io.calls.find(c=>c.name==='gridex_record_source_object_decisions_v1')?.args.p_facts_text??'null'))
beforeEach(()=>{reset();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-22T18:00:00Z'))})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
it('actual processor hands its fresh canonical owner through the real successful business writer',async()=>{
 await run()
 expect(facts()?.objects[0].disposition).toBe('accepted')
 expect(io.calls.filter(c=>c.name==='gridex_witness_source_objects_v1')).toHaveLength(1)
 expect(io.rows.supplier_switch_requests[0].status).toBe('accepted');expect(io.rows.customer_supply_periods[0].status).toBe('confirmed_by_grid_owner')
})
it('actual processor stores unavailable evidence when no business operation was correlated',async()=>{io.correlated=false;await run();expect(facts()?.objects[0].disposition).toBe('unavailable')})
it('normal ACK and business outcomes are identical when the new evidence store fails',async()=>{
 await run();const baseline={drafts:structuredClone(io.drafts),switch:structuredClone(io.rows.supplier_switch_requests[0]),supply:structuredClone(io.rows.customer_supply_periods[0])}
 expect(baseline.drafts.map(d=>[d.messageFamily,d.interchangeReference,d.relatedMessageId,d.ackOutcome])).toEqual([
  ['CONTRL','00000000000001',OWNER.source,'positive'],['APERAK','00000000000002',OWNER.source,'positive'],
 ])
 expect(baseline.drafts[0].rawPayload).toContain("UCI+I+12345:14+54321:14+1'")
 expect(baseline.drafts[1].rawPayload).toContain("RFF+ACW:D'")
 expect(baseline.drafts[1].rawPayload).toContain("RFF+Z07:735123456789012345'")
 reset();io.badReceipt='gridex_record_source_object_decisions_v1';await run()
 const withoutClock=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='updated_at'))
 expect(io.drafts.map(d=>[d.messageFamily,d.rawPayload])).toEqual(baseline.drafts.map(d=>[d.messageFamily,d.rawPayload]))
 expect(withoutClock(io.rows.supplier_switch_requests[0])).toEqual(withoutClock(baseline.switch))
 expect(withoutClock(io.rows.customer_supply_periods[0])).toEqual(withoutClock(baseline.supply))
 expect(io.calls.filter(c=>c.name==='gridex_witness_source_objects_v1')).toHaveLength(0)
})
