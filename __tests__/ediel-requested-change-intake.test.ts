import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
import {supabaseService} from '@/lib/supabase/service'
import {archiveRequestedChangeSource,readRequestedChangeArtifact,readRequestedChangeArtifactBytes,reviewRequestedChangeArtifact,type RequestedChangeSourceSubmission} from '@/lib/ediel/production/requestedChangeIntake'
const rpc=vi.mocked(supabaseService.rpc),scope={companyId:'own-company',actorUserId:'actual-actor',artifactId:'opaque-artifact'}
const bytes=Buffer.from('%PDF-1.7\nSYNTHETIC TEST ONLY\n%%EOF'),sourceHash=createHash('sha256').update(bytes).digest('hex')
const address={lines:['TEST ROAD 1','',''] as const,city:'TEST',postalCode:'12345',country:'SE',representation:{convention:'SOURCE',reference:'SYNTHETIC',mode:1 as const}}
const identity={id:'SYNTHETIC-CUSTOMER',qualifier:'' as const,agency:'89' as const}
const submission:RequestedChangeSourceSubmission={supplyPeriodId:'own-supply',contractId:'own-contract',kind:'death',effectiveAt:'2026-10-01T12:00Z',source:{bytesBase64:bytes.toString('base64'),mimeType:'application/pdf',reference:'SYNTHETIC',version:'1'},customerIdentity:{...identity,name:'SYNTHETIC',addressLines:['TEST ROAD 1'],city:'TEST',postalCode:'12345',country:'SE'},invoiceeProfile:{meteringPointId:'735999123456789012',identityAgency:'9',endUser:{identity,address},invoicee:{identity,nameLines:['SYNTHETIC'],address,availability:'available'},event:{state:'none',reference:'SYNTHETIC'},source:{kind:'caller_selection',companyId:scope.companyId,reference:'SYNTHETIC'}}}
beforeEach(()=>rpc.mockReset())
it('archives the server-owned selectors and original source bytes without treating absence of issuer proof as approval',async()=>{
 rpc.mockResolvedValueOnce({data:{status:'archived',artifactId:scope.artifactId,sourceHash,claimsHash:'b'.repeat(64),missing:['authentic_current_issuer_and_representation_receipt']},error:null} as never)
 const result=await archiveRequestedChangeSource({...submission,companyId:scope.companyId,actorUserId:scope.actorUserId})
 expect(result.status).toBe('archived');expect(result).not.toHaveProperty('eventId');expect(rpc).toHaveBeenCalledWith('ediel_archive_requested_change_source_v1',{p_company_id:scope.companyId,p_actor_user_id:scope.actorUserId,p_submission:submission})
})
it.each(['','%%%','AA==\n','AB=='])('rejects noncanonical/empty source base64 before nativeeffects: %j',async encoded=>{await expect(archiveRequestedChangeSource({...submission,companyId:scope.companyId,actorUserId:scope.actorUserId,source:{...submission.source,bytesBase64:encoded}})).rejects.toThrow('source_bytes_invalid');expect(rpc).not.toHaveBeenCalled()})
it('rejects over8MB before native effects',async()=>{await expect(archiveRequestedChangeSource({...submission,companyId:scope.companyId,actorUserId:scope.actorUserId,source:{...submission.source,bytesBase64:Buffer.alloc(8*1024*1024+1).toString('base64')}})).rejects.toThrow('source_bytes_invalid');expect(rpc).not.toHaveBeenCalled()})
it('read metadata never exposes bytes and refuses a foreign opaque response',async()=>{
 rpc.mockResolvedValueOnce({data:{status:'archived',artifactId:'foreign',sourceHash,byteLength:bytes.length},error:null} as never);await expect(readRequestedChangeArtifact(scope)).rejects.toThrow('artifact_scope_invalid')
 rpc.mockResolvedValueOnce({data:{status:'archived',artifactId:scope.artifactId,sourceHash,byteLength:bytes.length,bytesBase64:bytes.toString('base64')},error:null} as never);await expect(readRequestedChangeArtifact(scope)).rejects.toThrow('artifact_result_invalid')
})
it('source read uses current actor/company and rechecks actual returned bytes/hash',async()=>{
 rpc.mockResolvedValueOnce({data:{status:'held',artifactId:scope.artifactId,mimeType:'application/pdf',sourceHash,byteLength:bytes.length,bytesBase64:bytes.toString('base64')},error:null} as never)
 expect(Buffer.from((await readRequestedChangeArtifactBytes(scope)).bytes)).toEqual(bytes);expect(rpc).toHaveBeenCalledWith('ediel_read_requested_change_artifact_v1',{p_company_id:scope.companyId,p_artifact_id:scope.artifactId,p_actor_user_id:scope.actorUserId,p_include_bytes:true})
 rpc.mockResolvedValueOnce({data:{status:'held',artifactId:scope.artifactId,mimeType:'application/pdf',sourceHash:'a'.repeat(64),byteLength:bytes.length,bytesBase64:bytes.toString('base64')},error:null} as never);await expect(readRequestedChangeArtifactBytes(scope)).rejects.toThrow('artifact_bytes_invalid')
})
it('review preserves authentic native missing-source hold and propagates revoked permission; caller decision grants no authority',async()=>{
 const cmd={sourceHash,claimsHash:'b'.repeat(64),decision:'approve' as const,reason:'SYNTHETIC separate review'}
 rpc.mockResolvedValueOnce({data:{status:'held',artifactId:scope.artifactId,missing:['authentic_current_issuer_and_representation_receipt']},error:null} as never)
 expect((await reviewRequestedChangeArtifact({...scope,...cmd})).status).toBe('held');expect(rpc).toHaveBeenCalledWith('ediel_review_requested_change_artifact_v1',{p_company_id:scope.companyId,p_artifact_id:scope.artifactId,p_actor_user_id:scope.actorUserId,p_review:cmd})
 rpc.mockResolvedValueOnce({data:null,error:Error('requested_change_review_actor_forbidden')} as never);await expect(reviewRequestedChangeArtifact({...scope,...cmd})).rejects.toThrow('review_actor_forbidden')
})
