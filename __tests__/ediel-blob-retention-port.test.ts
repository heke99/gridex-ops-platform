import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn(),remove:vi.fn(),download:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:io.auth},rpc:io.rpc,storage:{from:()=>({remove:io.remove})}})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{storage:{from:()=>({download:io.download})}}}))
import {purgeBlobRetention,reviewBlobRetention,submitBlobRetention} from '@/lib/ediel/retention/blobLifecycleRetention'
const companyId='00000000-0000-4000-8000-000000000001',targetId='00000000-0000-4000-8000-000000000002',decisionId='00000000-0000-4000-8000-000000000003',actor='00000000-0000-4000-8000-000000000004',messageId='00000000-0000-4000-8000-000000000005'
const bytes=Buffer.from('SYNTHETIC MIME bytes'),sourceHash=createHash('sha256').update(bytes).digest('hex'),path=`transport/${companyId}/${messageId}/${sourceHash}.eml`,parameters={p_company_id:companyId,p_actor_user_id:actor,p_decision_id:decisionId}
const pending=()=>({status:'storage_purge_pending',targetId,sourceHash,byteLength:bytes.length,storagePath:path,replay:false})
beforeEach(()=>{
 vi.clearAllMocks();io.auth.mockResolvedValue({data:{user:{id:actor}},error:null})
 io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_begin_blob_purge_v1'?pending():{...pending(),status:'purged'},error:null}))
 io.remove.mockResolvedValue({data:[{name:path}],error:null});io.download.mockReset().mockResolvedValueOnce({data:new Blob([bytes]),error:null}).mockResolvedValue({data:null,error:{statusCode:'404'}})
})
it('holds missing native policy authority without entering Storage',async()=>{
 io.rpc.mockResolvedValue({data:{status:'held',missing:['current_blob_class_legal_review_deadline']},error:null})
 expect((await purgeBlobRetention({companyId,decisionId})).status).toBe('held');expect(io.remove).not.toHaveBeenCalled();expect(io.download).not.toHaveBeenCalled()
})
it('uses actual session actor, exact native target and authenticated Storage deletion before native completion',async()=>{
 expect((await purgeBlobRetention({companyId,decisionId})).status).toBe('purged')
 expect(io.rpc).toHaveBeenNthCalledWith(1,'ediel_begin_blob_purge_v1',parameters);expect(io.remove).toHaveBeenCalledExactlyOnceWith([path]);expect(io.rpc).toHaveBeenNthCalledWith(2,'ediel_finish_blob_storage_purge_v1',parameters)
 expect(io.download.mock.invocationCallOrder[0]).toBeLessThan(io.remove.mock.invocationCallOrder[0]);expect(io.remove.mock.invocationCallOrder[0]).toBeLessThan(io.download.mock.invocationCallOrder[1]);expect(io.download.mock.invocationCallOrder[1]).toBeLessThan(io.rpc.mock.invocationCallOrder[1])
})
it('does not convert a current native Storage reviewer denial into a deletion receipt',async()=>{
 io.remove.mockResolvedValue({data:null,error:Error('current legal reviewer revoked')})
 await expect(purgeBlobRetention({companyId,decisionId})).rejects.toThrow('reviewer revoked');expect(io.rpc).toHaveBeenCalledTimes(1)
})
it('rejects changed actual bytes before deletion',async()=>{
 io.download.mockReset().mockResolvedValue({data:new Blob([Buffer.from('changed')]),error:null})
 await expect(purgeBlobRetention({companyId,decisionId})).rejects.toThrow('exact_bytes_changed');expect(io.remove).not.toHaveBeenCalled()
})
it.each(['still present','non-404 error'])('does not finish if byte absence was not observed: %s',async(kind)=>{
 io.download.mockReset().mockResolvedValueOnce({data:new Blob([bytes]),error:null}).mockResolvedValue(kind==='still present'?{data:new Blob([bytes]),error:null}:{data:null,error:{statusCode:'500'}})
 await expect(purgeBlobRetention({companyId,decisionId})).rejects.toThrow('bytes_still_available');expect(io.rpc).toHaveBeenCalledTimes(1)
})
it('rejects another company target returned by an inconsistent native command',async()=>{
 io.rpc.mockResolvedValue({data:{...pending(),storagePath:path.replace(companyId,actor)},error:null})
 await expect(purgeBlobRetention({companyId,decisionId})).rejects.toThrow('target_invalid');expect(io.remove).not.toHaveBeenCalled();expect(io.download).not.toHaveBeenCalled()
})
it('preserves immutable native purge replay without repeating physical deletion',async()=>{
 io.rpc.mockResolvedValue({data:{...pending(),status:'purged',replay:true},error:null})
 expect(await purgeBlobRetention({companyId,decisionId})).toMatchObject({status:'purged',replay:true});expect(io.remove).not.toHaveBeenCalled();expect(io.download).not.toHaveBeenCalled()
})
it('requires authentication before the actual native lifecycle port',async()=>{
 io.auth.mockResolvedValue({data:{user:null},error:null});await expect(purgeBlobRetention({companyId,decisionId})).rejects.toThrow('authenticated_actor_required');expect(io.rpc).not.toHaveBeenCalled()
})
it('submits actual document bytes with an exact class and does not upgrade a held native review',async()=>{
 const document=Buffer.from('SYNTHETIC class legal decision'),data={status:'submitted',decisionId,sourceHash,targetHash:'a'.repeat(64),messageId,documentHash:'b'.repeat(64),issuerQualified:false}
 io.rpc.mockResolvedValue({data,error:null});expect(await submitBlobRetention({companyId,targetId,retentionClass:'transport_raw_mime_bytes',document,issuerReceipt:null})).toEqual(data)
 expect(io.rpc).toHaveBeenCalledWith('ediel_submit_blob_retention_v1',{p_company_id:companyId,p_actor_user_id:actor,p_retention_class:'transport_raw_mime_bytes',p_target_id:targetId,p_document_base64:document.toString('base64'),p_issuer_receipt:null})
 io.rpc.mockResolvedValue({data:{status:'held',decisionId},error:null});expect((await reviewBlobRetention({companyId,decisionId,outcome:'approve',reason:'SYNTHETIC'})).status).toBe('held')
})
