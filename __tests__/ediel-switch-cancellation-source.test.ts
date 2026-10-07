// masterplan: P-14, AT-P-14
import {expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn(async()=> '26.A')}))
import {buildSwitchCancellationDraft} from '@/lib/ediel/intent/renderers/switchCancellation'
import type {SwitchCancellationBasis} from '@/lib/ediel/production/switchCancellationSource'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function fixture(){
 const basis:SwitchCancellationBasis={status:'authorized',companyId:id(1),environment:'test',switchRequestId:id(2),originalMessageId:id(3),originalHash:'a'.repeat(64),operationId:id(4),intentId:id(10),outboundRequestId:id(21),messageId:null,customerId:id(5),siteId:id(22),meteringPointId:id(6),legalActorId:id(7),legalSenderId:'12345',legalReceiverId:'54321',pointId:'735123456789012345',identityAgency:'9',gridArea:'TES',li:'ORIGINAL:EXACT+LI',startAt:'2027-01-01T00:00:00+01:00',originalSubtype:'L',deadline:'2026-12-28',customerIdentity:'5566778899',customerQualifier:'SE1',customerName:'SYNTHETIC CUSTOMER',sourceObject:{},requestedMethod:'Z03'}
 const intent:EdielMessageIntent={id:id(10),companyId:id(1),environment:'test',market:'electricity',messageFamily:'PRODAT',messageCode:'Z03',businessProcess:'supplier_switch',direction:'outbound',senderEdielId:'99111',receiverEdielId:'54321',applicationReference:'23-DDQ-PRODAT',routeProfileId:id(11),communicationRouteId:id(12),customerId:id(5),meteringPointId:basis.pointId,operationId:id(4),interchangeReference:'SYNTHETIC-BRP-UNB',messageReference:'1',transactionReference:basis.li,idempotencyKey:'SYNTHETIC-BRP-EVENT',payload:{actorRole:'supplier',transactionSubtype:'C'},validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued'}
 const route={companyId:id(1),environment:'test',actor:{tenantIdentity:{legalActorId:id(7)},legalActorEdielId:'12345',marketRoles:['electricity_supplier']},senderEdielId:'99111',receiverEdielId:'54321',senderSubAddress:null,receiverSubAddress:null,receiverMessageSubAddress:null,applicationReference:'23-DDQ-PRODAT',route:{id:id(12)},routeRuntime:{route_profile_id:id(11)},mailbox:null,receiverEmail:'dso@example.invalid'} as Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
 return{basis,intent,routeContext:route,actorUserId:id(20),outboundRequestId:id(21)}
}
it('renders a separate C original with exact old LI/customer/point/start, preserving the original pointer',async()=>{
 const f=fixture(),{draft}=await buildSwitchCancellationDraft(f)
 expect(draft.rawPayload).toContain('BGM+Z03+')
 expect(draft.rawPayload).toContain('CAV+Z24')
 expect(draft.rawPayload).toContain('RFF+LI:ORIGINAL?:EXACT?+LI')
 expect(draft.rawPayload).toContain('NAD+UD+5566778899:SE1:260')
 expect(draft.rawPayload).toContain('LIN+1++735123456789012345:::9')
 expect(draft.rawPayload).toContain('DTM+92:202701010000:203')
 expect(draft.originalMessageId).toBe(f.basis.originalMessageId)
 expect(draft.sourceOperationId).toBe(f.intent.operationId)
 expect(draft.switchRequestId).toBe(f.basis.switchRequestId)
 expect(draft.status).toBe('draft')
})
it('holds a foreign legal or tenant route before producing cancellation bytes',async()=>{
 const f=fixture()
 for(const routeContext of [{...f.routeContext,companyId:id(99)},{...f.routeContext,receiverEdielId:'OTHER'},{...f.routeContext,actor:{...f.routeContext.actor,legalActorEdielId:'OTHER'}},{...f.routeContext,actor:{...f.routeContext.actor,marketRoles:[]}}])await expect(buildSwitchCancellationDraft({...f,routeContext})).rejects.toThrow('canonical_legal_route_mismatch')
})
it('holds detached cancellation identity and retains fixed UTC+1 source start in summer',async()=>{
 const f=fixture()
 await expect(buildSwitchCancellationDraft({...f,intent:{...f.intent,transactionReference:'OTHER'}})).rejects.toThrow('canonical_version_reference_required')
 f.basis.startAt='2027-07-01T00:00:00+01:00'
 expect((await buildSwitchCancellationDraft(f)).draft.rawPayload).toContain('DTM+92:202707010000:203')
})

it.each([['L','Z03'],['LK','Z04']] as const)('preserves the qualified original217 in physical %s cancellation bytes',async(subtype,method)=>{
 const f=fixture();f.basis.originalSubtype=subtype;f.basis.requestedMethod=method
 const {draft}=await buildSwitchCancellationDraft(f)
 expect(draft.rawPayload).toContain("CCI++Z04'CAV+"+method+"'")
 expect(draft.rawPayload?.match(/CCI\+\+Z04'/g)).toHaveLength(1)
 expect(draft.originalMessageId).toBe(f.basis.originalMessageId)
 expect(f.basis.requestedMethod).toBe(method)
})
