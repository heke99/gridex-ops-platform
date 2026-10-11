// masterplan: AT-Z09B-SUPPLIER
// Prohibited: missing required/dependent Z09B fields are never rendered. Each
// source-owned R/D input of the Z09/Z27 (point, agency, grid area, legal
// parties, BRP, effective date, transaction reference) blanked alone refuses
// the draft through the actual renderer before any wire exists.
import {expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn(async()=> '26.A')}))
import {buildBrpChangeDraft} from '@/lib/ediel/intent/renderers/brpChange'
import type {BrpChangeBasis} from '@/lib/ediel/production/brpChangeSource'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function fixture(){
 const basis:BrpChangeBasis={status:'authorized',companyId:id(1),environment:'test',eventId:id(2),supplyPeriodId:id(3),supplyStateVersion:4,supplySourceMessageId:id(4),customerId:id(5),siteId:id(22),meteringPointId:id(6),legalActorId:id(7),legalSenderId:'12345',legalReceiverId:'54321',brpActorId:id(8),brpEdielId:'11111',pointId:'735123456789012345',identityAgency:'9',gridArea:'TES',effectiveAt:'2027-01-01T00:00:00+01:00',registryGroundId:id(9),registryVersion:'SYNTHETIC-REGISTRY',registrySha256:'a'.repeat(64),sourceReference:'SYNTHETIC MARKET DECISION',sourceVersion:'fixture',sourceDigest:'b'.repeat(64)}
 const intent:EdielMessageIntent={id:id(10),companyId:id(1),environment:'test',market:'electricity',messageFamily:'PRODAT',messageCode:'Z09',businessProcess:'customer_masterdata',direction:'outbound',senderEdielId:'99111',receiverEdielId:'54321',applicationReference:'23-DDQ-PRODAT',routeProfileId:id(11),communicationRouteId:id(12),customerId:id(5),meteringPointId:basis.pointId,operationId:id(2),interchangeReference:'SYNTHETIC-BRP-UNB',messageReference:'1',transactionReference:'SYNTHETIC-BRP-LI',idempotencyKey:'SYNTHETIC-BRP-EVENT',payload:{actorRole:'supplier',brpChangeEventId:id(2)},validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued'}
 const route={companyId:id(1),environment:'test',actor:{tenantIdentity:{legalActorId:id(7)},legalActorEdielId:'12345',marketRoles:['electricity_supplier']},senderEdielId:'99111',receiverEdielId:'54321',senderSubAddress:null,receiverSubAddress:null,receiverMessageSubAddress:null,applicationReference:'23-DDQ-PRODAT',route:{id:id(12)},routeRuntime:{route_profile_id:id(11)},mailbox:null,receiverEmail:'dso@example.invalid'} as Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
 return{basis,intent,routeContext:route,actorUserId:id(20),outboundRequestId:id(21)}
}

const blank:[string,(f:ReturnType<typeof fixture>)=>void][]=[
 ['brpEdielId (NAD+Z02)',f=>{f.basis.brpEdielId=''}],
 ['effectiveAt (DTM+157)',f=>{f.basis.effectiveAt=''}],
 ['pointId (LIN)',f=>{f.basis.pointId=''}],
 ['identityAgency (LIN)',f=>{(f.basis as {identityAgency:string}).identityAgency=''}],
 ['gridArea (RFF+Z05)',f=>{f.basis.gridArea=''}],
 ['legalSenderId (NAD+FR)',f=>{f.basis.legalSenderId=''}],
 ['legalReceiverId (NAD+DO)',f=>{f.basis.legalReceiverId=''}],
 ['transactionReference (RFF+LI)',f=>{f.intent.transactionReference=''}],
]
it.each(blank)('AT-Z09B refuses a Z09B with missing %s before rendering',async(_name,mutate)=>{
 const f=fixture();expect((await buildBrpChangeDraft(f)).draft.rawPayload).toContain('CAV+Z27')
 const g=fixture();mutate(g)
 await expect(buildBrpChangeDraft(g)).rejects.toThrow(/brp_change_(required_field_missing|canonical_version_reference_required)|canonical_legal_route_mismatch/)
})
