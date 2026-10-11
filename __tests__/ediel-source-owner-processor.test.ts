import {tokenizeEdifact,segmentComposite,segmentElementCount} from '@/lib/ediel/core/edifactTokenizer'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {OWNER,ownerRows,ownerSourceWithInstallationStatus as ownerSource,ownerId} from './helpers/sourceOwnerFixtures'
import {createProdatOwnSourceReadingSdk,resetProdatOwnSourceReadingSdk,installProdatOwnSourceReadingFixture,type ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'
const io=vi.hoisted(()=>({rows:{} as Record<string,Record<string,unknown>[]>,calls:[] as {name:string;args:Record<string,unknown>}[],badReceipt:'',badCount:false,failTable:'',hideSupply:false,
  message:{} as EdielMessageRow,drafts:[] as Record<string,unknown>[],events:[] as Record<string,unknown>[],correlated:true,nativeUnavailable:false,interchangeNo:0,ownSourceReadings:null as ProdatOwnSourceReadingSdk|null}))
vi.mock('@/lib/supabase/service',async()=>({supabaseService:(await import('./helpers/sourceOwnerTestDatabase')).sourceOwnerTestDatabase(io)}))
vi.mock('@/lib/ediel/core/referenceRegistry',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/ediel/core/referenceRegistry')>(),buildEdielInterchangeReference:()=>String(++io.interchangeNo).padStart(14,'0')}))
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
const reset=()=>{io.rows=ownerRows();io.calls=[];io.message=ownerSource('Z12',{readingDeclarations:true,sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}});io.drafts=[];io.events=[];io.badReceipt='';io.badCount=false;io.failTable='';io.hideSupply=false;io.correlated=true;io.nativeUnavailable=false;io.interchangeNo=0
 io.ownSourceReadings=createProdatOwnSourceReadingSdk();resetProdatOwnSourceReadingSdk(io.ownSourceReadings)
 installProdatOwnSourceReadingFixture(io.ownSourceReadings,io.message,'L',{actorUserId:ownerId(50),receivedAt:io.message.message_received_at!,mailId:io.message.inbound_email_message_id!,parseId:ownerId(61),receptionId:ownerId(62),legalActorId:OWNER.actor})}
const run=()=>processInboundEdielMessage({actorUserId:ownerId(50),edielMessageId:OWNER.source})
const facts=()=>JSON.parse(String(io.calls.find(c=>c.name==='gridex_record_source_object_decisions_v1')?.args.p_facts_text??'null'))
beforeEach(()=>{reset();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-22T18:00:00Z'));vi.spyOn(Math,'random').mockReturnValue(0.123456)})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
it('actual processor hands its fresh canonical owner through the real successful business writer',async()=>{
 await run()
 expect(facts()?.objects[0].disposition).toBe('accepted')
 expect(io.calls.filter(c=>c.name==='gridex_witness_source_objects_v1')).toHaveLength(1)
 expect(io.rows.supplier_switch_requests[0].status).toBe('accepted');expect(io.rows.customer_supply_periods[0].status).toBe('confirmed_by_grid_owner')
})
it('actual processor stores unavailable evidence when the native original scope cannot qualify',async()=>{io.correlated=false;io.nativeUnavailable=true;await run();expect(facts()?.objects[0].disposition).toBe('unavailable')})
it('normal ACK and business outcomes are identical when the new evidence store fails',async()=>{
 await run();const baseline={drafts:structuredClone(io.drafts),switch:structuredClone(io.rows.supplier_switch_requests[0]),supply:structuredClone(io.rows.customer_supply_periods[0])}
 reset();io.badReceipt='gridex_record_source_object_decisions_v1';await run()
 const withoutClock=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='updated_at'))
 const responseSemantics=(draft:Record<string,unknown>)=>{
  const wire=tokenizeEdifact(String(draft.rawPayload)),unb=wire.segments.find(t=>t.tag==='UNB')!,unz=wire.segments.find(t=>t.tag==='UNZ')!,own=segmentComposite(unb,5,wire.una)[0]
  expect(own).toMatch(/^[A-F0-9]{14}$/);expect(segmentComposite(unz,2,wire.una)).toEqual([own])
  // Separate fresh creations have different own generated UNB identities.
  // Keep every original-source reference, party, function, error and field.
  return [draft.messageFamily,wire.segments.map(token=>({tag:token.tag,elements:Array.from({length:segmentElementCount(token,wire.una)},(_,index)=>token.tag==='UNB'&&index===4||token.tag==='UNZ'&&index===1?['<fresh-own-reference>']:segmentComposite(token,index+1,wire.una))}))]
 }
 expect(io.drafts.map(responseSemantics)).toEqual(baseline.drafts.map(responseSemantics))
 expect(withoutClock(io.rows.supplier_switch_requests[0])).toEqual(withoutClock(baseline.switch))
 expect(withoutClock(io.rows.customer_supply_periods[0])).toEqual(withoutClock(baseline.supply))
 expect(io.calls.filter(c=>c.name==='gridex_witness_source_objects_v1')).toHaveLength(0)
})
