// masterplan: AT-Z03H-SUPPLIER
import {beforeEach,expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
import {supabaseService} from '@/lib/supabase/service'
import {qualifyBilateralProdatSwitchPreparation,bilateralProdatSwitchPreparationQualified} from '@/lib/ediel/production/bilateralProdatSwitchPreparation'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,rpc=vi.mocked(supabaseService.rpc)
const scope={companyId:id(1),actorUserId:id(2),switchId:id(3),environment:'test' as const}
const own={...scope,pointId:id(4),customerId:id(5),siteId:id(6),contractId:id(7),requestedStartDate:'2026-10-15',senderEdielId:'12345',receiverEdielId:'54321'}
const native=()=>({...own,version:1,owner:'immutable-bilateral-prodat-switch-preparation-v1',objectId:'735123456789012345',contractHash:'a'.repeat(64),profileVersionId:id(8),rulePackId:id(9),messageProfileId:id(10),sourceVersion:'26.A:r3',sourceHash:'b'.repeat(64),sourceGrammarHash:'c'.repeat(64),gridAreaCode:'TES'})
beforeEach(()=>rpc.mockReset())
it('only actual private profile read returns opaque own preparation; copies and altered own selections cannot render',async()=>{
 rpc.mockResolvedValueOnce({data:native(),error:null} as never)
 const q=await qualifyBilateralProdatSwitchPreparation(scope)
 expect(rpc).toHaveBeenCalledExactlyOnceWith('ediel_qualify_bilateral_prodat_switch_preparation_v1',{p_company_id:scope.companyId,p_switch_id:scope.switchId,p_actor_user_id:scope.actorUserId,p_environment:'test'})
 expect(bilateralProdatSwitchPreparationQualified(q,own)).toBe(true)
 expect(bilateralProdatSwitchPreparationQualified({...q},own)).toBe(false)
 for(const key of ['companyId','actorUserId','switchId','pointId','customerId','siteId','contractId','requestedStartDate','senderEdielId','receiverEdielId'])expect(bilateralProdatSwitchPreparationQualified(q,{...own,[key]:'other'})).toBe(false)
})
it.each([{companyId:id(99)},{actorUserId:id(99)},{switchId:id(99)},{environment:'production'},{owner:'caller_approved'},{pointId:'approved'},{sourceGrammarHash:'ready'},{sourceVersion:'27.A:r1'}])('altered native profile scope %j never qualifies',async change=>{
 rpc.mockResolvedValueOnce({data:{...native(),...change},error:null} as never);await expect(qualifyBilateralProdatSwitchPreparation(scope)).rejects.toThrow('receipt_unqualified')
})
it('missing real bilateral profile or revoked issuer/reviewer holds on the sole read RPC, without request/intent/original writes',async()=>{
 rpc.mockResolvedValueOnce({data:null,error:null} as never);await expect(qualifyBilateralProdatSwitchPreparation(scope)).rejects.toThrow('current_profile_required');expect(rpc).toHaveBeenCalledTimes(1)
})
