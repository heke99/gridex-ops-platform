import {beforeEach,expect,it,vi} from 'vitest'
import {readSourceQualifiedBilateralProdatOutboundOriginal,qualifyBilateralProdatOutboundDraft,bilateralProdatOutboundDraftQualified} from '@/lib/ediel/production/bilateralProdatOutboundDraft'
import {raw,line,characteristic} from '@/__tests__/fixtures/prodat-register'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {EdielMessageRow,CreateEdielMessageInput} from '@/lib/ediel/types'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const payload=raw([line('1','POINT'),...characteristic('Z13','Z25'),['RFF',['LI','OWN-LI']]],'Z03')
const draft:CreateEdielMessageInput={companyId:id(1),actorUserId:id(2),environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z03',rawPayload:payload}
const original={id:id(3),company_id:id(1),environment:'test',direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z03',raw_payload:payload,created_by:id(4)} as EdielMessageRow
const projection={version:1,owner:'immutable-bilateral-prodat-outbound-profile-v1',companyId:id(1),environment:'test',actorUserId:id(2),originalActorUserId:id(4),payloadHash:evidenceHash(payload),messageCode:'Z03',objects:[{
 objectId:'POINT',identityAgency:'89',firstLineIndex:0,lineItemReference:'OWN-LI',profileVersionId:id(5),process:'normal_start_h',sourceHash:'a'.repeat(64),sourceGrammarHash:'b'.repeat(64),rulePackId:id(6),messageProfileId:id(7),pointId:id(8),customerId:id(9),siteId:id(10),contractId:id(11),contractHash:'c'.repeat(64),eventAt:'2026-10-09T00:00:00Z',switchId:id(12)}]}
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:projection,error:null})})
it('actual READ selects the existing reader RPC and cannot qualify an outbound sender draft',async()=>{
 const read=await readSourceQualifiedBilateralProdatOutboundOriginal(original,id(2))
 expect(rpc).toHaveBeenCalledExactlyOnceWith('ediel_read_bilateral_prodat_outbound_original_v1',{p_company_id:id(1),p_actor_user_id:id(2),p_message_id:id(3)})
 expect(read?.payloadHash).toBe(evidenceHash(payload))
 expect(bilateralProdatOutboundDraftQualified({draft,actorUserId:id(2),qualification:read as never})).toBe(false)
 const copied={...read}
 expect(bilateralProdatOutboundDraftQualified({draft,actorUserId:id(2),qualification:copied as never})).toBe(false)
})
it('the existing genuine sender qualification still redeems through its private issued map',async()=>{
 const qualification=await qualifyBilateralProdatOutboundDraft({draft,actorUserId:id(2)})
 expect(rpc).toHaveBeenCalledExactlyOnceWith('ediel_qualify_bilateral_prodat_outbound_draft_v1',{p_company_id:id(1),p_actor_user_id:id(2),p_environment:'test',p_raw_payload:payload})
 expect(bilateralProdatOutboundDraftQualified({draft,actorUserId:id(2),qualification})).toBe(true)
})
it('a recorded original actor mismatch cannot disclose qualified availability',async()=>{
 rpc.mockResolvedValueOnce({data:{...projection,originalActorUserId:id(99)},error:null})
 await expect(readSourceQualifiedBilateralProdatOutboundOriginal(original,id(2))).rejects.toThrow('bilateral_prodat_outbound_original_provenance_required')
})
