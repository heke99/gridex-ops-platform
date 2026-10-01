// Source authority/technical route modules below are declared mechanical probes.
// These tests prove gateway consumers; they are not native or authentic evidence.
import {createHash} from 'node:crypto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({actor:vi.fn(),duplicate:vi.fn(),ackDuplicate:vi.fn(),validation:vi.fn(),witness:vi.fn(),legacyCreate:vi.fn(),create:vi.fn(),conflict:vi.fn(),endpoint:vi.fn(),technical:vi.fn(),technicalRoute:vi.fn(),sourcePack:vi.fn(),route:vi.fn()}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/core/dedupe',()=>({hasCanonicalAckDuplicate:io.ackDuplicate,findOutboundEdielMessageDuplicate:io.duplicate}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessage:io.create,createCanonicalAckConflictEvent:io.conflict,findSequencedAckForSource:vi.fn().mockResolvedValue(null)}))
vi.mock('@/lib/ediel/rulebook/validator',()=>({validateRulebookMessageWithRegistry:io.validation}))
vi.mock('@/lib/ediel/core/outboundOwnerWitness',()=>({prepareEdielOutboundOwnerWitness:io.witness}))
vi.mock('@/lib/ediel/core/ackSourceRulePackEvidence',()=>({readSourceBoundOutboundAckRulePackEvidence:io.sourcePack}))
vi.mock('@/lib/ediel/ack/technicalSyntaxAuthority',()=>({readEdielTechnicalSourceEndpoint:io.endpoint,requireEdielTechnicalSyntaxAckEvidence:io.technical}))
vi.mock('@/lib/ediel/ack/technicalSyntaxRoute',()=>({readTechnicalSyntaxAckRoute:io.technicalRoute}))
vi.mock('@/lib/ediel/utilts/positiveAckAuthority',()=>({assertUtiltsPositiveAckSourceAuthority:vi.fn()}))
vi.mock('@/lib/ediel/testing/negativeFixtureAuthority',()=>({readSourceQualifiedNegativeFixtureDraft:()=>null,sourceQualifiedNegativeFixtureMatchesDraft:()=>false}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn().mockResolvedValue('D:96A:UN:E2SE6A')}))
vi.mock('@/lib/ediel/core/referenceRegistry',()=>({buildCanonicalAckReferences:vi.fn(),buildCanonicalOutboundReferences:vi.fn().mockReturnValue({})}))
vi.mock('@/lib/ediel/core/kernelLegacy',()=>({createCanonicalOutboundMessage:io.legacyCreate,resolveCanonicalOutboundContext:io.route,resolveCanonicalInboundActor:vi.fn(),resolveOutboundMessageVersion:vi.fn(),resolveInboundAcceptedVersions:vi.fn(),registerInboundCanonicalMessage:vi.fn(),buildCanonicalReferencesForOutbound:vi.fn()}))
import {createCanonicalAckMessage,createCanonicalOutboundMessage,finalizeCanonicalOutboundDraft,resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',sourceId='00000000-0000-4000-8000-000000000003',operation='00000000-0000-4000-8000-000000000004'
const raw="UNB+UNOC:3+REMOTE:ZZ:REMOTE-SUB+LOCAL:ZZ:LOCAL-SUB+260930:1200+ACTUAL++APP+++1'UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z04+SOURCE+9'UNT+3+1'UNZ+1+ACTUAL'"
function message(patch:Partial<EdielMessageRow>={}):EdielMessageRow{return {
 id:sourceId,company_id:company,direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z04',message_version:null,process_type:null,environment:'test',test_flag:1,status:'received',transport_type:'smtp',mailbox:null,mailbox_message_id:null,
 sender_ediel_id:null,sender_name:null,sender_sub_address:null,receiver_ediel_id:null,receiver_name:null,receiver_sub_address:null,sender_email:null,receiver_email:null,subject:null,file_name:null,mime_type:null,
 interchange_reference:'ACTUAL',external_reference:null,correlation_reference:null,transaction_reference:null,application_reference:null,original_message_id:null,original_transaction_id:null,original_message_code:null,related_message_id:null,
 communication_route_id:null,outbound_request_id:null,switch_request_id:null,grid_owner_data_request_id:null,partner_export_id:null,customer_id:null,site_id:null,metering_point_id:null,grid_owner_id:null,raw_payload:raw,parsed_payload:{},validation_report:{},
 requires_contrl:true,requires_aperak:true,contrl_status:null,aperak_status:null,utilts_err_status:null,ack_outcome:null,syntax_check_status:null,functional_check_status:null,failure_reason:null,
 message_created_at:null,message_received_at:null,message_sent_at:null,parsed_at:null,validated_at:null,acknowledged_at:null,failed_at:null,ack_due_at:null,created_at:'2026-09-30T12:00:00Z',updated_at:'2026-09-30T12:00:00Z',created_by:null,updated_by:null,...patch}}
const draft=():CreateEdielMessageInput=>({actorUserId:actor,companyId:company,environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z01',sourceOperationId:operation,rawPayload:raw,routeProfileId:'route-profile'})
const evidence=()=>({companyId:company,environment:'test',sourceMessageId:sourceId,sourceHash:createHash('sha256').update(raw,'utf8').digest('hex')})
const snapshot=()=>({profileKey:'canonical-z01',profileVersionId:'profile',version:'26.A:r3',checksum:'a'.repeat(64),originalWitness:{rulePack:{id:'pack',source_hash:'a'.repeat(64),guide_version:'26.A',guide_revision:3},messageProfile:{id:'profile',profile_key:'canonical-z01'}}})
const ackDraft=():CreateEdielMessageInput=>({...draft(),messageFamily:'CONTRL',messageCode:'CONTRL',companyId:null,rawPayload:"UNB+UNOC:3+LOCAL:ZZ:LOCAL-SUB+REMOTE:ZZ:REMOTE-SUB+260930:1201+ACKI++APP+++1'UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ACTUAL+REMOTE:ZZ:REMOTE-SUB+LOCAL:ZZ:LOCAL-SUB+4'UNT+3+1'UNZ+1+ACKI'"})
beforeEach(()=>{
 vi.clearAllMocks();io.actor.mockResolvedValue(undefined);io.duplicate.mockResolvedValue(null);io.ackDuplicate.mockResolvedValue(null);io.conflict.mockResolvedValue(undefined)
 io.endpoint.mockResolvedValue({companyId:company});io.technical.mockResolvedValue(evidence());io.technicalRoute.mockResolvedValue({route:{id:'technical-route'},routeRuntime:{route_profile_id:'technical-profile'},senderEdielId:'LOCAL',senderSubAddress:'LOCAL-SUB',receiverEdielId:'REMOTE',receiverSubAddress:'REMOTE-SUB',senderEmail:'local@example.invalid',receiverEmail:'remote@example.invalid',mailbox:'local@example.invalid',applicationReference:'APP'})
 io.sourcePack.mockRejectedValue(Error('current business guide must not load for technical CONTRL'))
 io.route.mockResolvedValue({companyId:company,environment:'test'});io.validation.mockResolvedValue({issues:[],blocking:false,fieldRuleSource:'registry',rulePackSnapshot:snapshot()})
 io.witness.mockImplementation(async(input)=>({witnessId:'opaque-server-witness',evidence:input.rulePackEvidence}));io.legacyCreate.mockResolvedValue(message({direction:'outbound',status:'draft'}));io.create.mockResolvedValue(message({direction:'outbound',message_family:'CONTRL',message_code:'CONTRL'}))
})
describe('canonical source-owner and technical gateway consumers',()=>{
 it('uses protected transport endpoint before legal routing for a tenant-unattributed source',async()=>{
  io.validation.mockResolvedValue({fieldRuleSource:'technical_source',blocking:false,technicalSyntaxAckEvidence:evidence()})
  await createCanonicalAckMessage({actorUserId:actor,sourceMessage:message({company_id:null}),ackFamily:'CONTRL',outcome:'negative',draft:ackDraft()})
  expect(io.actor).toHaveBeenCalledWith({companyId:company,actorUserId:actor,permission:'communication.send'})
  expect(io.technicalRoute).toHaveBeenCalledOnce();expect(io.route).not.toHaveBeenCalled();expect(io.sourcePack).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled()
  expect(io.create).toHaveBeenCalledWith(expect.objectContaining({companyId:company,canonicalRulePackId:null,executionContextSnapshot:null,relatedMessageId:sourceId,communicationRouteId:'technical-route',customerId:null,meteringPointId:null}))
 })
 it('returns an established own CONTRL before current endpoint, route or business guide reads',async()=>{
  const old=message({id:'own-ack',direction:'outbound',message_family:'CONTRL',message_code:'CONTRL',related_message_id:sourceId,status:'sent',ack_outcome:'negative'})
  io.ackDuplicate.mockResolvedValue(old);io.endpoint.mockRejectedValue(Error('endpoint revoked'));io.technicalRoute.mockRejectedValue(Error('route revoked'))
  expect(await createCanonicalAckMessage({actorUserId:actor,sourceMessage:message({company_id:null}),ackFamily:'CONTRL',outcome:'negative',draft:ackDraft()})).toBe(old)
  expect(io.endpoint).not.toHaveBeenCalled();expect(io.technical).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 it('refuses altered source bytes or evidence environment before technical route or writes',async()=>{
  for(const patch of [{raw_payload:raw+'altered'},{environment:'production' as const}]){
   await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:message(patch),ackFamily:'CONTRL',outcome:'negative',draft:{...ackDraft(),companyId:company,environment:patch.environment??'test'}})).rejects.toThrow('canonical_ack_actual_original_mismatch')
  }
  expect(io.technicalRoute).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 it('refuses another tenant or response source when duplicate lookup returns a conflicting row',async()=>{
  for(const patch of [{company_id:'foreign-company'},{related_message_id:'another-source'}]){
   io.ackDuplicate.mockResolvedValue(message({direction:'outbound',message_family:'CONTRL',message_code:'CONTRL',related_message_id:sourceId,...patch}))
   await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:message(),ackFamily:'CONTRL',outcome:'negative',draft:{...ackDraft(),companyId:company}})).rejects.toThrow('canonical_ack_duplicate_scope_mismatch')
  }
  expect(io.create).not.toHaveBeenCalled()
 })
 it('direct public creator obtains canonical validation and a one-use original witness instead of trusting supplied snapshot',async()=>{
  await createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:{...draft(),rulePackSnapshot:{forged:true},executionContextSnapshot:{outboundOwnerWitnessId:'caller-token'}}})
  expect(io.validation).toHaveBeenCalledOnce();expect(io.witness).toHaveBeenCalledWith(expect.objectContaining({companyId:company,environment:'test',rawPayload:raw,rulePackEvidence:expect.objectContaining({rulePackId:'pack'})}))
  expect(io.legacyCreate).toHaveBeenCalledWith(expect.objectContaining({baseInput:expect.objectContaining({executionContextSnapshot:{outboundOwnerWitnessId:'opaque-server-witness'},canonicalRulePackId:'pack'})}))
 })
 it('rejects blocking canonical diagnostics before minting original witness or writing a direct draft',async()=>{
  io.validation.mockResolvedValue({issues:[{severity:'error',code:'SYNTHETIC-REJECTION',description:'actual probe rejection'}],fieldRuleSource:'registry',rulePackSnapshot:snapshot()})
  await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:draft()})).rejects.toThrow('SYNTHETIC-REJECTION')
  expect(io.witness).not.toHaveBeenCalled();expect(io.legacyCreate).not.toHaveBeenCalled()
 })
 it('keeps server tenant/environment/operation/request authoritative over runtime duplicate-selector extra keys',async()=>{
  const routeContext=await resolveCanonicalOutboundContext({companyId:company,environment:'test',requestType:'customer_masterdata'})
  const duplicateCheck={sourceType:'manual',sourceId:'intent',messageFamily:'PRODAT',messageCode:'Z01',companyId:'foreign-company',environment:'production',sourceOperationId:'foreign-op',outboundRequestId:'foreign-request'}
  io.duplicate.mockResolvedValue(message({company_id:company,direction:'outbound',message_family:'PRODAT',message_code:'Z01',source_operation_id:operation,outbound_request_id:'own-request',status:'sent'}))
  await finalizeCanonicalOutboundDraft({actorUserId:actor,requestType:'customer_masterdata',routeContext,draft:draft(),outboundRequestId:'own-request',duplicateCheck})
  expect(io.duplicate).toHaveBeenCalledWith(expect.objectContaining({companyId:company,environment:'test',sourceOperationId:operation,outboundRequestId:'own-request'}))
  expect(io.validation).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled()
 })
 it('holds different wire for an established source operation before any current version/rule selection or write',async()=>{
  io.duplicate.mockResolvedValue(message({direction:'outbound',message_family:'PRODAT',message_code:'Z01',raw_payload:raw+'old',source_operation_id:operation,status:'sent'}))
  await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:draft(),duplicateCheck:{sourceType:'manual',sourceId:'intent',messageFamily:'PRODAT',messageCode:'Z01'}})).rejects.toThrow('canonical_outbound_existing_operation_wire_conflict')
  expect(io.validation).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled();expect(io.legacyCreate).not.toHaveBeenCalled()
 })
})
