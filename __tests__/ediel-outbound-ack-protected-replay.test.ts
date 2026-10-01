// Mechanical gateway tests. Native private receipt/wire tests are a separate gate.
import {createHash} from 'node:crypto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({rpc:vi.fn(),validation:vi.fn(),actor:vi.fn(),oldDuplicate:vi.fn(),oldSequence:vi.fn(),create:vi.fn(),conflict:vi.fn(),route:vi.fn(),technical:vi.fn(),endpoint:vi.fn(),source:vi.fn()}))
vi.mock('@/lib/ediel/rulebook/validator',()=>({validateRulebookMessageWithRegistry:io.validation}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/core/atomicAckPersistence',()=>({persistAtomicOutboundAck:(input:CreateEdielMessageInput)=>io.create(input)}))
vi.mock('@/lib/ediel/core/dedupe',()=>({hasCanonicalAckDuplicate:io.oldDuplicate,findOutboundEdielMessageDuplicate:vi.fn()}))
vi.mock('@/lib/ediel/db',()=>({listAckMessagesForSource:vi.fn(),createEdielMessage:io.create,createCanonicalAckConflictEvent:io.conflict,findSequencedAckForSource:io.oldSequence}))
vi.mock('@/lib/ediel/config',()=>({getEdielRouteRuntimeByCommunicationRouteId:vi.fn()}))
vi.mock('@/lib/ediel/core/kernelLegacy',()=>({createCanonicalOutboundMessage:vi.fn(),resolveCanonicalOutboundContext:io.route}))
vi.mock('@/lib/ediel/core/ackSourceRulePackEvidence',()=>({readSourceBoundOutboundAckRulePackEvidence:io.source}))
vi.mock('@/lib/ediel/ack/technicalSyntaxAuthority',()=>({requireEdielTechnicalSyntaxAckEvidence:io.technical,readEdielTechnicalSourceEndpoint:io.endpoint}))
vi.mock('@/lib/ediel/ack/technicalSyntaxRoute',()=>({readTechnicalSyntaxAckRoute:io.route}))
vi.mock('@/lib/ediel/ack/prodatCommonHeaderNegativeAckRoute',()=>({readProdatCommonHeaderNegativeAckRoute:io.route}))
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
const company='10000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000002',sourceId='10000000-0000-4000-8000-000000000003',ackId='10000000-0000-4000-8000-000000000004'
// Only fields read by this gateway/port are declared; these rows are mechanical.
const source=()=>({id:sourceId,company_id:company,environment:'test',direction:'inbound',message_standard:'edifact',message_family:'UTILTS',message_code:'E66',raw_payload:'physical original',parsed_payload:{}} as unknown as EdielMessageRow)
const ack=(family:'APERAK'|'CONTRL'|'UTILTS_ERR'='APERAK',patch:Partial<EdielMessageRow>={})=>({id:ackId,company_id:company,environment:'test',direction:'outbound',message_standard:'edifact',message_family:family,message_code:family,related_message_id:sourceId,raw_payload:'sealed response',status:'sent',ack_outcome:'negative',parsed_payload:{},...patch} as unknown as EdielMessageRow)
const draft=(family:'APERAK'|'CONTRL'|'UTILTS_ERR'='APERAK'):CreateEdielMessageInput=>({actorUserId:actor,companyId:company,environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:family,messageCode:family,rawPayload:'new draft'})
function protectedRow(actual=source(),response=ack()){io.rpc.mockResolvedValue({data:{version:1,sourceMessage:actual,ackMessage:response},error:null});return response}
function noEffects(){for(const fn of [io.oldDuplicate,io.oldSequence,io.create,io.conflict,io.route,io.technical,io.source])expect(fn).not.toHaveBeenCalled()}
beforeEach(()=>{vi.resetAllMocks();io.actor.mockResolvedValue(undefined);io.conflict.mockResolvedValue(undefined);io.oldDuplicate.mockImplementation(async input=>ack(input.ackFamily));io.oldSequence.mockImplementation(async input=>ack(input.ackFamily));io.endpoint.mockResolvedValue({companyId:company})})
describe('outbound ACK replay consumes protected actual source and own ACK',()=>{
 it.each(['APERAK','CONTRL','UTILTS_ERR'] as const)('reads %s once with current actor and exact scope without new effects',async family=>{
  const prior=protectedRow(source(),ack(family))
  expect(await createCanonicalAckMessage({actorUserId:actor,sourceMessage:source(),ackFamily:family,outcome:'negative',draft:draft(family)})).toEqual(prior)
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_read_outbound_ack_replay_v1',{p_company_id:company,p_environment:'test',p_source_message_id:sourceId,p_actor_user_id:actor,p_ack_family:family,p_sequence_field:null,p_sequence_value:null});noEffects()
 })
 it('compares caller raw and physical family/code to actual source before duplicate return',async()=>{
  protectedRow()
  for(const patch of [{raw_payload:'changed'}, {message_family:'PRODAT'}, {message_code:'E30'}])await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:{...source(),...patch} as EdielMessageRow,ackFamily:'APERAK',outcome:'negative',draft:draft()})).rejects.toThrow('canonical_ack_actual_original_mismatch')
  noEffects()
 })
 it('holds current revoked grant and unavailable private own ACK without fallback',async()=>{
  io.rpc.mockResolvedValue({data:null,error:Error('ediel_ack_replay_actor_not_authorized')})
  await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:source(),ackFamily:'APERAK',outcome:'negative',draft:draft()})).rejects.toThrow('actor_not_authorized');noEffects()
 })
 it.each([{company_id:'foreign'},{environment:'production'},{related_message_id:'wrong'},{direction:'inbound'},{message_family:'CONTRL'}])('rejects a protected-port malformed ACK scope %j',async patch=>{
  protectedRow(source(),ack('APERAK',patch as Partial<EdielMessageRow>))
  await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:source(),ackFamily:'APERAK',outcome:'negative',draft:draft()})).rejects.toThrow('canonical_ack_duplicate_scope_mismatch');noEffects()
 })
 it('includes opposite outcomes and refuses conflict without appending an event',async()=>{
  protectedRow(source(),ack('APERAK',{ack_outcome:'positive'}))
  await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:source(),ackFamily:'APERAK',outcome:'negative',draft:draft()})).rejects.toThrow('blocked_final_ack_exists');noEffects()
 })
 it('binds the full transaction reference without outcome filtering',async()=>{
  const prior=protectedRow(source(),ack('UTILTS_ERR',{parsed_payload:{ackScope:'transaction',relatedTransactionReference:'FULL-IDE'}}))
  const input={...draft('UTILTS_ERR'),parsedPayload:{ackScope:'transaction',relatedTransactionReference:'FULL-IDE'}}
  expect(await createCanonicalAckMessage({actorUserId:actor,sourceMessage:source(),ackFamily:'UTILTS_ERR',outcome:'negative',draft:input})).toEqual(prior)
  expect(io.rpc).toHaveBeenCalledWith('ediel_read_outbound_ack_replay_v1',expect.objectContaining({p_sequence_field:'relatedTransactionReference',p_sequence_value:'FULL-IDE'}));noEffects()
 })
 it('holds a port row with a different own transaction sequence',async()=>{
  protectedRow(source(),ack('UTILTS_ERR',{parsed_payload:{relatedTransactionReference:'OTHER'}}))
  await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:source(),ackFamily:'UTILTS_ERR',outcome:'negative',draft:{...draft('UTILTS_ERR'),parsedPayload:{ackScope:'transaction',relatedTransactionReference:'FULL-IDE'}}})).rejects.toThrow('canonical_ack_duplicate_scope_mismatch');noEffects()
 })
 it('rereads a fresh CONTRL unique race through the same protected actor/source port',async()=>{
  const e={environment:'test',sourceHash:createHash('sha256').update(source().raw_payload!).digest('hex')}
  io.rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{version:1,sourceMessage:source(),ackMessage:ack('CONTRL')},error:null})
  io.technical.mockResolvedValue(e);io.route.mockResolvedValue({route:{id:'route'},routeRuntime:{route_profile_id:'profile'}});io.validation.mockResolvedValue({fieldRuleSource:'technical_source',blocking:false,technicalSyntaxAckEvidence:e});io.create.mockRejectedValue({code:'23505'})
  expect((await createCanonicalAckMessage({actorUserId:actor,sourceMessage:source(),ackFamily:'CONTRL',outcome:'negative',draft:draft('CONTRL')})).id).toBe(ackId)
  expect(io.rpc).toHaveBeenCalledTimes(2);expect(io.oldDuplicate).not.toHaveBeenCalled();expect(io.oldSequence).not.toHaveBeenCalled();expect(io.conflict).not.toHaveBeenCalled()
 })
 it('a fresh unique race cannot return an established ACK after native current grant revocation',async()=>{
  const e={environment:'test',sourceHash:createHash('sha256').update(source().raw_payload!).digest('hex')}
  io.rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:null,error:Error('ediel_ack_replay_actor_not_authorized')})
  io.technical.mockResolvedValue(e);io.route.mockResolvedValue({route:{id:'route'},routeRuntime:{route_profile_id:'profile'}});io.validation.mockResolvedValue({fieldRuleSource:'technical_source',blocking:false,technicalSyntaxAckEvidence:e});io.create.mockRejectedValue({code:'23505'})
  await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:source(),ackFamily:'CONTRL',outcome:'negative',draft:draft('CONTRL')})).rejects.toThrow('actor_not_authorized');expect(io.rpc).toHaveBeenCalledTimes(2);expect(io.conflict).not.toHaveBeenCalled();expect(io.oldDuplicate).not.toHaveBeenCalled()
 })
 it('resolves tenant-unattributed CONTRL through protected source endpoint, never a global ACK',async()=>{
  const actual={...source(),company_id:null};protectedRow(actual,ack('CONTRL'))
  await createCanonicalAckMessage({actorUserId:actor,sourceMessage:actual,ackFamily:'CONTRL',outcome:'negative',draft:{...draft('CONTRL'),companyId:null}})
  expect(io.endpoint).toHaveBeenCalledOnce();noEffects()
 })
})
