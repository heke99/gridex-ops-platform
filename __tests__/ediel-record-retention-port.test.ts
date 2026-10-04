import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const io=vi.hoisted(()=>({rpc:vi.fn(),serviceRpc:vi.fn(),getUser:vi.fn(),download:vi.fn(),remove:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:io.getUser},rpc:io.rpc,storage:{from:(bucket:string)=>{expect(bucket).toBe('customer-contract-documents');return {remove:io.remove}}}})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.serviceRpc,storage:{from:(bucket:string)=>{expect(bucket).toBe('customer-contract-documents');return {download:io.download}}}}}))
import {beginCustomerRecordRetention,requireCustomerRecordAvailable,reviewCustomerRecordRetention,submitCustomerRecordRetention} from '@/lib/ediel/retention/customerRecordClasses'
import {purgeRetainedContractDocument} from '@/lib/ediel/retention/contractDocumentPurge'
const companyId='00000000-0000-4000-8000-000000000001',contractId='00000000-0000-4000-8000-000000000002',decisionId='00000000-0000-4000-8000-000000000003',actorId='00000000-0000-4000-8000-000000000004',targetId='00000000-0000-4000-8000-000000000005',customerId='00000000-0000-4000-8000-000000000006'
const bytes=Buffer.from('%PDF-1.7\nSYNTHETIC LOCAL PORT\n%%EOF'),sourceHash=createHash('sha256').update(bytes).digest('hex'),path=`${companyId}/${contractId}/signed-contract-${sourceHash}.pdf`
const pending={status:'storage_purge_pending',retentionClass:'contract_signed_pdf_bytes',targetId,sourceHash,byteLength:bytes.length,storagePath:path,replay:false}
const absent={data:null,error:{statusCode:'404',message:'Object not found'}}
beforeEach(()=>{
 vi.resetAllMocks();io.getUser.mockResolvedValue({data:{user:{id:actorId}},error:null});io.remove.mockResolvedValue({error:null,data:[{name:path}]})
 io.rpc.mockImplementation(async(name,args)=>{
  expect(args).toEqual({p_company_id:companyId,p_actor_user_id:actorId,p_decision_id:decisionId})
  return {error:null,data:name==='ediel_begin_customer_record_retention_v1'?pending:{status:'storage_object_absent',retentionClass:'contract_signed_pdf_bytes',targetId,sourceHash,byteLength:bytes.length,replay:false}}
 })
 io.download.mockResolvedValueOnce({error:null,data:new Blob([bytes])}).mockResolvedValue(absent)
})
it('binds actual authenticated actor, exact class/target/document and preserves a native no-issuer hold',async()=>{
 io.rpc.mockResolvedValue({error:null,data:{status:'submitted',decisionId,sourceHash,targetHash:'b'.repeat(64),documentHash:'c'.repeat(64),retentionClass:'customer_address_history',issuerQualified:false}})
 const document=Buffer.from('SYNTHETIC legal decision bytes')
 expect((await submitCustomerRecordRetention({companyId,retentionClass:'customer_address_history',targetId,document,issuerReceipt:null})).status).toBe('submitted')
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_submit_customer_record_retention_v1',{p_company_id:companyId,p_actor_user_id:actorId,p_retention_class:'customer_address_history',p_target_id:targetId,p_document_base64:document.toString('base64'),p_issuer_receipt:null})
 io.rpc.mockResolvedValue({error:null,data:{status:'held',missing:['current_exact_class_legal_review_deadline']}})
 expect((await reviewCustomerRecordRetention({companyId,decisionId,outcome:'approve',reason:'SYNTHETIC requested review'})).status).toBe('held')
})
it('unauthenticated actor cannot begin any actual class operation',async()=>{
 io.getUser.mockResolvedValue({data:{user:null},error:null})
 await expect(beginCustomerRecordRetention({companyId,decisionId})).rejects.toThrow('authenticated_actor_required');expect(io.rpc).not.toHaveBeenCalled();expect(io.remove).not.toHaveBeenCalled()
})
it('actual remove is preceded by exact hash/length read and followed by unavailable readback before native finish',async()=>{
 const result=await purgeRetainedContractDocument({companyId,decisionId})
 expect(result).toMatchObject({status:'storage_object_absent',sourceHash,physicalBytesObservedUnavailable:true})
 expect(io.remove).toHaveBeenCalledExactlyOnceWith([path]);expect(io.download.mock.calls).toEqual([[path],[path]])
 expect(io.rpc.mock.calls.map(call=>call[0])).toEqual(['ediel_begin_customer_record_retention_v1','ediel_finish_contract_document_retention_v1'])
})
it('an actual pre-read hash mismatch cannot reach Storage remove or native finish',async()=>{
 io.download.mockReset().mockResolvedValue({error:null,data:new Blob([Buffer.from('wrong')])})
 await expect(purgeRetainedContractDocument({companyId,decisionId})).rejects.toThrow('actual_hash_length_changed');expect(io.remove).not.toHaveBeenCalled();expect(io.rpc).toHaveBeenCalledTimes(1)
})
it('a remove error or still-present object cannot be relabelled physical absence',async()=>{
 io.remove.mockResolvedValue({error:Error('current_grant_revoked')})
 await expect(purgeRetainedContractDocument({companyId,decisionId})).rejects.toThrow('current_grant_revoked');expect(io.rpc).toHaveBeenCalledTimes(1)
 io.remove.mockResolvedValue({error:null});io.download.mockReset().mockResolvedValue({error:null,data:new Blob([bytes])})
 await expect(purgeRetainedContractDocument({companyId,decisionId})).rejects.toThrow('actual_unavailability_readback_required');expect(io.rpc).toHaveBeenCalledTimes(2)
})
it('a 403 storage response proves denial, not absent bytes',async()=>{
 io.download.mockReset().mockResolvedValue({error:{statusCode:'403',message:'Not authorized'},data:null})
 await expect(purgeRetainedContractDocument({companyId,decisionId})).rejects.toMatchObject({statusCode:'403'});expect(io.remove).not.toHaveBeenCalled()
})
it('crash after actual delete can repair from observed absence but native immutable delete admission remains mandatory',async()=>{
 io.download.mockReset().mockResolvedValue(absent)
 expect(await purgeRetainedContractDocument({companyId,decisionId})).toMatchObject({physicalBytesObservedUnavailable:true})
 expect(io.remove).not.toHaveBeenCalled();expect(io.rpc.mock.calls[1][0]).toBe('ediel_finish_contract_document_retention_v1')
 io.rpc.mockImplementation(async(name)=>({error:name.includes('finish')?Error('actual_storage_delete_receipt_required'):null,data:pending}))
 await expect(purgeRetainedContractDocument({companyId,decisionId})).rejects.toThrow('actual_storage_delete_receipt_required')
})
it('native current source binding and fresh tombstone failures cannot be replaced by a public available flag',async()=>{
 io.serviceRpc.mockResolvedValue({error:null,data:{status:'not_tombstoned',companyId,retentionClass:'contract_signed_pdf_bytes',targetId:contractId,customerId,authorizesProviderEntry:false}})
 await expect(requireCustomerRecordAvailable({companyId,retentionClass:'contract_signed_pdf_bytes',targetId})).rejects.toThrow('source_binding_changed')
 io.serviceRpc.mockResolvedValue({error:Error('customer_record_retention_tombstoned'),data:null})
 await expect(requireCustomerRecordAvailable({companyId,retentionClass:'contract_signed_pdf_bytes',targetId})).rejects.toThrow('tombstoned')
})
it('native final receipt must retain exact target/hash/byte-length binding',async()=>{
 io.rpc.mockImplementation(async(name)=>({error:null,data:name.includes('begin')?pending:{status:'storage_object_absent',retentionClass:'contract_signed_pdf_bytes',targetId:contractId,sourceHash,byteLength:bytes.length,replay:false}}))
 await expect(purgeRetainedContractDocument({companyId,decisionId})).rejects.toThrow('actual_receipt_binding_changed')
})
