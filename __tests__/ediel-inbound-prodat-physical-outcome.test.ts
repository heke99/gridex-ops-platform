import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {readInboundProdatPhysicalOutcomes} from '@/lib/ediel/ack/prodatPhysicalOutcome'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
const c='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222'
const a={id:'33333333-3333-4333-8333-333333333333',company_id:c,environment:'test',direction:'inbound',message_family:'APERAK',raw_payload:'actual ACK'} as EdielMessageRow
const s={id:'44444444-4444-4444-8444-444444444444',company_id:c,environment:'test',direction:'outbound',message_family:'PRODAT',raw_payload:'sealed original'} as EdielMessageRow
const input={actorUserId:actor,ackMessage:a,sourceMessage:s}
const projection={
 'lib/ediel/prodat/prodatRegisterGroups.ts':'142e9e441e6a94708841dec9aaddb9656b091aa04536c00ec358a6b59bcfe291',
 'lib/ediel/prodat/prodatRegisterFields.ts':'1d171216b8fd8be093a4b6d5e0d9e04cf969468ba342dfcde4771b46fe5df09c',
 'lib/ediel/prodat/prodat26AFieldMatrix.ts':'a96b7dcddb564aad04d3be6ee7aef1117601eccd893b47869a8ddc60b3794382',
 'lib/ediel/rulebook/prodatRegisterPolicy.ts':'72ab4f6836154c74a4dcd8e3fefec92fc31bb5da6800318707b591f51f44bf0e',
}
const receipt=()=>({version:1,sourceProjectionVersion:projection,companyId:c,environment:'test',ackMessageId:a.id,sourceMessageId:s.id,ackPayloadHash:evidenceHash(a.raw_payload!),sourcePayloadHash:evidenceHash(s.raw_payload!),physicalOutcomes:[{reference:'@prodat-physical-source:'+s.id+':lin:8',outcome:'negative',physicalReference:{firstLineIndex:8,objectId:'POINT-A',identityAgency:'9',lineItemReference:null}},{reference:'REAL-LI',outcome:'positive',physicalReference:{firstLineIndex:12,objectId:'POINT-B',identityAgency:'9',lineItemReference:'REAL-LI'}}]})
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({error:null,data:receipt()})})
it('reads the exact source/ACK/operator tuple through the protected native owner',async()=>{
 const r=await readInboundProdatPhysicalOutcomes(input)
 expect(rpc).toHaveBeenCalledWith('ediel_read_inbound_prodat_physical_outcomes_v1',{p_company_id:c,p_environment:'test',p_ack_message_id:a.id,p_source_message_id:s.id,p_actor_user_id:actor})
 expect(r?.physicalOutcomes).toMatchObject([{outcome:'negative',firstLineIndex:8,lineItemReference:null},{outcome:'positive',lineItemReference:'REAL-LI'}])
 expect(Object.isFrozen(r?.physicalOutcomes)).toBe(true)
 expect(r?.sourceProjectionVersion).toEqual(projection);expect(Object.isFrozen(r?.sourceProjectionVersion)).toBe(true)
})
it('absent new native receipt stays absent without projection from public metadata',async()=>{rpc.mockResolvedValue({error:null,data:null});expect(await readInboundProdatPhysicalOutcomes({...input,ackMessage:{...a,parsed_payload:{verified:true,outcome:'negative'}}})).toBeNull()})
it('current authority denial is propagated without raw fallback',async()=>{rpc.mockResolvedValue({error:Error('actor_forbidden'),data:null});await expect(readInboundProdatPhysicalOutcomes(input)).rejects.toThrow('actor_forbidden')})
it.each(['companyId','environment','ackMessageId','sourceMessageId','ackPayloadHash','sourcePayloadHash'] as const)('rejects a foreign immutable %s',async key=>{rpc.mockResolvedValue({error:null,data:{...receipt(),[key]:'foreign'}});await expect(readInboundProdatPhysicalOutcomes(input)).rejects.toThrow('ack_prodat_physical_receipt_invalid')})
it('missing LI cannot acquire a positive own outcome',async()=>{const r=receipt();r.physicalOutcomes[0].outcome='positive';rpc.mockResolvedValue({error:null,data:r});await expect(readInboundProdatPhysicalOutcomes(input)).rejects.toThrow('ack_prodat_physical_receipt_invalid')})
it('refuses client actor flags and cross-tenant source before any RPC',async()=>{await expect(readInboundProdatPhysicalOutcomes({...input,actorUserId:'verified'})).rejects.toThrow('scope_required');await expect(readInboundProdatPhysicalOutcomes({...input,sourceMessage:{...s,company_id:actor}})).rejects.toThrow('scope_required');expect(rpc).not.toHaveBeenCalled()})
it('refuses a missing source projection version',async()=>{rpc.mockResolvedValue({error:null,data:{...receipt(),sourceProjectionVersion:null}});await expect(readInboundProdatPhysicalOutcomes(input)).rejects.toThrow('ack_prodat_physical_receipt_invalid')})
