// masterplan: AT-Z09F-SUPPLIER, AT-Z09G-SUPPLIER
// A metering-method Z09F/G original has no requested-change origin. The SQL
// requested-change guard only proves that the method owner binds the message;
// it receives no sender identity. The actual current sender (not the stored
// creator) must reach the method owner's send check in the same send.
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {closureFixture} from './helpers/closureWireFixtures'
const io=vi.hoisted(()=>({rpc:vi.fn(),provider:vi.fn(),route:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:()=>{throw Error('unexpected_operational_read')}}}))
vi.mock('@/lib/email/sendEdielEmail',()=>({sendEdielEmail:io.provider}))
vi.mock('@/lib/ediel/db',()=>({getEdielRouteProfileByCommunicationRouteId:io.route,updateEdielMessageStatus:vi.fn(),createEdielMessageEvent:vi.fn()}))
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport/index.part-2'
const companyId='10000000-0000-4000-8000-000000000001',messageId='20000000-0000-4000-8000-000000000001'
const creatorUserId='30000000-0000-4000-8000-000000000001',senderUserId='30000000-0000-4000-8000-000000000002'
beforeEach(()=>{
 vi.clearAllMocks()
 io.rpc.mockImplementation(async(name,args)=>{
  if(name==='gridex_ediel_accepted_transport_projection_v1')return {data:null,error:null}
  if(['ediel_customer_life_event_message_basis_v1','ediel_customer_masterdata_message_basis_v1','ediel_brp_change_message_basis_v1','ediel_requested_change_message_basis_v1'].includes(name)){
   expect(args.p_actor_user_id).toBe(senderUserId);return {data:null,error:null}
  }
  if(name==='ediel_require_brp_change_source_current_v1')return {data:null,error:null}
  // Bridged guard: method-owner binding only, no actor parameter exists.
  if(name==='ediel_require_requested_change_source_current_v1'){expect(args).toEqual({p_company_id:companyId,p_message_id:messageId});return {data:null,error:null}}
  // The creator's permission is revoked; only the current sender is authorized.
  if(name==='ediel_metering_method_change_send_basis_v1')return args.p_actor_user_id===senderUserId
   ?{data:null,error:new Error('stop_after_current_sender_method_check')}
   :{data:null,error:new Error('creator_authority_revoked')}
  throw Error(`unexpected_rpc:${name}`)
 })
})
it.each([['F','E64'],['G','E32']] as const)('Z09%s method original created by a revoked user reaches the method owner with the actual current sender',async(_variant,reason)=>{
 const raw=closureFixture({reason}).wire.replace('BGM+Z05','BGM+Z09')
 const message={id:messageId,company_id:companyId,environment:'test',direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z09',status:'validated',raw_payload:raw,created_by:creatorUserId} as unknown as EdielMessageRow
 await expect(sendEdielMessageViaSmtp(message,{actorUserId:senderUserId})).rejects.toThrow('stop_after_current_sender_method_check')
 const calls=io.rpc.mock.calls.map(([name])=>name)
 expect(calls.slice(-3)).toEqual(['ediel_requested_change_message_basis_v1','ediel_require_requested_change_source_current_v1','ediel_metering_method_change_send_basis_v1'])
 expect(io.rpc.mock.calls.find(([name])=>name==='ediel_metering_method_change_send_basis_v1')?.[1]).toEqual({p_company_id:companyId,p_message_id:messageId,p_actor_user_id:senderUserId})
 expect(io.route).not.toHaveBeenCalled();expect(io.provider).not.toHaveBeenCalled()
})
