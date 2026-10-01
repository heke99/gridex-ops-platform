import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
import {supabaseService} from '@/lib/supabase/service'
import {archiveBilateralProdatGround,readBilateralProdatGroundScope,readBilateralProdatGroundBytes,readBilateralProdatGroundArtifact,reviewBilateralProdatGround,type BilateralProdatSubmission} from '@/lib/ediel/production/bilateralProdatProfileIntake'
const rpc=vi.mocked(supabaseService.rpc),id='11111111-1111-4111-8111-111111111111',scope={companyId:'own-company',actorUserId:'current-actor',artifactId:id}
const bytes=Buffer.from('%PDF-1.7\nSYNTHETIC bounded RPC boundary only\n%%EOF'),sourceHash=createHash('sha256').update(bytes).digest('hex'),scopeHash='b'.repeat(64)
const submission:BilateralProdatSubmission={environment:'test',kind:'normal_start_h',rulePackId:id,gridAreaCode:'TES',bilateralAgreementId:id,validFrom:'2026-01-01T00:00:00Z',validTo:'2099-01-01T00:00:00Z',source:{bytesBase64:bytes.toString('base64'),mimeType:'application/pdf',reference:'SYNTHETIC',version:'1'}}
const result=(status:string,extra:Record<string,unknown>={})=>({data:{status,companyId:scope.companyId,artifactId:id,sourceHash,scopeHash,missing:['authentic_current_issuer_representation_and_legal_ground_receipt'],...extra},error:null})
beforeEach(()=>rpc.mockReset())
it('archives exact original bytes/current tenant and actor; a held issuer is never ground authority',async()=>{
 rpc.mockResolvedValueOnce(result('archived') as never)
 expect((await archiveBilateralProdatGround({companyId:scope.companyId,actorUserId:scope.actorUserId,...submission})).status).toBe('archived')
 expect(rpc).toHaveBeenCalledExactlyOnceWith('ediel_archive_bilateral_prodat_ground_v1',{p_company_id:scope.companyId,p_actor_user_id:scope.actorUserId,p_submission:submission})
})
it.each(['','%%%','AA==\n','AB=='])('invalid original base64 %j has zero native writes',async encoded=>{await expect(archiveBilateralProdatGround({companyId:scope.companyId,actorUserId:scope.actorUserId,...submission,source:{...submission.source,bytesBase64:encoded}})).rejects.toThrow('source_bytes_invalid');expect(rpc).not.toHaveBeenCalled()})
it('8MB limit applies before native archive',async()=>{await expect(archiveBilateralProdatGround({companyId:scope.companyId,actorUserId:scope.actorUserId,...submission,source:{...submission.source,bytesBase64:Buffer.alloc(8*1024*1024+1).toString('base64')}})).rejects.toThrow('source_bytes_invalid');expect(rpc).not.toHaveBeenCalled()})
it.each([{companyId:'foreign'},{artifactId:'foreign'},{sourceHash:'a'.repeat(64)},{scopeHash:'forged'}])('refuses malformed/misbound archive receipt %j',async bad=>{rpc.mockResolvedValueOnce(result('archived',bad) as never);await expect(archiveBilateralProdatGround({companyId:scope.companyId,actorUserId:scope.actorUserId,...submission})).rejects.toThrow('unqualified')})
it('issuer scope returned by native owner must bind exact selected contract/point/kind/environment/company',async()=>{
 const selector={environment:submission.environment,kind:submission.kind,rulePackId:submission.rulePackId,gridAreaCode:submission.gridAreaCode,bilateralAgreementId:submission.bilateralAgreementId,validFrom:submission.validFrom,validTo:submission.validTo},actual={...selector,gridArea:selector.gridAreaCode,companyId:scope.companyId}
 rpc.mockResolvedValueOnce(result('scoped',{scope:actual}) as never);expect((await readBilateralProdatGroundScope({companyId:scope.companyId,actorUserId:scope.actorUserId,...selector})).status).toBe('scoped')
 rpc.mockResolvedValueOnce(result('scoped',{scope:{...actual,rulePackId:'foreign'}}) as never);await expect(readBilateralProdatGroundScope({companyId:scope.companyId,actorUserId:scope.actorUserId,...selector})).rejects.toThrow('scope_result_unqualified')
})
it('metadata cannot leak original bytes or a foreign artifact; exact original download rechecks hash/length',async()=>{
 rpc.mockResolvedValueOnce(result('held',{bytesBase64:bytes.toString('base64')}) as never);await expect(readBilateralProdatGroundArtifact(scope)).rejects.toThrow('artifact_result_unqualified')
 rpc.mockResolvedValueOnce(result('held',{bytesBase64:bytes.toString('base64'),byteLength:bytes.length,mimeType:'application/pdf'}) as never);expect(Buffer.from((await readBilateralProdatGroundBytes(scope)).bytes)).toEqual(bytes)
 rpc.mockResolvedValueOnce(result('held',{bytesBase64:bytes.toString('base64'),byteLength:bytes.length+1,mimeType:'application/pdf'}) as never);await expect(readBilateralProdatGroundBytes(scope)).rejects.toThrow('bytes_unqualified')
})
it('separate native review preserves exact source/scope hashes and a missing actual issuer hold',async()=>{
 const command={sourceHash,scopeHash,decision:'approve' as const,reason:'Separate source review'}
 rpc.mockResolvedValueOnce(result('held') as never);expect((await reviewBilateralProdatGround({...scope,...command})).status).toBe('held')
 expect(rpc).toHaveBeenCalledExactlyOnceWith('ediel_review_bilateral_prodat_ground_v1',{p_company_id:scope.companyId,p_actor_user_id:scope.actorUserId,p_artifact_id:id,p_review:command})
 rpc.mockResolvedValueOnce({data:null,error:Error('bilateral_prodat_review_actor_forbidden')} as never);await expect(reviewBilateralProdatGround({...scope,...command})).rejects.toThrow('actor_forbidden')
})
it.each([{profileVersionId:'caller-ready',missing:[]},{profileVersionId:id,missing:['actual_current_issuer_required']}])('malformed native authorized return %j grants no wrapper authority',async extra=>{rpc.mockResolvedValueOnce(result('authorized',extra) as never);await expect(reviewBilateralProdatGround({...scope,sourceHash,scopeHash,decision:'approve',reason:'Review'})).rejects.toThrow('review_result_unqualified')})
