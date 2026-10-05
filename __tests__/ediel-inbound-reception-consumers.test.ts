// These explicitly declared receipt ports prove consumers, not authentic mail
// trust, T duplicate response policy or native acceptance.
import{beforeEach,describe,expect,it,vi}from'vitest'
const io=vi.hoisted(()=>({read:vi.fn(),record:vi.fn(),events:vi.fn(),acks:vi.fn(),create:vi.fn(),queue:vi.fn(),safe:vi.fn(),inbound:vi.fn(),parse:vi.fn(),status:vi.fn(),task:vi.fn(),match:'matched'}))
vi.mock('@/lib/ediel/inbound/receptions',async(original)=>({...await original<object>(),readInboundReceptionRequest:io.read,recordInboundReception:io.record}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 rpc:async(name:string,args:Record<string,unknown>)=>{
  if(name!=='ediel_read_unattributed_technical_intake_v1')throw Error(`Undeclared reception fixture RPC: ${name}`)
  expect(args).toEqual({p_inbound_email_message_id:'00000000-0000-4000-8000-000000000010',p_source_message_id:null,p_actor_user_id:'00000000-0000-4000-8000-000000000002'})
  // This ordinary reception has no protected technical birth; null grants no authority.
  return{data:null,error:null}
 },
 from:(table:string)=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:[],error:null}),maybeSingle:async()=>({data:table==='inbound_email_messages'?{id:'00000000-0000-4000-8000-000000000010',body_text:"UNB+UNOC:3+54321:ZZ+21660:ZZ+261001:0000+OWN+++++23-DDQ-PRODAT'UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z02+OWN+9'LIN+1'UNT+4+1'UNZ+1+OWN'",environment:'test',ediel_mailboxes:{id:'00000000-0000-4000-8000-000000000004',environment:'test'}}:null,error:null})};return q}}}))
vi.mock('@/lib/inbound-mail/inboundStatusUpdater',()=>({applySafeInboundStatusUpdate:io.safe,createInboundEdielMessage:io.inbound,createParseResult:io.parse,createUnresolvedInboundEdielMessage:vi.fn(),updateInboundEmailProcessingStatus:io.status}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory',()=>({createInboundMailTask:io.task}))
vi.mock('@/lib/inbound-mail/inboundTenantResolver',()=>({resolveTenantForInboundEdiel:vi.fn(async()=>({status:'resolved',companyId:'00000000-0000-4000-8000-000000000001',shared:null}))}))
vi.mock('@/lib/inbound-mail/inboundMatcher',()=>({matchOutboundRequestForInbound:vi.fn(async()=>({status:io.match,entityId:'out',entityType:'ediel_message',reasons:[],candidates:[{customer_id:'00000000-0000-4000-8000-000000000009'}]})),matchMeteringPointForInbound:vi.fn(async()=>({status:'missing',entityId:null,reasons:[],candidates:[]}))}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:io.create,registerInboundCanonicalMessage:vi.fn()}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:io.events,listAckMessagesForSource:io.acks}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:io.queue}))
import{InboundReceptionHeldError,type InboundReception}from'@/lib/ediel/inbound/receptions'
import{processInboundEmailMessage}from'@/lib/inbound-mail/edielInboundProcessor'
import{runAutoAckOrchestratorForInboundMessage}from'@/lib/ediel/orchestrator/autoAckOrchestrator'
import type{EdielMessageRow}from'@/lib/ediel/types'
import type{EdielEngineDecision}from'@/lib/ediel/decisionEngine'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',sourceId='00000000-0000-4000-8000-000000000003',mail='00000000-0000-4000-8000-000000000010',parse='00000000-0000-4000-8000-000000000020',raw='SYNTHETIC ORIGINAL'
function message(patch:Partial<EdielMessageRow>={}):EdielMessageRow{return {
 id:sourceId,company_id:company,direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z04',message_version:null,process_type:null,environment:'test',test_flag:1,status:'received',transport_type:'smtp',mailbox:null,mailbox_message_id:null,
 sender_ediel_id:null,sender_name:null,sender_sub_address:null,receiver_ediel_id:null,receiver_name:null,receiver_sub_address:null,sender_email:null,receiver_email:null,subject:null,file_name:null,mime_type:null,
 interchange_reference:'ACTUAL',external_reference:null,correlation_reference:null,transaction_reference:null,application_reference:null,original_message_id:null,original_transaction_id:null,original_message_code:null,related_message_id:null,
 communication_route_id:null,outbound_request_id:null,switch_request_id:null,grid_owner_data_request_id:null,partner_export_id:null,customer_id:null,site_id:null,metering_point_id:null,grid_owner_id:null,raw_payload:raw,parsed_payload:{},validation_report:{},
 requires_contrl:true,requires_aperak:true,contrl_status:null,aperak_status:null,utilts_err_status:null,ack_outcome:null,syntax_check_status:null,functional_check_status:null,failure_reason:null,
 message_created_at:null,message_received_at:null,message_sent_at:null,parsed_at:null,validated_at:null,acknowledged_at:null,failed_at:null,ack_due_at:null,created_at:'2026-09-30T12:00:00Z',updated_at:'2026-09-30T12:00:00Z',created_by:null,updated_by:null,...patch}}
const held:InboundReception={companyId:company,sourceMessageId:sourceId,inboundEmailMessageId:mail,parseResultId:parse,receptionId:'receipt',classification:'protocol_duplicate',isReplay:false,receivedAt:'2026-10-01T00:00:00Z',canonicalPayloadHash:'a'.repeat(64),receivedPayloadHash:'a'.repeat(64),responseRequestId:'request',status:'held',reason:'authentic_duplicate_transport_response_policy_required',businessEffectAuthorized:false}
const decision:EdielEngineDecision={kind:'ack',ackFamily:'APERAK',outcome:'positive',messageText:null,applicationErrors:[],reason:'synthetic consumer probe',ruleKeys:[],classification:null}
beforeEach(()=>{vi.resetAllMocks();io.match='matched';io.parse.mockResolvedValue(parse);io.safe.mockRejectedValue(new InboundReceptionHeldError(held));io.inbound.mockRejectedValue(new InboundReceptionHeldError(held));io.read.mockResolvedValue(held);io.acks.mockResolvedValue([])})
describe('new receipt held projection and existing ACK separation',()=>{
 it.each(['matched','missing'])('keeps NEWmail held and stops business work/status overwrite for %s ingress',async(match)=>{
  io.match=match
  expect(await processInboundEmailMessage({inboundEmailMessageId:mail,actorUserId:actor})).toEqual({status:'manual_review',companyId:company,parseResultId:parse})
  expect(io.task).toHaveBeenCalledOnce();expect(io.task).toHaveBeenCalledWith(expect.objectContaining({taskType:'ediel_duplicate_response_held',metadata:expect.objectContaining({sourceId:'request',inboundEmailMessageId:mail})}))
  expect(io.status).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
  if(match==='missing')expect(io.inbound).toHaveBeenCalledWith(expect.objectContaining({actorUserId:actor,environment:'test',parseResultId:parse}))
 })
 it('checks exact protected reception before even consulting final ACK lifecycle',async()=>{
  expect(await runAutoAckOrchestratorForInboundMessage({actorUserId:actor,sourceMessage:message(),decision,inboundEmailMessageId:mail})).toMatchObject({status:'manual_review',lifecycleStatus:'duplicate_response_held',ackMessageId:null})
  expect(io.read).toHaveBeenCalledWith({companyId:company,messageId:sourceId,actorUserId:actor,inboundEmailMessageId:mail})
  expect(io.acks).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(io.events).not.toHaveBeenCalled()
 })
 it('does not invent a reception during internal replay without an actual mailbox selector',async()=>{
  await runAutoAckOrchestratorForInboundMessage({actorUserId:actor,sourceMessage:message(),decision:{...decision,kind:'no_ack'}})
  expect(io.read).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
 it('fails closed for an unregistered/foreign reception selector',async()=>{
  io.read.mockResolvedValue(null)
  await expect(runAutoAckOrchestratorForInboundMessage({actorUserId:actor,sourceMessage:message(),decision,inboundEmailMessageId:mail})).rejects.toThrow('exact_reception_original_required')
  expect(io.acks).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
})
