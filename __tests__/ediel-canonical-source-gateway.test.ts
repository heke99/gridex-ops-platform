// Source authority/technical route modules below are declared mechanical probes.
// These tests prove gateway consumers; they are not native or authentic evidence.
import {createHash} from 'node:crypto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {deathBody,deathRaw,deathSelection} from './fixtures/prodat-death-status'
import {characteristic} from './fixtures/prodat-register'
import {isQualifiedDeathStatusContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
const io=vi.hoisted(()=>({actor:vi.fn(),replay:vi.fn(),rpc:vi.fn(),registryDispatch:vi.fn(),duplicate:vi.fn(),ackDuplicate:vi.fn(),validation:vi.fn(),witness:vi.fn(),legacyCreate:vi.fn(),create:vi.fn(),conflict:vi.fn(),endpoint:vi.fn(),technical:vi.fn(),technicalRoute:vi.fn(),sourcePack:vi.fn(),route:vi.fn(),positiveRead:vi.fn(),positiveMatch:vi.fn(),positivePrepare:vi.fn(),negativeRead:vi.fn(),negativeMatch:vi.fn(),negativePrepare:vi.fn(),commonRead:vi.fn(),commonPrepare:vi.fn(),commonRoute:vi.fn(),aiOriginal:vi.fn(),version:vi.fn(),references:vi.fn(),ackReferences:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Record<string,unknown>)=>io.rpc.getMockImplementation()?io.rpc(name,args):io.replay(name,args)}}))
vi.mock('@/lib/ediel/config',()=>({getEdielRouteRuntimeByCommunicationRouteId:vi.fn()}))
// The tenant's verified supplier profile for the DDQ process (TEN-01/TEN-02 gate).
vi.mock('@/lib/ediel/core/actorRegistry',()=>({resolveCanonicalActorContext:async()=>({actor:{id:'supplier-profile'},actorRole:'supplier',senderEdielId:'LOCAL',legalActorEdielId:'LOCAL',transportActorEdielId:'LOCAL',marketRoles:['electricity_supplier']})}))
vi.mock('@/lib/actor-registry/registryMarketSource',()=>({readRegistryDispatchSource:io.registryDispatch}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/core/atomicAckPersistence',()=>({persistAtomicOutboundAck:(input:CreateEdielMessageInput)=>io.create(input)}))
vi.mock('@/lib/ediel/core/dedupe',()=>({hasCanonicalAckDuplicate:io.ackDuplicate,findOutboundEdielMessageDuplicate:io.duplicate}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessage:io.create,createCanonicalAckConflictEvent:io.conflict,findSequencedAckForSource:vi.fn().mockResolvedValue(null)}))
vi.mock('@/lib/ediel/rulebook/validator',()=>({validateRulebookMessageWithRegistry:io.validation}))
vi.mock('@/lib/ediel/core/outboundOwnerWitness',()=>({prepareEdielOutboundOwnerWitness:io.witness}))
vi.mock('@/lib/ediel/core/ackSourceRulePackEvidence',()=>({readSourceBoundOutboundAckRulePackEvidence:io.sourcePack}))
vi.mock('@/lib/ediel/ack/technicalSyntaxAuthority',()=>({readEdielTechnicalSourceEndpoint:io.endpoint,requireEdielTechnicalSyntaxAckEvidence:io.technical}))
vi.mock('@/lib/ediel/ack/technicalSyntaxRoute',()=>({readTechnicalSyntaxAckRoute:io.technicalRoute}))
vi.mock('@/lib/ediel/utilts/positiveAckAuthority',()=>({assertUtiltsPositiveAckSourceAuthority:vi.fn()}))
vi.mock('@/lib/ediel/testing/negativeFixtureAuthority',()=>({readSourceQualifiedNegativeFixtureDraft:io.negativeRead,sourceQualifiedNegativeFixtureMatchesDraft:io.negativeMatch,prepareSourceQualifiedNegativeFixtureWitness:io.negativePrepare}))
vi.mock('@/lib/ediel/testing/positiveFixtureAuthority',()=>({readSourceQualifiedPositiveFixtureDraft:io.positiveRead,sourceQualifiedPositiveFixtureMatchesDraft:io.positiveMatch,prepareSourceQualifiedPositiveFixtureWitness:io.positivePrepare}))
// This gateway probe supplies a declared qualification, not the private reader's
// branded evidence. Its reply APP port retains that same declared identity.
vi.mock('@/lib/ediel/ack/prodatCommonHeaderRejectionAuthority',()=>({readProdatCommonHeaderRejectionEvidence:io.commonRead,prepareProdatCommonHeaderNegativeAckWitness:io.commonPrepare,commonHeaderReplyApplicationReference:(e:{identities:{applicationReference:string}})=>e.identities.applicationReference}))
vi.mock('@/lib/ediel/ack/prodatCommonHeaderNegativeAckRoute',()=>({readProdatCommonHeaderNegativeAckRoute:io.commonRoute}))
vi.mock('@/lib/ediel/aiListOrigination',()=>({qualifyAiListProspectiveOriginal:io.aiOriginal}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:io.version}))
vi.mock('@/lib/ediel/core/referenceRegistry',()=>({buildCanonicalAckReferences:io.ackReferences,buildCanonicalOutboundReferences:io.references}))
vi.mock('@/lib/ediel/core/kernelLegacy',()=>({createCanonicalOutboundMessage:io.legacyCreate,resolveCanonicalOutboundContext:io.route,resolveCanonicalInboundActor:vi.fn(),resolveOutboundMessageVersion:vi.fn(),resolveInboundAcceptedVersions:vi.fn(),registerInboundCanonicalMessage:vi.fn(),buildCanonicalReferencesForOutbound:vi.fn()}))
import {createCanonicalAckMessage,createCanonicalOutboundMessage,finalizeCanonicalOutboundDraft,resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',sourceId='00000000-0000-4000-8000-000000000003',operation='00000000-0000-4000-8000-000000000004'
const raw="UNB+UNOC:3+REMOTE:ZZ:REMOTE-SUB+LOCAL:ZZ:LOCAL-SUB+260930:1200+ACTUAL++APP++++1'UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z04+SOURCE+9'UNT+3+1'UNZ+1+ACTUAL'"
function message(patch:Partial<EdielMessageRow>={}):EdielMessageRow{return {
 id:sourceId,company_id:company,direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z04',message_version:null,process_type:null,environment:'test',test_flag:1,status:'received',transport_type:'smtp',mailbox:null,mailbox_message_id:null,
 sender_ediel_id:null,sender_name:null,sender_sub_address:null,receiver_ediel_id:null,receiver_name:null,receiver_sub_address:null,sender_email:null,receiver_email:null,subject:null,file_name:null,mime_type:null,
 interchange_reference:'ACTUAL',external_reference:null,correlation_reference:null,transaction_reference:null,application_reference:null,original_message_id:null,original_transaction_id:null,original_message_code:null,related_message_id:null,
 communication_route_id:null,outbound_request_id:null,switch_request_id:null,grid_owner_data_request_id:null,partner_export_id:null,customer_id:null,site_id:null,metering_point_id:null,grid_owner_id:null,raw_payload:raw,parsed_payload:{},validation_report:{},
 requires_contrl:true,requires_aperak:true,contrl_status:null,aperak_status:null,utilts_err_status:null,ack_outcome:null,syntax_check_status:null,functional_check_status:null,failure_reason:null,
 message_created_at:null,message_received_at:null,message_sent_at:null,parsed_at:null,validated_at:null,acknowledged_at:null,failed_at:null,ack_due_at:null,created_at:'2026-09-30T12:00:00Z',updated_at:'2026-09-30T12:00:00Z',created_by:null,updated_by:null,...patch}}
const draft=():CreateEdielMessageInput=>({actorUserId:actor,companyId:company,environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z01',sourceOperationId:operation,rawPayload:raw,routeProfileId:'route-profile',applicationReference:'23-DDQ-PRODAT',senderEdielId:'LOCAL',receiverEdielId:'REMOTE',communicationRouteId:'route'})
const evidence=()=>({companyId:company,environment:'test',sourceMessageId:sourceId,sourceHash:createHash('sha256').update(raw,'utf8').digest('hex')})
const snapshot=()=>({profileKey:'canonical-z01',profileVersionId:'profile',version:'26.A:r3',checksum:'a'.repeat(64),originalWitness:{rulePack:{id:'pack',source_hash:'a'.repeat(64),guide_version:'26.A',guide_revision:3},messageProfile:{id:'profile',profile_key:'canonical-z01'}}})
const ackDraft=():CreateEdielMessageInput=>({...draft(),messageFamily:'CONTRL',messageCode:'CONTRL',companyId:null,rawPayload:"UNB+UNOC:3+LOCAL:ZZ:LOCAL-SUB+REMOTE:ZZ:REMOTE-SUB+260930:1201+ACKI++APP++++1'UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ACTUAL+REMOTE:ZZ:REMOTE-SUB+LOCAL:ZZ:LOCAL-SUB+4'UNT+3+1'UNZ+1+ACKI'"})
beforeEach(()=>{
 vi.resetAllMocks();io.registryDispatch.mockResolvedValue(null);io.ackReferences.mockReturnValue({});io.positiveRead.mockReturnValue(null);io.positiveMatch.mockReturnValue(false);io.negativeRead.mockReturnValue(null);io.negativeMatch.mockReturnValue(false);io.version.mockResolvedValue('D:96A:UN:E2SE6A');io.references.mockReturnValue({});io.aiOriginal.mockResolvedValue({owner:'mechanical declared private original port, not authentic evidence'});io.actor.mockResolvedValue(undefined);io.replay.mockResolvedValue({data:null,error:null});io.duplicate.mockResolvedValue(null);io.ackDuplicate.mockResolvedValue(null);io.conflict.mockResolvedValue(undefined)
 io.endpoint.mockResolvedValue({companyId:company});io.technical.mockResolvedValue(evidence());io.technicalRoute.mockResolvedValue({route:{id:'technical-route'},routeRuntime:{route_profile_id:'technical-profile'},senderEdielId:'LOCAL',senderSubAddress:'LOCAL-SUB',receiverEdielId:'REMOTE',receiverSubAddress:'REMOTE-SUB',senderEmail:'local@example.invalid',receiverEmail:'remote@example.invalid',mailbox:'local@example.invalid',applicationReference:'APP'})
 io.sourcePack.mockRejectedValue(Error('current business guide must not load for technical CONTRL'))
 io.route.mockResolvedValue({companyId:company,environment:'test'});io.validation.mockResolvedValue({issues:[],blocking:false,fieldRuleSource:'registry',rulePackSnapshot:snapshot()})
 io.witness.mockImplementation(async(input)=>({witnessId:'opaque-server-witness',evidence:input.rulePackEvidence}));io.legacyCreate.mockResolvedValue(message({direction:'outbound',status:'draft'}));io.create.mockResolvedValue(message({direction:'outbound',message_family:'CONTRL',message_code:'CONTRL'}))
})

describe('actual classified test original at public outbound consumers',()=>{
 const run='00000000-0000-4000-8000-000000000030',registration='00000000-0000-4000-8000-000000000031'
 function classifiedOriginal(){
  const rawPayload=deathRaw('Z09',deathBody('E34',characteristic('Z17','Z41')))
  const qualification={kind:'source_qualified_positive_fixture',registrationId:registration,companyId:company,runId:run,stepNo:1,expectedOutcome:'positive',expectedDiagnosticCodes:[]}
  const basis={status:'authorized',sourceKind:'independently_classified_fixture',authorizesBusinessEffect:false,companyId:company,environment:'test',code:'Z09',rawPayload,
   declarationId:'00000000-0000-4000-8000-000000000032',sourceVersion:'DECLARED-CLASSIFICATION-R1',sourceDigest:'a'.repeat(64),sourceReference:'DECLARED-GATEWAY-PORT',classification:'death',
   selection:deathSelection('death','Z09'),fixtureRegistrationId:registration,runId:run,expectedOutcome:'positive',expectedDiagnosticCodes:[],registeredCase:{roleCode:'supplier',caseCode:'DECLARED-E',suite:'PRODAT',revision:'DECLARED-R1',stepNo:1}}
  const input:CreateEdielMessageInput={...draft(),messageCode:'Z09',rawPayload,communicationRouteId:'actual-test-route',routeProfileId:'actual-test-profile',applicationReference:'23-DDQ-PRODAT',receiverEdielId:'R',receiverEmail:'receiver@example.invalid',receiverSubAddress:null}
  io.positiveRead.mockReturnValue(qualification);io.positiveMatch.mockReturnValue(true);io.positivePrepare.mockResolvedValue({witnessId:'declared-fixture-original',qualification})
  io.rpc.mockImplementation(async(name)=>{
   if(!['ediel_customer_event_certification_original_v1','ediel_customer_event_certification_preparation_basis_v1'].includes(name))throw Error(`Unexpected declared source RPC: ${name}`)
   return{data:basis,error:null}
  })
  return{input,basis,qualification}
 }
 it('requalifies the actual registration before the same national validator without minting an ordinary business intent',async()=>{
  const {input}=classifiedOriginal()
  await createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:input})
  expect(io.rpc).toHaveBeenNthCalledWith(1,'ediel_customer_event_certification_original_v1',{p_company_id:company,p_actor_user_id:actor,p_run_id:run,p_step_no:1})
  expect(io.rpc).toHaveBeenNthCalledWith(2,'ediel_customer_event_certification_preparation_basis_v1',{p_company_id:company,p_actor_user_id:actor,p_run_id:run,p_step_no:1,p_raw_payload:input.rawPayload})
  const validation=io.validation.mock.calls[0][0]
  expect(isQualifiedDeathStatusContext(validation.deathStatusContext)).toBe(true)
  expect(validation.deathStatusContext).toMatchObject({intentId:null,routeId:'actual-test-route',rawPayload:input.rawPayload,certification:{fixtureRegistrationId:registration,expectedOutcome:'positive',authorizesBusinessEffect:false}})
  expect(io.rpc.mock.invocationCallOrder[1]).toBeLessThan(io.validation.mock.invocationCallOrder[0])
  expect(io.legacyCreate.mock.calls[0][0].baseInput).toMatchObject({rawPayload:input.rawPayload,communicationRouteId:'actual-test-route'})
  expect(io.legacyCreate.mock.calls[0][0].baseInput.intentId).toBeUndefined()
 })
 it('holds absent independent classification before canonical diagnostics or any original seal',async()=>{
  const {input}=classifiedOriginal();io.rpc.mockResolvedValue({data:{status:'held',missing:['independent_authentic_certification_customer_event_classification']},error:null})
  await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:input})).rejects.toThrow('independent_classification_held')
  expect(io.validation).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled();expect(io.legacyCreate).not.toHaveBeenCalled()
 })
 it('holds a missing late basis after a genuine classified original instead of falling back to an earlier context',async()=>{
  const {input,basis}=classifiedOriginal();io.rpc.mockImplementation(async(name)=>({data:name==='ediel_customer_event_certification_original_v1'?basis:null,error:null}))
  await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:input})).rejects.toThrow('actual_preparation_basis_missing')
  expect(io.validation).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled();expect(io.legacyCreate).not.toHaveBeenCalled()
 })
 it.each(['registration','outcome','diagnostics'] as const)('holds a changed %s rather than deriving source authority from the requested outcome',async(change)=>{
  const {input,basis}=classifiedOriginal()
  io.rpc.mockImplementation(async(name)=>({data:name==='ediel_customer_event_certification_original_v1'?basis:{...basis,
   ...(change==='registration'?{fixtureRegistrationId:sourceId}:change==='outcome'?{expectedOutcome:'negative',expectedDiagnosticCodes:['PRODAT_DEATH_STATUS_REQUIRED']}:{expectedDiagnosticCodes:['UNRELATED']})},error:null}))
  await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:input})).rejects.toThrow(change==='diagnostics'?'certification_context_invalid':'fixture_source_mismatch')
  expect(io.validation).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled();expect(io.legacyCreate).not.toHaveBeenCalled()
 })
 it('returns an exact established source operation before a revoked current classification or registry',async()=>{
  const {input}=classifiedOriginal(),old=message({direction:'outbound',message_code:'Z09',status:'sent',raw_payload:input.rawPayload!,source_operation_id:operation})
  io.duplicate.mockResolvedValue(old);io.rpc.mockRejectedValue(Error('current classification revoked'));io.registryDispatch.mockRejectedValue(Error('current registry revoked'))
  expect(await createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:input,duplicateCheck:{sourceType:'manual',sourceId:registration,messageFamily:'PRODAT',messageCode:'Z09'}})).toBe(old)
  expect(io.rpc).not.toHaveBeenCalled();expect(io.registryDispatch).not.toHaveBeenCalled();expect(io.validation).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled()
 })
 it('does not load a customer-event classification before a physical syntax rejection',async()=>{
  const {input}=classifiedOriginal();input.rawPayload="UNB+BROKEN'"
  io.validation.mockResolvedValue({issues:[{severity:'error',code:'DECLARED-SYNTAX',description:'actual syntax hold'}],blocking:true,fieldRuleSource:'registry',rulePackSnapshot:snapshot()})
  await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:input})).rejects.toThrow('DECLARED-SYNTAX')
  expect(io.rpc).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled()
 })
 it('holds a changed actual registry transport tuple after national admission and before sealing',async()=>{
  const {input}=classifiedOriginal();io.registryDispatch.mockResolvedValue({wire:{interchangePartyId:'OTHER',address:input.receiverEmail,subaddress:null}})
  await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:input})).rejects.toThrow('registry_dispatch_mismatch')
  expect(io.validation).toHaveBeenCalledOnce();expect(io.witness).not.toHaveBeenCalled();expect(io.legacyCreate).not.toHaveBeenCalled()
 })
 it('carries the same source-only classification through the rendered public gateway and actual route',async()=>{
  const {input}=classifiedOriginal()
  io.route.mockResolvedValue({companyId:company,environment:'test',route:{id:'actual-test-route'},routeRuntime:{route_profile_id:'actual-test-profile'},actor:{testFlag:1},applicationReference:input.applicationReference,receiverEdielId:input.receiverEdielId,receiverEmail:input.receiverEmail,receiverSubAddress:null})
  const routeContext=await resolveCanonicalOutboundContext({companyId:company,environment:'test',requestType:'customer_masterdata'})
  await finalizeCanonicalOutboundDraft({actorUserId:actor,requestType:'customer_masterdata',draft:input,routeContext,duplicateCheck:{sourceType:'manual',sourceId:registration,messageFamily:'PRODAT',messageCode:'Z09'}})
  const validation=io.validation.mock.calls[0][0]
  expect(isQualifiedDeathStatusContext(validation.deathStatusContext)).toBe(true)
  expect(validation.deathStatusContext).toMatchObject({intentId:null,routeId:'actual-test-route',rawPayload:input.rawPayload})
  expect(io.registryDispatch).toHaveBeenCalledTimes(2);expect(io.witness).toHaveBeenCalledOnce()
 })
})
describe('canonical source-owner and technical gateway consumers',()=>{
 it('uses protected transport endpoint before legal routing for a tenant-unattributed source',async()=>{
  io.validation.mockResolvedValue({fieldRuleSource:'technical_source',blocking:false,technicalSyntaxAckEvidence:evidence()})
  await createCanonicalAckMessage({actorUserId:actor,sourceMessage:message({company_id:null}),ackFamily:'CONTRL',outcome:'negative',draft:ackDraft()})
  expect(io.actor).toHaveBeenCalledWith({companyId:company,actorUserId:actor,permissionAnyOf:['communication.write','ediel_testing.write']})
  expect(io.technicalRoute).toHaveBeenCalledOnce();expect(io.route).not.toHaveBeenCalled();expect(io.sourcePack).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled()
  expect(io.create).toHaveBeenCalledWith(expect.objectContaining({companyId:company,canonicalRulePackId:null,executionContextSnapshot:null,relatedMessageId:sourceId,communicationRouteId:'technical-route',customerId:null,meteringPointId:null}))
 })
 it('returns privately qualified own CONTRL after actual endpoint and actor checks without route or guide reads',async()=>{
  const old=message({id:'own-ack',direction:'outbound',message_family:'CONTRL',message_code:'CONTRL',related_message_id:sourceId,status:'sent',ack_outcome:'negative'})
  io.replay.mockResolvedValue({data:{version:1,sourceMessage:message({company_id:null}),ackMessage:old},error:null});io.technicalRoute.mockRejectedValue(Error('route revoked'))
  expect(await createCanonicalAckMessage({actorUserId:actor,sourceMessage:message({company_id:null}),ackFamily:'CONTRL',outcome:'negative',draft:ackDraft()})).toBe(old)
  expect(io.endpoint).toHaveBeenCalledOnce();expect(io.actor).toHaveBeenCalledOnce();expect(io.replay).toHaveBeenCalledOnce();expect(io.ackDuplicate).not.toHaveBeenCalled();expect(io.conflict).not.toHaveBeenCalled();expect(io.technical).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 const objectDraft=(results:{reference:string;positive:boolean}[]):CreateEdielMessageInput=>({...draft(),messageFamily:'APERAK',messageCode:'12',
  parsedPayload:{ackScope:'message',relatedTransactionReference:'caller-cache-sibling',ackOutcome:'caller-cache'},
  rawPayload:EdifactEnvelopeCodec.encode({sender:'LOCAL',receiver:'REMOTE',applicationReference:'APP',environment:'test',
   interchangeReference:'OWNACK',acknowledgementRequest:false,messages:[{messageReference:'OWNACKMSG',messageTypeToken:'APERAK:D:96A:UN:E2SE6A',
    businessSegments:['BGM+12+OWNACKDOC+34','NAD+FR+LOCAL:160:SVK','NAD+DO+REMOTE:160:SVK','RFF+ACW:SOURCE',
     ...results.flatMap(own=>[`ERC+${own.positive?'100':'42'}::260`,`RFF+LI:${own.reference}`])]}]})})
 // These test cases install their own complete physical source before the
 // subject call. A draft/parsed caller cache never supplies source authority.
 function objectSource(results:{reference:string;positive:boolean}[]){return message({raw_payload:EdifactEnvelopeCodec.encode({sender:'REMOTE',receiver:'LOCAL',applicationReference:'APP',environment:'test',interchangeReference:'ACTUAL',acknowledgementRequest:false,messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:['BGM+Z04+SOURCE+9+AB','NAD+FR+REMOTE:160:SVK','NAD+DO+LOCAL:160:SVK',...results.flatMap((r,i)=>[`LIN+${i+1}++POINT${i}:::9`,`RFF+LI:${r.reference}`])]}]})})}
 function oldObjectAck(ownDraft:CreateEdielMessageInput,outcome:'positive'|'negative'){
  return message({id:'protected-own-object-ack',direction:'outbound',related_message_id:sourceId,message_family:'APERAK',message_code:'12',
   raw_payload:ownDraft.rawPayload!,status:'failed',ack_outcome:outcome})
 }
 function protectedObjectReceipt(own:CreateEdielMessageInput,old:EdielMessageRow,results:{reference:string;positive:boolean}[]){
  const source=objectSource(results),lines=tokenizeEdifact(source.raw_payload!).segments.filter(s=>s.tag==='LIN')
  const scopes=results.map((r,index)=>({scope:'object',reference:String(lines[index].index),physicalReference:{li:r.reference,lineIndex:lines[index].index,id:'POINT'+index},outcome:r.positive?'positive':'negative'}))
  return {data:{version:2,sourceMessage:source,ackMessage:old,requestedPayloadHash:createHash('sha256').update(own.rawPayload!).digest('hex'),requestedScopes:scopes,ackScopes:scopes},error:null}
 }
 it('uses the protected raw-scope source receipt before today\'s guide despite changed caller sequence caches',async()=>{
  const results=[{reference:'OWN-LI',positive:true}],own=objectDraft(results),old=oldObjectAck(own,'positive')
  io.replay.mockResolvedValue(protectedObjectReceipt(own,old,results))
  expect(await createCanonicalAckMessage({actorUserId:actor,sourceMessage:objectSource(results),ackFamily:'APERAK',outcome:'positive',draft:own})).toBe(old)
  expect(io.replay).toHaveBeenCalledExactlyOnceWith('ediel_read_outbound_ack_scope_replay_v2',expect.objectContaining({p_company_id:company,p_source_message_id:sourceId,p_actor_user_id:actor,p_ack_raw_payload:own.rawPayload}))
  expect(io.ackDuplicate).not.toHaveBeenCalled();expect(io.sourcePack).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 it('preserves a protected exact mixed original without reinterpreting all objects as negative',async()=>{
  const results=[{reference:'OWN-POS',positive:true},{reference:'OWN-NEG',positive:false}],own=objectDraft(results),old=oldObjectAck(own,'negative')
  io.replay.mockResolvedValue(protectedObjectReceipt(own,old,results))
  expect(await createCanonicalAckMessage({actorUserId:actor,sourceMessage:objectSource(results),ackFamily:'APERAK',outcome:'negative',draft:own})).toBe(old)
  expect(io.ackDuplicate).not.toHaveBeenCalled();expect(io.sourcePack).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 it('holds changed own group outcomes even when whole mixed classification agrees, with zero conflict events',async()=>{
  const results=[{reference:'OWN-POS',positive:true},{reference:'OWN-NEG',positive:false}],desired=objectDraft(results)
  io.replay.mockResolvedValue({data:null,error:Error('ediel_prodat_ack_scope_conflicting_outcome')})
  await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:objectSource(results),ackFamily:'APERAK',outcome:'negative',draft:desired})).rejects.toThrow('scope_conflicting_outcome')
  expect(io.ackDuplicate).not.toHaveBeenCalled();expect(io.sourcePack).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled();expect(io.conflict).not.toHaveBeenCalled()
 })
 it('recovers a concurrent technical INSERT only from the same protected original actor/source scope',async()=>{
  const old=message({id:'committed-own-contrl',direction:'outbound',message_family:'CONTRL',message_code:'CONTRL',related_message_id:sourceId,status:'failed',ack_outcome:'negative'})
  let reads=0;io.replay.mockImplementation(async name=>name==='ediel_require_source_bytes_available_v1'?{data:null,error:null}:(++reads===1?{data:null,error:null}:{data:{version:1,sourceMessage:message(),ackMessage:old},error:null}))
  io.validation.mockResolvedValue({fieldRuleSource:'technical_source',blocking:false,technicalSyntaxAckEvidence:evidence()})
  io.create.mockRejectedValue({code:'23505',message:'declared same-source insertion race'})
  expect(await createCanonicalAckMessage({actorUserId:actor,sourceMessage:message(),ackFamily:'CONTRL',outcome:'negative',draft:{...ackDraft(),companyId:company}})).toBe(old)
  expect(io.create).toHaveBeenCalledOnce();expect(io.sourcePack).not.toHaveBeenCalled();expect(io.ackDuplicate).not.toHaveBeenCalled();expect(io.replay).toHaveBeenCalledTimes(3)
 })
 it('refuses altered source bytes or evidence environment before technical route or writes',async()=>{
  for(const patch of [{raw_payload:raw+'altered'},{environment:'production' as const}]){
   await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:message(patch),ackFamily:'CONTRL',outcome:'negative',draft:{...ackDraft(),companyId:company,environment:patch.environment??'test',rawPayload:patch.environment==='production' ? ackDraft().rawPayload!.replace("++APP++++1'","++APP'") : ackDraft().rawPayload}})).rejects.toThrow('canonical_ack_actual_original_mismatch')
  }
  expect(io.technicalRoute).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 it('refuses another tenant or response source when duplicate lookup returns a conflicting row',async()=>{
  for(const patch of [{company_id:'foreign-company'},{related_message_id:'another-source'}]){
   io.replay.mockResolvedValue({data:{version:1,sourceMessage:message(),ackMessage:message({direction:'outbound',message_family:'CONTRL',message_code:'CONTRL',related_message_id:sourceId,...patch})},error:null})
   await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:message(),ackFamily:'CONTRL',outcome:'negative',draft:{...ackDraft(),companyId:company}})).rejects.toThrow('canonical_ack_duplicate_scope_mismatch')
  }
  expect(io.create).not.toHaveBeenCalled()
 })
 it('direct public creator obtains canonical validation and a one-use original witness instead of trusting supplied snapshot',async()=>{
  await createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:{...draft(),rulePackSnapshot:{forged:true},executionContextSnapshot:{outboundOwnerWitnessId:'caller-token'}}})
  expect(io.validation).toHaveBeenCalledOnce();expect(io.witness).toHaveBeenCalledWith(expect.objectContaining({companyId:company,environment:'test',rawPayload:raw,rulePackEvidence:expect.objectContaining({rulePackId:'pack'})}))
  expect(io.legacyCreate).toHaveBeenCalledWith(expect.objectContaining({baseInput:expect.objectContaining({executionContextSnapshot:{outboundOwnerWitnessId:'opaque-server-witness',executionContext:expect.objectContaining({companyId:company,senderActorId:'supplier-profile',senderRole:'supplier',legalActorEdielId:'LOCAL',senderEdielId:'LOCAL',applicationReference:'23-DDQ-PRODAT'})},canonicalRulePackId:'pack'})}))
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
 it('consumes one genuine positive fixture token through the ordinary owner seal and actual draft INSERT',async()=>{
  const q={kind:'source_qualified_positive_fixture',registrationId:'protected-test-registration',companyId:company}
  io.positiveRead.mockReturnValue(q);io.positiveMatch.mockReturnValue(true);io.positivePrepare.mockResolvedValue({witnessId:'one-use-positive-token',qualification:q})
  await createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:draft()})
  expect(io.actor).toHaveBeenCalledWith({companyId:company,actorUserId:actor,permissionAnyOf:['communication.write','ediel_testing.write']})
  expect(io.positivePrepare).toHaveBeenCalledWith({qualification:q,actorUserId:actor,rawPayload:raw})
  expect(io.witness).toHaveBeenCalledWith(expect.objectContaining({sourceQualifiedPositiveFixtureWitnessId:'one-use-positive-token'}))
  expect(io.legacyCreate).toHaveBeenCalledWith(expect.objectContaining({baseInput:expect.objectContaining({executionContextSnapshot:{outboundOwnerWitnessId:'opaque-server-witness',sourceQualifiedPositiveFixtureWitnessId:'one-use-positive-token',executionContext:expect.objectContaining({companyId:company,senderActorId:'supplier-profile',senderRole:'supplier',legalActorEdielId:'LOCAL',senderEdielId:'LOCAL',applicationReference:'23-DDQ-PRODAT'})}})}))
  expect(io.positivePrepare.mock.invocationCallOrder[0]).toBeLessThan(io.witness.mock.invocationCallOrder[0])
 })
 it('consumes a qualified negative original token only alongside the same ordinary canonical owner seal',async()=>{
  const q={kind:'source_qualified_negative_fixture',registrationId:'protected-negative-registration',companyId:company}
  io.negativeRead.mockReturnValue(q);io.negativeMatch.mockReturnValue(true);io.negativePrepare.mockResolvedValue({witnessId:'one-use-negative-token',qualification:q});io.validation.mockResolvedValue({issues:[{severity:'error',code:'SOURCE-DECLARED-NEGATIVE',description:'declared probe diagnostic'}],canonicalPolicy:resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z01',subtypeOrReasonCode:'L',direction:'outbound',referenceDate:'2026-09-30',applicationReference:'23-DDQ-PRODAT',mode:'parse'}),fieldRuleSource:'registry',rulePackSnapshot:snapshot()})
  await createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:draft()})
  expect(io.witness).toHaveBeenCalledWith(expect.objectContaining({sourceQualifiedNegativeFixtureWitnessId:'one-use-negative-token',rulePackEvidence:expect.objectContaining({rulePackId:'pack'})}))
  expect(io.legacyCreate).toHaveBeenCalledWith(expect.objectContaining({baseInput:expect.objectContaining({executionContextSnapshot:{outboundOwnerWitnessId:'opaque-server-witness',sourceQualifiedNegativeFixtureWitnessId:'one-use-negative-token',executionContext:expect.objectContaining({companyId:company,senderActorId:'supplier-profile',senderRole:'supplier',legalActorEdielId:'LOCAL',senderEdielId:'LOCAL',applicationReference:'23-DDQ-PRODAT'})}})}))
  expect(io.negativePrepare.mock.invocationCallOrder[0]).toBeLessThan(io.witness.mock.invocationCallOrder[0])
 })
 it('holds positive fixtures with canonical rejection or unavailable one-use original instead of writing',async()=>{
  io.positiveRead.mockReturnValue({kind:'source_qualified_positive_fixture'});io.positiveMatch.mockReturnValue(false)
  await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:draft()})).rejects.toThrow('positive_fixture_diagnostics_mismatch')
  expect(io.positivePrepare).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled();expect(io.legacyCreate).not.toHaveBeenCalled()
  io.positiveMatch.mockReturnValue(true);io.positivePrepare.mockRejectedValue(Error('actual one-use original unavailable'))
  await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:draft()})).rejects.toThrow('actual one-use original unavailable')
  expect(io.witness).not.toHaveBeenCalled();expect(io.legacyCreate).not.toHaveBeenCalled()
 })
 it('prepares ordinary drafts under write permission independently of later provider SEND authority',async()=>{
  await createCanonicalOutboundMessage({actorUserId:actor,requestType:'customer_masterdata',baseInput:draft()})
  expect(io.actor).toHaveBeenCalledWith({companyId:company,actorUserId:actor,permission:'communication.write'})
 })
 const unknownSource=()=>message({company_id:null,message_code:'UNLISTED',raw_payload:raw.replace('BGM+Z04','BGM+UNLISTED')})
 const commonDraft=():CreateEdielMessageInput=>({...ackDraft(),companyId:company,messageFamily:'APERAK',messageCode:'12',rawPayload:"UNB+UNOC:3+LOCAL:ZZ:LOCAL-SUB+REMOTE:ZZ:REMOTE-SUB+260930:1201+ACKI++APP++++1'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+12+ACK-D+27'NAD+FR+LOCAL:160:SVK'NAD+DO+REMOTE:160:SVK'RFF+ACW:SOURCE'ERC+42::260'UNT+7+1'UNZ+1+ACKI'"})
 function commonPorts(source:EdielMessageRow){
  const sourceHash=createHash('sha256').update(source.raw_payload!,'utf8').digest('hex')
  const transport={interchangeReference:'ACTUAL',senderComponents:['REMOTE','ZZ','REMOTE-SUB'],receiverComponents:['LOCAL','ZZ','LOCAL-SUB']}
  const e={kind:'prodat_common_header_rejection',companyId:company,environment:'test',sourceMessageId:sourceId,sourceHash,syntaxAssessmentId:'protected-syntax-assessment',identities:{transport,applicationReference:'APP'}}
  const syntax={...evidence(),sourceHash,syntaxAssessmentId:e.syntaxAssessmentId,syntaxDecision:'accepted',originalUNB:{interchangeReference:'ACTUAL',applicationReference:'APP',sender:transport.senderComponents,receiver:transport.receiverComponents}}
  io.commonRead.mockResolvedValue({sourceMessage:source,evidence:e});io.technical.mockResolvedValue(syntax);io.commonRoute.mockResolvedValue({route:{id:'actual-ap27-route'},routeRuntime:{route_profile_id:'actual-ap27-profile'},senderEdielId:'LOCAL',senderSubAddress:'LOCAL-SUB',receiverEdielId:'REMOTE',receiverSubAddress:'REMOTE-SUB',senderEmail:'local@example.invalid',receiverEmail:'remote@example.invalid',mailbox:'local@example.invalid',applicationReference:'APP',smtpHost:'smtp.example.invalid',smtpPort:587});io.commonPrepare.mockResolvedValue({witnessId:'one-use-common-header-token',evidence:e});io.validation.mockResolvedValue({fieldRuleSource:'common_header_source',blocking:false,prodatCommonHeaderRejectionEvidence:e});io.create.mockResolvedValue(message({id:'new-common-ack',direction:'outbound',message_family:'APERAK',message_code:'12',related_message_id:sourceId,raw_payload:commonDraft().rawPayload,ack_outcome:'negative'}));return {e,syntax}
 }
 it('routes an unattributed physical P202 rejection through its protected common AP27 route and one-use witness',async()=>{
  const source=unknownSource(),{e}=commonPorts(source)
  await createCanonicalAckMessage({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative',draft:commonDraft()})
  expect(io.commonRead).toHaveBeenCalledWith(expect.objectContaining({companyId:company,sourceMessageId:sourceId,expectedRawPayload:source.raw_payload}))
  expect(io.commonRoute).toHaveBeenCalledWith(expect.objectContaining({evidence:e,actorUserId:actor}))
  expect(io.commonPrepare).not.toHaveBeenCalled() // Native atomic command owns route-bound witness mint.
  expect(io.sourcePack).not.toHaveBeenCalled();expect(io.route).not.toHaveBeenCalled();expect(io.technicalRoute).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled()
  expect(io.create).toHaveBeenCalledWith(expect.objectContaining({companyId:company,communicationRouteId:'actual-ap27-route',routeProfileId:'actual-ap27-profile',canonicalRulePackId:null,rulePackSnapshot:null,originalMessageCode:null,customerId:null,meteringPointId:null,executionContextSnapshot:null}))
 })
 it('holds known or foreign source scope and positive or transaction P202 outcomes before common writes',async()=>{
  for(const source of [message({company_id:null}),unknownSource()]){
   await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'positive',draft:commonDraft()})).rejects.toThrow('source_scope_mismatch')
  }
  await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:unknownSource(),ackFamily:'APERAK',outcome:'negative',draft:{...commonDraft(),rawPayload:commonDraft().rawPayload!.replace('BGM+12+ACK-D+27', 'BGM+12+ACK-D+34').replace("UNT+7+1'","RFF+LI:TX'UNT+8+1'"),parsedPayload:{ackScope:'transaction',relatedTransactionReference:'TX'}}})).rejects.toThrow('ack_prodat_original_object_scope_mismatch')
  await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:{...unknownSource(),company_id:'foreign-company'},ackFamily:'APERAK',outcome:'negative',draft:commonDraft()})).rejects.toThrow('source_scope_mismatch')
  expect(io.commonRoute).not.toHaveBeenCalled();expect(io.commonPrepare).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 it('requires the same protected syntax assessment, source hash and complete UNB/APP before common route or writes',async()=>{
  for(const mutate of [(s:Record<string,unknown>)=>({...s,sourceHash:'wrong'}),(s:Record<string,unknown>)=>({...s,syntaxAssessmentId:'wrong'}),(s:Record<string,unknown>)=>({...s,syntaxDecision:'rejected'}),(s:Record<string,unknown>)=>({...s,originalUNB:{applicationReference:'wrong'}})]){
   const source=unknownSource(),{syntax}=commonPorts(source);io.technical.mockResolvedValue(mutate(syntax))
   await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative',draft:commonDraft()})).rejects.toThrow('technical_source_mismatch')
  }
  expect(io.commonRoute).not.toHaveBeenCalled();expect(io.commonPrepare).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 it('holds a configured common-route failure before original token preparation and INSERT',async()=>{
  const source=unknownSource();commonPorts(source);io.commonRoute.mockRejectedValue(Error('actual current AP27 route unavailable'))
  await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:source,ackFamily:'APERAK',outcome:'negative',draft:commonDraft()})).rejects.toThrow('actual current AP27 route unavailable')
  expect(io.commonPrepare).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
 const aiDraft=():CreateEdielMessageInput=>({...draft(),applicationReference:null,messageStandard:'ai_list',messageFamily:'AI_LIST',messageCode:'AI',intentId:'00000000-0000-4000-8000-000000000020',rawPayload:'MECHANICAL AI ORIGINAL PORT: actual format/source qualification is separate',routeProfileId:'actual-ai-profile',senderEdielId:'LOCAL',receiverEdielId:'REMOTE',receiverEmail:'remote@example.invalid',communicationRouteId:'actual-ai-route'})
 it('qualifies actual AI original through the same public direct creator without EDIFACT authority selection',async()=>{
  const d=aiDraft();await createCanonicalOutboundMessage({actorUserId:actor,requestType:'meter_values',baseInput:d})
  expect(io.aiOriginal).toHaveBeenCalledWith({actorUserId:actor,draft:expect.objectContaining({...d,actorUserId:actor})})
  expect(io.validation).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled();expect(io.version).not.toHaveBeenCalled();expect(io.references).not.toHaveBeenCalled()
  expect(io.legacyCreate).toHaveBeenCalledWith(expect.objectContaining({baseInput:expect.objectContaining({intentId:d.intentId,sourceOperationId:operation,companyId:company,routeProfileId:'actual-ai-profile',executionContextSnapshot:null,requiresContrl:false,requiresAperak:false})}))
 })
 it('qualifies actual AI original through the rendered gateway with exact server actor, tenant, operation and route',async()=>{
  const d=aiDraft(),routeContext=await resolveCanonicalOutboundContext({companyId:company,environment:'test',requestType:'meter_values'})
  await finalizeCanonicalOutboundDraft({actorUserId:actor,requestType:'meter_values',draft:d,routeContext,duplicateCheck:{sourceType:'manual',sourceId:d.intentId,messageFamily:'AI_LIST',messageCode:'AI'}})
  expect(io.aiOriginal).toHaveBeenCalledWith({actorUserId:actor,draft:expect.objectContaining({...d,companyId:company,actorUserId:actor,environment:'test'})})
  expect(io.validation).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled();expect(io.version).not.toHaveBeenCalled();expect(io.references).not.toHaveBeenCalled()
 })
 it('holds rendered AI tenant/environment conflicts before private qualification or INSERT',async()=>{
  for(const scope of [{companyId:'foreign-company',environment:'test'},{companyId:company,environment:'production'}]){
   io.route.mockResolvedValue(scope);const routeContext=await resolveCanonicalOutboundContext({companyId:company,environment:'test',requestType:'meter_values'})
   await expect(finalizeCanonicalOutboundDraft({actorUserId:actor,requestType:'meter_values',draft:aiDraft(),routeContext,duplicateCheck:{messageFamily:'AI_LIST',messageCode:'AI'}})).rejects.toThrow('owner_scope_required')
  }
  expect(io.aiOriginal).not.toHaveBeenCalled();expect(io.legacyCreate).not.toHaveBeenCalled()
 })
 it('holds rejected AI original or EDIFACT/foreign links before any draft INSERT',async()=>{
  io.aiOriginal.mockRejectedValue(Error('actual private AI original rejected'))
  await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'meter_values',baseInput:aiDraft()})).rejects.toThrow('actual private AI original rejected')
  for(const patch of [{outboundRequestId:'foreign-request'},{applicationReference:'EDIFACT-APP'},{rulePackSnapshot:{forged:true}},{executionContextSnapshot:{outboundOwnerWitnessId:'caller-token'}}]){
   await expect(createCanonicalOutboundMessage({actorUserId:actor,requestType:'meter_values',baseInput:{...aiDraft(),...patch}})).rejects.toThrow('edifact_or_foreign_link_forbidden')
  }
  expect(io.legacyCreate).not.toHaveBeenCalled();expect(io.validation).not.toHaveBeenCalled();expect(io.witness).not.toHaveBeenCalled()
 })
})
