import {createHash} from 'node:crypto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const f=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:f.rpc}}))
import {archiveEdielServiceEvidence,readEdielServiceEvidenceArchive,readEdielServiceEvidenceBytes,reviewEdielServiceEvidence,serviceEvidenceArchiveSchema} from '@/lib/ediel/services/evidenceReview'

// RPC adapter/byte-integrity proof only. The SQL/native producer tests own
// issuer, scoped reviewer, actual permission, grant and ACK authority proof.
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const scope={companyId:id(1),actorUserId:id(2)},artifactId=id(4),evidenceId=id(5)
const bytes=Buffer.from('%PDF-1.7\nSynthetic original-byte custody test\n%%EOF'),sourceHash=createHash('sha256').update(bytes).digest('hex'),scopeHash='a'.repeat(64)
const submission=()=>({assignmentId:id(3),scopeBasisVersion:1,kind:'end_user_contract',terms:{valid_from:'2026-01-01T00:00:00Z',valid_to:null},source:{bytesBase64:bytes.toString('base64'),mimeType:'application/pdf',reference:'Own original PDF',version:'v1'},issuerReceipt:{keyId:id(6),representationId:id(7),payloadBase64:Buffer.from('{"signed":"original raw JSON"}').toString('base64'),signatureHex:'b'.repeat(64)}})
const archived=()=>({status:'archived',...scope,assignmentId:id(3),artifactId,sourceHash,scopeHash,scopeBasisVersion:1,missing:['separate_qualified_reviewer_required']})
const read=()=>({artifactId,companyId:scope.companyId,assignmentId:id(3),scopeBasisVersion:1,kind:'end_user_contract',mimeType:'application/pdf',sourceHash,sourceReference:'Own original PDF',sourceVersion:'v1',scopeHash,scope:{purpose:'analysis'},evidenceTerms:{valid_from:'2026-01-01T00:00:00Z',valid_to:null},byteLength:bytes.length,issuerCurrent:false,reviewStatus:'unreviewed',marketActivationGranted:false})
const review={decision:'approve',reason:'Read original own source against native scope',sourceHash,scopeHash}
beforeEach(()=>{f.rpc.mockReset()})
describe('ESCO evidence producer adapters preserve native authority and actual original bytes',()=>{
 it('archives exact issuer receipt and original bytes with session-derived company/actor while custody remains unreviewed',async()=>{
  const input=submission();f.rpc.mockResolvedValue({data:archived(),error:null})
  const got=await archiveEdielServiceEvidence({...scope,submission:input})
  expect(got.status).toBe('archived');expect(got.missing).toEqual(['separate_qualified_reviewer_required'])
  expect(f.rpc).toHaveBeenCalledWith('ediel_archive_service_evidence_v1',{p_company_id:scope.companyId,p_actor_user_id:scope.actorUserId,p_submission:input})
 })
 it.each(['approved','issuerAuthenticated','reviewerQualified','companyId'])('refuses injected %s authority before the native archive call',async key=>{
  await expect(archiveEdielServiceEvidence({...scope,submission:{...submission(),[key]:true}})).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled()
 })
 it.each(['not-base64','JVBERi0=\n',Buffer.from('not a PDF').toString('base64')])('refuses malformed/noncanonical/non-PDF original bytes %s before persistence',async bytesBase64=>{
  await expect(archiveEdielServiceEvidence({...scope,submission:{...submission(),source:{...submission().source,bytesBase64}}})).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled()
 })
 it.each(['sourceHash','companyId','assignmentId','scopeBasisVersion'])('refuses a returned %s outside the actual archived input',async field=>{
  const data={...archived(),[field]:field==='sourceHash'?'f'.repeat(64):field==='scopeBasisVersion'?2:id(99)};f.rpc.mockResolvedValue({data,error:null})
  await expect(archiveEdielServiceEvidence({...scope,submission:submission()})).rejects.toThrow('actual_scope_mismatch')
 })
 it('preserves native issuer/reviewer denial without converting a missing authority into approval',async()=>{
  const error=new Error('ediel_service_evidence_reviewer_forbidden');f.rpc.mockResolvedValue({data:null,error})
  await expect(reviewEdielServiceEvidence({...scope,artifactId,evidenceId,review})).rejects.toBe(error)
 })
 it('passes hash-bound separate review and keeps verified evidence distinct from market activation',async()=>{
  f.rpc.mockResolvedValue({data:{status:'verified',companyId:scope.companyId,artifactId,evidenceId,reviewId:id(8),reviewSequence:1,scopeBasisVersion:1,missing:[],marketActivationGranted:false},error:null})
  const r=await reviewEdielServiceEvidence({...scope,artifactId,evidenceId,review});expect(r.marketActivationGranted).toBe(false)
  expect(f.rpc).toHaveBeenCalledWith('ediel_review_service_evidence_v1',{p_company_id:scope.companyId,p_actor_user_id:scope.actorUserId,p_artifact_id:artifactId,p_evidence_id:evidenceId,p_review:review})
 })
 it.each(['held','rejected'])('preserves actual native %s as a held external/legal boundary',async status=>{
  f.rpc.mockResolvedValue({data:{status,companyId:scope.companyId,artifactId,evidenceId,reviewId:id(8),reviewSequence:1,scopeBasisVersion:1,missing:['authentic_current_issuer_and_representation_receipt'],marketActivationGranted:false},error:null})
  expect((await reviewEdielServiceEvidence({...scope,artifactId,evidenceId,review})).status).toBe(status)
 })
 it('metadata reads exclude original bytes and expose current issuer state for the qualified reviewer',async()=>{
  f.rpc.mockResolvedValue({data:read(),error:null});expect((await readEdielServiceEvidenceArchive({...scope,artifactId})).issuerCurrent).toBe(false)
  expect(f.rpc.mock.calls[0][1].p_include_bytes).toBe(false)
 })
 it('original bytes reads verify exact hash and size without reserializing the issuer-signed document',async()=>{
  f.rpc.mockResolvedValue({data:{...read(),bytesBase64:bytes.toString('base64')},error:null});expect(Buffer.from((await readEdielServiceEvidenceBytes({...scope,artifactId})).bytes)).toEqual(bytes)
  expect(f.rpc.mock.calls[0][1].p_include_bytes).toBe(true)
 })
 it.each(['sourceHash','byteLength','bytesBase64'])('refuses corrupted native archived %s',async field=>{
  const data={...read(),bytesBase64:bytes.toString('base64'),[field]:field==='sourceHash'?'f'.repeat(64):field==='byteLength'?bytes.length+1:Buffer.from('%PDF-1.7 altered bytes').toString('base64')};f.rpc.mockResolvedValue({data,error:null})
  await expect(readEdielServiceEvidenceBytes({...scope,artifactId})).rejects.toThrow('integrity_mismatch')
 })
 it('a transport mandate must carry only explicit native relation identifiers and signed typed source terms',()=>{
  const parsed=serviceEvidenceArchiveSchema.parse({...submission(),kind:'transport_mandate',transportRelationId:id(9),transportActorId:id(10),terms:{...submission().terms,permission_purpose_code:'B71',permission_reporting_frequency:'1',permission_customer_classification:'private'}})
  expect(parsed.transportRelationId).toBe(id(9));expect(parsed.terms.permission_purpose_code).toBe('B71')
  expect(()=>serviceEvidenceArchiveSchema.parse({...submission(),terms:{...submission().terms,verified:true}})).toThrow()
 })
})
