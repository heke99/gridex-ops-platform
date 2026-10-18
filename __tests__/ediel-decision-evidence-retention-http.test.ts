import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
import {createHash} from 'node:crypto'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',target='00000000-0000-4000-8000-000000000003',policyId='00000000-0000-4000-8000-000000000004'
const fixture=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn(),permissions:[] as string[],purgeResult:null as unknown,purgeError:null as {code?:string;message:string}|null}))
vi.mock('server-only',()=>({}))
vi.mock('next/headers',()=>({cookies:async()=>({get:(key:string)=>key==='gridex_retention_company'?{value:'00000000-0000-4000-8000-000000000001'}:undefined})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:fixture.rpc}}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:fixture.auth},rpc:fixture.rpc})}))
import {advanceCompletedParent,advanceCompletedWitnessDisposition} from '@/lib/ediel/retention/decisionEvidenceRetention'
import {decisionEvidenceParentPurposeStatus,decisionEvidenceDocument,decisionEvidenceOriginal,decisionEvidencePurge,decisionEvidenceRead,decisionEvidenceReview,decisionEvidenceSubmit} from '@/lib/ediel/retention/decisionEvidenceRetentionHttp'
const retentionClass='blob_retention_decision_original_bytes',classGrant='ediel.retention.blob_decision_evidence',document=Buffer.from('SYNTHETIC finite archived original, no legal approval'),documentHash=createHash('sha256').update(document).digest('hex')
const metadata={companyId:company,policyId,retentionClass,targetId:target,sourceHash:'a'.repeat(64),targetMetadataHash:'b'.repeat(64),documentHash,documentByteLength:document.length,bytesAvailable:true,documentPurgedAt:null,documentBase64:null,submittedBy:target,createdAt:'2026-10-01T00:00:00Z',issuerQualified:false,currentQualified:false,revoked:false,reviews:[],purge:null,authority:'none'}
const post=(body:unknown)=>new NextRequest('http://localhost/api/ediel/decision-evidence-retention',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{
 vi.resetAllMocks();fixture.permissions=['ediel.retention.read','ediel.retention.submit','ediel.retention.review','ediel.retention.purge',classGrant]
 fixture.purgeResult={status:'purged',retentionClass,targetId:target,sourceHash:metadata.sourceHash,byteLength:document.length,bytesAvailable:false,authority:'none',replay:true};fixture.purgeError=null
 fixture.auth.mockResolvedValue({data:{user:{id:actor}},error:null})
 fixture.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='ediel_current_retention_session_v1')return{data:{companyId:company,actorUserId:actor,permissions:fixture.permissions},error:null}
  if(name==='ediel_read_decision_evidence_policy_v1')return{data:{...metadata,documentBase64:args.p_include_document?document.toString('base64'):null},error:null}
  if(name==='ediel_submit_decision_evidence_retention_v1')return{data:{status:'submitted',policyId,retentionClass,targetId:target,sourceHash:metadata.sourceHash,documentHash,issuerQualified:false},error:null}
  if(name==='ediel_review_decision_evidence_retention_v1')return{data:{status:'held',policyId,reviewId:target,missing:['authentic_issuer_receipt']},error:null}
  if(name==='ediel_review_completed_witness_disposition_v1')return{data:{status:args.p_outcome==='approve'?'approved':'revoked',authority:'none'},error:null}
  if(name==='ediel_purge_decision_evidence_retention_v1')return{data:fixture.purgeResult,error:fixture.purgeError}
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
it('denies a foreign returned read-policy tuple without returning original data',async()=>{
 fixture.rpc.mockImplementation(async(name:string)=>name==='ediel_current_retention_session_v1'?{data:{companyId:company,actorUserId:actor,permissions:fixture.permissions},error:null}:{data:{...metadata,companyId:target},error:null})
 const r=await decisionEvidenceRead(policyId);expect(r.status).toBe(403);expect(fixture.rpc.mock.calls.some(c=>c[0]==='ediel_purge_decision_evidence_retention_v1')).toBe(false);expect(JSON.stringify(await r.json())).not.toContain(documentHash)
})
it('does not reuse a previous session when current native role/grant is revoked',async()=>{
 fixture.rpc.mockResolvedValue({data:null,error:{message:'native_current_deny'}});expect((await decisionEvidenceDocument(policyId)).status).toBe(403);expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1'])
})
it('rejects over-limit streamed request before original/archive access',async()=>{
 const req=new NextRequest('http://localhost/api/ediel/decision-evidence-retention',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'1450001'},body:'{}'});expect((await decisionEvidenceSubmit(req)).status).toBe(400);expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1'])
})

// Actual facade/domain, with explicitly synthetic GoTrue and SQL transports.
// The separate PGlite controls execute the real native owner's pre-effect gates.
it.each([false,true])('reaches authorized completed replay without a disclosure read, after W=%s',async expired=>{
 fixture.permissions.push('ediel.retention.completed_review_reason')
 fixture.purgeResult={...(fixture.purgeResult as object),retentionClass:'completed_decision_review_reason'}
 const native=fixture.rpc.getMockImplementation()!
 fixture.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='ediel_read_decision_evidence_policy_v1'
  ?expired?{data:null,error:{code:'42501',message:'completed_review_witness_disclosure_ended'}}:{data:{...metadata,retentionClass:'completed_decision_review_reason'},error:null}
  :native(name,args))
 const r=await decisionEvidencePurge(post({}),policyId)
 expect(r.status).toBe(200);expect(await r.json()).toEqual({status:'purged',replay:true,authority:'none'})
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1','ediel_purge_decision_evidence_retention_v1'])
 expect(fixture.rpc).toHaveBeenLastCalledWith('ediel_purge_decision_evidence_retention_v1',{p_company_id:company,p_actor_user_id:actor,p_policy_id:policyId})
 expect(r.headers.get('Cache-Control')).toBe('private, no-store')
})
it('returns a minimal first-purge or held receipt without expired witness fields',async()=>{
 fixture.purgeResult={...(fixture.purgeResult as object),replay:false}
 const purged=await decisionEvidencePurge(post({}),policyId);expect(purged.status).toBe(200);expect(await purged.json()).toEqual({status:'purged',replay:false,authority:'none'})
 fixture.purgeResult={status:'held',policyId,missing:['current_exact_original_deadline']}
 const held=await decisionEvidencePurge(post({}),policyId);expect(held.status).toBe(200);expect(await held.json()).toEqual({status:'held',authority:'none'})
 expect(fixture.rpc.mock.calls.some(c=>c[0]==='ediel_read_decision_evidence_policy_v1')).toBe(false)
})
it.each(['current_exact_class_denied','foreign_company_or_policy','decision_original_purge_replay_conflict'])('preserves authoritative native refusal without witness disclosure: %s',async message=>{
 if(message==='current_exact_class_denied')fixture.permissions=fixture.permissions.filter(p=>p!==classGrant)
 fixture.purgeError={code:'42501',message}
 const r=await decisionEvidencePurge(post({}),policyId)
 expect(r.status).toBe(403);expect(await r.json()).toEqual({error:'Aktuell bolags-, klass- eller källbehörighet saknas.'})
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1','ediel_purge_decision_evidence_retention_v1'])
})
it.each([
 {status:'approved',policyId},
 {status:'submitted',policyId,retentionClass,targetId:target,documentHash,sourceHash:metadata.sourceHash,issuerQualified:false},
 {status:'held',policyId:target,missing:['foreign_policy']},
 {status:'held',missing:['missing_policy']},
 {status:'held',policyId,missing:['held'],unexpectedWitness:'PRIVATE'},
 {status:'purged',retentionClass,targetId:target,sourceHash:'not-a-hash',byteLength:document.length,bytesAvailable:false,authority:'none',replay:true},
 {status:'purged',retentionClass,targetId:target,sourceHash:metadata.sourceHash,byteLength:document.length,bytesAvailable:false,authority:'none',replay:true,unexpectedWitness:'PRIVATE'},
])('refuses an unrelated, foreign or malformed native purge result: $status',async result=>{
 fixture.purgeResult=result
 const r=await decisionEvidencePurge(post({}),policyId);expect(r.status).toBe(403);expect(JSON.stringify(await r.json())).not.toContain('PRIVATE')
})
it('keeps an empty purge command and rejects caller authority before native mutation',async()=>{
 const r=await decisionEvidencePurge(post({companyId:target,actorUserId:target,retentionClass}),policyId)
 expect(r.status).toBe(400);expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1'])
})

it.each([{status:'disposed',replay:false,authority:'none'},{status:'disposed',replay:true,authority:'none'},{status:'expired',authority:'none'},{status:'unavailable',authority:'none'},{status:'purged',replay:true,authority:'none'}])('strict actual domain and HTTP expose only the new minimal $status receipt',async result=>{
 fixture.purgeResult=result;const response=await decisionEvidencePurge(post({}),policyId);expect(response.status).toBe(200);expect(await response.json()).toEqual(result);expect(fixture.rpc.mock.calls.some(c=>c[0]==='ediel_read_decision_evidence_policy_v1')).toBe(false)
})
it.each(['disposed','expired','unavailable','purged'])('refuses expired metadata smuggled into minimal %s DTO',async status=>{
 fixture.purgeResult={status,authority:'none',...(status==='disposed'||status==='purged'?{replay:true}:{}),expiredReviewId:actor};expect((await decisionEvidencePurge(post({}),policyId)).status).toBe(403)
})
it.each(['approve','revoke'])('uses the explicit signed physical-disposition %s branch without expired metadata preread',async outcome=>{
 fixture.permissions.push('ediel.retention.completed_review_reason');const issuerReceipt={issuerId:target,payloadBase64:'SYNTHETIC',signatureHex:'a'.repeat(64)}
 const response=await decisionEvidenceReview(post({phase:'completed-witness-disposition',outcome,issuerReceipt}),policyId);expect(response.status).toBe(200);expect(await response.json()).toEqual({status:outcome==='approve'?'approved':'revoked',authority:'none'})
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1','ediel_review_completed_witness_disposition_v1']);expect(fixture.rpc).toHaveBeenLastCalledWith('ediel_review_completed_witness_disposition_v1',{p_company_id:company,p_actor_user_id:actor,p_policy_id:policyId,p_outcome:outcome,p_receipt:issuerReceipt})
})
it('new phase review requires current exact class and refuses hidden reason or caller authority fields',async()=>{
 expect((await decisionEvidenceReview(post({phase:'completed-witness-disposition',outcome:'approve',issuerReceipt:null}),policyId)).status).toBe(403)
 fixture.permissions.push('ediel.retention.completed_review_reason');expect((await decisionEvidenceReview(post({phase:'completed-witness-disposition',outcome:'approve',issuerReceipt:null,reason:'hidden phase',actorUserId:target}),policyId)).status).toBe(400)
 expect(fixture.rpc.mock.calls.every(c=>c[0]==='ediel_current_retention_session_v1')).toBe(true)
})

it('actual worker adapter passes only the validated configured actor and bounded limit to the existing service port',async()=>{
 const counts={scanned:1,disposed:0,expired:0,clearedApprovals:0,held:1,authority:'none'};fixture.rpc.mockResolvedValue({data:counts,error:null});expect(await advanceCompletedWitnessDisposition({actorUserId:actor,limit:20})).toEqual(counts);expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('ediel_advance_completed_witness_disposition_v1',{p_actor_user_id:actor,p_limit:20})
 fixture.rpc.mockResolvedValue({data:null,error:{message:'SYNTHETIC private receipt must not be logged'}});await expect(advanceCompletedWitnessDisposition({actorUserId:actor,limit:20})).rejects.toThrow('completed_witness_worker_failed')
})

// Completed source-parent adapter boundary: synthetic session/RPC transports;
// the real facade/domain must select the correct native owner without disclosure.
it('admits a signed source-parent purpose by explicit phase without a disclosure prerequisite',async()=>{
 fixture.permissions.push('ediel.retention.completed_review_reason')
 const envelope={issuerId:target,payloadBase64:'ZXh0ZXJuYWw=',signatureHex:'a'.repeat(64)}
 fixture.rpc.mockImplementation(async(name:string)=>{
  if(name==='ediel_current_retention_session_v1')return{data:{companyId:company,actorUserId:actor,permissions:fixture.permissions},error:null}
  if(name==='ediel_admit_completed_parent_purpose_v1')return{data:{status:'purpose_admitted',version:1,authority:'none'},error:null}
  throw Error('No disclosure or other owner may substitute for purpose admission: '+name)
 })
 const response=await decisionEvidenceReview(post({phase:'completed-parent-purpose',issuerReceipt:envelope}),policyId)
 expect(response.status).toBe(200)
 expect(await response.json()).toEqual({status:'purpose_admitted',version:1,authority:'none'})
 expect(fixture.rpc).toHaveBeenLastCalledWith('ediel_admit_completed_parent_purpose_v1',{p_company_id:company,p_actor_user_id:actor,p_policy_id:policyId,p_receipt:envelope})
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1','ediel_admit_completed_parent_purpose_v1'])
})

import {GET as parentPurposeGET} from '@/app/api/ediel/decision-evidence-retention/[policyId]/parent-purpose/route'

const parentEnvelope={issuerId:target,payloadBase64:'ZXh0ZXJuYWw=',signatureHex:'a'.repeat(64)}
function parentTransport(result:unknown,error:unknown=null){
 fixture.permissions.push('ediel.retention.completed_review_reason')
 fixture.rpc.mockImplementation(async(name:string)=>{
  if(name==='ediel_current_retention_session_v1')return{data:{companyId:company,actorUserId:actor,permissions:fixture.permissions},error:null}
  if(['ediel_admit_completed_parent_purpose_v1','ediel_completed_parent_purpose_status_v1','ediel_review_completed_parent_v1','ediel_dispose_completed_parent_v1','ediel_advance_completed_parent_v1'].includes(name))return{data:result,error}
  throw Error('Ordinary disclosure and legacy mutation may not substitute for this phase: '+name)
 })
}
it('routes a separate parent approval with unchanged signed envelope, not old witness or reason authority',async()=>{
 parentTransport({status:'approved',authority:'none'})
 const response=await decisionEvidenceReview(post({phase:'completed-parent-disposition',issuerReceipt:parentEnvelope}),policyId)
 expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'approved',authority:'none'})
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1','ediel_review_completed_parent_v1'])
 expect(fixture.rpc).toHaveBeenLastCalledWith('ediel_review_completed_parent_v1',{p_company_id:company,p_actor_user_id:actor,p_policy_id:policyId,p_receipt:parentEnvelope})
})
it.each(['ediel.retention.completed_review_reason',classGrant])('requires both current classes for parent mutations: missing %s',async missing=>{
 parentTransport(null);const current=fixture.rpc.getMockImplementation()!
 fixture.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='ediel_current_retention_session_v1'?current(name,args):{data:name==='ediel_admit_completed_parent_purpose_v1'?{status:'purpose_admitted',version:1,authority:'none'}:name==='ediel_review_completed_parent_v1'?{status:'approved',authority:'none'}:{status:'disposed',replay:false,authority:'none'},error:null})
 fixture.permissions=fixture.permissions.filter(key=>key!==missing)
 for(const phase of ['completed-parent-purpose','completed-parent-disposition'])expect((await decisionEvidenceReview(post({phase,issuerReceipt:parentEnvelope}),policyId)).status).toBe(403)
 expect((await decisionEvidencePurge(post({phase:'completed-parent-disposition'}),policyId)).status).toBe(403)
 expect(fixture.rpc.mock.calls.every(c=>c[0]==='ediel_current_retention_session_v1')).toBe(true)
})
it.each([
 {phase:'completed-parent-purpose',issuerReceipt:parentEnvelope,companyId:target},
 {phase:'completed-parent-disposition',issuerReceipt:parentEnvelope,actorUserId:target},
 {phase:'completed-parent-purpose',issuerReceipt:parentEnvelope,outcome:'approve'},
 {phase:'completed-parent-disposition',issuerReceipt:parentEnvelope,reason:'hidden authority'},
 {phase:'completed-parent-purpose',issuerReceipt:null},
 {phase:'completed-parent-purpose',issuerReceipt:{...parentEnvelope,issuerId:'foreign-not-uuid'}},
 {phase:'completed-parent-purpose',issuerReceipt:{...parentEnvelope,approved:true}},
 {phase:'completed-parent-purpose',issuerReceipt:{...parentEnvelope,payloadBase64:'x'.repeat(65540)}},
])('rejects parent input authority or malformed envelope before native admission',async raw=>{
 parentTransport(null);expect((await decisionEvidenceReview(post(raw),policyId)).status).toBe(400)
 expect(fixture.rpc.mock.calls.every(c=>c[0]==='ediel_current_retention_session_v1')).toBe(true)
})
it.each([
 {status:'disposed',replay:false,authority:'none'},
 {status:'held',authority:'none'},
 {status:'unavailable',authority:'none'},
])('keeps exact parent $status receipt without ordinary reads or legacy replay',async result=>{
 parentTransport(result);const response=await decisionEvidencePurge(post({phase:'completed-parent-disposition'}),policyId)
 expect(response.status).toBe(200);expect(await response.json()).toEqual(result)
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1','ediel_dispose_completed_parent_v1'])
 expect(fixture.rpc).toHaveBeenLastCalledWith('ediel_dispose_completed_parent_v1',{p_company_id:company,p_actor_user_id:actor,p_policy_id:policyId})
})
it.each([{status:'disposed',replay:true,authority:'none'},{status:'expired',authority:'none'},{status:'purged',replay:true,authority:'none'},{status:'held',authority:'none',policyId},{status:'disposed',replay:false,authority:'none',expiredMetadata:'PRIVATE'},{status:'approved',authority:'none'}])('refuses invalid parent effect/replay result $status replay=$replay',async result=>{
 parentTransport(result);const response=await decisionEvidencePurge(post({phase:'completed-parent-disposition'}),policyId);expect(response.status).toBe(400);expect(JSON.stringify(await response.json())).not.toContain('PRIVATE')
})
it('does not turn native hold or stale-purpose refusal into synthetic held or success',async()=>{
 parentTransport(null,{code:'42501',message:'phase_current_customer_hold PRIVATE'})
 const response=await decisionEvidencePurge(post({phase:'completed-parent-disposition'}),policyId)
 expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'Aktuell bolags-, klass- eller källbehörighet saknas.'})
})
it.each([{phase:'completed-parent-disposition',companyId:target},{phase:'completed-parent-disposition',issuerReceipt:parentEnvelope},{phase:'other'},{phase:'completed-parent-disposition',replay:true}])('refuses hidden authority or replay on parent purge command',async raw=>{
 parentTransport(null);expect((await decisionEvidencePurge(post(raw),policyId)).status).toBe(400);expect(fixture.rpc.mock.calls.every(c=>c[0]==='ediel_current_retention_session_v1')).toBe(true)
})
it.each(['active','ordinary_use_ended','POLICY_REVIEW_OVERDUE','POLICY_OVERDUE','unavailable'])('read-only parent status $0 needs no review/purge or expired disclosure',async status=>{
 const result=status==='unavailable'?{status,authority:'none'}:{status,disposed:false,authority:'none'}
 parentTransport(result);fixture.permissions=['ediel.retention.read',classGrant]
 const response=await parentPurposeGET(new NextRequest('https://ops.example/status?companyId='+target),{params:Promise.resolve({policyId})})
 expect(response.status).toBe(200);expect(await response.json()).toEqual(result);expect(response.headers.get('Cache-Control')).toBe('private, no-store')
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_current_retention_session_v1','ediel_completed_parent_purpose_status_v1'])
 expect(fixture.rpc).toHaveBeenLastCalledWith('ediel_completed_parent_purpose_status_v1',{p_company_id:company,p_actor_user_id:actor,p_policy_id:policyId})
 expect((await decisionEvidenceReview(post({phase:'completed-parent-purpose',issuerReceipt:parentEnvelope}),policyId)).status).toBe(403)
})
it.each([{status:'unavailable',disposed:true,authority:'none'},{status:'active',disposed:false,authority:'none',receipt:parentEnvelope},{status:'disposed',replay:false,authority:'none'}])('refuses parent status that asserts unavailable deletion or leaks extra metadata',async result=>{
 parentTransport(result);expect((await parentPurposeGET(new NextRequest('https://ops.example/status'),{params:Promise.resolve({policyId})})).status).toBe(400)
})
it('fresh status refuses missing class, revoked session or native foreign/current scope denial',async()=>{
 parentTransport({status:'active',disposed:false,authority:'none'});fixture.permissions=['ediel.retention.read'];expect((await decisionEvidenceParentPurposeStatus(policyId)).status).toBe(403)
 fixture.permissions.push(classGrant);fixture.auth.mockResolvedValue({data:{user:null},error:null});expect((await decisionEvidenceParentPurposeStatus(policyId)).status).toBe(403)
 fixture.auth.mockResolvedValue({data:{user:{id:actor}},error:null});parentTransport(null,{code:'42501',message:'foreign/stale scope'});expect((await decisionEvidenceParentPurposeStatus(policyId)).status).toBe(403)
})
it('parent worker uses the configured actor and exact four counters, preserving safe absent-schema code without private error text',async()=>{
 const counts={scanned:2,disposed:1,clearedApprovals:1,held:0};fixture.rpc.mockResolvedValue({data:counts,error:null})
 expect(await advanceCompletedParent({actorUserId:actor,limit:20})).toEqual(counts);expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('ediel_advance_completed_parent_v1',{p_actor_user_id:actor,p_limit:20})
 fixture.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'PRIVATE receipt'}})
 await expect(advanceCompletedParent({actorUserId:actor,limit:20})).rejects.toMatchObject({code:'PGRST202',message:'completed_parent_worker_failed'})
 fixture.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'PRIVATE hold'}})
 await expect(advanceCompletedParent({actorUserId:actor,limit:20})).rejects.toMatchObject({message:'completed_parent_worker_failed'})
})
it('parent worker refuses fabricated expiry counters, invalid actor or batch before service effects',async()=>{
 fixture.rpc.mockResolvedValue({data:{scanned:0,disposed:0,held:0,clearedApprovals:0,expired:1,authority:'none'},error:null});await expect(advanceCompletedParent({actorUserId:actor,limit:20})).rejects.toThrow()
 fixture.rpc.mockClear();await expect(advanceCompletedParent({actorUserId:actor,limit:101})).rejects.toThrow();await expect(advanceCompletedParent({actorUserId:'forged',limit:20})).rejects.toThrow();expect(fixture.rpc).not.toHaveBeenCalled()
})
