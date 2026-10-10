import {beforeEach,expect,it,vi} from 'vitest'
import {createAssignedProdatHeaderNegativeSource,observeAssignedProdatHeaderNegativeField} from '@/lib/inbound-mail/prodatAssignedHeaderRejectionIntake'
import {guideOrderedFixtureRaw} from '@/__tests__/helpers/prodatGuideOrderedFixture'
import {line,characteristic} from '@/__tests__/fixtures/prodat-register'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
const io=vi.hoisted(()=>({rpc:vi.fn(),actor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'configured@example.test',host:'smtp.example.test',port:465})}))
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002'
const mail='00000000-0000-4000-8000-000000000003',parse='00000000-0000-4000-8000-000000000004',source='00000000-0000-4000-8000-000000000005'
const received='2026-10-09T07:00:00Z'
function payload(field?:string){
 const raw=guideOrderedFixtureRaw([['NAD','FR',['54321','160','SVK'],'','','','','','','SE'],
 ['NAD','DO',['12345','160','SVK'],'','','','','','','SE'],line('1','735123456789012345',undefined,'9'),...characteristic('Z13','Z25'),
 ['RFF',['LI','OWN']],['NAD','UD',['5561234567','SE1','260'],'','Synthetic Customer','Street','Town','','12345','SE']],'Z04').replace("23-DDQ-PRODAT'","23-DDQ-PRODAT++++1'").replace('UNOC:3+S+R+','UNOC:3+S:14+R:14+')
 if(field==='202')return raw.replace('BGM+Z04','BGM+')
 if(field==='311')return raw.replace('23-DDQ-PRODAT','')
 if(field==='223'){
  const segments=raw.split("'").filter(segment=>segment!==''&&segment!=='CCI++Z13'&&segment!=='CAV+Z25')
  const unh=segments.findIndex(segment=>segment.startsWith('UNH+')),unt=segments.findIndex(segment=>segment.startsWith('UNT+'))
  segments[unt]=segments[unt].replace(/^UNT\+\d+/,`UNT+${unt-unh+1}`)
  return segments.join("'")+"'"
 }
 return raw
}
const input=(rawPayload:string)=>({companyId:company,environment:'test' as const,actorUserId:actor,inboundEmailMessageId:mail,parseResultId:parse,rawPayload})
const receipt=(raw:string,field:string)=>({version:1,disposition:'assigned_header_negative',permanentNegative:true,
 authorizesBusinessEffect:false,companyId:company,environment:'test',sourceMessageId:source,sourcePayloadHash:evidenceHash(raw),
 inboundEmailMessageId:mail,parseResultId:parse,sourceReceivedAt:received,fieldCode:field})
beforeEach(()=>{io.rpc.mockReset();io.actor.mockReset();io.actor.mockResolvedValue(undefined)})
it.each(['202','311','223'])('observes actual omitted%s without repairing parser/original fields',field=>{
 const raw=payload(field),before=parseEdifactPayload(raw)
 expect(observeAssignedProdatHeaderNegativeField(raw)).toBe(field)
 expect(parseEdifactPayload(raw)).toEqual(before)
 expect(before).toMatchObject({rawPayload:raw,messageFamily:'PRODAT',messageCode:field==='202'?'PRODAT_UNKNOWN':'Z04',
  applicationReference:field==='311'?null:'23-DDQ-PRODAT'})
})
it.each(['202','311','223'])('uses the SQL-owned assigned negative birth for%s with no caller APP/profile/source UUID',async field=>{
 const raw=payload(field);io.rpc.mockResolvedValue({data:receipt(raw,field),error:null})
 expect(await createAssignedProdatHeaderNegativeSource(input(raw))).toBe(source)
 expect(io.actor).toHaveBeenCalledWith({companyId:company,actorUserId:actor,permission:'communication.write'})
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_create_assigned_prodat_header_negative_v1',{
  p_company_id:company,p_environment:'test',p_actor_user_id:actor,p_inbound_email_message_id:mail,p_parse_result_id:parse,
  p_expected_raw_payload:raw,p_expected_payload_hash:evidenceHash(raw)})
})
it.each([
 ['healthy',()=>payload()],['two omissions',()=>payload('202').replace('23-DDQ-PRODAT','')],
 ['two messages',()=>payload('202')+payload('202')],['missing document reference',()=>payload('202').replace(/BGM\+\+[^+']+/,'BGM++')],
 ['different association',()=>payload('202').replace('E2SE6A','OTHER')],['wrong application for missing202',()=>payload('202').replace('23-DDQ-PRODAT','23-DGI-PRODAT')],
 ['wrong application for missing223',()=>payload('223').replace('23-DDQ-PRODAT','23-DGI-PRODAT')],
 ['different missingAPP process',()=>payload('311').replace('BGM+Z04','BGM+Z14')],
 ['different reason',()=>payload('311').replace('CAV+Z25','CAV+Z26')],
 ['empty reason supplied',()=>payload('202').replace('CAV+Z25','CAV+')],
 ['invalid syntax',()=>payload('202').replace(/UNT\+\d+/,'UNT+999')],
 ['invalid sequence',()=>payload('202').replace('LIN+1++','LIN+2++')],
 ['missing identity',()=>payload('202').replace('735123456789012345','')],
 ['invalid APP composite',()=>payload('202').replace('23-DDQ-PRODAT','23-DDQ-PRODAT:EXTRA')],
] as const)('ordinary/refused %s gains no assigned negative birth',async(_name,make)=>{
 expect(await createAssignedProdatHeaderNegativeSource(input(make()))).toBeNull()
 expect(io.rpc).not.toHaveBeenCalled()
})
it.each(['companyId','environment','sourcePayloadHash','inboundEmailMessageId','parseResultId','fieldCode','permanentNegative','authorizesBusinessEffect','sourceReceivedAt'])('holds mismatched actual returned%s',async key=>{
 const raw=payload('202'),data=receipt(raw,'202') as Record<string,unknown>;data[key]=key==='authorizesBusinessEffect'?true:key==='permanentNegative'?false:'wrong'
 io.rpc.mockResolvedValue({data,error:null})
 await expect(createAssignedProdatHeaderNegativeSource(input(raw))).rejects.toThrow('ediel_assigned_header_negative_birth_required')
})
it('keeps actual actor refusal ahead of a throwing raw getter and performs no birth',async()=>{
 const denied=new Error('actual_actor_denied');io.actor.mockRejectedValue(denied)
 const value=input(payload('202'));Object.defineProperty(value,'rawPayload',{get(){throw Error('untrusted_raw_getter')}})
 await expect(createAssignedProdatHeaderNegativeSource(value)).rejects.toBe(denied);expect(io.rpc).not.toHaveBeenCalled()
})
it('pins raw bytes and scope before the current actor await',async()=>{
 const raw=payload('202'),value=input(raw);io.actor.mockImplementation(async()=>{value.rawPayload=payload();value.inboundEmailMessageId='wrong'})
 io.rpc.mockResolvedValue({data:receipt(raw,'202'),error:null})
 expect(await createAssignedProdatHeaderNegativeSource(value)).toBe(source)
 expect(io.rpc.mock.calls[0][1]).toMatchObject({p_expected_raw_payload:raw,p_inbound_email_message_id:mail})
})
it('preserves a plain actual SQL guard error instead of returning a source',async()=>{
 const error={code:'23514',message:'ediel_assigned_header_negative_actual_custody_required'};io.rpc.mockResolvedValue({data:null,error})
 await expect(createAssignedProdatHeaderNegativeSource(input(payload('311')))).rejects.toBe(error)
})

import {loadReceivedProdatHeaderRejection,observeReceivedProdatHeaderRejection,readReceivedProdatHeaderRejectionErrors,
 ownReceivedProdatHeaderRejection,hasReceivedProdatHeaderRejection} from '@/lib/ediel/prodat/receivedProdatHeaderRejection'
import {readProdatCommonHeaderRejectionEvidence,commonHeaderReplyApplicationReference} from '@/lib/ediel/ack/prodatCommonHeaderRejectionAuthority'
import {AUTHORITATIVE_EDIEL_GUIDES} from '@/lib/ediel/rulebook/guideRegistry'
import {originalAckPartyIdentities} from '@/lib/ediel/core/originalAckPartyIdentities'
import {buildAckDraftForSource} from '@/lib/ediel/ack'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateRulebookMessage} from '@/lib/ediel/rulebook/validator'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
function born(raw:string):EdielMessageRow{
 const parsed=parseEdifactPayload(raw),hash=evidenceHash(raw)
 return {id:source,company_id:company,resolved_company_id:company,environment:'test',direction:'inbound',message_standard:'edifact',
  message_family:'PRODAT',message_code:parsed.messageCode,message_version:'E2SE6A',raw_payload:raw,message_received_at:received,
  application_reference:parsed.applicationReference,canonical_rule_pack_id:null,rule_profile_key:null,rule_profile_version_id:null,
  rule_profile_version:null,rule_pack_checksum:null,rule_pack_snapshot:{},execution_context_snapshot:{receivedProdatContext:{version:1,
   contextOrigin:'database_insert',sourceMessageId:source,companyId:company,environment:'test',messageCode:parsed.messageCode,
   payloadHash:hash,sourceReceivedAt:received,capturedAt:'2026-10-09T07:00:01Z'}},created_at:received,
  sender_ediel_id:parsed.senderEdielId,receiver_ediel_id:parsed.receiverEdielId,sender_sub_address:parsed.senderSubAddress,
  receiver_sub_address:parsed.receiverSubAddress,mailbox:'local@example.test',receiver_email:'local@example.test',sender_email:'remote@example.test'} as unknown as EdielMessageRow
}
function protectedSource(raw:string,field:string){
 const row=born(raw),errors=observeReceivedProdatHeaderRejection(raw),guide=AUTHORITATIVE_EDIEL_GUIDES.find(value=>value.family==='PRODAT')!
 if(errors.length!==1)throw Error('actual_typed_observation_required:'+field)
 return {version:1,sourceMessage:row,evidence:{kind:'prodat_common_header_rejection',version:1,companyId:company,environment:'test',
  sourceMessageId:source,sourceHash:evidenceHash(raw),sourceReceivedAt:received,observedAt:'2026-10-09T07:00:01Z',syntaxAssessmentId:'actual-committed-syntax',
  negativeField:{fieldCode:field,ercCode:errors[0].ercCode,text:errors[0].text},
  ...(field==='202'?{field202:{fieldCode:field,ercCode:errors[0].ercCode,text:errors[0].text}}:{}),
  guide:Object.fromEntries(Object.entries(guide).sort(([a],[b])=>a.localeCompare(b))),
  familyEdition:{version:'26.A:r3',rulePack:{id:'declared-real-family-catalog-port'},guideSources:[],sourceProjection:{actual:'declared-private-source-port'}},
  identities:originalAckPartyIdentities({rawPayload:raw}),replyApplicationReference:'23-DDQ-PRODAT',authorizesBusinessEffect:false,
  ...(field==='311'?{applicationReferenceCorrection:{sourceEdition:'068e8f82c082c2d3513ead62f4833fa89884488cbd0347fa499a0949a4c9e3c6',
    sourceSha256:'83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95',tableIndex:105,page:120,fieldCode:'311',
    originalApplicationReference:null,expectedApplicationReference:'23-DDQ-PRODAT',processEdition:'111385d7f0a83dd865de369ccee9aae3dc52098a5d3105cb3bacb4070ff7579b',
    canonicalProjection:{family:'PRODAT',code:'Z04',subtype:'H',transactionReasonCode:'Z25',receiverRoles:['supplier'],applicationReferences:['23-DDQ-PRODAT']},
    actorRole:'electricity_supplier',market:'electricity'}}:{})}}
}
it.each(['202','311','223'])('owns only a same-invocation rejected%s decision from the actual private source READ',async field=>{
 const raw=payload(field),original=born(raw);io.rpc.mockResolvedValue({data:protectedSource(raw,field),error:null})
 const token=await loadReceivedProdatHeaderRejection(original,actor);expect(token).not.toBeNull()
 const errors=readReceivedProdatHeaderRejectionErrors(token!,original,actor);expect(errors).toHaveLength(1)
 const decision={policy:null,syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'not_applicable',
  responsePlan:[{family:'APERAK',outcome:'negative',applicationErrors:errors}],validationReport:{}} as unknown as CanonicalRuntimeDecision
 expect(ownReceivedProdatHeaderRejection(decision,original,actor,token!)).toBe(true)
 expect(hasReceivedProdatHeaderRejection(decision,original,actor)).toBe(true)
 expect(hasReceivedProdatHeaderRejection({...decision},original,actor)).toBe(false)
 expect(hasReceivedProdatHeaderRejection(decision,{...original,raw_payload:payload()},actor)).toBe(false)
 expect(hasReceivedProdatHeaderRejection(decision,original,'foreign')).toBe(false)
 expect(ownReceivedProdatHeaderRejection(decision,original,actor,token!)).toBe(false)
 decision.applicationDecision='accepted';expect(hasReceivedProdatHeaderRejection(decision,original,actor)).toBe(false)
 expect(original.canonical_rule_pack_id).toBeNull();expect(original.application_reference).toBe(field==='311'?null:'23-DDQ-PRODAT')
})
it('keeps missing223 typed as its own object with real LI and Z07 in actual P34 rendering',()=>{
 const raw=payload('223'),errors=observeReceivedProdatHeaderRejection(raw)
 expect(errors).toEqual([expect.objectContaining({fieldCode:'223',ercCode:'41',referenceNumber:'735123456789012345',lineItemReference:'OWN',
  prodatOccurrence:expect.objectContaining({scope:'object',objectId:'735123456789012345',lineItemReference:'OWN'})})])
 const draft=buildAckDraftForSource({sourceMessage:born(raw),ackFamily:'APERAK',outcome:'negative',applicationErrors:errors})
 const wire=tokenizeEdifact(draft.rawPayload!),bgm=wire.segments.find(row=>row.tag==='BGM')!
 expect(segmentComposite(bgm,3,wire.una)).toEqual(['34'])
 expect(wire.segments.filter(row=>row.tag==='RFF').map(row=>segmentComposite(row,1,wire.una)))
  .toEqual(expect.arrayContaining([['ACW',parseEdifactPayload(raw).bgmReference],['LI','OWN'],['Z07','735123456789012345']]))
})
it('uses only authenticated P120 missing311 correction in the actual constructor and common national guide',async()=>{
 const raw=payload('311'),sourceMessage=born(raw),errors=observeReceivedProdatHeaderRejection(raw)
 io.rpc.mockResolvedValue({data:protectedSource(raw,'311'),error:null})
 const {evidence}=await readProdatCommonHeaderRejectionEvidence({companyId:company,environment:'test',sourceMessageId:source,
  expectedRawPayload:raw,actorUserId:actor})
 expect(commonHeaderReplyApplicationReference(evidence)).toBe('23-DDQ-PRODAT')
 expect(()=>commonHeaderReplyApplicationReference({...evidence})).toThrow('ediel_common_header_rejection_basis_required')
 const args={sourceMessage,ackFamily:'APERAK' as const,outcome:'negative' as const,applicationErrors:errors,prodatCommonHeaderRejectionEvidence:evidence}
 const draft=buildAckDraftForSource(args),wire=tokenizeEdifact(draft.rawPayload!)
 expect(parseEdifactPayload(raw).applicationReference).toBeNull();expect(sourceMessage.application_reference).toBeNull()
 expect(draft.applicationReference).toBe('23-DDQ-PRODAT')
 expect(segmentComposite(wire.segments.find(row=>row.tag==='UNB'),7,wire.una)).toEqual(['23-DDQ-PRODAT'])
 expect(segmentComposite(wire.segments.find(row=>row.tag==='BGM'),3,wire.una)).toEqual(['27'])
 expect(wire.segments.filter(row=>row.tag==='ERC').map(row=>segmentComposite(row,1,wire.una))).toEqual([['41','','260']])
 expect(wire.segments.filter(row=>row.tag==='FTX').map(row=>segmentComposite(row,3,wire.una))).toEqual([['311','','260']])
 const validation={family:'APERAK',code:'APERAK',companyId:company,environment:'test',direction:'outbound',mode:'send',
  rawPayload:draft.rawPayload,prodatCommonHeaderRejectionEvidence:evidence} as Parameters<typeof validateRulebookMessage>[0]
 const actual=validateRulebookMessage(validation)
 expect(actual.ok,JSON.stringify(actual.issues)).toBe(true)
 expect(actual).toMatchObject({fieldRuleSource:'common_header_source',rulePackSnapshot:null})
 expect(validateRulebookMessage({...validation,prodatCommonHeaderRejectionEvidence:{...evidence}}).ok).toBe(false)
 expect(validateRulebookMessage({...validation,rawPayload:draft.rawPayload!.replace('23-DDQ-PRODAT','23-DGI-PRODAT')}).ok).toBe(false)
 expect(validateRulebookMessage({...validation,rawPayload:draft.rawPayload!.replace('311::260','223::260')}).ok).toBe(false)
 expect(()=>buildAckDraftForSource({...args,outcome:'positive'})).toThrow('ack_common_header_source_scope_mismatch')
 expect(()=>buildAckDraftForSource({...args,prodatCommonHeaderRejectionEvidence:{...evidence}})).toThrow('ack_common_header_source_scope_mismatch')
})
it.each(['sourceEdition','sourceSha256','tableIndex','page','fieldCode','expectedApplicationReference','processEdition','actorRole','market'])('holds unauthenticated311 correction basis%s at its actual READ',async key=>{
 const raw=payload('311'),data=protectedSource(raw,'311');Object.assign(data.evidence.applicationReferenceCorrection!,{[key]:'wrong'})
 io.rpc.mockResolvedValue({data,error:null})
 await expect(readProdatCommonHeaderRejectionEvidence({companyId:company,environment:'test',sourceMessageId:source,
  expectedRawPayload:raw,actorUserId:actor})).rejects.toThrow('ediel_common_header_application_correction_required')
})
it('retains actual actor quarantine before a throwing negative-birth raw getter',async()=>{
 const {EdielExecutionFailure}=await import('@/lib/ediel/core/failureDisposition')
 const denied=new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_TENANT_ACTOR_FORBIDDEN'},'actual_actor_denied')
 const row=born(payload('311'));Object.defineProperty(row,'raw_payload',{get(){throw Error('untrusted_raw_getter')}});io.actor.mockRejectedValue(denied)
 await expect(loadReceivedProdatHeaderRejection(row,actor)).rejects.toBe(denied);expect(io.rpc).not.toHaveBeenCalled()
})

// External private RPC results below are declared component-test ports. The
// real kernel, source-owner decoder, guide, route and atomic output checks run;
// these fixtures do not establish native SQL, outbox or concurrency proof.
async function corrected311Draft(){
 const raw=payload('311'),sourceMessage=born(raw)
 io.rpc.mockResolvedValueOnce({data:protectedSource(raw,'311'),error:null})
 const {evidence}=await readProdatCommonHeaderRejectionEvidence({companyId:company,environment:'test',sourceMessageId:source,
  expectedRawPayload:raw,actorUserId:actor})
 const draft=buildAckDraftForSource({sourceMessage,ackFamily:'APERAK',outcome:'negative',
  applicationErrors:observeReceivedProdatHeaderRejection(raw),prodatCommonHeaderRejectionEvidence:evidence})
 io.rpc.mockReset();return {raw,sourceMessage,draft}
}
function scopeReceipt(sourceMessage:EdielMessageRow,ackMessage:EdielMessageRow,requestedRaw:string){
 const documentId=parseEdifactPayload(sourceMessage.raw_payload!).bgmReference!
 const scopes=[{scope:'message',reference:documentId,physicalReference:{documentId},outcome:'negative'}]
 return {version:2,sourceMessage,ackMessage,requestedPayloadHash:evidenceHash(requestedRaw),requestedScopes:scopes,ackScopes:scopes}
}
function ackRow(sourceMessage:EdielMessageRow,raw:string):EdielMessageRow{
 return {id:'protected-existing-ack',company_id:company,environment:'test',direction:'outbound',message_standard:'edifact',
  message_family:'APERAK',message_code:'APERAK',related_message_id:sourceMessage.id,raw_payload:raw,ack_outcome:'negative',
  status:'sent',application_reference:'23-DDQ-PRODAT'} as EdielMessageRow
}
it('carries real missing311 through the fresh kernel, private technical route, national guide and atomic ACK port',async()=>{
 const {createCanonicalAckMessage}=await import('@/lib/ediel/core/kernel')
 const {raw,sourceMessage,draft}=await corrected311Draft(),native=protectedSource(raw,'311'),ids=native.evidence.identities
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='ediel_read_outbound_ack_scope_replay_v2')return {data:null,error:null}
  if(name==='ediel_require_source_bytes_available_v1')return {data:true,error:null}
  if(name==='ediel_read_prodat_common_header_rejection_v1')return {data:native,error:null}
  if(name==='ediel_require_technical_syntax_ack_basis_v2')return {data:{kind:'technical_syntax_ack',version:1,companyId:company,
   environment:'test',sourceMessageId:source,sourceHash:evidenceHash(raw),observedAt:received,syntaxAssessmentId:'actual-committed-syntax',
   syntaxDecision:'accepted',transportActorId:'declared-transport',transportEdielId:'R',originalUNB:{sender:ids.transport.senderComponents,
    receiver:ids.transport.receiverComponents,interchangeReference:ids.transport.interchangeReference,
    uciReference:ids.transport.interchangeReference.slice(0,14),applicationReference:'',testIndicator:'1'}},error:null}
  if(name==='ediel_read_common_header_negative_ack_route_v1')return {data:{kind:'prodat_common_header_negative_ack_route',
   companyId:company,environment:'test',sourceMessageId:source,sourceHash:evidenceHash(raw),
   route:{id:'declared-route',company_id:company,is_active:true},routeRuntime:{company_id:company,route_profile_id:'declared-profile',
    communication_route_id:'declared-route',environment:'test',is_enabled:true,message_family:'APERAK',business_code:'APERAK'},
   senderEdielId:'R',senderQualifier:'14',senderSubAddress:null,receiverEdielId:'S',receiverQualifier:'14',receiverSubAddress:null,
   receiverMessageSubAddress:null,applicationReference:'23-DDQ-PRODAT',senderEmail:'configured@example.test',
   receiverEmail:'remote@example.test',mailbox:'configured@example.test',smtpHost:'smtp.example.test',smtpPort:465,
   authorizesBusinessEffect:false},error:null}
  if(name==='ediel_create_outbound_ack_scope_atomic_v2'){
   const committed=args.p_draft as Record<string,unknown>
   expect(args).toMatchObject({p_company_id:company,p_environment:'test',p_source_message_id:source,p_actor_user_id:actor,
    p_ack_family:'APERAK',p_outcome:'negative',p_common_smtp:{from:'configured@example.test',host:'smtp.example.test',port:465}})
   expect(committed.applicationReference).toBe('23-DDQ-PRODAT')
   expect(committed).not.toHaveProperty('canonicalRulePackId');expect(committed).not.toHaveProperty('customerId')
   return {data:scopeReceipt(sourceMessage,ackRow(sourceMessage,String(committed.rawPayload)),String(committed.rawPayload)),error:null}
  }
  throw Error('unexpected_private_rpc:'+name)
 })
 const result=await createCanonicalAckMessage({actorUserId:actor,sourceMessage,ackFamily:'APERAK',outcome:'negative',draft})
 expect(result.raw_payload).toBe(draft.rawPayload);expect(sourceMessage.application_reference).toBeNull()
 expect(io.rpc.mock.calls.map(call=>call[0])).toEqual(['ediel_read_outbound_ack_scope_replay_v2','ediel_require_source_bytes_available_v1',
  'ediel_read_prodat_common_header_rejection_v1','ediel_require_technical_syntax_ack_basis_v2',
  'ediel_read_common_header_negative_ack_route_v1','ediel_create_outbound_ack_scope_atomic_v2'])
})
it('returns a protected retained311 response before fresh source, role, route or atomic effects',async()=>{
 const {createCanonicalAckMessage}=await import('@/lib/ediel/core/kernel')
 const {sourceMessage,draft}=await corrected311Draft(),ack=ackRow(sourceMessage,draft.rawPayload!)
 io.rpc.mockImplementation(async(name:string)=>{
  if(name!=='ediel_read_outbound_ack_scope_replay_v2')throw Error('fresh_authority_unavailable:'+name)
  return {data:scopeReceipt(sourceMessage,ack,draft.rawPayload!),error:null}
 })
 expect(await createCanonicalAckMessage({actorUserId:actor,sourceMessage,ackFamily:'APERAK',outcome:'negative',draft})).toBe(ack)
 expect(io.rpc).toHaveBeenCalledTimes(1)
})
it.each(['202','311','223'])('takes the actual runtime negative%s owner before any operational profile or business READ',async field=>{
 const {resolveCanonicalRuntimeDecisionWithRegistry}=await import('@/lib/ediel/core/runtimeDecision')
 const raw=payload(field),sourceMessage=born(raw)
 io.rpc.mockImplementation(async(name:string)=>{
  if(name!=='ediel_read_prodat_common_header_rejection_v1')throw Error('operational_authority_forbidden:'+name)
  return {data:protectedSource(raw,field),error:null}
 })
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(sourceMessage,{actorUserId:actor})
 expect(decision).toMatchObject({policy:null,syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'not_applicable',
  validationReport:{fieldRuleSource:'physical_common_header_rejection_only'}})
 expect(hasReceivedProdatHeaderRejection(decision,sourceMessage,actor)).toBe(true)
 expect(decision.responsePlan.filter(plan=>plan.family==='APERAK')).toEqual([expect.objectContaining({outcome:'negative',
  applicationErrors:observeReceivedProdatHeaderRejection(raw)})])
 expect(io.rpc).toHaveBeenCalledTimes(1)
})
