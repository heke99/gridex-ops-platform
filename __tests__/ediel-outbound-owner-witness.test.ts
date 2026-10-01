import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc }=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
import {prepareEdielOutboundOwnerWitness} from '@/lib/ediel/core/outboundOwnerWitness'
const evidence={profileKey:'DB:E66',messageProfileId:'00000000-0000-0000-0000-000000000002',rulePackId:'00000000-0000-0000-0000-000000000001',version:'25.A:r3',sourceHash:'a'.repeat(64),snapshot:{rulePack:{actual:true},messageProfile:{actual:true},guideSources:[]}}
const sealed={...evidence,snapshot:{...evidence.snapshot,profileKey:evidence.profileKey,profileVersionId:evidence.messageProfileId,version:evidence.version,checksum:evidence.sourceHash}}
const input={companyId:'company',actorUserId:'actor',environment:'test' as const,rawPayload:'actual original raw',rulePackEvidence:evidence}
describe('prospective outbound original canonical owner witness adapter',()=>{
 beforeEach(()=>rpc.mockReset())
 it('prepares the same exact original witness and raw/company/actor scope before insert',async()=>{
  rpc.mockResolvedValue({data:{version:1,witnessId:'00000000-0000-0000-0000-000000000010',evidence:sealed},error:null})
  expect(await prepareEdielOutboundOwnerWitness(input)).toEqual({witnessId:'00000000-0000-0000-0000-000000000010',evidence:sealed})
  expect(rpc).toHaveBeenCalledWith('ediel_prepare_outbound_owner_witness_v1',{p_input:input})
 })
 it.each([{version:'changed'},{sourceHash:'f'.repeat(64)},{messageProfileId:'different'},{snapshot:{...sealed.snapshot,version:'changed'}}])('rejects a changed returned selection/version %j',async patch=>{
  rpc.mockResolvedValue({data:{version:1,witnessId:'00000000-0000-0000-0000-000000000010',evidence:{...sealed,...patch}},error:null})
  await expect(prepareEdielOutboundOwnerWitness(input)).rejects.toThrow('ediel_outbound_owner_witness_required')
 })
 it('keeps absent or malformed native seals held without fallback',async()=>{
  rpc.mockResolvedValue({data:{version:1,witnessId:'forged',evidence:sealed},error:null})
  await expect(prepareEdielOutboundOwnerWitness(input)).rejects.toThrow('ediel_outbound_owner_witness_required')
  expect(rpc).toHaveBeenCalledTimes(1)
 })
})
