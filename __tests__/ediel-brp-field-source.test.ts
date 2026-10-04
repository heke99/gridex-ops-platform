import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),structure:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/sources/qualifiedCustomerStructure',()=>({readQualifiedCustomerStructure:io.structure}))
import {prepareQualifiedBrpSource,type BrpFieldScope} from '@/lib/ediel/production/brpFieldSource'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const scope:BrpFieldScope={companyId:id(1),contractId:id(2),actorUserId:id(3),environment:'production',customerId:id(4),siteId:id(5),meteringPointId:id(6),at:'2026-11-01T12:34:00+01:00',supplyPeriodId:id(7)}
const held={status:'held',missing:['same_dated_structural_owner_brp_candidate']}
const basis=()=>({status:'authorized',sourceKind:'accepted_supply_brp',...scope,brpEdielId:'11111',pointId:'735123456789012345',identityAgency:'9',legalActorId:id(8),legalSenderId:'12345',legalReceiverId:'54321',gridArea:'TES',sourceMessageId:id(9),sourcePayloadHash:'a'.repeat(64)})
const structure=()=>({status:'selected',snapshotId:id(10),readsetHash:'c'.repeat(64),selection:{coverage:{supplyPeriodId:id(7)},states:[{sourceMessageId:id(9),measurements:{balanceResponsibleId:{sourceMessageId:id(9),value:'11111'}}}]}})
beforeEach(()=>{vi.clearAllMocks();io.rpc.mockResolvedValue({data:held,error:null});io.structure.mockResolvedValue(structure())})
it('prepares a dated change only from the existing structural owner and exact protected native snapshot',async()=>{
 io.rpc.mockResolvedValueOnce({data:held,error:null}).mockResolvedValueOnce({data:basis(),error:null}).mockResolvedValueOnce({data:basis(),error:null})
 expect(await prepareQualifiedBrpSource(scope)).toMatchObject({status:'authorized',sourceKind:'accepted_supply_brp',brpEdielId:'11111'})
 expect(io.structure).toHaveBeenCalledWith(expect.objectContaining({periodStart:scope.at,periodEnd:scope.at}))
 expect(io.rpc.mock.calls[1]).toEqual(['ediel_qualify_brp_source_candidate_v1',expect.objectContaining({p_snapshot_id:id(10),p_readset_hash:'c'.repeat(64),p_source_message_id:id(9),p_period_id:id(7)})])
})
it('keeps a first supply held without an authentic signed-contract declaration and never invents an earlier DSO period',async()=>{
 io.rpc.mockResolvedValue({data:{status:'held',missing:['unique_authentic_signed_contract_brp_declaration']},error:null})
 expect(await prepareQualifiedBrpSource({...scope,supplyPeriodId:null})).toMatchObject({status:'held'})
 expect(io.structure).not.toHaveBeenCalled();expect(io.rpc).toHaveBeenCalledTimes(1)
})
it('does not manufacture a new approval when dated source authority, own262 or period is missing',async()=>{
 for(const result of [{status:'unavailable'}, {...structure(),selection:{...structure().selection,coverage:{supplyPeriodId:id(99)}}}, {...structure(),selection:{...structure().selection,states:[{measurements:{balanceResponsibleId:{value:null,sourceMessageId:null}}}]}}]){
  io.structure.mockResolvedValue(result);io.rpc.mockClear()
  expect(await prepareQualifiedBrpSource(scope)).toMatchObject({status:'held'});expect(io.rpc).toHaveBeenCalledTimes(1)
 }
})
it('does not turn a qualified old snapshot into current approval after the native source changes',async()=>{
 io.rpc.mockResolvedValueOnce({data:held,error:null}).mockResolvedValueOnce({data:basis(),error:null}).mockResolvedValueOnce({data:held,error:null})
 expect(await prepareQualifiedBrpSource(scope)).toEqual(held)
})
it.each(['companyId','siteId','meteringPointId','environment'])('rejects foreign or mismatched native %s before rendering',async key=>{
 io.rpc.mockResolvedValue({data:{...basis(),[key]:key==='environment'?'test':id(99)},error:null})
 await expect(prepareQualifiedBrpSource(scope)).rejects.toThrow('brp_field_source_scope_invalid')
 expect(io.structure).not.toHaveBeenCalled()
})
it('propagates current native authority errors without a portal or desired-B fallback',async()=>{
 io.rpc.mockResolvedValue({data:null,error:Error('current_source_unconfirmed')})
 await expect(prepareQualifiedBrpSource(scope)).rejects.toThrow('current_source_unconfirmed');expect(io.structure).not.toHaveBeenCalled()
})
it('requires the declared first-agreement kind and original, not an invented earlier supply basis',async()=>{
 const first={...scope,supplyPeriodId:null}
 io.rpc.mockResolvedValue({data:{...basis(),supplyPeriodId:null},error:null})
 await expect(prepareQualifiedBrpSource(first)).rejects.toThrow('brp_field_source_scope_invalid')
 io.rpc.mockResolvedValue({data:{...basis(),sourceKind:'signed_contract_brp_declaration',supplyPeriodId:null,declarationId:id(11)},error:null})
 expect(await prepareQualifiedBrpSource(first)).toMatchObject({sourceKind:'signed_contract_brp_declaration',declarationId:id(11)})
 expect(io.structure).not.toHaveBeenCalled()
})
