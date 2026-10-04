import {beforeEach,it,expect,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {deathRaw,deathBody} from './fixtures/prodat-death-status'
const io=vi.hoisted(()=>({rpc:vi.fn(async(name:string,args:unknown)=>{
 if(['ediel_customer_masterdata_message_basis_v1','ediel_customer_life_event_message_basis_v1','ediel_brp_change_message_basis_v1','ediel_metering_method_change_message_basis_v1','ediel_require_metering_method_change_source_current_v1','ediel_requested_change_message_basis_v1'].includes(name)){
  expect(args).toEqual({p_company_id:'00000000-0000-4000-8000-000000000002',p_actor_user_id:'00000000-0000-4000-8000-000000000003',p_message_id:'00000000-0000-4000-8000-000000000001'})
  return{data:null,error:null}
 }
 if(['ediel_require_brp_change_source_current_v1','ediel_require_requested_change_source_current_v1'].includes(name)){
  expect(args).toEqual({p_company_id:'00000000-0000-4000-8000-000000000002',p_message_id:'00000000-0000-4000-8000-000000000001'})
  // Actual native Z09E has neither an approved event nor registered original.
  return{data:null,error:name==='ediel_require_requested_change_source_current_v1'?new Error('requested_change_original_origin_required'):null}
 }
 if(name!=='gridex_ediel_accepted_transport_projection_v1')throw new Error('UNEXPECTED_RPC_BOUNDARY')
 expect(args).toEqual({p_company_id:'00000000-0000-4000-8000-000000000002',p_environment:'test',p_actor_user_id:'00000000-0000-4000-8000-000000000003',p_message_id:'00000000-0000-4000-8000-000000000001'})
 return {data:null,error:null}
}),from:vi.fn(()=>{throw new Error('DB_BOUNDARY_REACHED')}),provider:vi.fn(()=>{throw new Error('PROVIDER_BOUNDARY_REACHED')}),event:vi.fn(),update:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:io.provider}))
vi.mock('@/lib/ediel/db',()=>({getEdielRouteProfileByCommunicationRouteId:vi.fn(),createEdielMessageEvent:io.event,updateEdielMessageStatus:io.update}))
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
beforeEach(()=>vi.clearAllMocks())
for(const [wire,label] of [['Z05','Z05'],['Z06','Z04'],['Z09','Z09'],['Z04','Z06']])it(`actual shared SMTP rejects unqualified death scope ${wire}/${label} before external edges`,async()=>{
 const row={id:'00000000-0000-4000-8000-000000000001',company_id:'00000000-0000-4000-8000-000000000002',direction:'outbound',environment:'test',message_standard:'edifact',message_family:'PRODAT',message_code:label,raw_payload:deathRaw(wire,deathBody(wire==='Z05'?'Z23':wire==='Z04'?'Z22':'E34')),parsed_payload:{transactionSubtype:label==='Z05'?'LK':'E',rulebookAllowInvalidSend:true,prodatEngine:{registerEvidence:{facts:{deathStatus:{source:{kind:'tgt'}}}}}}} as unknown as EdielMessageRow
 const before=structuredClone(row)
 await expect(sendEdielMessageViaSmtp(row,{actorUserId:'00000000-0000-4000-8000-000000000003'})).rejects.toThrow(wire==='Z09'?'requested_change_original_origin_required':'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
 expect(io.rpc).toHaveBeenNthCalledWith(1,'gridex_ediel_accepted_transport_projection_v1',{p_company_id:row.company_id,p_environment:'test',p_actor_user_id:'00000000-0000-4000-8000-000000000003',p_message_id:row.id})
 if(wire==='Z09')expect(io.rpc).toHaveBeenLastCalledWith('ediel_require_requested_change_source_current_v1',{p_company_id:row.company_id,p_message_id:row.id})
 else expect(io.rpc).toHaveBeenLastCalledWith('ediel_customer_masterdata_message_basis_v1',{p_company_id:row.company_id,p_message_id:row.id,p_actor_user_id:'00000000-0000-4000-8000-000000000003'})
 expect(io.from).not.toHaveBeenCalled();expect(io.provider).not.toHaveBeenCalled();expect(io.event).not.toHaveBeenCalled();expect(io.update).not.toHaveBeenCalled();expect(row).toEqual(before)
})
