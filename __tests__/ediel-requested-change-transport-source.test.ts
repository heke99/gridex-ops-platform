import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {closureFixture} from './helpers/closureWireFixtures'
const io=vi.hoisted(()=>({rpc:vi.fn(),provider:vi.fn(),route:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:()=>{throw Error('unexpected_operational_read')}}}))
vi.mock('@/lib/email/sendEdielEmail',()=>({sendEdielEmail:io.provider}))
vi.mock('@/lib/ediel/db',()=>({getEdielRouteProfileByCommunicationRouteId:io.route,updateEdielMessageStatus:vi.fn(),createEdielMessageEvent:vi.fn()}))
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport/index.part-2'
const companyId='10000000-0000-4000-8000-000000000001',messageId='20000000-0000-4000-8000-000000000001'
const actorUserId='30000000-0000-4000-8000-000000000001'
beforeEach(()=>{
 vi.clearAllMocks()
 io.rpc.mockImplementation(async(name,args)=>{
  if(name==='gridex_ediel_accepted_transport_projection_v1')return {data:null,error:null}
  if(name==='ediel_customer_life_event_message_basis_v1'||name==='ediel_customer_masterdata_message_basis_v1'){expect(args).toEqual({p_company_id:companyId,p_message_id:messageId,p_actor_user_id:actorUserId});return {data:null,error:null}}
  if(name==='ediel_brp_change_message_basis_v1'||name==='ediel_require_brp_change_source_current_v1')return {data:null,error:null}
  if(name==='ediel_requested_change_message_basis_v1'){
   expect(args).toEqual({p_company_id:companyId,p_message_id:messageId,p_actor_user_id:actorUserId})
   return {data:null,error:null}
  }
  if(name==='ediel_require_requested_change_source_current_v1'){
   expect(args).toEqual({p_company_id:companyId,p_message_id:messageId})
   return {data:null,error:new Error('requested_change_actual_source_revoked')}
  }
  throw Error(`unexpected_rpc:${name}`)
 })
})
it.each([['E','E34'],['F','E64'],['G','E32']] as const)('actual fresh Z09%s send cannot replace current source authority with parsed JSON',async(variant,reason)=>{
 // Synthetic bytes test the consumer's native call order. Native source,
 // immutable event and contract proof remain in the native SQL companion.
 const raw=closureFixture({reason}).wire.replace('BGM+Z05','BGM+Z09')
 const message={id:messageId,company_id:companyId,environment:'test',direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z09',status:'validated',raw_payload:raw,
  parsed_payload:{transactionSubtype:variant,requestedChangeBasis:{status:'authorized',sourceCurrent:true},requestedChangeSourceQualified:true}} as unknown as EdielMessageRow
 await expect(sendEdielMessageViaSmtp(message,{actorUserId})).rejects.toThrow('requested_change_actual_source_revoked')
 expect(io.rpc.mock.calls.map(([name])=>name)).toEqual(['gridex_ediel_accepted_transport_projection_v1','ediel_customer_life_event_message_basis_v1','ediel_customer_masterdata_message_basis_v1','ediel_brp_change_message_basis_v1','ediel_require_brp_change_source_current_v1','ediel_requested_change_message_basis_v1','ediel_require_requested_change_source_current_v1'])
 expect(io.route).not.toHaveBeenCalled();expect(io.provider).not.toHaveBeenCalled()
})
