import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),finalize:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/core/kernel',()=>({finalizeCanonicalOutboundDraft:io.finalize,resolveCanonicalOutboundContext:vi.fn()}))
vi.mock('@/lib/cis/db',()=>({cancelSupplierSwitchOutboundAttemptsForReplacement:vi.fn(),createOutboundRequest:vi.fn(),findOpenOutboundBySource:vi.fn(),repairOutboundRequestCommunicationRoute:vi.fn(),updateOutboundRequestStatus:vi.fn()}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:vi.fn()}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:vi.fn()}))
import {prepareCustomerMasterdataSource,isQualifiedCustomerMasterdataValidationContext} from '@/lib/ediel/production/customerMasterdataSource'
import {rememberCustomerMasterdataDraft,bindCustomerMasterdataDraftContext} from '@/lib/ediel/prodat/customerMasterdataDraft'
import {finalizeOutboundDraft} from '@/lib/ediel/flows/shared'
import type {CreateEdielMessageInput} from '@/lib/ediel/types'
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const company=uuid(1),customer=uuid(2),route=uuid(3),intent=uuid(4)
const projectionInput={companyId:company,customerId:customer,actorUserId:uuid(5),environment:'test' as const,asOf:'2026-10-01T00:00:00Z'}
async function source(){io.rpc.mockResolvedValueOnce({data:{status:'authorized',...projectionInput,sourceKind:'registered_customer_address',sourceReference:'REGISTERED',sourceDigest:'a'.repeat(64),sourceContextId:uuid(6),customerIdentity:{id:'199001011234',qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:[' Actual Name '],streetParts:[' Street '],postalCode:'12345',city:' City ',country:'SE'}},error:null});return prepareCustomerMasterdataSource(projectionInput)}
const draft=():CreateEdielMessageInput=>({actorUserId:uuid(5),companyId:company,customerId:customer,direction:'outbound',environment:'test',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z01',rawPayload:'ACTUAL RAW',communicationRouteId:route})
beforeEach(()=>{vi.clearAllMocks();io.finalize.mockResolvedValue({id:uuid(8)})})
it('binds only the exact source producer result after actual intent and route selection',async()=>{
 const result=rememberCustomerMasterdataDraft(draft(),await source())
 expect(()=>bindCustomerMasterdataDraftContext({draft:result,companyId:company,environment:'test',routeId:route})).toThrow('customer_masterdata_draft_binding_changed')
 result.intentId=intent
 const context=bindCustomerMasterdataDraftContext({draft:result,companyId:company,environment:'test',routeId:route})!
 expect(isQualifiedCustomerMasterdataValidationContext(context)).toBe(true)
 expect(context).toMatchObject({rawPayload:'ACTUAL RAW',intentId:intent,routeId:route,customerId:customer})
 expect(bindCustomerMasterdataDraftContext({draft:JSON.parse(JSON.stringify(result)),companyId:company,environment:'test',routeId:route})).toBeUndefined()
 for(const changed of [{companyId:uuid(9)},{environment:'production' as const},{routeId:uuid(9)}])expect(()=>bindCustomerMasterdataDraftContext({draft:result,companyId:company,environment:'test',routeId:route,...changed})).toThrow('customer_masterdata_draft_binding_changed')
 result.rawPayload='CHANGED';expect(()=>bindCustomerMasterdataDraftContext({draft:result,companyId:company,environment:'test',routeId:route})).toThrow('customer_masterdata_draft_binding_changed')
})
it('forwards the actual opaque source through the shared canonical finalizer without JSON authority',async()=>{
 const result=rememberCustomerMasterdataDraft(draft(),await source());result.intentId=intent
 const routeContext={companyId:company,environment:'test',route:{id:route}}
 const params={actorUserId:uuid(5),requestType:'customer_masterdata' as const,routeContext:routeContext as Parameters<typeof finalizeOutboundDraft>[0]['routeContext'],draft:result,duplicateCheck:{messageFamily:'PRODAT',messageCode:'Z01'}}
 await finalizeOutboundDraft(params)
 const call=io.finalize.mock.calls[0][0]
 expect(isQualifiedCustomerMasterdataValidationContext(call.customerMasterdataContext)).toBe(true)
 expect(call.customerMasterdataContext.intentId).toBe(intent)
 expect(call.customerMasterdataContext.routeId).toBe(route)
 expect(result.parsedPayload).toBeUndefined()
 await finalizeOutboundDraft({...params,draft:{...result}})
 expect(io.finalize.mock.calls[1][0].customerMasterdataContext).toBeUndefined()
})
