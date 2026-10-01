// Explicit native reception fixture ports; no authentic T response policy.
import{beforeEach,describe,expect,it,vi}from'vitest'
const io=vi.hoisted(()=>({record:vi.fn(),duplicate:vi.fn(),create:vi.fn(),event:vi.fn(),actor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn(),from:vi.fn()}}))
vi.mock('@/lib/ediel/inbound/receptions',async(original)=>({...await original<object>(),recordInboundReception:io.record}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessage:io.create,createCanonicalDuplicateBlockEvent:io.event}))
vi.mock('@/lib/ediel/core/dedupe',async(original)=>({...await original<object>(),findInboundDuplicateByCanonicalIdentity:io.duplicate}))
import{registerInboundCanonicalMessage}from'@/lib/ediel/core/kernelLegacy'
import{InboundReceptionHeldError}from'@/lib/ediel/inbound/receptions'
import type{EdielMessageRow,CreateEdielMessageInput}from'@/lib/ediel/types'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',sourceId='00000000-0000-4000-8000-000000000003',raw="UNB+UNOC:3+REMOTE:ZZ+LOCAL:ZZ+261001:0000+OWN'UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z04+OWN+9'UNT+3+1'UNZ+1+OWN'"
function message(patch:Partial<EdielMessageRow>={}):EdielMessageRow{return {
 id:sourceId,company_id:company,direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z04',message_version:null,process_type:null,environment:'test',test_flag:1,status:'received',transport_type:'smtp',mailbox:null,mailbox_message_id:null,
 sender_ediel_id:null,sender_name:null,sender_sub_address:null,receiver_ediel_id:null,receiver_name:null,receiver_sub_address:null,sender_email:null,receiver_email:null,subject:null,file_name:null,mime_type:null,
 interchange_reference:'ACTUAL',external_reference:null,correlation_reference:null,transaction_reference:null,application_reference:null,original_message_id:null,original_transaction_id:null,original_message_code:null,related_message_id:null,
 communication_route_id:null,outbound_request_id:null,switch_request_id:null,grid_owner_data_request_id:null,partner_export_id:null,customer_id:null,site_id:null,metering_point_id:null,grid_owner_id:null,raw_payload:raw,parsed_payload:{},validation_report:{},
 requires_contrl:true,requires_aperak:true,contrl_status:null,aperak_status:null,utilts_err_status:null,ack_outcome:null,syntax_check_status:null,functional_check_status:null,failure_reason:null,
 message_created_at:null,message_received_at:null,message_sent_at:null,parsed_at:null,validated_at:null,acknowledged_at:null,failed_at:null,ack_due_at:null,created_at:'2026-09-30T12:00:00Z',updated_at:'2026-09-30T12:00:00Z',created_by:null,updated_by:null,...patch}}
const input:CreateEdielMessageInput={companyId:company,environment:'test',direction:'inbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z04',rawPayload:raw}
const reception={inboundEmailMessageId:'00000000-0000-4000-8000-000000000010',parseResultId:'00000000-0000-4000-8000-000000000020'}
const held={companyId:company,sourceMessageId:sourceId,...reception,receptionId:'reception',classification:'protocol_duplicate',isReplay:false,receivedAt:'2026-10-01T00:00:00Z',canonicalPayloadHash:'a'.repeat(64),receivedPayloadHash:'a'.repeat(64),responseRequestId:'request',status:'held',reason:'authentic_duplicate_transport_response_policy_required',businessEffectAuthorized:false}
beforeEach(()=>{vi.resetAllMocks();io.duplicate.mockResolvedValue(message());io.actor.mockResolvedValue(undefined);io.record.mockResolvedValue(held);io.create.mockResolvedValue(message());io.event.mockResolvedValue(undefined)})
describe('canonical ingress explicit receipt consumer',()=>{
 it('does not manufacture an arrival during internal saved-source replay',async()=>{
  expect(await registerInboundCanonicalMessage({actorUserId:actor,input})).toMatchObject({id:sourceId});expect(io.record).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 it('qualifies exact new receipt and holds before reusing the old source or creating a new effect',async()=>{
  await expect(registerInboundCanonicalMessage({actorUserId:actor,input,reception})).rejects.toBeInstanceOf(InboundReceptionHeldError)
  expect(io.record).toHaveBeenCalledWith({companyId:company,messageId:sourceId,actorUserId:actor,...reception});expect(io.event).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 it('records a first real receipt after canonical first persistence without changing source bytes',async()=>{
  io.duplicate.mockResolvedValue(null);io.record.mockResolvedValue({...held,status:'observed',classification:'first_reception',responseRequestId:null,reason:null})
  expect(await registerInboundCanonicalMessage({actorUserId:actor,input,reception})).toMatchObject({id:sourceId,raw_payload:raw});expect(io.create).toHaveBeenCalledOnce();expect(io.record).toHaveBeenCalledOnce()
 })
})
