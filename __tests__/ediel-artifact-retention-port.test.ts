import {beforeEach,expect,it,vi} from 'vitest'
const port=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:port.getUser},rpc:port.rpc})}))
import {purgeArtifactRetention,reviewArtifactRetention,revokeArtifactRetention,submitArtifactRetention} from '@/lib/ediel/retention/artifactRetention'
const companyId='00000000-0000-4000-8000-000000000001',artifactId='00000000-0000-4000-8000-000000000002',decisionId='00000000-0000-4000-8000-000000000003',actor='00000000-0000-4000-8000-000000000004'
beforeEach(()=>{vi.clearAllMocks();port.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});port.rpc.mockResolvedValue({data:{status:'held',missing:['current_approved_legal_retention_deadline']},error:null})})
it('uses the authenticated JWT actor and actual archived document bytes without inventing issuer qualification',async()=>{
 const document=Buffer.from('SYNTHETIC legal-document bytes, not authentic authority')
 port.rpc.mockResolvedValue({data:{status:'submitted',decisionId,documentHash:'a'.repeat(64),sourceHash:'b'.repeat(64),issuerQualified:false},error:null})
 expect((await submitArtifactRetention({companyId,artifactId,document,issuerReceipt:null})).status).toBe('submitted')
 expect(port.rpc).toHaveBeenCalledExactlyOnceWith('ediel_submit_artifact_retention_v1',{p_company_id:companyId,p_actor_user_id:actor,p_artifact_id:artifactId,p_document_base64:document.toString('base64'),p_issuer_receipt:null})
})
it('an unauthenticated caller cannot enter any retention operation',async()=>{
 port.getUser.mockResolvedValue({data:{user:null},error:null})
 await expect(purgeArtifactRetention({companyId,decisionId})).rejects.toThrow('authenticated_actor_required')
 expect(port.rpc).not.toHaveBeenCalled()
})
it('rejects an oversized document before making a native call',async()=>{
 await expect(submitArtifactRetention({companyId,artifactId,document:Buffer.alloc(1048577),issuerReceipt:null})).rejects.toThrow('document_limit')
 expect(port.rpc).not.toHaveBeenCalled()
})
it('a requested approval remains held when the native current issuer authority is absent',async()=>{
 port.rpc.mockResolvedValue({data:{status:'held',decisionId,reviewId:artifactId},error:null})
 expect(await reviewArtifactRetention({companyId,decisionId,outcome:'approve',reason:'SYNTHETIC review'})).toEqual({status:'held',decisionId,reviewId:artifactId})
 expect(port.rpc).toHaveBeenCalledExactlyOnceWith('ediel_review_artifact_retention_v1',{p_company_id:companyId,p_actor_user_id:actor,p_decision_id:decisionId,p_outcome:'approve',p_reason:'SYNTHETIC review'})
})
it('preserves a native current-authority denial at the purge boundary',async()=>{
 const error={code:'42501',message:'ediel_retention_current_actor_forbidden'};port.rpc.mockResolvedValue({data:null,error})
 await expect(purgeArtifactRetention({companyId,decisionId})).rejects.toEqual(error)
})
it('returns the actual durable tombstone receipt rather than caller bytes or flags',async()=>{
 const receipt={status:'purged',artifactId,sourceHash:'c'.repeat(64),byteLength:57,purgedAt:'2026-10-01T01:00:00+00:00',replay:true};port.rpc.mockResolvedValue({data:receipt,error:null})
 expect(await purgeArtifactRetention({companyId,decisionId})).toEqual(receipt)
 expect(port.rpc).toHaveBeenCalledExactlyOnceWith('ediel_purge_artifact_retention_v1',{p_company_id:companyId,p_actor_user_id:actor,p_decision_id:decisionId})
})
it('records revocation with the current authenticated actor, exact decision and reason',async()=>{
 await revokeArtifactRetention({companyId,decisionId,reason:'SYNTHETIC policy revoked'})
 expect(port.rpc).toHaveBeenCalledExactlyOnceWith('ediel_revoke_artifact_retention_v1',{p_company_id:companyId,p_actor_user_id:actor,p_decision_id:decisionId,p_reason:'SYNTHETIC policy revoked'})
})
