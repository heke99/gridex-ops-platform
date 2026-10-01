import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn(async()=> '26.A')}))
import { buildServicePermissionDraft } from '@/lib/ediel/intent/renderers/servicePermission'
import { buildServiceReportingContext } from '@/lib/ediel/services/reporting'
import { assertReportingAuthority } from '@/lib/ediel/prodat/prodatReportingPermissionAuthority'
import { resolveApplicationReferenceForProcess } from '@/lib/ediel/intent/applicationReferencePolicy'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { ServicePermissionOriginBasis } from '@/lib/ediel/services/permissionOrigin'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
const uid=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const appref=resolveApplicationReferenceForProcess('metering_permission')
function fixture(){
 const basis:ServicePermissionOriginBasis={status:'authorized',companyId:uid(1),assignmentId:uid(2),assignmentVersion:1,scopeBasisVersion:1,permissionId:uid(3),permissionStateVersion:0,code:'Z13',environment:'test',providerActorId:uid(4),dsoActorId:uid(5),legalSenderId:'21660',legalReceiverId:'54321',customerId:uid(6),customer:{org_number:'SYNTHETIC-CUSTOMER',company_name:'Synthetic Customer',country:'SE'},mode:'V',purposeCode:'B72',frequency:'D',reportingTerm:'bounded',customerClassification:'nonprivate',terminationReason:null,evidenceId:uid(7),evidenceSha256:'a'.repeat(64),evidenceVersion:'SYNTHETIC-FIXTURE',li:null,objects:[{point:null,permissionId:null,product:'8716867000030',gridArea:'TES',reportStart:'2026-09-01T00:00:00+01:00',reportEnd:'2027-01-01T00:00:00+01:00'}]}
 const intent:EdielMessageIntent={market:'electricity',messageFamily:'PRODAT',businessProcess:'metering_permission',direction:'outbound',senderEdielId:'99111',receiverEdielId:'54321',idempotencyKey:'SYNTHETIC-SOURCE-INTENT',validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued',id:uid(8),routeProfileId:uid(9),companyId:uid(1),environment:'test',messageCode:'Z13',transactionReference:'REAL-PERSISTED-LI',interchangeReference:'REAL-PERSISTED-UNB',messageReference:'1',applicationReference:appref,payload:{externalReference:'REAL-PERSISTED-BGM',authorizationReference:'REAL-PERSISTED-ANJ'}}
 const route={companyId:uid(1),environment:'test',actor:{tenantIdentity:{legalActorId:uid(4)},legalActorEdielId:'21660'},senderEdielId:'99111',receiverEdielId:'54321',senderSubAddress:null,receiverSubAddress:null,receiverMessageSubAddress:null,applicationReference:appref,route:{id:uid(10)},routeRuntime:{route_profile_id:uid(9)},mailbox:null,receiverEmail:'dso@example.invalid'} as Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
 return{basis,intent,routeContext:route,actorUserId:uid(11),outboundRequestId:uid(12)}
}
describe('dedicated source service permission pipeline (synthetic facts, no activation)',()=>{
 it('uses canonical Z13 customer-bound body with exact source legal basis and persisted references',async()=>{
  const f=fixture(),draft=await buildServicePermissionDraft(f)
  expect(draft.rawPayload).toContain('UNB+UNOC:3+99111:ZZ+54321:ZZ')
  expect(draft.rawPayload).toContain('NAD+FR+21660:160:SVK')
  expect(draft.rawPayload).toContain('LIN+1\'')
  expect(draft.rawPayload).toContain('CAV+B72')
  expect(draft.rawPayload).toContain('RFF+LI:REAL-PERSISTED-LI')
  expect(draft.rawPayload).toContain('RFF+ANJ:REAL-PERSISTED-ANJ')
  expect(draft.rawPayload).toContain('DTM+91:202701010000:203')
  expect(draft.rawPayload).not.toContain(uid(1))
  const expected=buildServiceReportingContext(f.basis,f.intent,f.routeContext,f.actorUserId)
  const reporting=(draft.parsedPayload?.prodatEngine as {registerEvidence:{facts:{reportingPermission:unknown}}}).registerEvidence.facts.reportingPermission
  const row={company_id:f.basis.companyId,environment:'test',direction:'outbound',message_code:'Z13',sender_ediel_id:'99111',receiver_ediel_id:'54321',sender_sub_address:null,receiver_sub_address:null,application_reference:appref,transport_type:'smtp',mailbox:null,receiver_email:'dso@example.invalid',communication_route_id:uid(10),route_profile_id:uid(9)} as const
  const wire=tokenizeEdifact(draft.rawPayload!),rawSegments=wire.segments.map(s=>s.raw)
  expect(()=>assertReportingAuthority({code:'Z13',rawSegments,una:wire.una,facts:{reportingPermission:reporting as never},row,expected})).not.toThrow()
  expect(()=>assertReportingAuthority({code:'Z13',rawSegments,una:wire.una,facts:{reportingPermission:reporting as never},row:{...row,company_id:uid(99)},expected})).toThrow('SCOPE_MISMATCH')
 })
 it('does not infer indefinite term or customer classification from local nulls/identity',()=>{
  const f=fixture()
  expect(()=>buildServiceReportingContext({...f.basis,reportingTerm:null},f.intent,f.routeContext,f.actorUserId)).toThrow('source_unqualified')
  expect(()=>buildServiceReportingContext({...f.basis,customerClassification:null},f.intent,f.routeContext,f.actorUserId)).toThrow('source_unqualified')
  expect(()=>buildServiceReportingContext({...f.basis,reportingTerm:'indefinite'},f.intent,f.routeContext,f.actorUserId)).toThrow('term_unqualified')
 })
 it('holds wrong tenant/legal route and internal-only customer identifiers before wire construction',async()=>{
  const f=fixture()
  await expect(buildServicePermissionDraft({...f,routeContext:{...f.routeContext,companyId:uid(99)}})).rejects.toThrow('legal_scope_mismatch')
  await expect(buildServicePermissionDraft({...f,basis:{...f.basis,customer:{customer_number:'LOCAL-ID',company_name:'Synthetic',country:'SE'}}})).rejects.toThrow('actual_customer_identity_required')
 })
})
