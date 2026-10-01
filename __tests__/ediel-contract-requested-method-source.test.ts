import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {readContractRequestedMethodSource,assertContractRequestedMethodSelection} from '@/lib/ediel/production/contractRequestedMethodSource'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const input={companyId:id(1),contractId:id(2),actorUserId:id(3),environment:'test' as const}
const basis=()=>({status:'authorized' as const,declarationId:id(4),companyId:id(1),environment:'test' as const,contractId:id(2),contractRevision:'declared-fixture-revision',protectedContractHash:'a'.repeat(64),agreementSha256:'b'.repeat(64),customerId:id(5),siteId:id(6),meteringPointId:id(7),pointId:'735123456789012345',identityAgency:'9' as const,legalActorId:id(8),legalSenderId:'12345',legalReceiverId:'54321',gridArea:'TES',requestedMethod:'Z04',sourceReference:'declared mechanical fixture only',sourceVersion:'v1',sourceDigest:'c'.repeat(64)})
beforeEach(()=>{vi.clearAllMocks();io.rpc.mockResolvedValue({data:basis(),error:null})})
it('reads actual protected company/contract/environment/actor selectors without caller requested method',async()=>{
 expect(await readContractRequestedMethodSource(input)).toEqual(basis())
 expect(io.rpc).toHaveBeenCalledWith('ediel_contract_metering_request_source_v1',{p_company_id:id(1),p_contract_id:id(2),p_actor_user_id:id(3),p_environment:'test'})
})
it.each(['Z01','Z02','15'])('does not accept previous/current/guessed method %s as a new agreement declaration',async method=>{
 io.rpc.mockResolvedValue({data:{...basis(),requestedMethod:method},error:null})
 await expect(readContractRequestedMethodSource(input)).rejects.toThrow('contract_requested_method_source_scope_invalid')
})
it('preserves explicit missing external declaration as held',async()=>{
 const held={status:'held',missing:['unique_authentic_new_agreement_requested_method_declaration']}
 io.rpc.mockResolvedValue({data:held,error:null});expect(await readContractRequestedMethodSource(input)).toEqual(held)
})
it('rejects a different exact selected customer/site/point or environment',()=>{
 const selection={companyId:id(1),contractId:id(2),customerId:id(5),siteId:id(6),meteringPointId:id(7),environment:'test' as const}
 for(const bad of [{customerId:id(10)},{siteId:id(10)},{meteringPointId:id(10)},{environment:'production' as const}])expect(()=>assertContractRequestedMethodSelection(basis(),{...selection,...bad})).toThrow('contract_requested_method_selected_scope_mismatch')
})
