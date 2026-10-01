import {expect,it,vi} from 'vitest'
// Pure source-bound renderer projection. The declared route/version fixtures
// are neither native issuer authority nor an approved service assignment.
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn(async()=> '26.A')}))
import {buildServicePermissionDraft} from '@/lib/ediel/intent/renderers/servicePermission'
import {resolveApplicationReferenceForProcess} from '@/lib/ediel/intent/applicationReferencePolicy'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import type {ServicePermissionOriginBasis} from '@/lib/ediel/services/permissionOrigin'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
const uid=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const appref=resolveApplicationReferenceForProcess('metering_permission')
function fixture(){
 const basis:ServicePermissionOriginBasis={status:'authorized',companyId:uid(1),assignmentId:uid(2),assignmentVersion:1,scopeBasisVersion:1,permissionId:uid(3),permissionStateVersion:0,code:'Z13',environment:'test',providerActorId:uid(4),dsoActorId:uid(5),legalSenderId:'21660',legalReceiverId:'54321',customerId:uid(6),customer:{org_number:'SYNTHETIC-CUSTOMER',company_name:'Synthetic Customer',country:'SE'},mode:'V',requestedMethod:'Z04',agreementReference:'SYNTHETIC-ACTUAL-ARCHIVED-AGREEMENT',purposeCode:'B72',frequency:'D',reportingTerm:'bounded',customerClassification:'nonprivate',terminationReason:null,evidenceId:uid(7),evidenceSha256:'a'.repeat(64),evidenceVersion:'SYNTHETIC-FIXTURE',li:null,objects:[{point:null,permissionId:null,product:'8716867000030',gridArea:'TES',reportStart:'2026-09-01T00:00:00+01:00',reportEnd:'2027-01-01T00:00:00+01:00'}]}
 const intent:EdielMessageIntent={market:'electricity',messageFamily:'PRODAT',businessProcess:'metering_permission',direction:'outbound',senderEdielId:'99111',receiverEdielId:'54321',idempotencyKey:'SYNTHETIC-SOURCE-INTENT',validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued',id:uid(8),routeProfileId:uid(9),companyId:uid(1),environment:'test',messageCode:'Z13',transactionReference:'REAL-PERSISTED-LI',interchangeReference:'REAL-PERSISTED-UNB',messageReference:'1',applicationReference:appref,payload:{externalReference:'REAL-PERSISTED-BGM',authorizationReference:'REAL-PERSISTED-ANJ'}}
 const route={companyId:uid(1),environment:'test',actor:{tenantIdentity:{legalActorId:uid(4)},legalActorEdielId:'21660'},senderEdielId:'99111',receiverEdielId:'54321',senderSubAddress:null,receiverSubAddress:null,receiverMessageSubAddress:null,applicationReference:appref,route:{id:uid(10)},routeRuntime:{route_profile_id:uid(9)},mailbox:null,receiverEmail:'dso@example.invalid'} as Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
 return{basis,intent,routeContext:route,actorUserId:uid(11),outboundRequestId:uid(12)}
}

it('renders the actual native customer country while preserving Z13 field restrictions',async()=>{
 const f=fixture();f.basis.customer={org_number:'SYNTHETIC-CUSTOMER',company_name:'Synthetic Customer',billing_country:'SE',billing_street:'Synthetic registered street 1',billing_postal_code:'12345',billing_city:'Synthetic registered city'}
 const draft=await buildServicePermissionDraft(f),wire=tokenizeEdifact(draft.rawPayload!),own=wire.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='UD')!
 // The actual 26.A Z13 field matrix permits country and customer identity,
 // but prohibits postal/address fields. Native billing facts must not bypass it.
 expect(own).toBeDefined();expect(segmentComposite(own,4,wire.una)[0]).toBe('Synthetic Customer');expect(segmentComposite(own,5,wire.una)[0]).toBe('');expect(segmentComposite(own,6,wire.una)[0]).toBe('');expect(segmentComposite(own,8,wire.una)[0]).toBe('');expect(segmentComposite(own,9,wire.una)[0]).toBe('SE')
 expect(draft.rawPayload).toContain('23-DGI-PRODAT');expect(draft.rawPayload).not.toContain(f.basis.companyId)
})
it('preserves an explicit actual legacy source country and never replaces a missing country with a manufactured Swedish default',async()=>{
 const f=fixture();f.basis.customer={org_number:'SYNTHETIC-CUSTOMER',company_name:'Synthetic Customer',country:'DK',billing_country:'SE'}
 await expect(buildServicePermissionDraft(f)).rejects.toThrow('actual_customer_identity_required')
 delete f.basis.customer.country;delete f.basis.customer.billing_country
 await expect(buildServicePermissionDraft(f)).rejects.toThrow('actual_customer_identity_required')
})
