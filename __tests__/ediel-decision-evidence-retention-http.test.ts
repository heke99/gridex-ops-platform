import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
import {createHash} from 'node:crypto'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',target='00000000-0000-4000-8000-000000000003',policyId='00000000-0000-4000-8000-000000000004'
const fixture=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn(),permissions:[] as string[]}))
vi.mock('server-only',()=>({}))
vi.mock('next/headers',()=>({cookies:async()=>({get:(key:string)=>key==='gridex_retention_company'?{value:'00000000-0000-4000-8000-000000000001'}:undefined})}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:fixture.auth},rpc:fixture.rpc})}))
import {decisionEvidenceDocument,decisionEvidenceOriginal,decisionEvidencePurge,decisionEvidenceReview,decisionEvidenceSubmit} from '@/lib/ediel/retention/decisionEvidenceRetentionHttp'
const retentionClass='blob_retention_decision_original_bytes',classGrant='ediel.retention.blob_decision_evidence',document=Buffer.from('SYNTHETIC finite archived original, no legal approval'),documentHash=createHash('sha256').update(document).digest('hex')
const metadata={companyId:company,policyId,retentionClass,targetId:target,sourceHash:'a'.repeat(64),targetMetadataHash:'b'.repeat(64),documentHash,documentByteLength:document.length,bytesAvailable:true,documentPurgedAt:null,documentBase64:null,submittedBy:target,createdAt:'2026-10-01T00:00:00Z',issuerQualified:false,currentQualified:false,revoked:false,reviews:[],purge:null,authority:'none'}
const post=(body:unknown)=>new NextRequest('http://localhost/api/ediel/decision-evidence-retention',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{
 vi.resetAllMocks();fixture.permissions=['ediel.retention.read','ediel.retention.submit','ediel.retention.review','ediel.retention.purge',classGrant]
 fixture.auth.mockResolvedValue({data:{user:{id:actor}},error:null})
 fixture.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='ediel_current_retention_session_v1')return{data:{companyId:company,actorUserId:actor,permissions:fixture.permissions},error:null}
  if(name==='ediel_read_decision_evidence_policy_v1')return{data:{...metadata,documentBase64:args.p_include_document?document.toString('base64'):null},error:null}
  if(name==='ediel_submit_decision_evidence_retention_v1')return{data:{status:'submitted',policyId,retentionClass,targetId:target,sourceHash:metadata.sourceHash,documentHash,issuerQualified:false},error:null}
  if(name==='ediel_review_decision_evidence_retention_v1')return{data:{status:'held',policyId,reviewId:target,missing:['authentic_issuer_receipt']},error:null}
  throw Error('unexpected finite RPC '+name)
 })
})
// Finite current GoTrue + named native RPC boundary, not legal/native proof.
it('uses server-selected own company and actual session actor for archive, preserving absent issuer qualification',async()=>{
 const r=await decisionEvidenceSubmit(post({retentionClass,targetId:target,documentBase64:document.toString('base64'),issuerReceipt:null}));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({issuerQualified:false});expect(fixture.rpc).toHaveBeenCalledWith('ediel_submit_decision_evidence_retention_v1',{p_company_id:company,p_actor_user_id:actor,p_retention_class:retentionClass,p_target_id:target,p_document_base64:document.toString('base64'),p_issuer_receipt:null});expect(r.headers.get('Cache-Control')).toBe('private, no-store')
})
it('rejects caller company or actor authority fields before archival',async()=>{
 const r=await decisionEvidenceSubmit(post({retentionClass,targetId:target,documentBase64:document.toString('base64'),issuerReceipt:null,companyId:target,actorUserId:target}));expect(r.status).toBe(400);expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1'])
})
it('denies missing current exact class even with all base operation grants',async()=>{
 fixture.permissions=fixture.permissions.filter(k=>k!==classGrant);expect((await decisionEvidenceOriginal(retentionClass,target)).status).toBe(403);expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1'])
})
it('allows read-only metadata while denying originals and review/purge mutation',async()=>{
 fixture.permissions=['ediel.retention.read',classGrant]
 expect((await decisionEvidenceDocument(policyId)).status).toBe(403);expect((await decisionEvidenceReview(post({outcome:'approve',reason:'Synthetic review'}),policyId)).status).toBe(403);expect((await decisionEvidencePurge(post({}),policyId)).status).toBe(403)
 expect(fixture.rpc.mock.calls.every(c=>c[0]==='ediel_current_retention_session_v1')).toBe(true)
})
it('preserves held current native review instead of creating approval',async()=>{
 const r=await decisionEvidenceReview(post({outcome:'approve',reason:'Synthetic separate review'}),policyId);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({status:'held',missing:['authentic_issuer_receipt']})
})
it('validates original bytes against actual returned native hash before download',async()=>{
 const r=await decisionEvidenceDocument(policyId);expect(r.status).toBe(200);expect(Buffer.from(await r.arrayBuffer())).toEqual(document);expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff')
 fixture.rpc.mockImplementation(async(name:string)=>name==='ediel_current_retention_session_v1'?{data:{companyId:company,actorUserId:actor,permissions:fixture.permissions},error:null}:{data:{...metadata,documentBase64:Buffer.from('different').toString('base64')},error:null})
 expect((await decisionEvidenceDocument(policyId)).status).toBe(403)
})
it('denies foreign policy tuple without returning original data or attempting purge',async()=>{
 fixture.rpc.mockImplementation(async(name:string)=>name==='ediel_current_retention_session_v1'?{data:{companyId:company,actorUserId:actor,permissions:fixture.permissions},error:null}:{data:{...metadata,companyId:target},error:null})
 const r=await decisionEvidencePurge(post({}),policyId);expect(r.status).toBe(403);expect(fixture.rpc.mock.calls.some(c=>c[0]==='ediel_purge_decision_evidence_retention_v1')).toBe(false);expect(JSON.stringify(await r.json())).not.toContain(documentHash)
})
it('does not reuse a previous session when current native role/grant is revoked',async()=>{
 fixture.rpc.mockResolvedValue({data:null,error:{message:'native_current_deny'}});expect((await decisionEvidenceDocument(policyId)).status).toBe(403);expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1'])
})
it('rejects over-limit streamed request before original/archive access',async()=>{
 const req=new NextRequest('http://localhost/api/ediel/decision-evidence-retention',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'1450001'},body:'{}'});expect((await decisionEvidenceSubmit(req)).status).toBe(400);expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1'])
})
