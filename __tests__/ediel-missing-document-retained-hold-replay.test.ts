// Finite service-call qualification only. Protected SQL and current identity/
// runtime reads are declared ports; no genuine SQL/native/custody approval.
// The real preparer, its private error marker, physical document projection,
// diagnostic projection and technical evidence decoder remain active.
import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({read:vi.fn(),reception:vi.fn(),legal:vi.fn(),tenant:vi.fn(),decision:vi.fn(),rpc:vi.fn(),from:vi.fn(),order:[] as string[]}))
vi.mock('@/lib/ediel/core/ackDraftSource',()=>({readExistingAckBeforeDraft:io.read}))
vi.mock('@/lib/ediel/inbound/receptions',()=>({readInboundReceptionRequest:io.reception}))
vi.mock('@/lib/ediel/tenant/sourceLegalContext',()=>({requireEdielInboundLegalContext:io.legal}))
vi.mock('@/lib/ediel/tenant/resolveInboundTenant',async original=>({...await original<Record<string,unknown>>(),resolveInboundTenantFromIdentifiers:io.tenant}))
vi.mock('@/lib/ediel/core/runtimeDecision',()=>({resolveCanonicalRuntimeDecisionWithRegistry:io.decision}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
import {createHash} from 'node:crypto'
import {readRetainedProdatDocumentHold} from '@/lib/ediel/ack/retainedProdatDocumentHold'
import {prepareSourceAckDraft,isProtectedProdatDocumentReferenceHold} from '@/lib/ediel/ack/prepareSourceAckDraft'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {validateFieldMatrixPayload} from '@/lib/ediel/rulebook/fieldMatrix'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
const actor='10000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000002'
const sourceId='10000000-0000-4000-8000-000000000003',mail='10000000-0000-4000-8000-000000000004',assessment='10000000-0000-4000-8000-000000000005'
const received='2026-10-10T12:00:00Z'
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex')
let source:EdielMessageRow,contrl:EdielMessageRow,first:Record<string,unknown>,basis:Record<string,unknown>
// This port models the caller's already-selected grammar result, not a new
// physical grammar or native proof. The caller still runs its real validator.
const syntax={ok:true,grammarQualification:'qualified'} as ReturnType<typeof validateEdifactSyntax>
function message(document=''){
 const raw_payload=EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',environment:'test',applicationReference:'23-DDQ-PRODAT',interchangeReference:'OWN-I',acknowledgementRequest:true,messages:[{messageReference:'OWN-M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:[`BGM+Z04+${document}+9+AB`,'DTM+137:202610101200:203','DTM+ZZZ:1:805','NAD+FR+12345:160:SVK+++++++SE','NAD+DO+54321:160:SVK+++++++SE','LIN+1++735999999999999999:::9','DTM+92:202610150000:203','CCI++Z13','CAV+Z22','CCI++Z07','CAV+E22','RFF+LI:OWN-LI','RFF+Z05:TES','NAD+UD+5566778899:SE1:260++Synthetic+Street+City++12345+SE']} ]})
 return {id:sourceId,company_id:company,direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z04',environment:'test',raw_payload,inbound_email_message_id:mail,message_received_at:received,parsed_payload:{bgmReference:'untrusted cached document'},validation_report:{receivedSourceValidationEvidence:{assessmentId:'untrusted public id'}}} as unknown as EdielMessageRow
}
beforeEach(()=>{
 vi.clearAllMocks();io.order=[];source=message()
 contrl={id:'10000000-0000-4000-8000-000000000006',company_id:company,environment:'test',direction:'outbound',message_family:'CONTRL',related_message_id:sourceId,ack_outcome:'positive',raw_payload:'declared finite retained CONTRL bytes'} as EdielMessageRow
 first={companyId:company,sourceMessageId:sourceId,inboundEmailMessageId:mail,classification:'first_reception',status:'observed',canonicalPayloadHash:hash(source.raw_payload!),receivedPayloadHash:hash(source.raw_payload!),receivedAt:received,firstOutcomeAvailable:true,firstValidationAssessmentId:assessment}
 basis={kind:'technical_syntax_ack',version:1,companyId:company,environment:'test',sourceMessageId:sourceId,sourceHash:hash(source.raw_payload!),observedAt:received,syntaxAssessmentId:assessment,syntaxDecision:'accepted',transportActorId:actor,transportEdielId:'54321',originalUNB:{sender:['12345','ZZ'],receiver:['54321','ZZ'],interchangeReference:'OWN-I',uciReference:'OWN-I',applicationReference:'23-DDQ-PRODAT',testIndicator:'1'}}
 io.read.mockImplementation(async (p:{ackFamily:string;ackScope:string})=>{io.order.push(`ack:${p.ackFamily}:${p.ackScope}`);return p.ackFamily==='CONTRL'?contrl:null})
 io.rpc.mockImplementation(async(name:string,p:Record<string,unknown>)=>{
  io.order.push('protected-contrl')
  if(name!=='ediel_read_persisted_technical_contrl_basis_v2')throw Error('Unexpected RPC')
  expect(p).toMatchObject({p_company_id:company,p_environment:'test',p_ack_message_id:contrl.id,p_actor_user_id:actor,p_phase:'prepare'})
  return {data:{version:2,executionActorUserId:actor,executionPhase:'prepare',ackMessage:contrl,technicalSyntaxAckEvidence:basis},error:null}
 })
 io.from.mockImplementation(()=>{throw Error('Unexpected public/private DB operation')})
 io.reception.mockImplementation(async()=>{io.order.push('protected-reception');return first})
 io.legal.mockImplementation(async()=>{io.order.push('original-legal');return {companyId:company,direction:'inbound',environment:'test',sourceReceivedAt:received}})
 io.tenant.mockImplementation(async()=>{io.order.push('current-tenant');return {status:'resolved',companyId:company}})
 io.decision.mockImplementation(async()=>{
  io.order.push('current-decision')
  const wire=tokenizeEdifact(source.raw_payload!)
  const findings=validateFieldMatrixPayload({direction:'inbound',mode:'parse',family:'PRODAT',code:'Z04',rawSegments:wire.segments.map(t=>t.raw),una:wire.una,applicationReference:'23-DDQ-PRODAT'},canonicalProdat26AFieldRules('Z04').filter(rule=>rule.fieldNumber==='203'))
  const projected=projectProdatDiagnostics(findings)
  return {syntaxDecision:'accepted',applicationDecision:'rejected',issues:projected.observations,responsePlan:[{family:'APERAK',outcome:'negative',applicationErrors:projected.applicationErrors}]}
 })
})
const run=()=>readRetainedProdatDocumentHold({actorUserId:actor,sourceMessage:source,syntax})
it('retains an already processed real physical203 hold with reads only and unchanged source',async()=>{
 const original=JSON.stringify(source)
 expect(await run()).toBe(true)
 expect(JSON.stringify(source)).toBe(original);expect(io.from).not.toHaveBeenCalled()
 expect(io.order).toEqual(['ack:CONTRL:interchange','protected-contrl','protected-reception','original-legal','current-tenant','ack:APERAK:message','ack:APERAK:object','current-decision'])
})
it('keeps first processing when its protected CONTRL does not exist',async()=>{
 io.read.mockResolvedValue(null);expect(await run()).toBe(false)
 expect(io.rpc).not.toHaveBeenCalled();expect(io.reception).not.toHaveBeenCalled();expect(io.decision).not.toHaveBeenCalled()
})
it.each([false,undefined])('keeps first processing until protected first outcome exists (%s)',async available=>{
 first.firstOutcomeAvailable=available;expect(await run()).toBe(false)
 expect(io.legal).not.toHaveBeenCalled();expect(io.decision).not.toHaveBeenCalled()
})
it.each(['protocol_duplicate','identity_conflict'])('does not inherit retained first-source authority for %s',async classification=>{
 first.classification=classification;first.status='held';expect(await run()).toBe(false)
 expect(io.legal).not.toHaveBeenCalled();expect(io.decision).not.toHaveBeenCalled()
})
it('rejects changed retained source hash before any current projection',async()=>{
 first.canonicalPayloadHash='a'.repeat(64)
 await expect(run()).rejects.toThrow('ediel_retained_document_hold_source_changed');expect(io.tenant).not.toHaveBeenCalled()
})
it('rejects a retained technical facet for another actual source hash',async()=>{
 basis.sourceHash='a'.repeat(64)
 await expect(run()).rejects.toThrow('ediel_retained_document_hold_technical_basis_required');expect(io.reception).not.toHaveBeenCalled()
})
it('propagates current actor denial unchanged before any retained hold',async()=>{
 const refusal={code:'42501',message:'Actual current actor refusal'};io.read.mockRejectedValue(refusal)
 await expect(run()).rejects.toBe(refusal);expect(io.rpc).not.toHaveBeenCalled();expect(io.decision).not.toHaveBeenCalled()
})
it('refuses unavailable current legal identity while preserving the old projection',async()=>{
 const original=JSON.stringify(source);io.tenant.mockResolvedValue({status:'unresolved',companyId:null})
 await expect(run()).rejects.toThrow('ediel_retained_document_hold_current_tenant_required')
 expect(JSON.stringify(source)).toBe(original);expect(io.decision).not.toHaveBeenCalled()
})
it.each(['message','object'])('protected existing %s APERAK retains priority over current guide qualification',async scope=>{
 io.read.mockImplementation(async(p:{ackFamily:string;ackScope:string})=>p.ackFamily==='CONTRL'?contrl:p.ackScope===scope?{id:'finite retained APERAK'}:null)
 io.decision.mockRejectedValue(Error('Current guide unavailable'))
 expect(await run()).toBe(false);expect(io.decision).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()
})
it('a same-text protected actor/RPC refusal cannot counterfeit the private203 hold marker',async()=>{
 const refusal=Error('aperak_prodat_document_reference_required')
 io.read.mockImplementation(async(p:{ackFamily:string})=>{if(p.ackFamily==='CONTRL')return contrl;throw refusal})
 expect(isProtectedProdatDocumentReferenceHold(refusal)).toBe(false)
 await expect(run()).rejects.toBe(refusal);expect(io.decision).not.toHaveBeenCalled()
})
it('a borrowed prior genuine guard cannot qualify a new source/actor invocation',async()=>{
 let prior:unknown
 try{await prepareSourceAckDraft({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative'})}catch(error){prior=error}
 expect(isProtectedProdatDocumentReferenceHold(prior)).toBe(true)
 io.read.mockImplementation(async(p:{ackFamily:string})=>{if(p.ackFamily==='CONTRL')return contrl;throw prior})
 await expect(run()).rejects.toBe(prior);expect(io.decision).not.toHaveBeenCalled()
})
it('does not use public rejection JSON when the current canonical203 decision is unavailable',async()=>{
 source.validation_report={applicationDecision:'rejected',responsePlan:[{fieldCode:'203'}]}
 io.decision.mockResolvedValue({syntaxDecision:'accepted',applicationDecision:'rejected',issues:[],responsePlan:[]})
 expect(await run()).toBe(false);expect(io.from).not.toHaveBeenCalled()
})
it('present physical document and unavailable selected grammar leave ordinary processing intact',async()=>{
 source=message('ACTUAL-DOC');expect(await run()).toBe(false);expect(io.read).not.toHaveBeenCalled()
 source=message();expect(await readRetainedProdatDocumentHold({actorUserId:actor,sourceMessage:source,syntax:{...syntax,ok:false}})).toBe(false)
 expect(io.read).not.toHaveBeenCalled()
})
