import {requireEdielTechnicalSyntaxAckEvidence} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import {readProdatCommonHeaderNegativeAckRoute,prodatCommonHeaderNegativeAckRouteQualification} from '@/lib/ediel/ack/prodatCommonHeaderNegativeAckRoute'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const {rpc,assertActor}=vi.hoisted(()=>({rpc:vi.fn(),assertActor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:assertActor}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'configured@example.test',host:'smtp.example.test',port:465})}))
import {readProdatCommonHeaderRejectionEvidence,prepareProdatCommonHeaderNegativeAckWitness,prodatCommonHeaderRejectionQualification,readPersistedProdatCommonHeaderNegativeAckBasis} from '@/lib/ediel/ack/prodatCommonHeaderRejectionAuthority'
import {validateRulebookMessage,validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import {AUTHORITATIVE_EDIEL_GUIDES} from '@/lib/ediel/rulebook/guideRegistry'
import {originalAckPartyIdentities} from '@/lib/ediel/core/originalAckPartyIdentities'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {readFreshEdielSendValidationSources} from '@/lib/ediel/production/sendValidationSources'
import {preflightEdielMessageRow} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import type {EdielMessageRow} from '@/lib/ediel/types'
const company='10000000-0000-4000-8000-000000000001',sourceId='20000000-0000-4000-8000-000000000001'
const sourceRaw="UNB+UNOC:3+REMOTE:14+LOCAL:14+260930:1200+SOURCE++23-DDQ-PRODAT++++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+BAD+D+9+AB'NAD+FR+REMOTE:160:SVK+++++++SE'NAD+DO+LOCAL:160:SVK+++++++SE'UNT+5+M'UNZ+1+SOURCE'"
const ackRaw="UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:1200+ACKI++23-DDQ-PRODAT++++1'UNH+A+APERAK:D:96A:UN:E2SE6A'BGM+APERAK+ACKD+27'DTM+137:202609301200:203'RFF+ACW:D'NAD+FR+LOCAL:160:SVK+++++++SE'NAD+DO+REMOTE:160:SVK+++++++SE'ERC+42::260'FTX+AAO++202::260+Felaktigt Meddelandenamn BAD'UNT+9+A'UNZ+1+ACKI'"
const input={companyId:company,environment:'test' as const,sourceMessageId:sourceId,expectedRawPayload:sourceRaw,actorUserId:'user'}
function native(){const guide=AUTHORITATIVE_EDIEL_GUIDES.find(g=>g.family==='PRODAT')!;return {version:1,sourceMessage:{id:sourceId,company_id:null,environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'BAD',raw_payload:sourceRaw,message_received_at:'2026-09-30T12:00:00Z'},evidence:{kind:'prodat_common_header_rejection',version:1,companyId:company,environment:'test',sourceMessageId:sourceId,sourceHash:evidenceHash(sourceRaw),sourceReceivedAt:'2026-09-30T12:00:00Z',observedAt:'2026-09-30T12:00:01Z',syntaxAssessmentId:'actual-assessment',field202:{fieldCode:'202',ercCode:'42',text:'Felaktigt Meddelandenamn BAD'},guide:Object.fromEntries(Object.entries(guide).sort(([a],[b])=>a.localeCompare(b))),familyEdition:{version:'26.A:r3',rulePack:{id:'family-pack'},guideSources:[],sourceProjection:{actual:'projection'}},identities:originalAckPartyIdentities({rawPayload:sourceRaw}),authorizesBusinessEffect:false}}}
const renderedAckRaw=ackRaw.replace('BGM+APERAK+ACKD+27','BGM+++27')
function outboundAck():EdielMessageRow{return {...energyHandoffMessage('2026-09-30',company),id:'ack',direction:'outbound',message_family:'APERAK',message_code:'APERAK',related_message_id:sourceId,raw_payload:renderedAckRaw,mime_type:'application/edifact',execution_context_snapshot:{prodatCommonHeaderNegativeWitnessId:'one-use'}}}
async function qualified(){rpc.mockResolvedValueOnce({data:native(),error:null});return readProdatCommonHeaderRejectionEvidence(input)}
const validation=(evidence:unknown,raw=ackRaw)=>({family:'APERAK',code:'APERAK',companyId:company,environment:'test',direction:'outbound',mode:'send',rawPayload:raw,prodatCommonHeaderRejectionEvidence:evidence}) as Parameters<typeof validateRulebookMessage>[0]
describe('protected prospective PRODAT common-header national rejection',()=>{
 beforeEach(()=>{rpc.mockReset();assertActor.mockReset();assertActor.mockResolvedValue(undefined)})
 it('qualifies actual source bytes/namespace/edition without inventing code profile or source acceptance',async()=>{const {evidence,sourceMessage}=await qualified();expect(sourceMessage.company_id).toBeNull();expect(evidence.authorizesBusinessEffect).toBe(false);expect(evidence.familyEdition).not.toHaveProperty('messageProfile');expect(prodatCommonHeaderRejectionQualification({evidence,companyId:company,environment:'test'})).toBe(evidence);expect(prodatCommonHeaderRejectionQualification({evidence:{...evidence},companyId:company,environment:'test'})).toBeNull();expect(Object.isFrozen(evidence.identities.legalReceiver.identityComponents)).toBe(true)})
 it('reads permission before protected original and holds different supplied raw',async()=>{rpc.mockResolvedValueOnce({data:native(),error:null});await expect(readProdatCommonHeaderRejectionEvidence({...input,expectedRawPayload:'different'})).rejects.toThrow('ediel_common_header_rejection_basis_required');expect(assertActor).toHaveBeenCalledWith({companyId:company,actorUserId:'user',permissionAnyOf:['communication.write','ediel_testing.write']})})
 it('admits only the exact prescribed header202 negative through the same canonical ACK guide',async()=>{const {evidence}=await qualified();expect(validateRulebookMessage(validation(evidence))).toMatchObject({ok:true,fieldRuleSource:'common_header_source',rulePackSnapshot:null});expect(await validateRulebookMessageWithRegistry(validation(evidence))).toMatchObject({ok:true,fieldRuleSource:'common_header_source',rulePackSnapshot:null});expect(rpc).toHaveBeenCalledTimes(1)})
 it.each([ackRaw.replace('ERC+42','ERC+100'),ackRaw.replace('202::260','226::260'),ackRaw.replace('Meddelandenamn BAD','Meddelandenamn OTHER'),ackRaw.replace('ACKD+27','ACKD+34'),ackRaw.replace('NAD+FR+LOCAL','NAD+FR+OTHER'),ackRaw.replace('RFF+ACW:D','RFF+ACW:FOREIGN')])('holds substituted national outcome or source scope',async raw=>{const {evidence}=await qualified();expect(validateRulebookMessage(validation(evidence,raw)).ok).toBe(false)})
 it('does not authorize an arbitrary copied source cap',async()=>{const {evidence}=await qualified();expect(validateRulebookMessage(validation({...evidence})).ok).toBe(false);await expect(prepareProdatCommonHeaderNegativeAckWitness({evidence:{...evidence},actorUserId:'user',rawPayload:ackRaw,route:{} as never})).rejects.toThrow('ediel_common_header_rejection_basis_required');expect(rpc).toHaveBeenCalledTimes(1)})
 it('requires its own APERAK configured route and seals it with the one-use negative witness',async()=>{
  const {evidence}=await qualified()
  rpc.mockResolvedValueOnce({data:{kind:'technical_syntax_ack',version:1,companyId:company,environment:'test',sourceMessageId:sourceId,sourceHash:evidence.sourceHash,observedAt:evidence.observedAt,syntaxAssessmentId:evidence.syntaxAssessmentId,syntaxDecision:'accepted',transportActorId:'transport',transportEdielId:'LOCAL',originalUNB:{sender:['REMOTE','14'],receiver:['LOCAL','14'],interchangeReference:'SOURCE',uciReference:'SOURCE',applicationReference:'23-DDQ-PRODAT',testIndicator:'1'}},error:null})
  const technicalEvidence=await requireEdielTechnicalSyntaxAckEvidence(company,sourceId)
  const returned={kind:'prodat_common_header_negative_ack_route',companyId:company,environment:'test',sourceMessageId:sourceId,sourceHash:evidence.sourceHash,route:{id:'route',company_id:company,is_active:true},routeRuntime:{company_id:company,route_profile_id:'profile',communication_route_id:'route',environment:'test',is_enabled:true,message_family:'APERAK',business_code:'APERAK'},senderEdielId:'LOCAL',senderQualifier:'14',senderSubAddress:null,receiverEdielId:'REMOTE',receiverQualifier:'14',receiverSubAddress:null,receiverMessageSubAddress:null,applicationReference:'23-DDQ-PRODAT',senderEmail:'configured@example.test',receiverEmail:'remote@example.test',mailbox:'configured@example.test',routeKey:'actual',smtpHost:'smtp.example.test',smtpPort:465,authorizesBusinessEffect:false}
  rpc.mockResolvedValueOnce({data:returned,error:null})
  const route=await readProdatCommonHeaderNegativeAckRoute({evidence,technicalEvidence,actorUserId:'user'})
  expect(prodatCommonHeaderNegativeAckRouteQualification(route,evidence)).toBe(route)
  expect(prodatCommonHeaderNegativeAckRouteQualification({...route},evidence)).toBeNull()
  await expect(prepareProdatCommonHeaderNegativeAckWitness({evidence,actorUserId:'user',rawPayload:ackRaw,route:{...route}})).rejects.toThrow('basis_required')
  rpc.mockResolvedValueOnce({data:{witnessId:'one-use',evidence},error:null})
  expect(await prepareProdatCommonHeaderNegativeAckWitness({evidence,actorUserId:'user',rawPayload:ackRaw,route})).toEqual({witnessId:'one-use',evidence})
  expect(rpc.mock.calls[3][0]).toBe('ediel_prepare_common_header_negative_ack_v2')
  expect(rpc.mock.calls[3][1]).toMatchObject({p_smtp_from:'configured@example.test',p_smtp_host:'smtp.example.test',p_smtp_port:465})
  rpc.mockResolvedValueOnce({data:{...returned,routeRuntime:{...returned.routeRuntime,message_family:'CONTRL'}},error:null})
  await expect(readProdatCommonHeaderNegativeAckRoute({evidence,technicalEvidence,actorUserId:'user'})).rejects.toThrow('route_scope_mismatch')
 })
 it('qualifies persisted actual ACK and protected original in one read',async()=>{const value=native();const ack={id:'ack',company_id:company,environment:'test',direction:'outbound',message_family:'APERAK',message_code:'APERAK',related_message_id:sourceId,raw_payload:ackRaw,execution_context_snapshot:{prodatCommonHeaderNegativeWitnessId:'one-use'}} as unknown as EdielMessageRow;rpc.mockResolvedValueOnce({data:{...value,ackMessage:ack},error:null});const actual=await readPersistedProdatCommonHeaderNegativeAckBasis({companyId:company,environment:'test',ackMessageId:'ack',expectedRawPayload:ackRaw});expect(actual.ackMessage).toBe(ack);expect(prodatCommonHeaderRejectionQualification({evidence:actual.evidence,companyId:company,environment:'test',sourceMessageId:sourceId})).toBe(actual.evidence)})
 it('carries the protected common negative through the real fresh-send read and preflight without selecting a code profile',async()=>{
  const ack=outboundAck();rpc.mockResolvedValueOnce({data:{...native(),ackMessage:ack},error:null})
  const sources=await readFreshEdielSendValidationSources(ack,'user')
  expect(sources.ackSourceQualification).toBeUndefined()
  const result=preflightEdielMessageRow(ack,'send',undefined,undefined,sources.ackSourceQualification,sources.deathStatusContext,sources.prodatCommonHeaderRejectionEvidence)
  expect(result.ok,JSON.stringify(result.issues)).toBe(true)
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc.mock.calls[0][0]).toBe('ediel_read_common_header_negative_ack_v1')
 })
 it.each(['syntax','format'] as const)('rejects actual %s before fresh source reads',async kind=>{
  const ack=outboundAck(),invalid=kind==='syntax'?{...ack,raw_payload:renderedAckRaw.replace('UNT+9','UNT+999')}:{...ack,mime_type:'application/xml'}
  await expect(readFreshEdielSendValidationSources(invalid,'user')).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
 })
 it('keeps a copied common hint held when its private original read fails and does not fall back to a business pack',async()=>{
  rpc.mockResolvedValueOnce({data:null,error:{message:'protected original unavailable'}})
  await expect(readFreshEdielSendValidationSources(outboundAck(),'user')).rejects.toThrow('ediel_common_header_negative_witness_required')
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc.mock.calls[0][0]).toBe('ediel_read_common_header_negative_ack_v1')
 })
})
