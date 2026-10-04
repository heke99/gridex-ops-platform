import {beforeEach,describe,expect,it,vi} from 'vitest'
import {projectSupplyEndFollowup} from '@/lib/ediel/flows/supplyEndFollowup'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const input={companyId:id(1),actorUserId:id(2),effectReceiptId:id(3)}
beforeEach(()=>{vi.clearAllMocks();io.rpc.mockResolvedValue({data:{status:'created',caseId:id(4),effectReceiptId:id(3),sourceMessageId:id(5)},error:null})})
describe('source-owned end operational projection',()=>{
 it('passes only actual executor and receipt identity, never proposed customer/period facts',async()=>{
  expect(await projectSupplyEndFollowup(input)).toEqual({status:'created',caseId:id(4),effectReceiptId:id(3),sourceMessageId:id(5)})
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_project_supply_end_followup_v1',{p_company_id:id(1),p_effect_receipt_id:id(3),p_actor_user_id:id(2)})
 })
 it('preserves an existing closed operational outcome as the native result',async()=>{
  io.rpc.mockResolvedValue({data:{status:'existing',caseId:id(4),effectReceiptId:id(3),sourceMessageId:id(5)},error:null})
  expect((await projectSupplyEndFollowup(input)).status).toBe('existing')
 })
 it('does not invent a case for a non-end or genuinely superseded end',async()=>{
  io.rpc.mockResolvedValue({data:{status:'not_applicable',effectReceiptId:id(3),sourceMessageId:id(5)},error:null})
  expect(await projectSupplyEndFollowup(input)).not.toHaveProperty('caseId')
 })
 it.each([{effectReceiptId:'hint'},{actorUserId:''},{companyId:'other'}])('rejects unqualified identity selectors %s',async extra=>{
  await expect(projectSupplyEndFollowup({...input,...extra})).rejects.toThrow('identity_required');expect(io.rpc).not.toHaveBeenCalled()
 })
 it.each([{effectReceiptId:id(9)},{sourceMessageId:'hint'},{caseId:null},{status:'applied'}])('rejects mismatched or truncated native results %s',async extra=>{
  io.rpc.mockResolvedValue({data:{status:'created',caseId:id(4),effectReceiptId:id(3),sourceMessageId:id(5),...extra},error:null})
  await expect(projectSupplyEndFollowup(input)).rejects.toThrow('result_invalid')
 })
 it('propagates native authorization/qualification errors without making an operational case',async()=>{
  io.rpc.mockResolvedValue({data:null,error:Error('own_source_held')})
  await expect(projectSupplyEndFollowup(input)).rejects.toThrow('own_source_held')
 })
})
