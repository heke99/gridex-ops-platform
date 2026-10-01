import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {assertMeteringMethodChangeSendSource} from '@/lib/ediel/production/meteringMethodChangeSource'
import type {EdielMessageRow} from '@/lib/ediel/types'
const{rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
const source={id:'source',company_id:'company',environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z09',raw_payload:'actual original bytes',intent_id:'intent'} as EdielMessageRow
const result=(kind='agreement')=>({version:1,kind,companyId:source.company_id,environment:source.environment,messageId:source.id,intentId:source.intent_id,sourcePayloadHash:createHash('sha256').update(source.raw_payload!).digest('hex')})
describe('method watch consumes actual protected send source kind',()=>{
 beforeEach(()=>rpc.mockReset())
 it.each(['agreement','certification','not_applicable'])('returns %s only from actual native same-source scope',async kind=>{
  rpc.mockResolvedValue({data:result(kind),error:null})
  expect(await assertMeteringMethodChangeSendSource(source,'actor')).toEqual({kind})
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith('ediel_metering_method_change_send_basis_v1',{p_company_id:'company',p_message_id:'source',p_actor_user_id:'actor'})
 })
 it('does not treat a test environment or metadata flag as certification',async()=>{
  rpc.mockResolvedValue({data:null,error:null})
  await expect(assertMeteringMethodChangeSendSource({...source,parsed_payload:{certification:true}},'actor')).rejects.toThrow('origin_mismatch')
 })
 it.each(['sourcePayloadHash','companyId','environment','messageId','intentId'])('holds a mismatched native %s',async key=>{
  rpc.mockResolvedValue({data:{...result('certification'),[key]:'other'},error:null})
  await expect(assertMeteringMethodChangeSendSource(source,'actor')).rejects.toThrow('origin_mismatch')
 })
 it('retains native live source holds and refuses missing tenant',async()=>{
  rpc.mockResolvedValue({data:null,error:new Error('current_test_original_required')})
  await expect(assertMeteringMethodChangeSendSource(source,'actor')).rejects.toThrow('current_test_original_required')
  await expect(assertMeteringMethodChangeSendSource({...source,company_id:null},'actor')).rejects.toThrow('company_required')
 })
 it('does not read method authority for another business operation',async()=>{
  expect(await assertMeteringMethodChangeSendSource({...source,message_code:'Z13'},'actor')).toEqual({kind:'not_applicable'})
  expect(rpc).not.toHaveBeenCalled()
 })
})
