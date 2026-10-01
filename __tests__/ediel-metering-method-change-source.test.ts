import {expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn(async()=> '26.A')}))
import {buildMeteringMethodChangeDraft} from '@/lib/ediel/intent/renderers/meteringMethodChange'
import type {MeteringMethodChangeBasis} from '@/lib/ediel/production/meteringMethodChangeSource'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function fixture(){
 const basis:MeteringMethodChangeBasis={status:'authorized',companyId:id(1),environment:'test',eventId:id(2),supplyPeriodId:id(3),supplyStateVersion:4,supplySourceMessageId:id(4),customerId:id(5),meteringPointId:id(6),legalActorId:id(7),legalSenderId:'12345',legalReceiverId:'54321',siteId:id(8),subtype:'F',reason:'E64',method:'Z04',contractId:id(9),contractRevision:'SYNTHETIC-REVISION',pointId:'735123456789012345',identityAgency:'9',gridArea:'TES',effectiveAt:'2027-01-01T00:00:00+01:00',sourceReference:'SYNTHETIC MARKET DECISION',sourceVersion:'fixture',sourceDigest:'b'.repeat(64)}
 const intent:EdielMessageIntent={id:id(10),companyId:id(1),environment:'test',market:'electricity',messageFamily:'PRODAT',messageCode:'Z09',businessProcess:'customer_masterdata',direction:'outbound',senderEdielId:'99111',receiverEdielId:'54321',applicationReference:'23-DDQ-PRODAT',routeProfileId:id(11),communicationRouteId:id(12),customerId:id(5),meteringPointId:basis.pointId,operationId:id(2),interchangeReference:'SYNTHFG001',messageReference:'1',transactionReference:'SYNTHETIC-METHOD-LI',idempotencyKey:'SYNTHETIC-BRP-EVENT',payload:{actorRole:'supplier',meteringMethodChangeEventId:id(2)},validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued'}
 const route={companyId:id(1),environment:'test',actor:{tenantIdentity:{legalActorId:id(7)},legalActorEdielId:'12345',marketRoles:['electricity_supplier']},senderEdielId:'99111',receiverEdielId:'54321',senderSubAddress:null,receiverSubAddress:null,receiverMessageSubAddress:null,applicationReference:'23-DDQ-PRODAT',route:{id:id(12)},routeRuntime:{route_profile_id:id(11)},mailbox:null,receiverEmail:'dso@example.invalid'} as Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
 return{basis,intent,routeContext:route,actorUserId:id(20),outboundRequestId:id(21)}
}
it.each([{subtype:'F' as const,reason:'E64',method:'Z04'},{subtype:'G' as const,reason:'E32',method:'Z03'}])('renders own agreed $subtype method and precise validity minute without old/current masterdata',async tuple=>{
 const f=fixture();Object.assign(f.basis,tuple)
 const {draft}=await buildMeteringMethodChangeDraft(f)
 expect(draft.rawPayload).toContain('BGM+Z09+')
 expect(draft.rawPayload).toContain(`CAV+${tuple.reason}`)
 expect(draft.rawPayload).toContain(`CCI++Z04'CAV+${tuple.method}`)
 expect(draft.rawPayload).toContain('DTM+157:202701010000:203')
 expect(draft.rawPayload).toContain('NAD+FR+12345:160:SVK')
 expect(draft.rawPayload).not.toContain('NAD+UD+')
 expect(draft.rawPayload).not.toContain('NAD+IT+')
 expect(draft.rawPayload).not.toContain('DTM+92:')
 expect(draft.rawPayload).not.toContain('DTM+93:')
 expect(draft.sourceOperationId).toBe(f.basis.eventId)
 expect(draft.siteId).toBe(f.basis.siteId)
})
it('does not silently turn an old DSO method into the agreed new method',async()=>{const f=fixture();f.basis.method='Z02';await expect(buildMeteringMethodChangeDraft(f)).rejects.toThrow('canonical_tuple_mismatch')})
it('holds foreign tenant, legal actor, recipient and non-supplier route before rendering',async()=>{
 const f=fixture()
 for(const routeContext of [{...f.routeContext,companyId:id(99)},{...f.routeContext,receiverEdielId:'OTHER'},{...f.routeContext,actor:{...f.routeContext.actor,legalActorEdielId:'OTHER'}},{...f.routeContext,actor:{...f.routeContext.actor,marketRoles:[]}}])await expect(buildMeteringMethodChangeDraft({...f,routeContext})).rejects.toThrow('canonical_legal_route_mismatch')
})

it('retains fixed Ediel UTC+1 effective minute in summer',async()=>{
 const f=fixture();f.basis.effectiveAt='2027-07-01T00:00:00+01:00'
 expect((await buildMeteringMethodChangeDraft(f)).draft.rawPayload).toContain('DTM+157:202707010000:203')
})
