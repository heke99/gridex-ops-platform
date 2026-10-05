import { beforeEach,describe,expect,it,vi } from 'vitest'
import { finalizeRecoveryDraft,queueRecoveryDraft } from '@/lib/ediel/intent/prodatRecoveryGateway'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'
import { source } from './fixtures/prodat-identity'
import {prepareCustomerMasterdataSource,bindCustomerMasterdataValidationContext} from '@/lib/ediel/production/customerMasterdataSource'
import {readProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
const io=vi.hoisted(()=>({rpc:vi.fn(),finalize:vi.fn(),route:vi.fn(),intent:vi.fn(),validate:vi.fn(),lifecycle:vi.fn(),queue:vi.fn(),customerSource:vi.fn(),methodSource:vi.fn(),methodRoute:vi.fn(),switchRead:vi.fn(),invoicee:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/core/kernel',()=>({finalizeCanonicalOutboundDraft:io.finalize,resolveCanonicalOutboundContext:io.route}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({getEdielMessageIntentById:io.intent,evaluateIntentValidation:io.validate,updateIntentLifecycle:io.lifecycle}))
vi.mock('@/lib/ediel/flows/shared',()=>({queuePreparedEdielMessage:io.queue}))
vi.mock('@/lib/ediel/recovery/meteringMethodContext',()=>({loadRecoveryMeteringMethodContext:io.methodSource,assertRecoveryMeteringMethodRoute:io.methodRoute}))
vi.mock('@/lib/ediel/production/customerMasterdataSource',async importOriginal=>({...await importOriginal<typeof import('@/lib/ediel/production/customerMasterdataSource')>(),prepareRecoveryCustomerMasterdataContext:io.customerSource}))
vi.mock('@/lib/ediel/production/contractInvoicee',()=>({readContractInvoicee:io.invoicee}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:()=>({from:()=>({select:()=>({eq:()=>({returns:()=>({maybeSingle:io.switchRead})})})})})}))
const intent:EdielMessageIntent={id:'new-intent',companyId:'tenant',environment:'test',market:'electricity',messageFamily:'PRODAT',messageCode:'Z01',businessProcess:'customer_masterdata',direction:'outbound',senderEdielId:'111',receiverEdielId:'222',applicationReference:'23-DDQ-PRODAT',routeProfileId:'profile',communicationRouteId:'route',customerId:'customer',operationId:'operation',interchangeReference:'NEW',messageReference:'1',payload:{},idempotencyKey:'recovery:operation',validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued'}
const message={...source('wire'),id:'new-message',company_id:'tenant',message_code:'Z01',intent_id:'new-intent',source_operation_id:'operation',outbound_request_id:'chosen-request',original_message_id:'original',direction:'outbound' as const,status:'draft' as const}
const scope={companyId:'tenant',operationId:'operation',actorUserId:'actor'}
// The existing source parser/opaque context and fact consumer are real. Only
// native preparation, tenant contract read and shared finalization are ports.
async function currentCustomer(rawPayload:string) {
 const previous=io.rpc.getMockImplementation()
 io.rpc.mockResolvedValueOnce({data:{status:'authorized',companyId:'tenant',customerId:'customer',environment:'test',asOf:'2026-10-04T12:00:00Z',sourceKind:'signed_contract_masterdata',sourceReference:'synthetic signed contract',sourceDigest:'a'.repeat(64),sourceContextId:'11111111-1111-4111-8111-111111111111',customerIdentity:{id:'198001019999',qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:['Kund'],streetParts:['Testgatan 1'],postalCode:'123 45',city:'Teststad',country:'SE'}},error:null})
 const projection=await prepareCustomerMasterdataSource({companyId:'tenant',customerId:'customer',actorUserId:'actor',environment:'test',asOf:'2026-10-04T12:00:00Z'})
 if(previous)io.rpc.mockImplementation(previous)
 return bindCustomerMasterdataValidationContext({kind:'customer_masterdata',companyId:'tenant',customerId:'customer',environment:'test',rawPayload,intentId:'new-intent',routeId:'route',projection})
}
beforeEach(()=>{vi.resetAllMocks();io.intent.mockResolvedValue(intent);io.validate.mockReturnValue({ok:true});io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_reserve_prodat_recovery_origin_v1'?{status:'reserved',intentId:'new-intent',outboundRequestId:'chosen-request',messageId:'new-message'}:null,error:null}));io.queue.mockResolvedValue(undefined);io.lifecycle.mockResolvedValue(undefined);io.finalize.mockResolvedValue(message);io.route.mockResolvedValue({route:{id:'route'}})})
describe('correction intent/private origin gateway',()=>{
 it('uses the first private chosen request and exact new intent identity in shared finalization',async()=>{
  const routeContext=await resolveCanonicalOutboundContext({companyId:'tenant',environment:'test',requestType:'customer_masterdata'})
  const draft:CreateEdielMessageInput={actorUserId:scope.actorUserId,companyId:scope.companyId,direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z01',rawPayload:'wire',customerId:'customer',environment:'test'}
  const result=await finalizeRecoveryDraft({...scope,intent,params:{actorUserId:'actor',requestType:'customer_masterdata',routeContext,outboundRequestId:'racing-request',draft,duplicateCheck:{messageFamily:'PRODAT',messageCode:'Z01'}}})
  expect(result.id).toBe('new-message');expect(io.finalize.mock.calls[0][0]).toMatchObject({outboundRequestId:'chosen-request',draft:{actorUserId:scope.actorUserId,messageStandard:'edifact',intentId:'new-intent',outboundRequestId:'chosen-request'},duplicateCheck:{sourceId:'new-intent'}})
 })
 it('never queues a foreign dedupe/private binding',async()=>{
  io.rpc.mockResolvedValue({data:{status:'reserved',intentId:'new-intent',outboundRequestId:'chosen-request',messageId:'old-other-message'},error:null})
  await expect(queueRecoveryDraft({...scope,message})).rejects.toThrow('final_message_unbound');expect(io.queue).not.toHaveBeenCalled();expect(io.lifecycle).not.toHaveBeenCalled()
 })
 it('rechecks immutable recovery authority before lifecycle/outbox writes',async()=>{
  io.rpc.mockImplementation(async(name:string)=>name==='ediel_require_prodat_recovery_current_v1'?{data:null,error:{message:'held_current_source'}}:{data:{status:'reserved',intentId:'new-intent',outboundRequestId:'chosen-request',messageId:'new-message'},error:null})
  await expect(queueRecoveryDraft({...scope,message})).rejects.toEqual({message:'held_current_source'});expect(io.queue).not.toHaveBeenCalled();expect(io.lifecycle).not.toHaveBeenCalled()
 })
 it('queues only exact own validated intent and keeps its lifecycle',async()=>{
  await queueRecoveryDraft({...scope,message});expect(io.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({messageId:'new-message',intentId:'new-intent',outboundRequestId:'chosen-request'}));expect(io.lifecycle).toHaveBeenLastCalledWith('new-intent',{outboxStatus:'queued',actorUserId:'actor'})
  io.intent.mockResolvedValue({...intent,operationId:'other-operation'});io.queue.mockClear()
  await expect(queueRecoveryDraft({...scope,message})).rejects.toThrow('current_intent_required');expect(io.queue).not.toHaveBeenCalled()
 })
 it('binds the corrected switch operative source before queue and holds on native rejection',async()=>{
  io.intent.mockResolvedValue({...intent,messageCode:'Z03',businessProcess:'supplier_switch',supplierSwitchRequestId:'switch'})
  const corrected={...message,message_code:'Z03',switch_request_id:'switch'}
  io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_reserve_prodat_recovery_origin_v1'?{status:'reserved',intentId:'new-intent',outboundRequestId:'chosen-request',messageId:'new-message'}:name==='ediel_bind_switch_correction_v1'?{status:'bound',messageId:'new-message'}:null,error:null}))
  await queueRecoveryDraft({...scope,message:corrected})
  const binding=io.rpc.mock.calls.findIndex(([name])=>name==='ediel_bind_switch_correction_v1')
  expect(binding).toBeGreaterThan(-1);expect(io.rpc.mock.invocationCallOrder[binding]).toBeLessThan(io.queue.mock.invocationCallOrder[0])
  io.queue.mockClear();io.rpc.mockImplementation(async(name:string)=>name==='ediel_bind_switch_correction_v1'?{data:null,error:{message:'qualified_source_changed'}}:{data:{status:'reserved',intentId:'new-intent',outboundRequestId:'chosen-request',messageId:'new-message'},error:null})
  await expect(queueRecoveryDraft({...scope,message:corrected})).rejects.toEqual({message:'qualified_source_changed'});expect(io.queue).not.toHaveBeenCalled()
 })
 it('replaces caller protected UD selectors with fresh native context after private reservation',async()=>{
  const routeContext=await resolveCanonicalOutboundContext({companyId:'tenant',environment:'test',requestType:'customer_masterdata'})
  const raw="UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z01+CORRECTION+9+AB'LIN+1++735123456789012345:Z01::9'NAD+UD+198001019999:SE2:260++Kund+Testgatan 1+Teststad++123 45+SE'UNT+5+1'"
  const fresh=await currentCustomer(raw);io.customerSource.mockResolvedValue(fresh)
  const draft:CreateEdielMessageInput={actorUserId:'actor',companyId:'tenant',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z01',rawPayload:raw,customerId:'customer',environment:'test',parsedPayload:{customerMasterdataSourceContextId:'old-caller-context'}}
  await finalizeRecoveryDraft({...scope,intent,params:{actorUserId:'actor',requestType:'customer_masterdata',routeContext,outboundRequestId:'racing-request',draft,duplicateCheck:{messageFamily:'PRODAT',messageCode:'Z01'}}})
  expect(io.customerSource).toHaveBeenCalledExactlyOnceWith({companyId:'tenant',operationId:'operation',actorUserId:'actor',intentId:'new-intent',routeId:'route',customerId:'customer',environment:'test',rawPayload:raw})
  const reservation=io.rpc.mock.calls.findIndex(([name])=>name==='ediel_reserve_prodat_recovery_origin_v1')
  expect(io.rpc.mock.invocationCallOrder[reservation]).toBeLessThan(io.customerSource.mock.invocationCallOrder[0]);expect(io.customerSource.mock.invocationCallOrder[0]).toBeLessThan(io.finalize.mock.invocationCallOrder[0])
  expect(io.finalize.mock.calls[0][0]).toMatchObject({customerMasterdataContext:fresh,draft:{parsedPayload:{customerMasterdataSourceContextId:fresh.projection.sourceContextId}}})
  const sent=io.finalize.mock.calls[0][0].draft,wire=tokenizeEdifact(raw)
  expect(readProdatRegisterEvidence({code:'Z01',rawSegments:wire.segments.map(s=>s.raw),una:wire.una,parsedPayload:sent.parsedPayload,companyId:'tenant',customerMasterdataContext:fresh})?.endUserAddressObjects).toEqual([{meteringPointId:'735123456789012345',identityAgency:'9',endUser:fresh.projection.customerIdentity,availability:'available',addressLines:['Testgatan 1'],source:{kind:'customer_masterdata',companyId:'tenant',customerId:'customer',reference:fresh.projection.sourceReference,sourceContextId:fresh.projection.sourceContextId,sourceDigest:fresh.projection.sourceDigest,asOf:fresh.projection.asOf}}])
 })
 it('publishes fresh address and independently read contract invoicee facts for corrected Z03',async()=>{
  const raw="UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z03+CORRECTION+9+AB'LIN+1++735123456789012345:Z01::9'NAD+UD+198001019999:SE2:260++Kund+Testgatan 1+Teststad++123 45+SE'UNT+5+1'"
  const fresh=await currentCustomer(raw);io.customerSource.mockResolvedValue(fresh)
  io.switchRead.mockResolvedValue({data:{id:'switch',company_id:'tenant',customer_id:'customer',customer_contract_id:'contract',contract_id:'contract'},error:null})
  const address={lines:['Testgatan 1','',''],postalCode:'123 45',city:'Teststad',country:'SE',representation:{convention:'synthetic contract source',reference:'contract',mode:1}}
  const fact={meteringPointId:'735123456789012345',identityAgency:'9',endUser:{identity:fresh.projection.customerIdentity,address},invoicee:{identity:fresh.projection.customerIdentity,nameLines:['Kund'],address,availability:'available'},event:{state:'none',reference:'contract'},source:{kind:'caller_selection',companyId:'tenant',reference:'contract'}}
  io.invoicee.mockResolvedValue({fact,invoicee:null})
  const routeContext=await resolveCanonicalOutboundContext({companyId:'tenant',environment:'test',requestType:'supplier_switch'})
  const draft:CreateEdielMessageInput={actorUserId:'actor',companyId:'tenant',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z03',rawPayload:raw,customerId:'customer',switchRequestId:'switch',environment:'test',parsedPayload:{customerMasterdataSourceContextId:'old-caller-context',prodatEngine:{registerEvidence:{version:1,code:'Z03',bodyBinding:'foreign original',facts:{endUserAddressObjects:[{source:{sourceContextId:'stale'}}]}}}}}
  await finalizeRecoveryDraft({...scope,intent:{...intent,messageCode:'Z03',supplierSwitchRequestId:'switch'},params:{actorUserId:'actor',requestType:'supplier_switch',routeContext,outboundRequestId:'request',draft,duplicateCheck:{messageFamily:'PRODAT',messageCode:'Z03'}}})
  expect(io.invoicee).toHaveBeenCalledExactlyOnceWith({companyId:'tenant',customerId:'customer',contractId:'contract',meteringPointId:'735123456789012345',identityAgency:'9',endUser:{identity:fresh.projection.customerIdentity,...fresh.projection.endUserMasterdata}})
  const sent=io.finalize.mock.calls[0][0].draft,wire=tokenizeEdifact(raw)
  const facts=readProdatRegisterEvidence({code:'Z03',rawSegments:wire.segments.map(s=>s.raw),una:wire.una,parsedPayload:sent.parsedPayload,companyId:'tenant',customerMasterdataContext:fresh})
  expect(facts?.endUserAddressObjects?.[0].source.sourceContextId).toBe(fresh.projection.sourceContextId)
  expect(facts?.invoiceeObjects).toEqual([fact]);expect(sent.rawPayload).toBe(raw)
  expect(io.customerSource.mock.invocationCallOrder[0]).toBeLessThan(io.invoicee.mock.invocationCallOrder[0]);expect(io.invoicee.mock.invocationCallOrder[0]).toBeLessThan(io.finalize.mock.invocationCallOrder[0])
 })
 it.each([
  {company_id:'foreign'},
  {customer_id:'foreign'},
  {customer_contract_id:'other-contract'},
  {customer_contract_id:null,contract_id:null},
 ])('holds a foreign, ambiguous or absent correction invoicee contract %j',async mismatch=>{
  const raw="UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z03+CORRECTION+9+AB'LIN+1++735123456789012345:Z01::9'NAD+UD+198001019999:SE2:260++Kund+Testgatan 1+Teststad++123 45+SE'UNT+5+1'"
  io.customerSource.mockResolvedValue(await currentCustomer(raw))
  io.switchRead.mockResolvedValue({data:{id:'switch',company_id:'tenant',customer_id:'customer',customer_contract_id:'contract',contract_id:'contract',...mismatch},error:null})
  const routeContext=await resolveCanonicalOutboundContext({companyId:'tenant',environment:'test',requestType:'supplier_switch'})
  await expect(finalizeRecoveryDraft({...scope,intent:{...intent,messageCode:'Z03',supplierSwitchRequestId:'switch'},params:{actorUserId:'actor',requestType:'supplier_switch',routeContext,outboundRequestId:'request',duplicateCheck:{messageFamily:'PRODAT',messageCode:'Z03'},draft:{actorUserId:'actor',companyId:'tenant',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z03',rawPayload:raw,customerId:'customer',switchRequestId:'switch',environment:'test'}}})).rejects.toThrow('prodat_recovery_invoicee_contract_required')
  expect(io.invoicee).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
 it('holds fresh preparation rejection before shared draft mutation',async()=>{
  const routeContext=await resolveCanonicalOutboundContext({companyId:'tenant',environment:'test',requestType:'customer_masterdata'});io.customerSource.mockRejectedValue(Error('current_policy_revoked'))
  await expect(finalizeRecoveryDraft({...scope,intent,params:{actorUserId:'actor',requestType:'customer_masterdata',routeContext,outboundRequestId:'request',duplicateCheck:{messageFamily:'PRODAT',messageCode:'Z01'},draft:{actorUserId:'actor',companyId:'tenant',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z01',rawPayload:'raw',customerId:'customer',environment:'test'}}})).rejects.toThrow('current_policy_revoked');expect(io.finalize).not.toHaveBeenCalled()
 })
 it('qualifies genuine F/G current source and legal route before corrected Z09 shared finalization',async()=>{
  const routeContext=await resolveCanonicalOutboundContext({companyId:'tenant',environment:'test',requestType:'customer_masterdata'});const basis={eventId:'genuine-current-event'};io.methodSource.mockResolvedValue(basis)
  const call=()=>finalizeRecoveryDraft({...scope,intent:{...intent,messageCode:'Z09'},params:{actorUserId:'actor',requestType:'customer_masterdata',routeContext,outboundRequestId:'request',duplicateCheck:{messageFamily:'PRODAT',messageCode:'Z09'},draft:{actorUserId:'actor',companyId:'tenant',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z09',rawPayload:'raw'}}})
  await call();expect(io.methodSource).toHaveBeenCalledExactlyOnceWith({...scope,rawPayload:'raw'});expect(io.methodRoute).toHaveBeenCalledWith(basis,routeContext)
  expect(io.methodSource.mock.invocationCallOrder[0]).toBeLessThan(io.finalize.mock.invocationCallOrder[0]);io.finalize.mockClear();io.methodSource.mockRejectedValue(Error('current_metering_source_retired'));await expect(call()).rejects.toThrow('current_metering_source_retired');expect(io.finalize).not.toHaveBeenCalled()
 })

})
